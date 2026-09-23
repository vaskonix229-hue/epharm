# ACC → ePharm order bridge

This directory tracks the **actual ACC storefront worker** deployed at
`/var/www/inkar-shop/scripts/sync-epharm-orders.mjs` on `90.156.222.185`.
The monorepo's `storefront/` is an older application revision and must not be
deployed over the ACC site. The deploy script guards the audited live file
checksums and backs up both scripts and the environment before replacing code.

## Why this patch is necessary

- ePharm production links use `ch:<Medusa numeric ID>` for all 505 pharmacy
  links. ACC's older worker used Daribar `source_code` or a local `sloc_` ID.
  Neither value matches the existing ePharm links. The worker now derives the
  backend external ID only from the exact, active `catalog_pharmacies` row.
- ACC cash-on-pickup orders currently use `payment_status=not_required`.
  The bridge sends `pending`, preserving ePharm's mandatory `cashCollected`
  confirmation before issue.
- `EPHARM_ORDER_PHARMACY_IDS` is required when enabling the worker. Use a
  comma-separated list of `sloc_` IDs for the pilot. `*` explicitly opts in
  the entire mapped network after acceptance.
- ePharm and ACC HMAC secrets must match. Preserve the ePharm secret: it is
  also used to verify pickup codes for existing orders. Copy it to the
  root-only ACC environment file; never put it in Git or deployment packages.

## Production audit, 2026-09-22

- 496 active pharmacies have an exact `sloc_` → `ch:` pair in both databases.
- 7 ePharm-linked locations have no numeric external ID in ACC; one more
  ePharm-linked location is absent from the ACC catalog.
- 25 ACC locations with numeric external IDs have no ePharm link. These
  locations remain outside the rollout until their exact pairs are verified.
- Pilot candidate `sloc_01KSAHYDSFE9QRRNK42YZB1D2S` is Алматы, Абая
  150/230, mapped to `ch:432`. Its POSM device is on version 1.0.63.
- Three pre-existing, unprocessed storefront orders from other pharmacies
  were present before cutover. Set `EPHARM_ORDER_START_AT` to the actual
  enablement time in UTC to exclude them from automatic dispatch.

## Release sequence

1. Run `node --test tests/epharm-contract.test.mjs` on the release folder.
2. Keep the ACC order worker disabled, then run `deploy.sh` as root on the ACC
   server. Retain the reported backup directory.
3. Compare SHA-256 fingerprints of `FULFILLMENT_SHARED_SECRET` on ePharm and
   `EPHARM_FULFILLMENT_SHARED_SECRET` on ACC. Copy the ePharm value to ACC if
   needed. Load the root-only ACC env and run
   `node scripts/probe-epharm-orders.mjs` to verify a signed, read-only feed.
4. Set `EPHARM_ORDER_PHARMACY_IDS` to the pilot pharmacy and
   `EPHARM_ORDER_START_AT` to an explicit UTC timestamp after old orders.
   `scripts/configure-pilot.mjs prepare <sloc-id> <backend-secret-sha256>
   <root-only-secret-file>` verifies the fingerprint, backs up the root-only
   env file, and sets the allowlist while leaving sync disabled. After the
   signed probe, `scripts/configure-pilot.mjs enable <sloc-id>
   <backend-secret-sha256>` sets the current UTC cutoff and enables sync.
5. Enable `EPHARM_ORDER_SYNC_ENABLED=true`, start the systemd timer and make
   a demo or cash-on-pickup order for the pilot location. Verify assignment,
   POSM display, state transitions, and return status to the ACC customer view.
6. Only after the pilot passes on two independent cash desks and the status
   feed remains healthy for a full shift, expand the allowlist. Resolve the
   33 mapping exceptions before using `*`.

## Pilot status, 2026-09-22 20:20 UTC

The audited bridge code is installed on ACC, its HMAC fingerprint matches the
existing ePharm backend, and a signed read-only status-feed probe passed. The
worker ran once with `sent=0`, `failed=0`, `updated=0`; there were no new ACC
outbox orders after the cutover time. It was then **disabled again** because
the only registered POSM device at Абая 150/230 last polled ePharm at
18:55 UTC, over an hour earlier. Other ePharm devices remained online, so
this is a location-specific pilot blocker rather than a backend outage.

Do not re-enable the timer merely because the software tests pass. First
confirm a fresh heartbeat and a pharmacist-visible POSM session at the exact
location, then conduct a coordinated real or clearly labelled test pickup.
The site checkout requires a real Daribar-authenticated commercial order;
creating a synthetic database order would bypass that contract and must not be
used as evidence of end-to-end acceptance. Card-payment authority and the
second independent cash desk remain separate rollout gates.

## Explicit network rollout request, 2026-09-22

The operator clarified that overnight offline tills are expected after pharmacy
closing time and explicitly requested distribution to the fleet before the
physical pilot. POSM `1.0.63` is already the mandatory signed Windows release;
the public ZIP matches the registered SHA-256, and all 111 currently connected
registers report `1.0.63.0`. Publishing an identical new POSM binary would not
change those clients. The remaining release action is the ACC order worker.

`rollout-2026-09-22.json` is an audited allowlist of 477 pharmacies with all
three prerequisites: active ACC catalog row, exact active ePharm `ch:` link,
and an active individual POSM device. It covers all 111 registers online at
the audit time. The other 26 provisioned pharmacy IDs do not have a verified
active ACC mapping and must remain excluded; no fuzzy matching is allowed.

Run `configure-rollout.mjs <manifest.json> <backend-secret-sha256> --check`
on the ACC server before changing state. The script rejects an old/duplicate
manifest, altered ACC catalog mappings, a wrong secret or origin, and an active
worker. After rechecking ePharm links, run it without `--check` to back up the
root-only env, set an explicit current UTC cutoff, and enable only those 477
IDs. Start the timer separately, inspect the first cycles and preserve the
backup path. This is a deployment authorization, **not** evidence of end-to-end
pharmacist acceptance; a real order and status round-trip still need a staffed
pharmacy, and untrusted card payments remain pending until authority is set.

Rollback: stop the ACC timer and service, set `EPHARM_ORDER_SYNC_ENABLED=false`,
then, if necessary, set `FULFILLMENT_ENABLED=false` in ePharm. Restore the two
worker files from the deployment backup only while the timer is stopped. Keep
orders, outbox records, status feed, and audit history intact.
