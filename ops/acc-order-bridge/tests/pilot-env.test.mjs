import test from "node:test";
import assert from "node:assert/strict";
import { readEnvValue, rewriteEnv } from "../scripts/lib/pilot-env.mjs";

test("pilot environment replacement preserves unrelated keys and comments", () => {
  const before = "# ACC\nEPHARM_ORDER_SYNC_ENABLED=false\nEPHARM_BASE_URL=https://epharm.example\n";
  const after = rewriteEnv(before, {
    EPHARM_ORDER_SYNC_ENABLED: "true",
    EPHARM_ORDER_PHARMACY_IDS: "sloc_01KSAHYDSFE9QRRNK42YZB1D2S",
  });
  assert.match(after, /^# ACC\n/);
  assert.equal(readEnvValue(after, "EPHARM_BASE_URL"), "https://epharm.example");
  assert.equal(readEnvValue(after, "EPHARM_ORDER_SYNC_ENABLED"), "true");
  assert.equal(readEnvValue(after, "EPHARM_ORDER_PHARMACY_IDS"), "sloc_01KSAHYDSFE9QRRNK42YZB1D2S");
});

test("duplicate security-sensitive configuration fails closed", () => {
  assert.throws(() => rewriteEnv("EPHARM_ORDER_SYNC_ENABLED=false\nEPHARM_ORDER_SYNC_ENABLED=true\n",
    { EPHARM_ORDER_SYNC_ENABLED: "true" }), /duplicate_env_key/);
  assert.throws(() => readEnvValue("EPHARM_ORDER_SYNC_ENABLED=false\nEPHARM_ORDER_SYNC_ENABLED=true\n",
    "EPHARM_ORDER_SYNC_ENABLED"), /missing_or_duplicate_env_key/);
});
