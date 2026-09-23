# POSM Client

Path: `App/` and `Models/`.

Current client is C#/WPF/.NET 10. Older Electron references are historical and no longer describe the
implementation.

## Responsibilities

The POSM client runs on a Windows cash-desk machine:

1. Polls the authoritative active Standard-N Firebird receipt (`DOCS` + `DOC_DETAIL_ACTIVE`) for the
   local `zkassa` workstation session. It auto-reads server/path/login from the cashier `options.ini`.
2. Tails detailed cp1251 `zkassa.log` events as a compatibility fallback for older Standard-N builds.
3. Sends cart data to `POST /api/posm/recommend`.
4. Shows up to five replacement and five cross-sell recommendations to the pharmacist in one compact,
   mouse-scrollable popup. Prices are formatted in Kazakhstan tenge (`₸`).
5. Sends accepted/rejected outcomes.
6. Reports printed sales to `POST /api/posm/sales`.
7. Mirrors receipt and broadcast media on the customer display.
8. Polls the effective active playlist and app version. The backend resolves the default or
   pharmacy-targeted profile, so changing assignments or videos does not require reinstalling POSM.
9. Sends heartbeat with the current Windows monitor count so admin can count online cash desks and
   report whether a customer display is physically available.
10. Persists an atomic active-receipt draft and accepts only an exact fiscal PDF/PNG produced by an
    approved KKM/OFD adapter; POSM never reconstructs a fiscal-looking receipt.
11. Stores outgoing non-real-time events in a local SQLite outbox and retries safely.
12. Sends any cashier id/name found in Standard-N as an audit signal; the backend decides the trusted
    internal pharmacist used for bonuses.

## Important Files

| Path                                       | Role                                               |
| ------------------------------------------ | -------------------------------------------------- |
| `App/MainWindow.xaml[.cs]`                 | WPF customer display and main integration shell.   |
| `App/MainWindow.StandardNReceipt.cs`       | Live Standard-N receipt reconciliation loop.       |
| `App/MainWindow.Recommendations.cs`        | Recommendation popup wiring.                       |
| `App/MainWindow.Screen.cs`                 | Customer screen/video playlist logic.              |
| `App/MainWindow.Update.cs`                 | App auto-update logic.                             |
| `App/RecommendationWindow.xaml[.cs]`       | Pharmacist recommendation popup.                   |
| `App/CdpForm.xaml[.cs]`                    | POSM customer-phone/CDP form.                      |
| `App/Config/EpharmConfig.cs`               | Config/env parsing.                                |
| `App/Services/EpharmApiClient.cs`          | HTTP client with `X-Posm-Key`.                     |
| `App/Services/CheckoutSession.cs`          | Current receipt/cart lifecycle.                    |
| `App/Services/StandardNLogLocator.cs`      | Bounded production cash-log discovery/cache.       |
| `App/Services/StandardNDbLookup.cs`        | Workstation-bound Firebird receipt/cashier reader. |
| `App/Services/SaleReporter.cs`             | Printed sale reporting.                            |
| `App/Services/ReceiptArtifactStore.cs`     | Atomic receipt draft/pending/recovery lifecycle.   |
| `App/Services/FiscalReceiptInboxSource.cs` | Exact KKM/OFD artifact validation boundary.        |
| `App/Services/ReceiptSaleId.cs`            | Stable pharmacy/document sale id.                  |
| `App/Services/OfflineOutbox.cs`            | SQLite outbox.                                     |
| `App/Services/OutboxFlusher.cs`            | Retry loop.                                        |
| `Models/Posm/*`                            | DTOs shared by POSM requests/responses.            |

## Matching Contract

The matching contract uses three ordered identities. Exact identifiers are preferred; a product name
is only a last-resort fallback.

POSM sends:

- `barcode` - authoritative exact EAN/GTIN match against the catalog/Medusa barcode;
- `sku` - Standard-N local `iPartID`, sent only when barcode is unavailable and matched against the
  campaign product's `ipartId`;
- `name` - normalized exact-name fallback;
- `qty`, price/total data for sales.

Backend resolves barcode, then `iPartID` when barcode is unavailable, then normalized name. Ambiguous catalog keys are skipped
instead of selecting an arbitrary product.

`ExtractBarcode` supports:

- explicit `barcode=...` or `ean=...`;
- values in `iPartID=<id>(<EAN>)` when the value is 8/12/13/14 digits and differs from the internal id.

If the log does not contain EAN, POSM performs a read-only lookup in local Standard-N. It first tries
`VW_WAREBASE_KASSA`, then `PARTS.ID/BARCODE/BARCODE1/ORIG_BCODE_IZG` with a release-stable fallback
when the optional manufacturer-barcode column is absent. A missing view or a
schema difference does not abort the fallback chain. A non-cancelled recommendation response belongs
to the current cart snapshot and is trusted; POSM does not repeat backend matching with incompatible
catalog product ids.

## Config

`posm.json` keys can be overridden by environment variables:

| Key                                    | Env                                        | Meaning                                                               |
| -------------------------------------- | ------------------------------------------ | --------------------------------------------------------------------- |
| `Enabled`                              | `EPHARM_POSM_ENABLED`                      | Enables backend integration.                                          |
| `BackendBaseUrl`                       | `EPHARM_BACKEND_URL`                       | Preferred backend origin, e.g. `https://epharm.inkar.kz`.             |
| `BackendFallbackBaseUrls`              | `EPHARM_BACKEND_FALLBACK_URLS`             | Ordered backup origins; environment values use `;` or `,` separators. |
| `DeviceKey`                            | `EPHARM_POSM_KEY`                          | POSM device key for `X-Posm-Key`.                                     |
| `PharmacyId`                           | `EPHARM_PHARMACY_ID`                       | Pharmacy/screen id.                                                   |
| `PharmacistId`                         | `EPHARM_PHARMACIST_ID`                     | Diagnostic fallback only; do not use a fixed person in production.    |
| `ScreenMode`                           | `EPHARM_SCREEN_MODE`                       | `dev` windowed or `prod` monitor behavior.                            |
| `VideoEnabled`                         | `EPHARM_NO_VIDEO=true` disables            | Customer video playback.                                              |
| `PlaylistPollSec`                      | `EPHARM_PLAYLIST_POLL_SEC`                 | Playlist poll period.                                                 |
| `AppLogPath`                           | `EPHARM_APP_LOG`                           | POSM app log path.                                                    |
| `StandardNLogPaths`                    | `EPHARM_STANDARDN_LOG_PATHS`               | Optional explicit paths (`;`-separated in env).                       |
| `StandardNReceiptPollMs`               | `EPHARM_STANDARDN_RECEIPT_POLL_MS`         | Active receipt poll interval; default 400ms.                          |
| `ReceiptCaptureEnabled`                | `EPHARM_RECEIPT_CAPTURE_ENABLED`           | Enables exact-only local capture; default true.                       |
| `ReceiptCaptureDir`                    | `EPHARM_RECEIPT_CAPTURE_DIR`               | Root for active/pending/quarantine receipt artifacts.                 |
| `FiscalReceiptInboxDir`                | `EPHARM_FISCAL_RECEIPT_INBOX_DIR`          | Handoff directory written by an approved KKM/OFD adapter.             |
| `FiscalReceiptTrustedSources`          | `EPHARM_FISCAL_RECEIPT_TRUSTED_SOURCES`    | Allowed adapter identities.                                           |
| `FiscalReceiptPollSec`                 | `EPHARM_FISCAL_RECEIPT_POLL_SEC`           | Background inbox poll period; 1-60 seconds.                           |
| `FiscalReceiptMaxClockSkewSec`         | `EPHARM_FISCAL_RECEIPT_MAX_CLOCK_SKEW_SEC` | Maximum sale/document correlation skew.                               |
| `FiscalReceiptMaxArtifactMb`           | `EPHARM_FISCAL_RECEIPT_MAX_ARTIFACT_MB`    | Maximum accepted PDF/PNG size; 1-50 MB.                               |
| `ReceiptCaptureActiveRetentionDays`    | `EPHARM_RECEIPT_ACTIVE_RETENTION_DAYS`     | Retention for abandoned active drafts; 1-30 days.                     |
| `FiscalReceiptCompletedRetentionHours` | `EPHARM_FISCAL_RECEIPT_RETENTION_HOURS`    | Exact-copy retention after capture; 1-168 hours.                      |

POSM v1.0.43 uses the workstation-bound active Firebird receipt as the primary live-cart source. It
still watches explicit and previously confirmed paths first, then the two legacy v1.0.23 paths:
`C:\Standart-N\Kassir\zkassa.log` and
`C:\Standart-N_DEMO\Apteka_KZ DEMO\Kassir\zkassa.log`. In parallel it performs a bounded search near
running Standard-N/cashier processes and likely top-level installation folders. It searches only for
`zkassa.log`, avoids reparse points, never blocks the UI thread, and stores a path only after a real
cash-event marker is observed. The cache is `C:\Epharm\standardn-log-paths.txt`.

`Enabled` is effective only when key identity fields are present.

## Exact Fiscal Receipt Contract

Every open Standard-N receipt gets an atomically replaced JSON draft under
`C:\Epharm\receipts\active`. A confirmed document close or print-log marker moves the immutable
structured sale to `pending` and queues it independently of the fiscal artifact. A deterministic id
based on `pharmacyId + DOCS.ID` deduplicates print-log, Firebird-close and retry signals.

POSM never renders an image from cart rows. In the background it waits for an approved read-only
KKM/OFD adapter to publish an original PDF/PNG and atomic manifest into
`C:\Epharm\fiscal-inbox`. It validates pharmacy, Standard-N document id, total, time, required fiscal
fields, container boundaries and SHA-256, then copies the bytes without transformation. Backend
records the immutable hash and provenance in a separate idempotent enrichment request. A legacy
`artifactFormat=png` without this evidence is accepted as an old structured sale but ignored as a
fiscal artifact.

After the durable local copy passes a second SHA-256 check, POSM removes the dedicated inbox
manifest first and then its source handoff file. Failed handoff cleanup is retried from stored
metadata without deleting the accepted original.

The local exact copy is deleted only after backend acknowledgment of its fiscal metadata and the
full configured retention counted from that acknowledgment. A delivered sale for which no fiscal
source ever appears expires after the bounded source-wait window. Corrupt evidence is quarantined.
POSM does not call print, cancel, drawer, shift or fiscalization commands and never changes
Standard-N/KKM state. The real adapter and locked
Windows ACL are mandatory pilot prerequisites; the repository currently provides the validated
consumer boundary, not a universal adapter for unknown cash-register drivers. See
`docs/17-posm-exact-fiscal-receipt.md`.

## Pharmacist Attribution

Pharmacist attribution comes exclusively from the active Standard-N user on the workstation:

1. POSM reads the active Standard-N id and full name and captures them once for the receipt.
2. Backend first applies an explicit HQ rule `(pharmacy, external USER_ID) -> pharmacist`. The target
   must be active and assigned to that pharmacy. Only then can it use a valid internal id or exact
   unique full-name match within the pharmacy.
3. Any other Standard-N id/name is marked `standardn_unmapped`, stored verbatim, and shown in the
   dashboard instead of being discarded.
4. Missing identity is marked `unresolved`. Unmapped/unresolved sales do not enter automatic bonus
   reconciliation until the employee identity is mapped.

For Auezova 134, the real cashier evidence confirmed `KASSA2`, remote Firebird server `MANAGER`, and
an `options.ini` that points to `C:\Standart-N\base\ztrade.fdb`. POSM selects only a current `zkassa`
session whose `WORKSTATIONS.COMPNAME` matches the local computer, so a shared database cannot silently
attribute another cash desk's receipt or pharmacist. Other Standard-N releases remain fail-safe: a
schema/connection failure preserves the last known UI state and the log compatibility path continues.

POSM sends API requests to `BackendBaseUrl` first. On public-gateway `404/502/503/504` or a connection
failure it retries configured HTTPS fallbacks within a bounded attempt budget and probes the primary
again every five minutes. Origins must not include `/login`; the client adds `/api/posm/*`. Remote
HTTP origins are rejected; only loopback development may use HTTP.

## Screen Modes

- `dev`: windowed display for debugging.
- `prod`: with two monitors, customer display opens fullscreen on the second monitor and popup stays
  on the pharmacist/cashier screen; with one monitor, customer display is suppressed and recommendations
  can still work.

The pharmacist popup is informational and does not steal keyboard focus from Standard-N. It displays
the exact recommendation count returned by the backend, keeps its header fixed, and scrolls only the
offer list when the content exceeds the compact window height.

## Build

WPF builds only on Windows.

```powershell
cd <repo>\App
dotnet run

# release/self-contained
powershell -ExecutionPolicy Bypass -File scripts\publish-exe.ps1
```

The release package must include the exe, runtime dependencies, LibVLC files, `posm.json`, and `run.bat`.

## Deployment

For long-running cash desk installation:

- use `dotnet publish` or `publish-exe.ps1`, not `dotnet run`;
- install scheduled tasks with `App/scripts/install-tasks.ps1`;
- enable Windows autologin if the client must start after reboot without manual login;
- use the watchdog task and heartbeat file;
- publish app releases through `/api/admin/app-releases` for auto-update.

`setup-autostart.bat` copies the package to `C:\Epharm\app-<mode>\<version>`, compares key package
hashes before reusing an existing folder, performs a bounded handover from an old POSM process, and
reports success only after the expected executable path and a fresh UI heartbeat are verified.

POSM sends backend presence every 30 seconds. Backend considers a device online for 90 seconds and
persists last-seen/pharmacy mapping in Redis with an in-memory fail-safe. Presence is keyed by the
pair `pharmacyId + deviceId`, not by the Windows machine name alone: `KASSA1` can therefore exist
in multiple pharmacies without one live cash desk hiding another. The admin screen polls the
connected-device endpoint every 30 seconds. POSM v1.0.46 sends `monitorCount` and `appVersion` on
every pulse,
so connecting or disconnecting the second monitor is reflected without restarting or reinstalling
the client. During rolling update, older clients remain online and are exported as `Не определено`.
The Excel report includes a separate POSM version column so an unknown screen has an explicit rollout
cause instead of being mistaken for a confirmed one-monitor installation. v1.0.46 also caps update
polling at five minutes and resumes interrupted release downloads from a persistent partial file.

Production binary releases are mirrored in the public, artifact-only repository
`sabirovv17/epharm-posm-releases`. The source repository remains private. The production URL uses
jsDelivr with an immutable artifact-repository commit, while the GitHub release asset remains an
independent recovery source. Release archives must never contain `posm.json`, device keys,
credentials, pharmacy identifiers, or source code. The current bridge archive contains only the
application executable, DLL, deps file, runtime config, and the QR dependency DLL. Before a release becomes current, verify
an anonymous HTTPS download, Range resume, ZIP integrity, exact byte size, and SHA-256 from the final
CDN URL. Register only a manifest signed by the offline ECDSA P-256 key. `AppUpdater` verifies the
independently pinned SPKI over platform/version/URL/hash/mandatory before download and then verifies
the ZIP SHA-256. A public P-256 trust anchor is embedded in current clients so older pharmacy
configs without an explicit SPKI can still verify a signed update. A malformed nonblank override
fails closed. The installer rejects remote HTTP backend/fallback URLs before reporting success.
Pharmacy-specific `C:\Epharm\posm.json` is preserved during the overlay update.

## Merchandising task QR

Starting with v1.0.52, the same authenticated POSM channel can retrieve an active merchandising task
for the device's pharmacy and acknowledge a QR only when it is visible. Backend authentication binds
individual device tokens to both `pharmacyId` and `deviceId`; the server-to-server CRM credential is
never returned to the cash desk. The client accepts HTTPS task links (plus loopback HTTP in local
development), deduplicates acknowledgements by delivery token, and retries after transient failures.
Current clients also send `X-Device-Id`; legacy clients without the header remain compatible. The
backend treats merchandising as an optional dependency: timeout, invalid payload, or a 5xx response
returns HTTP 200 with `available=false` instead of a gateway error. POSM applies an isolated bounded
backoff (30 seconds, one, two, then five minutes), marks only the task window offline, and keeps the
recommendation, heartbeat, and sales channel on its normal backend route.
From POSM 1.0.65, healthy assignment polls use a fresh 24–36-second jitter instead of a fixed
10-second interval. This reduces load and synchronized bursts across the fleet; task visibility may
therefore take up to roughly 36 seconds under healthy connectivity.

The public task portal is routed by Caddy through exact `/merch/staff` and allowlisted task/media
paths; CRM admin/auth routes must stay unavailable there. The server-to-server base URL must use
verified HTTPS when the merchandising service is outside the private INKAR network. Production values live in `.env.prod`:
`MERCH_TASKS_ENABLED`, `MERCH_TASKS_BASE_URL`, `MERCH_TASKS_INTEGRATION_KEY`,
`MERCH_TASKS_TIMEOUT_MS`, and `MERCH_PORTAL_UPSTREAM`. Roll out with the bridge disabled first, check
the internal active-task API and public portal, enable the bridge, then confirm one end-to-end task on
a provisioned device before publishing a POSM release as current.

## Operations

Useful docs:

- `App/scripts/README-distrib.md` - dev/release package operation.
- `App/POSM_DEPLOY.md` - production installation, scheduled tasks, update release flow.
- `App/WINDOWS_RUNBOOK.md` - Windows demo and barcode scan examples.

For Standard-N identity diagnostics, run `collect-posm-diagnostics.bat` as administrator on the
cash-desk machine and return the ZIP created on the desktop. The collector redacts device keys and
database passwords.
