export function rewriteEnv(text, replacements) {
  const seen = new Set();
  const lines = text.replace(/\n$/, "").split("\n").map((line) => {
    const match = /^([A-Z][A-Z0-9_]*)=/.exec(line);
    if (!match || !Object.hasOwn(replacements, match[1])) return line;
    if (seen.has(match[1])) throw new Error(`duplicate_env_key:${match[1]}`);
    seen.add(match[1]);
    return `${match[1]}=${replacements[match[1]]}`;
  });
  for (const [key, value] of Object.entries(replacements)) {
    if (!seen.has(key)) lines.push(`${key}=${value}`);
  }
  return `${lines.join("\n")}\n`;
}

export function readEnvValue(text, key) {
  const values = text.split("\n").filter((line) => line.startsWith(`${key}=`));
  if (values.length !== 1) throw new Error(`missing_or_duplicate_env_key:${key}`);
  return values[0].slice(key.length + 1);
}
