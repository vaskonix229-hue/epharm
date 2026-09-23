#!/usr/bin/env node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import { readEnvValue, rewriteEnv } from "./lib/pilot-env.mjs";

const [mode, pharmacyId, expectedSha, secretFile] = process.argv.slice(2);
if (!["prepare", "enable"].includes(mode)
    || !/^sloc_[0-9A-Z]{26}$/.test(pharmacyId || "")
    || !/^[0-9a-f]{64}$/.test(expectedSha || "")
    || (mode === "prepare" && !secretFile)) {
  throw new Error("usage: configure-pilot.mjs <prepare|enable> <sloc-id> <secret-sha256> [secret-file]");
}
if (process.getuid() !== 0) throw new Error("root_required");
for (const unit of ["inkar-shop-epharm-orders.timer", "inkar-shop-epharm-orders.service"]) {
  try {
    execFileSync("systemctl", ["is-active", "--quiet", unit]);
    throw new Error(`stop_unit_before_configuration:${unit}`);
  } catch (error) {
    if (error.message?.startsWith("stop_unit_before_configuration:")) throw error;
  }
}

const envPath = "/etc/inkar-shop/epharm-orders.env";
const stat = fs.statSync(envPath);
if ((stat.mode & 0o077) !== 0 || stat.uid !== 0) throw new Error("unsafe_env_permissions");
const before = fs.readFileSync(envPath, "utf8");
if (readEnvValue(before, "EPHARM_ORDER_SYNC_ENABLED") !== "false") {
  throw new Error("worker_must_be_disabled_before_configuration");
}

let secret;
if (mode === "prepare") {
  const secretStat = fs.statSync(secretFile);
  if ((secretStat.mode & 0o077) !== 0 || secretStat.uid !== 0) throw new Error("unsafe_secret_file_permissions");
  secret = fs.readFileSync(secretFile, "utf8");
} else {
  secret = readEnvValue(before, "EPHARM_FULFILLMENT_SHARED_SECRET");
  if (readEnvValue(before, "EPHARM_ORDER_PHARMACY_IDS") !== pharmacyId) {
    throw new Error("unexpected_pilot_pharmacy");
  }
}
if (!/^[A-Za-z0-9+/_=-]{32,}$/.test(secret)
    || createHash("sha256").update(secret).digest("hex") !== expectedSha) {
  throw new Error("secret_fingerprint_mismatch");
}

const replacements = mode === "prepare"
  ? { EPHARM_FULFILLMENT_SHARED_SECRET: secret, EPHARM_ORDER_PHARMACY_IDS: pharmacyId }
  : {
    EPHARM_ORDER_START_AT: new Date().toISOString(),
    EPHARM_ORDER_SYNC_ENABLED: "true",
    EPHARM_FULFILLMENT_ENABLED: "true",
  };
const after = rewriteEnv(before, replacements);
const backupDir = fs.mkdtempSync("/opt/backups/acc-order-pilot-");
fs.copyFileSync(envPath, `${backupDir}/epharm-orders.env`);
fs.chmodSync(`${backupDir}/epharm-orders.env`, 0o600);
const next = `${envPath}.next-${process.pid}`;
try {
  fs.writeFileSync(next, after, { flag: "wx", mode: 0o600 });
  fs.renameSync(next, envPath);
} finally {
  if (fs.existsSync(next)) fs.unlinkSync(next);
}
console.log(JSON.stringify({ mode, pharmacyId, backupDir,
  ...(mode === "enable" ? { startAt: replacements.EPHARM_ORDER_START_AT } : {}) }));
