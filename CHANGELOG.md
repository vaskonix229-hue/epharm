# Changelog

All notable production changes to Epharm are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and release tags use semantic versioning.

## [Unreleased]

### Added

- Completed pharmacist course materials end to end: administrators can publish external links,
  interactive content, downloadable attachments, required lessons and minimum video-view targets;
  the mobile app now renders and opens every published material.
- Added local search and operational sorting to the pharmacist training list.

### Fixed

- Added a bounded mobile API timeout so unavailable services fail with an actionable retry state
  instead of leaving the application waiting indefinitely.
- POSM 1.0.65 spreads healthy QR-task polling over 24–36 seconds per device, reducing
  synchronized load on the merchandising fallback without changing recommendations or orders.

## [0.1.10] - 2026-09-23

### Fixed

- Corrected the public merchandising QR portal's `/merch/staff` asset, task API and media paths;
  limited the ePharm proxy to staff-only routes and required a trusted transport for its service key.
- Bound the POSM offline fulfillment cache to the pharmacy and device so a reassigned cash desk cannot
  display another pharmacy's cached orders. POSM source is versioned 1.0.64 for a separately signed release.
- Validated POSM installer HTTPS and release trust-anchor settings before completing installation.

### Operations

- Added reproducible checks for preserving merchandising photo sidecars across a frontend build,
  atomic `dist` exchange and rollback, and immutable application release preparation.

## [0.1.9] - 2026-09-22

### Fixed

- Merchandising QR delivery receipts now use an explicit JSON byte body with `Content-Length`,
  keeping the ePharm bridge compatible with the fallback Python service while preserving the
  fail-open isolation of recommendations, heartbeats, sales and other POSM schedules.

## [0.1.8] - 2026-09-22

### Added

- Integrated pharmacy merchandising assignments with POSM through an authenticated, fail-open
  task bridge: a configured pharmacy receives the task QR without blocking recommendations when
  the merchandising service is unavailable.

### Fixed

- Kept a recommendation request alive when zkassa.log and the Standard-N Firebird receipt observe
  the same scan, and retriggered recommendations after a POSM restart with an already-open receipt.
- Anchored the pharmacist popup to the visible Standard-N window and moved the customer advertising
  kiosk to the other monitor, including when Standard-N starts after POSM.
- Bound each multi-item response to its real local trigger and prevented transparent windows from
  being acknowledged as displayed.
- Excluded active promotion rules before their start date and after their end date using the
  Kazakhstan pharmacy calendar.
- Produced each POSM update bridge on Windows CI with its exact source commit and SHA-256 provenance,
  preventing a stale binary from being published under a newer version label.

## [0.1.7] - 2026-09-21

### Added

- Production-grade PostgreSQL and MinIO backup, retention, isolated restore testing and backup metrics.
- Prometheus, Alertmanager, Grafana, exporters and actionable availability/SLO/capacity alerts.
- Sentry integration points for backend, admin frontend and Flutter mobile application.
- Immutable release identity, deploy verification and rollback tooling.
- A k6 workload model for a 500-cash-desk fleet.
- Automated mobile release gates, privacy manifest and deep-link declarations.
- Reproducible pharmacy-specific POSM package generation with exact catalog matching, per-device
  credentials and secret-free rollout manifests.

### Fixed

- Added a stable provisioned POSM device identity so packages prepared before installation can use
  heartbeat, recommendations and signed remote updates without a shared bootstrap key.
- Kept the pharmacist recommendation card fully on-screen at 100-200% Windows scaling and above
  Standard-N without stealing scanner or keyboard focus.
- Changed recommendation `displayed_at` acknowledgement to require a rendered, native-topmost window
  whose physical bounds are verified inside the pharmacist monitor.
- Normalized Medusa products containing several GTINs in one barcode field so promotion campaigns
  can be created and matched by the first canonical EAN.
- Included field-level backend validation details in admin error messages instead of showing only
  the generic “check the data” response.

## [0.1.6] - 2026-09-20

### Fixed

- Replaced the stale `0 pharmacies` campaign counter with the current global active-pharmacy target.
- Added an auditable POSM rollout coverage endpoint and admin warning for unprovisioned pharmacies.
- Made recommendation matching fast and resilient to local cash-register barcodes and safe name variants.
- Restart POSM once after device enrollment so every API immediately uses the new per-device credential.

## [0.1.4] - 2026-09-19

### Fixed

- Replaced the generic promotion-rule save error with field-level, accessible validation and an
  actionable error summary.
- Normalized read-only Medusa product snapshots before saving so external catalog text cannot block
  campaign rule authoring.
- Added conditional validation for campaign goals and comparison rows while keeping barcode,
  iPartID and an unused goal optional.

## [0.1.3] - 2026-09-18

### Fixed

- Replaced slow, failure-prone remote Medusa search with an automatically refreshed PostgreSQL snapshot.
- Kept catalogue browsing and promotion product search available during Medusa outages.
- Added release smoke coverage for snapshot readiness and exact-name catalogue search.

## [0.1.2] - 2026-09-18

### Fixed

- Restored secure per-device POSM presence and the live register count during the credential migration.

## [0.1.1] - 2026-09-18

### Fixed

- Restored the live Medusa catalogue for admin, mobile and promotion workflows.
- Reduced Medusa listing latency, added last-known-good cache fallback and hourly linked-product refresh.
- Added release smoke gates that reject an empty production catalogue.

## [0.1.0] - 2026-09-08

### Added

- Initial versioned baseline for the existing backend, admin, mobile and POSM applications.
