import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Feed this file the JSON produced by `caddy adapt --config Caddyfile`.
const config = JSON.parse(readFileSync(0, "utf8"));
const servers = Object.values(config.apps.http.servers);
let checked = 0;

for (const server of servers) {
  const hostRoutes = server.routes ?? [];
  for (const hostRoute of hostRoutes) {
    const top = hostRoute.handle?.[0]?.routes ?? [];
    const merchIndex = top.findIndex((route) =>
      route.match?.some((match) => match.path?.includes("/merch/*")));
    if (merchIndex < 0) continue;

    const fallbackIndex = top.findIndex((route) => !route.match && route.group);
    assert.ok(fallbackIndex < 0 || merchIndex < fallbackIndex, "merch route must precede frontend fallback");

    const staffRoutes = top[merchIndex].handle?.[0]?.routes?.[0]?.handle?.[0]?.routes ?? [];
    const allowed = [
      ["GET", ["/merch/staff"]],
      ["GET", ["/merch/assets/*", "/merch/pharmacy-shelf.png"]],
      ["POST", [
        "/merch/api/public/task-dispatch",
        "/merch/api/public/task-dispatch/queue",
        "/merch/api/public/task-dispatch/start",
        "/merch/api/public/task-dispatch/checklist",
        "/merch/api/public/task-dispatch/evidence",
        "/merch/api/public/task-dispatch/submit",
      ]],
      ["GET", [
        "/merch/api/task-files/*",
        "/merch/api/request-item-files/*",
        "/merch/api/placement-files/*",
      ]],
    ];

    assert.equal(staffRoutes.length, allowed.length + 1, "no extra public merch routes");
    for (const [index, [method, paths]] of allowed.entries()) {
      assert.deepEqual(staffRoutes[index].match, [{ method: [method], path: paths }]);
      const handlers = staffRoutes[index].handle?.[0]?.routes?.[0]?.handle ?? [];
      assert.equal(handlers[0]?.strip_path_prefix, "/merch");
      assert.equal(handlers[1]?.handler, "reverse_proxy");
      assert.deepEqual(handlers[1]?.headers?.request?.delete, ["X-Pharmapay-Key"]);
      assert.ok(handlers[1]?.transport?.tls, "merch upstream must use verified TLS");
    }
    assert.equal(staffRoutes.at(-1)?.handle?.[0]?.handler, "static_response");
    assert.equal(staffRoutes.at(-1)?.handle?.[0]?.status_code, 404);
    checked++;
  }
}

assert.equal(checked, 2, "both public TLS and INKAR ingress routes must protect merchandising");
console.log("Merch Caddy routes: HTTPS upstream, exact allowlist and default deny in both listeners.");
