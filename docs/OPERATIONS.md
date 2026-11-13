# OPERATIONS — Ruqan / Rwqan

CURRENT VERSION: 0.5.0 (2026-11-05)
BRANCH / COMMIT: `test/unified-gateway-ui-only` @ `190b43577b3eee10b835579aa63d2c155fd7e660`
  (0.5.0 changes are in the working tree, not yet committed)

## Environments
- LOCAL (developer machine): `rwqan-sa-opencode` clone; port 5001; Firebase data project
  `rwqan-sa-dev` (project 467810513087, me-central2); R2 `rwqan-sa-dev`; external services
  disabled; Paymob NOT used. LOCAL is fixed and needs no switch button (DEC-015: the LOCAL
  switch button was removed from the bar in 0.3.1; LOCAL detection/operation unchanged).
- TEST deploy target: project `rwqan-757` / backend `rwqan-backend` /
  `https://rwqan-backend--rwqan-757.europe-west4.hosted.app`; workflow
  `.github/workflows/deploy-test.yml` on branch `test/unified-gateway-ui-only`.
- LIVE deploy target: project `rwqan-757` / backend `rwqan` /
  `https://rwqan--rwqan-757.europe-west4.hosted.app`; workflow
  `.github/workflows/deploy-live.yml` on `main`. The official domain `https://rwqan.sa` is
  untouched. LIVE is enabled by `DEPLOY_REAL_DEPLOY` with no separate production opt-in;
  build, target and permission checks remain.
- PROD/legacy: guarded; never accessed from LOCAL. The legacy local `rwqan-sa` folder was
  removed earlier; the official remote and `rwqan-sa-full-backup.git` are the recovery
  sources.

## Startup (DEV)
- `npm run dev` (cross-env NODE_ENV=development tsx server/index.ts)
- Guarded startup: production security env, development isolation, Firebase dev isolation,
  R2 dev isolation.

## Checks on Start
- / (health), /api/packages, /properties.

## Deploy Bar / TEST / LIVE (0.5.0)
- UI: `src/components/deploy-bar.tsx`; admin section `sections/deploy.tsx`.
- API: `/api/admin/deploy/state`, `/checks`, `/releases`, `/status`, `/restore`.
- TEST and LIVE are separate targets. The bar shows the real GitHub Actions run state,
  including the failed job/step when a run fails.
- The environment switch shows only TEST/LIVE (LOCAL is fixed and not offered); the
  generic cloud "نشر" button was removed. The TEST/LIVE publish buttons, status and
  mechanism remain unchanged.
- TEST publish deploys the last approved commit on `test/unified-gateway-ui-only`. It does
  NOT create commits, pushes, or branches. If the local worktree has uncommitted changes,
  the bar warns that they will not be published; they are never deleted, stashed, or
  replaced. Mandatory secret/TypeScript checks still apply.
- The gate marks a dirty TEST worktree as `ok` with that warning (deploying the last
  approved commit is valid). LIVE and LOCAL keep the strict blocked behavior.
- LIVE never auto-commits. LIVE is enabled by `DEPLOY_REAL_DEPLOY`; there is no separate
  production opt-in. Build, target and admin-permission checks still apply.
- The official domain `https://rwqan.sa` remains untouched; the approved LIVE hosting URL
  is `https://rwqan--rwqan-757.europe-west4.hosted.app/`.
- Unapproved development hosting URLs were removed; LOCAL remains `http://localhost:5001`.
- Status is read from the public repository anonymously (read-only). If it cannot be
  read, a safe reason is shown; no success is claimed.
- `deploy-test.yml` is manual `workflow_dispatch` only (the `push` trigger is disabled),
  so pushing to the branch does not deploy TEST before explicit approval.
- Do not run a TEST or LIVE deployment without explicit approval. A real TEST dispatch
  requires the pre-existing server `DEPLOY_GITHUB_TOKEN`.
- GitHub dispatch credentials: the server first uses `DEPLOY_GITHUB_TOKEN` if configured
  (it must allow workflow dispatch: `actions:write`, or the `workflow` scope, on
  `modii1/rwqan`). In development it otherwise reuses the existing authenticated `gh`
  session; it never creates a token. Production stays explicit-env only. Without a valid
  source the executor fails closed with a clear reason; no commit/push/deploy is claimed.
- Diagnosing a blocked publish: read the latest entries in the durable store collections
  `deploy_audit_log` and `deploy_check_runs` (Firestore DEV). The failing check and the
  server reason are recorded there; the secret-scan reason names the offending changed
  file(s) (never the content). 0.4.1 fixed a secret-scan false positive from token-shaped
  test fixtures; the check-button UX and auth reuse are retained in 0.5.0.
- 0.5.0 removed the TEST auto-commit/auto-push service. TEST deploys the last approved
  commit on `test/unified-gateway-ui-only`; local uncommitted changes are warned about and
  never published. The dev server must be restarted after code changes (`tsx` does not
  hot-reload).

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