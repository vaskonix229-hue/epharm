# Epharm Project Documentation

This folder is the maintained technical documentation for the current codebase. It is not deployed
to the server.

## Product

Epharm is a pharmacist-motivation system for Inkar/Ledex:

1. HQ creates product campaigns, replacement/cross-sell rules, banners, payout batches, screen media,
   courses, and moderation decisions in the web admin console.
2. Pharmacists use the mobile app to view campaigns, inspect product cards, upload receipt photos,
   and track receipt status and balance.
3. POSM clients installed on Standard-N cash desks read cash-desk logs, send scanned items to the
   backend, show recommendations to pharmacists, mirror receipt/video content on the customer screen,
   and report sales/heartbeat.
4. The backend reconciles accepted recommendations, POS sales, Excel imports, and mobile receipts
   into approved or manually reviewed bonuses.

## Active Environment

Intended shared environment:

```text
https://epharm.inkar.kz
```

The 2026-07-21 gateway inspection found an expired certificate. That is historical diagnostics:
the public HTTPS health endpoint and certificate passed the 2026-09-23 audit. Current POSM still
rejects every remote HTTP origin, including `:8060`; verify public HTTPS again for each rollout.

It is one public host behind Caddy:

- `/api/*` -> backend;
- `/s3/*` -> MinIO;
- `/merch/staff` and its allowlisted assets/task API -> merchandising QR staff portal;
- `/` -> admin frontend.

The `api/admin/s3.epharm.kz` split-domain model is a future/ops option, not the currently active
public endpoint unless `.env.prod` and `Caddyfile` are changed together.

## Docs Map

| File                                      | Purpose                                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------ |
| `00-project-map.md`                       | Карта проекта: где лежит код/доки/важные файлы. НАЧИНАТЬ ОТСЮДА.               |
| `01-architecture.md`                      | Current system architecture, runtime surfaces, business flows.                 |
| `02-backend.md`                           | Backend stack, domains, API map, security, integrations, test/build commands.  |
| `03-admin-panel.md`                       | Admin frontend routes, state, UI system, sections, tests.                      |
| `04-mobile-app.md`                        | Flutter app architecture, active flows, API/mock switching, build notes.       |
| `05-posm-client.md`                       | C#/WPF POSM client, log parsing, barcode matching, outbox, deployment.         |
| `06-deployment-and-ops.md`                | Docker/Caddy production stack, deploy, backup, operations, known risks.        |
| `07-database.md`                          | Flyway migrations and domain tables.                                           |
| `08-product-workflow.md`                  | Понятное описание того, как системой пользуются HQ, фармацевт и POSM в аптеке. |
| `09-posm-v1.0.41-pilot-and-prod.md`       | Результат пилота Ауэзова 134, причины успеха и PROD-чеклист.                   |
| `10-posm-v1.0.42-production-hardening.md` | Разбор VM/боевой кассы, исправления установки, логов и heartbeat.              |
| `11-posm-v1.0.43-active-receipt.md`       | Причина сбоя на Ауэзова 134 и контракт чтения живого чека из Firebird.         |
| `12-posm-v1.0.44-firebird-auth.md`        | Боевой сбой авторизации Firebird и детерминированный приоритет `options.ini`.  |
| `13-training-module.md`                   | Реализация блока обучения в backend, админке и мобильном приложении.           |
| `14-screen-playlist-profiles.md`          | Общий эфир и индивидуальные экранные плейлисты по списку аптек.                |
| `15-daribar-otp.md`                       | Извлечённый SMS/OTP-контракт Daribar, безопасность и production-операции.      |
| `16-posm-v1.0.47-receipt-capture.md`      | Безопасный захват состава чека, PNG, outbox/ACK и пилотные критерии.           |
| `17-posm-exact-fiscal-receipt.md`         | Exact-only контракт оригинала ККМ/OFD, валидация, retention и пилотный gate.   |
| `19-order-fulfillment.md`                 | Надежная доставка интернет-заказов из витрины в Epharm/POSM и rollout.         |
| `20-reliability-and-release.md`           | Backup/restore, monitoring, Sentry, releases, load testing and TestFlight.     |
| `20-production-acceptance.md`             | Единый доказательный P1 runbook: обучение, POSM, mapping и fulfillment pilot.  |
| `reports/2026-09-23-orders-merch-audit.md` | Аудит связки заказов/мерча, риски и доказательства перед следующим rollout.   |
| `TRAINING-TEST-GUIDE.md`                  | Сквозная проверка обучения: админка, приложение, QR, сертификат и роли.        |
| `RUNBOOK.md`                              | Day-to-day local startup, reset, tests, and production commands.               |
| `DEV-ONBOARDING.md`                       | Run mobile app on Android/iPhone against shared backend.                       |
| `RELEASE-CHECKLIST.md`                    | Release blockers and hardening backlog.                                        |
| `BACKLOG.md`                              | Текущий бэклог: доп-проверки + что осталось до завершения.                     |
| `claude-notes.md`                         | Current mobile working memory.                                                 |
| `STOREFRONT.md`                           | Medusa storefront integration notes (untracked).                               |
| `STOREFRONT-CREDENTIALS.md`               | Storefront/SSH credentials (untracked, NEVER commit).                          |

## Other Important Files

| File                                    | Purpose                                                         |
| --------------------------------------- | --------------------------------------------------------------- |
| `../CLAUDE.md`                          | Контракт для Claude: docs-first, карта, правила (автозагрузка). |
| `../README.md`                          | Short repo overview and quick start.                            |
| `../admin-panel/claude-admin-notes.md`  | Current backend/admin/POSM working memory.                      |
| `../admin-panel/design-tokens-admin.md` | Current admin design system.                                    |
| `../_reference/design-tokens.md`        | Current mobile design system.                                   |
| `../App/WINDOWS_RUNBOOK.md`             | POSM module runbook (module-local).                             |

## Documentation Rules

- Prefer these docs plus the two `claude*notes.md` files over historical handoff files.
- Treat `admin-panel/PLAN.md` and `_reference/design_handoff_pharmapay/*` as historical context unless
  a current doc explicitly points to them.
- Do not move or duplicate secrets from existing credential files.
- When changing behavior, update the relevant technical doc and `08-product-workflow.md` in the same work session when the HQ, pharmacist, customer, or POSM workflow changes.
