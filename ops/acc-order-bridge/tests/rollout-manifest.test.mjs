import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { validateRolloutManifest } from "../scripts/lib/rollout-manifest.mjs";

const id1 = "sloc_01KSAHYDSFE9QRRNK42YZB1D2S";
const id2 = "sloc_01KSAHYDSMPG5DCG9JBFW0Q4ZZ";
const at = "2026-09-22T21:11:21Z";

test("network manifest is fresh, exact, sorted and unique", () => {
  const manifest = JSON.parse(fs.readFileSync(new URL("../rollout-2026-09-22.json", import.meta.url), "utf8"));
  const ids = validateRolloutManifest(manifest, new Date("2026-09-22T22:00:00Z"));
  assert.equal(ids.length, 477);
  assert.equal(new Set(ids).size, ids.length);
});

test("rollout rejects stale, duplicate or unverified mappings", () => {
  const valid = { generatedAtUtc: at, entries: [[id1, "ch:432"], [id2, "ch:701"]] };
  assert.deepEqual(validateRolloutManifest(valid, new Date("2026-09-22T22:00:00Z")), [id1, id2]);
  assert.throws(() => validateRolloutManifest(valid, new Date("2026-09-24T22:00:00Z")), /stale/);
  assert.throws(() => validateRolloutManifest({ ...valid, entries: [valid.entries[0], valid.entries[0]] },
    new Date("2026-09-22T22:00:00Z")), /invalid_rollout_entry/);
  assert.throws(() => validateRolloutManifest({ ...valid, entries: [[id1, "unknown"]] },
    new Date("2026-09-22T22:00:00Z")), /invalid_rollout_entry/);
});
