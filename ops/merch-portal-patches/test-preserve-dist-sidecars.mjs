import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./preserve-dist-sidecars.mjs", import.meta.url));
const mediaDirs = ["pharmacy-exteriors", "pharmacy-exteriors-web", "catalog-previews"];
const rootPngs = [
  "pharmacy-shelf.png",
  "pharmacy-shelf-original.png",
  ...[1, 2, 3, 4, 5].map((number) => `pharmacy-cabinet-empty-${number}.png`),
];

function fixture() {
  const base = mkdtempSync(join(tmpdir(), "merch-dist-sidecars-"));
  const live = join(base, "live");
  const candidate = join(base, "candidate");
  mkdirSync(join(live, "assets"), { recursive: true });
  mkdirSync(join(candidate, "assets"), { recursive: true });
  for (const name of rootPngs) {
    writeFileSync(join(live, name), `original ${name}`);
    writeFileSync(join(candidate, name), `original ${name}`);
  }
  writeFileSync(join(live, "index.html"), '<script src="/assets/index-OLDabc12.js"></script>');
  writeFileSync(join(candidate, "index.html"), '<script src="./assets/index-NEWabc12.js"></script><link href="./assets/index-NEWabc12.css" rel="stylesheet">');
  writeFileSync(join(live, "assets", "index-OLDabc12.js"), "legacy code");
  writeFileSync(join(live, "assets", "index-OLDabc12.css"), "legacy style");
  writeFileSync(join(candidate, "assets", "index-NEWabc12.js"), "new code");
  writeFileSync(join(candidate, "assets", "index-NEWabc12.css"), "new style");
  for (const name of mediaDirs) mkdirSync(join(live, name));
  mkdirSync(join(live, "pharmacy-exteriors", "101-101"));
  writeFileSync(join(live, "pharmacy-exteriors", "101-101", "photo.jpg"), "exterior photo bytes");
  writeFileSync(join(live, "pharmacy-exteriors-web", "photo.webp"), "web photo bytes");
  writeFileSync(join(live, "catalog-previews", "preview.jpg"), "catalog photo bytes");
  return { base, live, candidate };
}
function run(mode, live, candidate) {
  return spawnSync(process.execPath, [script, mode, live, candidate], { encoding: "utf8" });
}

test("prepares a candidate, preserves sidecars and legacy assets, and never writes live", () => {
  const { base, live, candidate } = fixture();
  try {
    const original = readFileSync(join(live, "pharmacy-exteriors", "101-101", "photo.jpg"));
    const prepared = run("--prepare", live, candidate);
    assert.equal(prepared.status, 0, prepared.stderr);
    assert.match(prepared.stdout, /legacy assets: 2 byte-identical/);
    assert.equal(readFileSync(join(candidate, "pharmacy-exteriors", "101-101", "photo.jpg")).toString(), original.toString());
    assert.equal(readFileSync(join(candidate, "assets", "index-OLDabc12.js"), "utf8"), "legacy code");
    assert.equal(readFileSync(join(live, "pharmacy-exteriors", "101-101", "photo.jpg")).toString(), original.toString());
    assert.equal(run("--verify", live, candidate).status, 0);

    writeFileSync(join(candidate, "catalog-previews", "preview.jpg"), "corrupted candidate");
    const rejected = run("--verify", live, candidate);
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /catalog-previews differs from live/);
    assert.equal(readFileSync(join(live, "catalog-previews", "preview.jpg"), "utf8"), "catalog photo bytes");
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("rejects a symlink in live media before any candidate copy", () => {
  const { base, live, candidate } = fixture();
  try {
    symlinkSync(join(live, "catalog-previews", "preview.jpg"), join(live, "catalog-previews", "linked.jpg"));
    const rejected = run("--prepare", live, candidate);
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /symlink in preserved assets/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test("rejects changed root PNG before copying sidecars", () => {
  const { base, live, candidate } = fixture();
  try {
    writeFileSync(join(candidate, "pharmacy-shelf.png"), "wrong placeholder");
    const rejected = run("--prepare", live, candidate);
    assert.notEqual(rejected.status, 0);
    assert.match(rejected.stderr, /pharmacy-shelf\.png differs from live/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
