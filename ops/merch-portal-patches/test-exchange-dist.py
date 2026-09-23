"""Synthetic-only checks for the Linux atomic dist exchange helper."""

import hashlib
import importlib.util
import os
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


HELPER = Path(__file__).with_name("exchange-dist.py")


def load_helper():
    spec = importlib.util.spec_from_file_location("exchange_dist_for_test", HELPER)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def sha256(content):
    return hashlib.sha256(content).hexdigest()


@unittest.skipUnless(sys.platform == "linux", "renameat2 is Linux-only")
class ExchangeDistTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.project = Path(self.temporary.name) / "pharmacy-crm-demo"
        self.project.mkdir()
        (self.project / "scripts").mkdir()
        (self.project / "scripts" / "api_server.py").write_text("# project marker\n")
        (self.project / "package.json").write_text('{"name":"test"}\n')
        self.live = self.project / "dist"
        self.candidate = self.project / "dist.candidate-test-1"
        self.old_index = b"<html>old release</html>"
        self.new_index = b"<html>new release</html>"
        for path, content in ((self.live, self.old_index), (self.candidate, self.new_index)):
            path.mkdir()
            (path / "assets").mkdir()
            (path / "index.html").write_bytes(content)

    def call(self, *extra, live=None, candidate=None):
        return subprocess.run(
            [
                sys.executable,
                str(HELPER),
                "--live",
                str(live or self.live),
                "--candidate",
                str(candidate or self.candidate),
                "--old-index-sha256",
                sha256(self.old_index),
                "--new-index-sha256",
                sha256(self.new_index),
                *extra,
            ],
            capture_output=True,
            text=True,
            check=False,
        )

    def plan_hash(self, *extra):
        result = self.call("--dry-run", *extra)
        self.assertEqual(result.returncode, 0, result.stderr)
        match = re.search(r"plan_sha256=([0-9a-f]{64})", result.stdout)
        self.assertIsNotNone(match)
        return match.group(1)

    def test_dry_run_exchange_and_reverse_rollback(self):
        release_plan = self.plan_hash()
        self.assertEqual((self.live / "index.html").read_bytes(), self.old_index)
        result = self.call("--exchange", "--plan-sha256", release_plan)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.live / "index.html").read_bytes(), self.new_index)
        self.assertEqual((self.candidate / "index.html").read_bytes(), self.old_index)
        self.assertNotEqual(self.call("--exchange", "--plan-sha256", release_plan).returncode, 0)

        rollback_plan = self.plan_hash("--rollback")
        result = self.call("--exchange", "--rollback", "--plan-sha256", rollback_plan)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual((self.live / "index.html").read_bytes(), self.old_index)
        self.assertEqual((self.candidate / "index.html").read_bytes(), self.new_index)

    def test_refuses_stale_plan_without_mutation(self):
        release_plan = self.plan_hash()
        (self.candidate / "assets" / "new-file.js").write_bytes(b"changed")
        result = self.call("--exchange", "--plan-sha256", release_plan)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual((self.live / "index.html").read_bytes(), self.old_index)

    def test_postcheck_rejects_changed_asset_with_unchanged_index(self):
        helper = load_helper()
        (self.candidate / "assets" / "bundle.js").write_bytes(b"original")
        parent_fd = os.open(self.project, helper.DIR_FLAGS)
        try:
            parent_dev = os.fstat(parent_fd).st_dev
            before = {
                "live": helper.snapshot_dist(parent_fd, self.live.name, parent_dev),
                "candidate": helper.snapshot_dist(parent_fd, self.candidate.name, parent_dev),
            }
            temporary_name = self.project / ".test-exchange-hold"
            os.rename(self.live, temporary_name)
            os.rename(self.candidate, self.live)
            os.rename(temporary_name, self.candidate)
            (self.live / "assets" / "bundle.js").write_bytes(b"modified")
            after_live = helper.snapshot_dist(parent_fd, self.live.name, parent_dev)
            after_candidate = helper.snapshot_dist(parent_fd, self.candidate.name, parent_dev)
            self.assertEqual(after_live["index_sha256"], before["candidate"]["index_sha256"])
            self.assertNotEqual(after_live["manifest"], before["candidate"]["manifest"])
            with self.assertRaises(helper.ReleaseError):
                helper.verify_exchanged(before, after_live, after_candidate)
        finally:
            os.close(parent_fd)

    def test_refuses_symlink_nested_or_wrong_basename(self):
        alias = self.project / "dist.candidate-alias"
        alias.symlink_to(self.candidate, target_is_directory=True)
        self.assertNotEqual(self.call("--dry-run", candidate=alias).returncode, 0)

        nested = self.live / "dist.candidate-nested"
        nested.mkdir()
        (nested / "assets").mkdir()
        (nested / "index.html").write_bytes(self.new_index)
        self.assertNotEqual(self.call("--dry-run", candidate=nested).returncode, 0)

        wrong_name = self.project / "unrelated"
        wrong_name.mkdir()
        (wrong_name / "assets").mkdir()
        (wrong_name / "index.html").write_bytes(self.new_index)
        self.assertNotEqual(self.call("--dry-run", candidate=wrong_name).returncode, 0)

    def test_refuses_missing_project_marker_and_candidate_checksum(self):
        (self.project / "scripts" / "api_server.py").unlink()
        self.assertNotEqual(self.call("--dry-run").returncode, 0)
        (self.project / "scripts" / "api_server.py").write_text("# restored\n")
        (self.candidate / "index.html").write_bytes(b"wrong release")
        self.assertNotEqual(self.call("--dry-run").returncode, 0)


if __name__ == "__main__":
    unittest.main()
