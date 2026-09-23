#!/usr/bin/env node
import pg from "pg";
import { pathToFileURL } from "node:url";
import {
  buildOrder, exactEpharmPharmacyId, parsePharmacyAllowlist, signature, stableJson,
  STATUS_LABELS, validateFeed, validateOrderAck, validateOrigin,
} from "./lib/epharm-contract.mjs";

const LOCK = 4930511130;
const OUTBOUND_PATH = "/api/integrations/storefront/orders";

function enabled(env) {
  return String(env.EPHARM_ORDER_SYNC_ENABLED ?? env.EPHARM_FULFILLMENT_ENABLED ?? "false").toLowerCase() === "true";
}

function safeErrorCode(error) {
  const message = error instanceof Error ? error.message : "";
  return /^epharm_http_\d+$|^invalid_|^unresolved_|^unsupported_/.test(message)
    ? message.slice(0, 120)
    : "epharm_delivery_failed";
}

export async function runOnce(env = process.env) {
  if (!enabled(env)) return { enabled: false };
  const origin = validateOrigin(env.EPHARM_BASE_URL);
  const secret = env.EPHARM_FULFILLMENT_SHARED_SECRET || env.EPHARM_SHARED_SECRET || "";
  const start = new Date(env.EPHARM_ORDER_START_AT || "invalid");
  if (Buffer.byteLength(secret, "utf8") < 32 || !Number.isFinite(start.valueOf())) {
    throw new Error("epharm_secret_and_explicit_start_date_required");
  }
  const allowlist = parsePharmacyAllowlist(env.EPHARM_ORDER_PHARMACY_IDS);
  const connectionString = env.DATABASE_URL || env.POSTGRES_URL;
  if (!connectionString) throw new Error("orders_database_required");
  const parsed = new URL(connectionString);
  const db = new pg.Client({
    connectionString,
    connectionTimeoutMillis: 10000,
    statement_timeout: 20000,
    application_name: "epharm-order-sync",
    ssl: parsed.searchParams.get("sslmode") === "require" ? { rejectUnauthorized: true } : undefined,
  });
  await db.connect();
  let locked = false;
  let sent = 0;
  let failed = 0;
  let updated = 0;
  const request = async (method, target, input) => {
    const body = input === undefined ? "" : stableJson(input);
    const timestamp = String(Math.floor(Date.now() / 1000));
    const response = await fetch(`${origin}${target}`, {
      method,
      redirect: "error",
      signal: AbortSignal.timeout(15000),
      headers: {
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json; charset=utf-8" } : {}),
        "X-Fulfillment-Timestamp": timestamp,
        "X-Fulfillment-Signature": signature(secret, timestamp, method, target, body),
      },
      ...(body ? { body } : {}),
    });
    const responseBody = await response.text();
    if (!response.ok) throw new Error(`epharm_http_${response.status}`);
    return JSON.parse(responseBody);
  };
  try {
    locked = (await db.query("SELECT pg_try_advisory_lock($1) AS locked", [LOCK])).rows[0].locked;
    if (!locked) return { busy: true };
    const backlog = await db.query(`
      SELECT o.*
      FROM integration_outbox o
      JOIN site_orders s ON s.id = o.aggregate_id
      WHERE o.topic = 'epharm.order.created'
        AND o.created_at >= $1
        AND s.placed_at >= $1
        AND s.status IN ('Новый','Собирается','Готов к выдаче')
        AND ($2::boolean OR o.payload->>'pharmacy_external_id' = ANY($3::text[]))
        AND (
          (o.status IN ('pending','failed') AND o.available_at <= now())
          OR (o.status = 'processing' AND o.locked_at < now() - interval '5 minutes')
        )
      ORDER BY o.created_at, o.id
      LIMIT 20
    `, [start, allowlist.all, allowlist.ids]);
    for (const event of backlog.rows) {
      try {
        await db.query(`
          UPDATE integration_outbox
          SET status='processing', locked_at=now(), attempts=attempts+1, updated_at=now()
          WHERE id=$1
        `, [event.id]);
        let input = event.epharm_request;
        if (!input) {
          const ids = (event.payload?.line_items || []).map((line) => line.variant_id).filter(Boolean);
          const catalog = ids.length ? await db.query(`
            SELECT v.id AS variant_id, v.product_id, v.sku, p.title
            FROM catalog_variants v
            JOIN catalog_products p ON p.id=v.product_id
            WHERE v.id=ANY($1::text[])
          `, [ids]) : { rows: [] };
          const localPharmacyId = String(event.payload?.pharmacy_external_id || "").trim();
          const catalogPharmacy = localPharmacyId ? await db.query(`
            SELECT id, external_id, active
            FROM catalog_pharmacies
            WHERE id=$1
          `, [localPharmacyId]) : { rows: [] };
          const externalId = exactEpharmPharmacyId(localPharmacyId, catalogPharmacy.rows[0]);
          input = buildOrder(event, catalog.rows, externalId);
          await db.query(
            "UPDATE integration_outbox SET epharm_request=$2::jsonb WHERE id=$1",
            [event.id, JSON.stringify(input)],
          );
        }
        validateOrderAck(await request("POST", OUTBOUND_PATH, input), input.orderId);
        await db.query(`
          UPDATE integration_outbox
          SET status='sent', sent_at=now(), locked_at=NULL, last_error=NULL, updated_at=now()
          WHERE id=$1
        `, [event.id]);
        sent += 1;
      } catch (error) {
        await db.query(`
          UPDATE integration_outbox
          SET status='failed', locked_at=NULL, last_error=$2,
              available_at=now()+make_interval(secs => LEAST(3600,30*power(2,LEAST(attempts,7)))),
              updated_at=now()
          WHERE id=$1
        `, [event.id, safeErrorCode(error)]);
        failed += 1;
      }
    }
    let cursor = Number((await db.query("SELECT cursor FROM epharm_sync_state WHERE id=1")).rows[0].cursor);
    let hasMore = true;
    let pages = 0;
    while (hasMore && pages < 10) {
      const target = `/api/integrations/storefront/order-updates?after=${cursor}&limit=200`;
      const feed = validateFeed(await request("GET", target), cursor);
      await db.query("BEGIN");
      try {
        for (const event of feed.updates) {
          const result = await db.query(`
            UPDATE site_orders
            SET status=$2, epharm_version=$3, status_version=status_version+1,
                metadata=metadata || jsonb_build_object('fulfillment_source','epharm'), updated_at=now()
            WHERE id=$1 AND epharm_version < $3
          `, [event.orderId, STATUS_LABELS[event.status], event.version]);
          updated += result.rowCount;
        }
        await db.query(
          "UPDATE epharm_sync_state SET cursor=$1,last_success_at=now() WHERE id=1",
          [feed.nextCursor],
        );
        await db.query("COMMIT");
      } catch (error) {
        await db.query("ROLLBACK");
        throw error;
      }
      cursor = feed.nextCursor;
      hasMore = feed.hasMore;
      pages += 1;
    }
    return { enabled: true, sent, failed, updated, cursor };
  } finally {
    if (locked) await db.query("SELECT pg_advisory_unlock($1)", [LOCK]).catch(() => undefined);
    await db.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runOnce()
    .then((result) => {
      console.log(JSON.stringify(result));
      if (result.failed) process.exitCode = 1;
    })
    .catch((error) => {
      console.error(`epharm_sync_failed:${safeErrorCode(error)}`);
      process.exitCode = 1;
    });
}
