# Contributing

Current workflow for this repository.

## Branches

- `main` is the only long-lived branch.
- Work in short-lived task branches.
- No direct push to `main`.
- Merge by squash PR.

Suggested branch prefixes:

- `feat/<slug>`;
- `fix/<slug>`;
- `chore/<slug>`;
- `docs/<slug>`;
- `refactor/<slug>`;
- `test/<slug>`;
- `ci/<slug>`.

Codex-created branches may use the `codex/` prefix.

## Commits

Use Conventional Commits:

```text
<type>(<scope>): <subject>
```

Types:

```text
feat fix chore docs refactor test ci perf build style revert
```

Common scopes:

```text
admin backend mobile posm infra repo deps docs
```

Examples:

```text
feat(admin): add promo list view
fix(backend): resolve posm cart by barcode
docs(repo): refresh runbook for one-host caddy
```

## Quality Rules

- Reproduce bugs with a failing test when feasible.
- Keep changes scoped.
- Do not edit applied Flyway migrations; add a new migration.
- Backend controllers return DTOs, not entities.
- Frontend DTOs mirror backend DTOs.
- Use design tokens; avoid raw UI hexes.
- Do not commit secrets or generated build artifacts.
- Update docs/notes after meaningful behavior changes.

## Checks

Backend:

```bash
cd admin-panel/backend
./gradlew test
./gradlew build
```

Admin:

```bash
cd admin-panel/frontend
npm run lint
npm test
npm run build
```

Mobile:

```bash
flutter analyze lib test
flutter test
```

Run only the relevant subset while iterating, but run the full relevant stack before PR/merge.

## Pull Requests

PR description should include:

- what changed;
- why;
- how it was verified;
- any release/deploy/migration notes.

Keep PRs reviewable. If a change spans backend, admin, mobile, and POSM, split when possible.

Do not merge with known red checks unless the failure is explicitly triaged and accepted.

## Secrets

Some existing docs contain live credentials by project decision. Do not move, duplicate, quote, or
paste those values elsewhere. If a secret leaks into a new place, rotate it rather than trying to
hide the symptom.

Private signing keys, integration keys, passwords, and recovery codes must never be committed,
attached to a PR or release, placed in a public artifact, or printed in build/test/deploy logs.
Keep the local release-key inventory under the Git-ignored `secrets/` directory with owner-only
permissions; record purpose, custodian, path, public-key fingerprint, and rotation procedure there,
not secret values in tracked documents. A production POSM release must use the existing offline
signing key whose public SPKI matches the trust anchor already embedded in deployed clients;
generating a replacement key is not a substitute for recovering the original key.
