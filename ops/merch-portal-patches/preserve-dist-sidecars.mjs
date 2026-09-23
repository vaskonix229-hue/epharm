#!/usr/bin/env node
// Prepare/verify a candidate merchandising dist without ever writing to live dist.
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statfsSync,
  statSync,
} from "node:fs";
import { join, sep } from "node:path";

const mediaDirs = ["pharmacy-exteriors", "pharmacy-exteriors-web", "catalog-previews"];
const rootPngs = [
  "pharmacy-shelf.png",
  "pharmacy-shelf-original.png",
  ...[1, 2, 3, 4, 5].map((number) => `pharmacy-cabinet-empty-${number}.png`),
];
const allowedRootFiles = new Set(["index.html", ...rootPngs]);
const allowedRootDirs = new Set(["assets", ...mediaDirs]);
const hashedAssetName = /^[A-Za-z0-9][A-Za-z0-9._-]*-[A-Za-z0-9_-]{8}\.(?:js|css|map)$/;
const minimumFreeAfterCopy = 512 * 1024 * 1024;

const [mode, liveArg, candidateArg] = process.argv.slice(2);
if (!["--prepare", "--verify"].includes(mode) || !liveArg || !candidateArg) {
  process.stderr.write("Usage: node preserve-dist-sidecars.mjs --prepare|--verify <live-dist> <candidate-dist>\n");
  process.exit(2);
}

function fail(message) { throw new Error(message); }
function assert(condition, message) { if (!condition) fail(message); }
function safeDirectory(path, label) {
  assert(lstatSync(path).isDirectory(), `${label} must be a directory, not a symlink`);
  return realpathSync(path);
}

const live = safeDirectory(liveArg, "live dist");
const candidate = safeDirectory(candidateArg, "candidate dist");
assert(live !== candidate, "live and candidate must differ");
assert(!live.startsWith(`${candidate}${sep}`) && !candidate.startsWith(`${live}${sep}`), "nested dist paths are forbidden");
assert(statSync(live).dev === statSync(candidate).dev, "candidate must be on the same filesystem for atomic exchange");

function assertRootLayout(root, candidateBeforeCopy = false) {
  const entries = readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isSymbolicLink()) fail("symlink in dist root");
    if (entry.isFile()) assert(allowedRootFiles.has(entry.name), "unexpected dist root file");
    else if (entry.isDirectory()) assert(allowedRootDirs.has(entry.name), "unexpected dist root directory");
    else fail("unsupported dist root entry");
  }
  for (const filename of allowedRootFiles) {
    assert(entries.some((entry) => entry.name === filename && entry.isFile()), `missing required root file: ${filename}`);
  }
  assert(entries.some((entry) => entry.name === "assets" && entry.isDirectory()), "assets directory missing");
  for (const dirname of mediaDirs) {
    const present = entries.some((entry) => entry.name === dirname);
    assert(candidateBeforeCopy ? !present : present, `${dirname} ${candidateBeforeCopy ? "already exists in candidate" : "is missing"}`);
  }
}

function fileHash(path) { return createHash("sha256").update(readFileSync(path)).digest("hex"); }
function treeManifest(root) {
  const files = [];
  function walk(dir, prefix) {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.isSymbolicLink()) fail("symlink in preserved assets");
      const path = join(dir, entry.name);
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path, relative);
      else if (entry.isFile()) files.push({ relative, bytes: statSync(path).size, sha256: fileHash(path) });
      else fail("unsupported preserved asset type");
    }
  }
  walk(root, "");
  const bytes = files.reduce((sum, file) => sum + file.bytes, 0);
  const digest = createHash("sha256");
  for (const file of files) digest.update(`${file.relative}\0${file.bytes}\0${file.sha256}\n`);
  return { files, count: files.length, bytes, digest: digest.digest("hex") };
}
function sameManifest(expected, actual, label) {
  assert(expected.count === actual.count && expected.bytes === actual.bytes && expected.digest === actual.digest,
    `${label} differs from live; refuse release`);
}
function copyTree(source, destination) {
  const meta = lstatSync(source);
  assert(meta.isDirectory(), "source media directory changed during copy");
  mkdirSync(destination, { mode: meta.mode });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) fail("source media changed to symlink during copy");
    const from = join(source, entry.name);
    const to = join(destination, entry.name);
    if (entry.isDirectory()) copyTree(from, to);
    else if (entry.isFile()) {
      copyFileSync(from, to);
      chmodSync(to, lstatSync(from).mode);
    } else fail("unsupported source media entry");
  }
}
function assetManifest(root) {
  const assets = join(root, "assets");
  assert(lstatSync(assets).isDirectory(), "assets must be a real directory");
  const names = readdirSync(assets).sort();
  const files = names.map((name) => {
    assert(hashedAssetName.test(name), "non-hash-named asset encountered");
    const path = join(assets, name);
    assert(lstatSync(path).isFile(), "asset must be a regular file");
    return { name, bytes: statSync(path).size, sha256: fileHash(path) };
  });
  return files;
}
function assertRootPngsEqual() {
  for (const name of rootPngs) {
    assert(fileHash(join(live, name)) === fileHash(join(candidate, name)), `${name} differs from live`);
  }
}
function assertCandidateIndex() {
  const html = readFileSync(join(candidate, "index.html"), "utf8");
  assert(!/(?:src|href)="\/assets\//.test(html), "candidate still has root-absolute assets");
  const refs = [...html.matchAll(/(?:src|href)="\.\/assets\/([^"/]+)"/g)].map((match) => match[1]);
  assert(refs.some((name) => name.endsWith(".js")) && refs.some((name) => name.endsWith(".css")), "candidate index lacks relative JS/CSS");
  for (const name of refs) assert(lstatSync(join(candidate, "assets", name)).isFile(), "candidate index references missing asset");
}

assertRootLayout(live);
assertRootLayout(candidate, mode === "--prepare");
assertRootPngsEqual();
assertCandidateIndex();
const sourceMedia = new Map(mediaDirs.map((name) => [name, treeManifest(join(live, name))]));
const oldAssets = assetManifest(live);
assetManifest(candidate);

if (mode === "--prepare") {
  const preserveBytes = [...sourceMedia.values()].reduce((sum, item) => sum + item.bytes, 0)
    + oldAssets.reduce((sum, item) => sum + item.bytes, 0);
  const fsInfo = statfsSync(candidate);
  assert(fsInfo.bavail * fsInfo.bsize >= preserveBytes + minimumFreeAfterCopy,
    "insufficient free space for preserved assets plus safety margin");
  for (const name of mediaDirs) copyTree(join(live, name), join(candidate, name));
  for (const old of oldAssets) {
    const destination = join(candidate, "assets", old.name);
    if (readdirSync(join(candidate, "assets")).includes(old.name)) {
      assert(fileHash(destination) === old.sha256, "same-named old/new asset has different bytes");
    } else {
      const source = join(live, "assets", old.name);
      copyFileSync(source, destination);
      chmodSync(destination, lstatSync(source).mode);
    }
  }
}

assertRootLayout(candidate);
for (const name of mediaDirs) {
  const freshSource = treeManifest(join(live, name));
  sameManifest(sourceMedia.get(name), freshSource, `${name} source drift`);
  const preserved = treeManifest(join(candidate, name));
  sameManifest(freshSource, preserved, name);
  process.stdout.write(`${name}: ${preserved.count} files, ${preserved.bytes} bytes, manifest SHA-256 ${preserved.digest}\n`);
}
const candidateAssets = new Map(assetManifest(candidate).map((asset) => [asset.name, asset]));
const freshOldAssets = assetManifest(live);
assert(freshOldAssets.length === oldAssets.length && freshOldAssets.every((asset, index) =>
  asset.name === oldAssets[index].name && asset.bytes === oldAssets[index].bytes && asset.sha256 === oldAssets[index].sha256),
"legacy assets changed during verification");
for (const old of oldAssets) {
  const copied = candidateAssets.get(old.name);
  assert(copied && copied.bytes === old.bytes && copied.sha256 === old.sha256, "legacy asset was not preserved byte-for-byte");
}
assertRootPngsEqual();
assertCandidateIndex();
process.stdout.write(`root PNG: ${rootPngs.length} byte-identical; legacy assets: ${oldAssets.length} byte-identical; candidate assets: ${candidateAssets.size}; ${mode.slice(2)} OK\n`);
