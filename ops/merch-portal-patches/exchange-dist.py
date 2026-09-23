#!/usr/bin/env python3
"""Fail-closed Linux atomic dist exchange; never run without a reviewed dry-run."""

import argparse
import ctypes
import fcntl
import hashlib
import json
import os
import re
import stat
import sys
from pathlib import Path


RENAME_EXCHANGE = 2
CANDIDATE_NAME = re.compile(r"dist\.candidate-[A-Za-z0-9][A-Za-z0-9._-]{3,63}\Z")
SHA256 = re.compile(r"[0-9a-f]{64}\Z")
MAX_INDEX_BYTES = 1024 * 1024
DIR_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW | os.O_CLOEXEC
FILE_FLAGS = os.O_RDONLY | os.O_NOFOLLOW | os.O_CLOEXEC


class ReleaseError(Exception):
    pass


def sha256_regular_at(directory_fd, name, max_bytes=None):
    before = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
    if not stat.S_ISREG(before.st_mode) or (max_bytes is not None and before.st_size > max_bytes):
        raise ReleaseError(f"{name} is not a bounded regular marker file")
    fd = os.open(name, FILE_FLAGS, dir_fd=directory_fd)
    try:
        opened = os.fstat(fd)
        if (opened.st_dev, opened.st_ino) != (before.st_dev, before.st_ino):
            raise ReleaseError(f"{name} changed while opening")
        digest = hashlib.sha256()
        while chunk := os.read(fd, 65536):
            digest.update(chunk)
        after = os.fstat(fd)
        if (after.st_size, after.st_mtime_ns, after.st_ctime_ns) != (
            before.st_size,
            before.st_mtime_ns,
            before.st_ctime_ns,
        ):
            raise ReleaseError(f"{name} changed while hashing")
        return digest.hexdigest()
    finally:
        os.close(fd)


def tree_manifest(directory_fd):
    """Hash every regular file and path, rejecting symlinks and concurrent writes."""
    digest = hashlib.sha256()
    file_count = 0
    total_bytes = 0

    def visit(fd, prefix):
        nonlocal file_count, total_bytes
        before = os.fstat(fd)
        with os.scandir(fd) as entries:
            names = sorted(entry.name for entry in entries)
        for name in names:
            relative = f"{prefix}/{name}" if prefix else name
            item = os.stat(name, dir_fd=fd, follow_symlinks=False)
            if stat.S_ISDIR(item.st_mode):
                child_fd = os.open(name, DIR_FLAGS, dir_fd=fd)
                try:
                    opened = os.fstat(child_fd)
                    if (opened.st_dev, opened.st_ino) != (item.st_dev, item.st_ino):
                        raise ReleaseError("dist directory changed while opening")
                    digest.update(b"d\0" + os.fsencode(relative) + b"\0")
                    visit(child_fd, relative)
                finally:
                    os.close(child_fd)
            elif stat.S_ISREG(item.st_mode):
                file_hash = sha256_regular_at(fd, name)
                digest.update(
                    b"f\0"
                    + os.fsencode(relative)
                    + b"\0"
                    + str(item.st_size).encode()
                    + b"\0"
                    + file_hash.encode()
                    + b"\0"
                )
                file_count += 1
                total_bytes += item.st_size
            else:
                raise ReleaseError("dist contains a symlink or non-regular entry")
        after = os.fstat(fd)
        if (before.st_mtime_ns, before.st_ctime_ns) != (after.st_mtime_ns, after.st_ctime_ns):
            raise ReleaseError("dist changed while hashing")

    visit(directory_fd, "")
    return {"sha256": digest.hexdigest(), "files": file_count, "bytes": total_bytes}


def snapshot_dist(parent_fd, name, parent_dev):
    entry = os.stat(name, dir_fd=parent_fd, follow_symlinks=False)
    if not stat.S_ISDIR(entry.st_mode) or entry.st_dev != parent_dev:
        raise ReleaseError(f"{name} must be a real directory on the parent filesystem")
    fd = os.open(name, DIR_FLAGS, dir_fd=parent_fd)
    try:
        opened = os.fstat(fd)
        if (opened.st_dev, opened.st_ino) != (entry.st_dev, entry.st_ino):
            raise ReleaseError(f"{name} changed while opening")
        assets = os.stat("assets", dir_fd=fd, follow_symlinks=False)
        if not stat.S_ISDIR(assets.st_mode) or assets.st_dev != parent_dev:
            raise ReleaseError(f"{name}/assets is not a real same-filesystem directory")
        return {
            "dev": opened.st_dev,
            "ino": opened.st_ino,
            "mtime_ns": opened.st_mtime_ns,
            "ctime_ns": opened.st_ctime_ns,
            "index_sha256": sha256_regular_at(fd, "index.html", MAX_INDEX_BYTES),
            "manifest": tree_manifest(fd),
        }
    finally:
        os.close(fd)


def check_path(raw, expected_name=None):
    path = Path(raw)
    if not path.is_absolute() or os.path.normpath(raw) != raw:
        raise ReleaseError("paths must be absolute and normalized")
    if str(path) != os.path.realpath(raw):
        raise ReleaseError("paths and their parents must not contain symlinks")
    if expected_name and path.name != expected_name:
        raise ReleaseError(f"live directory basename must be {expected_name}")
    return path


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__)
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--dry-run", action="store_true", help="validate and print a one-use plan hash")
    action.add_argument("--exchange", action="store_true", help="perform one atomic exchange")
    parser.add_argument("--rollback", action="store_true", help="expect the new dist at live and the old dist at candidate")
    parser.add_argument("--live", required=True)
    parser.add_argument("--candidate", required=True)
    parser.add_argument("--old-index-sha256", required=True)
    parser.add_argument("--new-index-sha256", required=True)
    parser.add_argument("--plan-sha256", help="required for --exchange; from the immediately preceding dry-run")
    args = parser.parse_args()
    for label in ("old_index_sha256", "new_index_sha256"):
        if not SHA256.fullmatch(getattr(args, label)):
            parser.error(f"--{label.replace('_', '-')} must be a lowercase SHA-256")
    if args.old_index_sha256 == args.new_index_sha256:
        parser.error("old and new index checksums must differ")
    if args.exchange and not args.plan_sha256:
        parser.error("--exchange requires --plan-sha256 from a reviewed dry-run")
    if args.plan_sha256 and not SHA256.fullmatch(args.plan_sha256):
        parser.error("--plan-sha256 must be a lowercase SHA-256")
    if args.dry_run and args.plan_sha256:
        parser.error("--plan-sha256 is only accepted with --exchange")
    return args


def verify_exchanged(before, after_live, after_candidate):
    """Check directory identity and all bytes, not merely the SPA entrypoints."""
    for actual, expected in (
        (after_live, before["candidate"]),
        (after_candidate, before["live"]),
    ):
        for key in ("dev", "ino", "index_sha256", "manifest"):
            if actual[key] != expected[key]:
                raise ReleaseError("exchange returned but post-check failed; inspect both directories before further action")


def run(args):
    if sys.platform != "linux":
        raise ReleaseError("renameat2(RENAME_EXCHANGE) is Linux-only")
    live = check_path(args.live, "dist")
    candidate = check_path(args.candidate)
    if not CANDIDATE_NAME.fullmatch(candidate.name):
        raise ReleaseError("candidate basename must match dist.candidate-<release-id>")
    if live.parent != candidate.parent or live.parent == Path("/"):
        raise ReleaseError("live and candidate must be sibling directories under a project root")
    if live == candidate:
        raise ReleaseError("live and candidate cannot be identical")

    parent_fd = os.open(live.parent, DIR_FLAGS)
    try:
        fcntl.flock(parent_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        parent = os.fstat(parent_fd)
        package = os.stat("package.json", dir_fd=parent_fd, follow_symlinks=False)
        if not stat.S_ISREG(package.st_mode):
            raise ReleaseError("project marker package.json is not a regular file")
        scripts = os.stat("scripts", dir_fd=parent_fd, follow_symlinks=False)
        if not stat.S_ISDIR(scripts.st_mode):
            raise ReleaseError("project marker scripts is not a directory")
        scripts_fd = os.open("scripts", DIR_FLAGS, dir_fd=parent_fd)
        try:
            server = os.stat("api_server.py", dir_fd=scripts_fd, follow_symlinks=False)
            if not stat.S_ISREG(server.st_mode):
                raise ReleaseError("project marker scripts/api_server.py is not a regular file")
        finally:
            os.close(scripts_fd)

        def plan():
            current_live = snapshot_dist(parent_fd, live.name, parent.st_dev)
            current_candidate = snapshot_dist(parent_fd, candidate.name, parent.st_dev)
            expected_live = args.new_index_sha256 if args.rollback else args.old_index_sha256
            expected_candidate = args.old_index_sha256 if args.rollback else args.new_index_sha256
            if current_live["index_sha256"] != expected_live:
                raise ReleaseError("live index checksum does not match the expected release state")
            if current_candidate["index_sha256"] != expected_candidate:
                raise ReleaseError("candidate index checksum does not match the expected release state")
            return {
                "version": 1,
                "direction": "rollback" if args.rollback else "deploy",
                "parent": str(live.parent),
                "parent_dev": parent.st_dev,
                "parent_ino": parent.st_ino,
                "live": current_live,
                "candidate": current_candidate,
            }

        current = plan()
        encoded = json.dumps(current, sort_keys=True, separators=(",", ":")).encode()
        plan_sha256 = hashlib.sha256(encoded).hexdigest()
        if args.dry_run:
            print(f"dry-run: {current['direction']} validated; plan_sha256={plan_sha256}")
            return
        if args.plan_sha256 != plan_sha256:
            raise ReleaseError("plan changed since dry-run; re-check the candidate before retrying")

        libc = ctypes.CDLL(None, use_errno=True)
        renameat2 = getattr(libc, "renameat2", None)
        if renameat2 is None:
            raise ReleaseError("libc renameat2 is unavailable")
        renameat2.argtypes = (ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint)
        renameat2.restype = ctypes.c_int
        # Recheck immediately before the syscall; parent fd and flock remain held.
        if plan() != current:
            raise ReleaseError("dist changed since validation; do not exchange")
        result = renameat2(
            parent_fd,
            live.name.encode(),
            parent_fd,
            candidate.name.encode(),
            RENAME_EXCHANGE,
        )
        if result != 0:
            error = ctypes.get_errno()
            raise ReleaseError(f"renameat2 failed: {os.strerror(error)}")
        after_live = snapshot_dist(parent_fd, live.name, parent.st_dev)
        after_candidate = snapshot_dist(parent_fd, candidate.name, parent.st_dev)
        verify_exchanged(current, after_live, after_candidate)
        print(f"atomic exchange complete: {current['direction']}; previous live retained at {candidate}")
    finally:
        os.close(parent_fd)


def main():
    try:
        run(parse_args())
    except (ReleaseError, OSError) as error:
        print(f"refused: {error}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
