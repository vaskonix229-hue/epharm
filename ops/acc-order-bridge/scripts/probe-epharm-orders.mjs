#!/usr/bin/env node
import { signature, validateFeed, validateOrigin } from "./lib/epharm-contract.mjs";

const origin = validateOrigin(process.env.EPHARM_BASE_URL);
const secret = process.env.EPHARM_FULFILLMENT_SHARED_SECRET || "";
if (Buffer.byteLength(secret, "utf8") < 32) throw new Error("missing_hmac_secret");

const target = "/api/integrations/storefront/order-updates?after=0&limit=1";
const timestamp = String(Math.floor(Date.now() / 1000));
const response = await fetch(`${origin}${target}`, {
  redirect: "error",
  signal: AbortSignal.timeout(10000),
  headers: {
    Accept: "application/json",
    "X-Fulfillment-Timestamp": timestamp,
    "X-Fulfillment-Signature": signature(secret, timestamp, "GET", target),
  },
});
if (!response.ok) throw new Error(`signed_feed_http_${response.status}`);
const feed = validateFeed(await response.json(), 0);
console.log(JSON.stringify({ signedFeed: "ok", updatesInProbePage: feed.updates.length }));
