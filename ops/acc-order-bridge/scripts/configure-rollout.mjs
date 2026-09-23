#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import { createRequire } from "node:module";
import { readEnvValue, rewriteEnv } from "./lib/pilot-env.mjs";
import { validateRolloutManifest } from "./lib/rollout-manifest.mjs";

const [manifestFile, expectedSecretSha, option] = process.argv.slice(2);
const checkOnly = option === "--check";
if (process.getuid() !== 0 || !manifestFile || !/^[0-9a-f]{64}$/.test(expectedSecretSha || "")) {
  throw new Error("usage: root configure-rollout.mjs <manifest.json> <backend-secret-sha256> [--check]");
}
if (option && !checkOnly) throw new Error("unsupported_rollout_option");
for (const unit of ["inkar-shop-epharm-orders.timer", "inkar-shop-epharm-orders.service"]) {
  try {
    execFileSync("systemctl", ["is-active", "--quiet", unit]);
    throw new Error(`stop_unit_before_rollout:${unit}`);
  } catch (error) {
    if (error.message?.startsWith("stop_unit_before_rollout:")) throw error;
  }
}

const manifest = JSON.parse(fs.readFileSync(manifestFile, "utf8"));
const ids = validateRolloutManifest(manifest);
const envPath = "/etc/inkar-shop/epharm-orders.env";
const envStat = fs.statSync(envPath);
if ((envStat.mode & 0o077) !== 0 || envStat.uid !== 0) throw new Error("unsafe_env_permissions");
const before = fs.readFileSync(envPath, "utf8");
if (readEnvValue(before, "EPHARM_ORDER_SYNC_ENABLED") !== "false") {
  throw new Error("worker_must_be_disabled_before_rollout");
}
const secret = readEnvValue(before, "EPHARM_FULFILLMENT_SHARED_SECRET");
if (createHash("sha256").update(secret).digest("hex") !== expectedSecretSha) {
  throw new Error("secret_fingerprint_mismatch");
}
if (readEnvValue(before, "EPHARM_BASE_URL") !== "https://epharm.inkar.kz") {
  throw new Error("unexpected_epharm_origin");
}

// Import the exact pg runtime used by the live worker, not a separate copy.
const siteRequire = createRequire("/var/www/inkar-shop/package.json");
const { Client } = siteRequire("pg");
const dotenv = fs.readFileSync("/var/www/inkar-shop/.env.local", "utf8");
const databaseLines = dotenv.split("\n").filter((line) => line.startsWith("DATABASE_URL="));
if (databaseLines.length !== 1) throw new Error("database_url_missing_or_duplicate");
const connectionString = databaseLines[0].slice("DATABASE_URL=".length).replace(/^"|"$/g, "");
const db = new Client({ connectionString, connectionTimeoutMillis: 10000, statement_timeout: 20000 });
await db.connect();
try {
  const rows = (await db.query(
    "SELECT id, external_id, active FROM catalog_pharmacies WHERE id = ANY($1::text[])",
    [ids],
  )).rows;
  const byId = new Map(rows.map((row) => [row.id, row]));
  for (const [id, externalId] of manifest.entries) {
    const row = byId.get(id);
    if (!row || row.active !== true || `ch:${row.external_id}` !== externalId) {
      throw new Error(`catalog_mapping_drift:${id}`);
    }
  }
} finally {
  await db.end();
}

const allowlist = ids.join(",");
if (Buffer.byteLength(allowlist, "utf8") > 32000) throw new Error("allowlist_too_large");
const allowlistSha256 = createHash("sha256").update(allowlist).digest("hex");
if (checkOnly) {
  console.log(JSON.stringify({ checked: true, count: ids.length, allowlistSha256 }));
  process.exit(0);
}
const startAt = new Date().toISOString();
const after = rewriteEnv(before, {
  EPHARM_ORDER_PHARMACY_IDS: allowlist,
  EPHARM_ORDER_START_AT: startAt,
  EPHARM_ORDER_SYNC_ENABLED: "true",
  EPHARM_FULFILLMENT_ENABLED: "true",
});
const backupDir = fs.mkdtempSync("/opt/backups/acc-order-network-");
fs.copyFileSync(envPath, `${backupDir}/epharm-orders.env`);
fs.chmodSync(`${backupDir}/epharm-orders.env`, 0o600);
const next = `${envPath}.next-${process.pid}`;
try {
  fs.writeFileSync(next, after, { flag: "wx", mode: 0o600 });
  fs.renameSync(next, envPath);
} finally {
  if (fs.existsSync(next)) fs.unlinkSync(next);
}
console.log(JSON.stringify({ count: ids.length, startAt, backupDir,
  allowlistSha256 }));
