# OPERATIONS — Ruqan / Rwqan

## Environments
- DEV: rwqan-sa-opencode clone; Firebase rwqan-sa-dev (project 467810513087, me-central2);
  R2 rwqan-sa-dev; port 5001; external services disabled; Paymob NOT used.
- PROD: guarded; never accessed from DEV.

## Startup (DEV)
- `npm run dev` (cross-env NODE_ENV=development tsx server/index.ts)
- Guarded startup: production security env, development isolation, Firebase dev isolation,
  R2 dev isolation.

## Checks on Start
- / (health), /api/packages, /properties.

## DEV E2E Test Data (synthetic, DEV-only)
- Seed:   `cross-env NODE_ENV=development tsx scripts/dev/e2e-seed.ts`
- Cleanup:`cross-env NODE_ENV=development tsx scripts/dev/e2e-cleanup.ts`
- Both refuse to run unless NODE_ENV=development AND project=rwqan-sa-dev AND
  bucket=rwqan-sa-dev AND external services disabled. Never touches production.
- Idempotent (fixed ids). Every record marked `testData:true` + `E2E_TEST_` label.
  Cleanup deletes ONLY marked/known ids (no broad collection deletes).
- Fixtures: packages E2E_TEST_PKG_{1PROP,2PROP,90D}; discount E2E_TEST_SAVE10;
  5-digit owners/properties 90001-90003 (login UI needs exactly 5 digits), argon2id
  hashed pins; subscriptions SUB-90001 (active premium) / SUB-90002 (expired);
  request E2E_TEST_REQ_1.
- Reuses the DEV server on :5001. Run the quality suite with NODE_ENV=development
  (it loads .env.development.local so admin creds are available to the browser suite).

## MCP/External Tooling
- Not part of this repo.

## Backup / Restore (OPERATIONAL DECISION REQUIRED)
- Admin backup routes are app-level export only.
- Verified operational backup/restore runbook: UNKNOWN.
- SEC-001 .env cleanup performed 2026-10-13 (cleanup-only scope): `.env` is untracked
  (removed from index via `git rm --cached`, reversible with `git restore --staged .env`),
  covered by .gitignore:28; do NOT recreate `.env` with real secrets. `.env.template` is
  placeholder-only (audited, HEAD + worktree). `.env.development.local` remains the DEV
  credential source (local, ignored). REMEMBER: production credential rotation is still
  REQUIRED and BLOCKED — never start a production/staging service with the old secrets
  until they are rotated.
- Safe DEV-run pattern (verified): `set NODE_ENV=development && tsx server/index.ts`
  (port 5001, loads .env.development.local; Firebase rwqan-sa-dev; R2 rwqan-sa-dev;
  booking worker disabled). Quality dashboard: `set NODE_ENV=development &&
  tsx quality/src/cli.ts` against the running DEV server (Playwright chromium local).
  NOTE: the full unit test suite must run WITHOUT NODE_ENV=development (paymob/whatsapp/
  worker suites falsely fail under DEV).
- Pre-migration backup checklist documented in plans; not executed.

## Rollback
- AUTH feature flags allow controlled AUTH rollback.
- Full operational rollback runbook: UNKNOWN / REQUIRES DECISION.

## Staging
- UNKNOWN. No staging infra verified. Do not create production resources.

## Release / Deployment
- No production release authorized. Requires PRODUCTION RELEASE GATE = PASS.

## Monitoring / Health
- Health endpoints exist; formal monitoring/SLO docs: UNKNOWN.

## Incident / Recovery
- Incident containment and recovery runbooks: UNKNOWN / NOT DOCUMENTED.