#!/usr/bin/env node
// Sanitizes a known upstream Auth.jsx without ever recording its embedded credentials in a diff.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const baselineSha256 = "b9c04ea5de77de0211a73d2384c4fabe6eec3ae8aaf95c6f7b0e66f433dc5468";
const [rootArg, mode = "--check"] = process.argv.slice(2);
if (!rootArg || !["--check", "--apply-and-build"].includes(mode)) {
  process.stderr.write("Usage: node strip-demo-autofill.mjs <merch-source-dir> [--check|--apply-and-build]\n");
  process.exit(2);
}

const root = realpathSync(resolve(rootArg));
if (root === "/opt/pharmacy-crm-demo") throw new Error("Refusing live source tree; use an isolated staging copy");
const authPath = join(root, "src", "Auth.jsx");
const original = readFileSync(authPath, "utf8");
const sha256 = createHash("sha256").update(original).digest("hex");
if (sha256 !== baselineSha256) throw new Error("Auth.jsx differs from audited baseline; review manually");

const credentials = [...original.matchAll(/email: "([^"]+)", password: "([^"]+)"/g)];
if (credentials.length !== 3) throw new Error("Expected three embedded demo credentials");
const forbidden = new Set(credentials.flatMap((match) => [match[1], match[2]]));

let source = original;
function replaceExactly(label, pattern, replacement, expected) {
  const found = [...source.matchAll(pattern)];
  if (found.length !== expected) throw new Error(`${label}: expected ${expected} matches, found ${found.length}`);
  source = source.replace(pattern, replacement);
}

replaceExactly("demo account array", /^const demoAccounts = \[[\s\S]*?^\];\n\n/gm, "", 1);
replaceExactly("default emails", /^(  const \[email, setEmail\] = useState\()[^\n]+(\);)$/gm, '$1""$2', 2);
replaceExactly("default passwords", /^(  const \[password, setPassword\] = useState\()[^\n]+(\);)$/gm, '$1""$2', 2);
replaceExactly("demo selection handlers", /^  const selectAccount = \(account\) => \{\n[\s\S]*?^  \};\n\n/gm, "", 2);
replaceExactly("page demo picker", /^          <div className="demo-accounts" aria-label="Демонстрационные роли">\n[\s\S]*?^          <\/div>\n\n/gm, "", 1);
replaceExactly("modal demo picker", /^              <details className="demo-login-details">\n[\s\S]*?^              <\/details>\n\n/gm, "", 1);
replaceExactly("demo heading", /Выберите роль для демонстрации или введите данные пользователя\./g, "Введите данные своей учётной записи.", 1);
replaceExactly("page demo hint", /^          <small className="demo-password">Данные выбранной роли подставляются автоматически<\/small>\n/gm, "", 1);
replaceExactly("modal demo hint", /^              <small className="demo-password">Выберите роль выше — данные для входа подставятся автоматически<\/small>\n/gm, "", 1);

if ([...forbidden].some((value) => source.includes(value))) throw new Error("Embedded credential survived source sanitization");
if (/demoAccounts|selectAccount|Демонстрационные роли/.test(source)) throw new Error("Demo picker survived source sanitization");

if (mode === "--check") {
  process.stdout.write("Sanitization preflight passed; no files changed.\n");
  process.exit(0);
}

writeFileSync(authPath, source, "utf8");
const build = spawnSync("npm", ["run", "build"], { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
if (build.status !== 0) throw new Error(`Sanitized build failed (exit ${build.status ?? "unknown"})`);
const assetDir = join(root, "dist", "assets");
const bundlePaths = readdirSync(assetDir).filter((name) => name.endsWith(".js")).map((name) => join(assetDir, name));
if (!bundlePaths.length) throw new Error("No built JS assets found");
for (const assetPath of bundlePaths) {
  const bundle = readFileSync(assetPath, "utf8");
  if ([...forbidden].some((value) => bundle.includes(value))) throw new Error("Embedded credential survived production build");
}
process.stdout.write(`Sanitized build passed; ${bundlePaths.length} JS assets contain no audited demo credentials.\n`);
