export function validateRolloutManifest(manifest, now = new Date()) {
  if (!manifest || !Array.isArray(manifest.entries) || !manifest.entries.length
      || !Number.isFinite(Date.parse(manifest.generatedAtUtc))) {
    throw new Error("invalid_rollout_manifest");
  }
  const ageMs = now.valueOf() - Date.parse(manifest.generatedAtUtc);
  if (ageMs < 0 || ageMs > 24 * 60 * 60 * 1000) {
    throw new Error("stale_rollout_manifest");
  }
  const ids = [];
  let previous = "";
  for (const entry of manifest.entries) {
    if (!Array.isArray(entry) || entry.length !== 2
        || !/^sloc_[0-9A-Z]{26}$/.test(entry[0])
        || !/^ch:[1-9][0-9]*$/.test(entry[1])
        || entry[0] <= previous) {
      throw new Error("invalid_rollout_entry");
    }
    ids.push(entry[0]);
    previous = entry[0];
  }
  return ids;
}
