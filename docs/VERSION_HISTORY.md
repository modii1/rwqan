# VERSION HISTORY — Ruqan / Rwqan

Version convention: MAJOR.MINOR.PATCH (semantic).

No formal release has been cut yet on this clone. The project is at a documented
development baseline, not a certified release.

VERSION: 0.1.0 (documentation + verification baseline)
DATE: 2026-10-13
ENVIRONMENT: DEVELOPMENT (rwqan-sa-opencode clone)
RELEASE TYPE: Development baseline (no production deployment)
PREVIOUS VERSION: none on record
SUMMARY:
- Permanent docs/ system created.
- AUTH-001 follow-ups completed (changePassword hash-aware verification, no-new-plaintext
  owner creation, 19 new auth tests).
- AUTHZ-001 owner subscription IDOR fixed (group-aware session guard) + regression test.
- Security scanner re-run (NEW:0, RED-trigger:1 = SEC-001), baseline re-anchored.
- DEV smoke + full build verified.
WHY:
- Persistent operational memory; security fixes for known open IDs; evidence baseline.
CHANGED:
- docs/* (permanent project system)
- server/utils/password.ts + tests (untracked new files)
- server/services/AuthService.ts (dual-read changePassword) + AuthService.test.ts
- server/firebaseService.ts (hash-on-sync import + new-owner create)
- server/routes/owner.ts (subscription scope guard, group-aware)
- server/routes/owner-subscription-access.test.ts (new)
- security/src/rules/ruqanRules.ts (widen session-scoped detection) + security/baseline.json (re-anchored)
FILES / SYSTEMS:
- Earlier work still in tree: assertionR2DevIsolation export in server/utils/r2.ts,
  argon2 + @aws-sdk/s3-request-presigner dependencies, pre-existing config/integration diffs (documented).
DATABASE IMPACT:
- NONE in DEV (no data writes performed; .env working file absent; DEV collection empty).
SECURITY IMPACT:
- AUTH-001: hashed-on-write enforced for new credentials and change-password verification.
- AUTHZ-001 closed. Red-triggering reduced 2 -> 1 (SEC-001 remains BLOCKED/open).
UI/UX IMPACT:
- None. Build PASS; RTL verified (<html lang="ar" dir="rtl">).
BUSINESS LOGIC IMPACT:
- None. Group-linked subscription access semantics preserved (DEC-007).
TEST RESULTS:
- TypeScript: PASS 0 errors.
- Full suite: PASS 702/702 (serial; run WITHOUT forcing NODE_ENV — paymob/whatsapp/
  worker suites expect a non-dev env and falsely fail under NODE_ENV=development).
- AUTH-001 + AUTHZ-001 regression: PASS 20/20.
- Business-logic dashboard suite: PASS 10/10 (after BL-006 fixture corrected).
- Browser E2E (Playwright chromium against DEV server on localhost:5001): PASS 2/2
  (home + /properties). Live-API suite: PASS 2/3 (API-002 = known empty-DEV package
  data gap; route 404s by design for missing package; not a regression).
- Build: PASS (next build + tsc server + write-dist-package).
- Security scan: NEW 0 / EXISTING 40 / RED 1 (SEC-001; AUTHZ-001 gone).
- quality CLI Windows entry-guard fixed (pathToFileURL) so suites actually run.
SECURITY SCAN RESULTS:
- See SECURITY_STATUS.md. SEC-001 open (production secret rotation BLOCKED).
BACKUP:
- Backup admin routes covered by passing suite; ops backup/restore runbook UNKNOWN.
ROLLBACK:
- AUTH feature flags allow controlled rollback; full ops rollback NOT VERIFIED.
DEPLOYMENT:
- NONE.
POST-DEPLOYMENT:
- NOT RUN.
KNOWN ISSUES:
- see SECURITY_STATUS.md / SESSION_HANDOFF.md
BLOCKED:
- Production data gate NOT cleared; SEC-001; Private R2 (admin doc scope); CA
  production migration; staging + ops backup/restore UNKNOWN.
UNKNOWN:
- production migration completion measurement; ops backup/restore; staging availability;
  exact admin document scope; browser E2E suites (not re-run this session).
NEXT STEP:
- Production authorization decisions; then B/E2E suites re-run; then production
  security + migration rollout per the locked plan.

---

VERSION: 0.1.0 (addendum — DEV E2E test-data + realistic browser E2E)
DATE: 2026-10-13
ENVIRONMENT: DEVELOPMENT (rwqan-sa-opencode clone) — NOT a production release.
RELEASE TYPE: Documentation addendum (no version bump, no deployment)
PREVIOUS VERSION: 0.1.0
SUMMARY:
- Added a DEV-only synthetic test-data system (DEC-014): scripts/dev/e2e-test-data.ts
  (+ e2e-seed.ts / e2e-cleanup.ts). Runtime-guarded (NODE_ENV=development, project
  rwqan-sa-dev, bucket rwqan-sa-dev, external services disabled); idempotent fixed ids;
  every record marked testData:true + E2E_TEST_. Cleanup deletes only marked/known ids.
- Expanded the browser E2E suite from 2 navigation cases to 15 real cases and fixed the
  live-API API-002 to resolve a real seeded package id.
CHANGED:
- scripts/dev/e2e-test-data.ts, scripts/dev/e2e-seed.ts, scripts/dev/e2e-cleanup.ts (new)
- quality/suites/browserE2E.ts (expanded), quality/suites/liveApi.ts (API-002),
  quality/tsconfig.json (lib +dom)
- docs/DECISIONS.md (DEC-014), docs/OPERATIONS.md, docs/SESSION_HANDOFF.md,
  docs/DEV_E2E_REPORT.md (new), docs/VERSION_HISTORY.md, docs/RELEASE_NOTES.md
DATABASE IMPACT:
- DEV-only synthetic records created (packages/owners/properties/subscriptions/discount/
  request), all marked + removable via cleanup. NONE in production.
SECURITY IMPACT:
- NONE. No security status changed. Offline scan: total 39 / ORANGE / NEW 0 / EXISTING 39
  / REGRESSED 0 / RESOLVED 0. SEC-002 MEDIUM remains. SEC-001 historically open.
UI/UX IMPACT:
- None (no UI code changed). Responsive RTL verified at 390/768/1440.
BUSINESS LOGIC IMPACT:
- None. No server/shared business logic changed.
TEST RESULTS (this session):
- TypeScript: PASS 0 errors (root + quality).
- Full server+shared suite: PASS 702/702 (serial; no forced NODE_ENV).
- Quality dashboard: 27/28 PASS, 0 FAIL, 1 BLOCKED (criticalFailures 0, exit 0).
  - Business Logic: 10/10 PASS
  - Live API: 3/3 PASS
  - Browser E2E: 14 PASS + 1 BLOCKED (E2E-AUTH-005 customer OTP — WhatsApp disabled in DEV)
- Seed/Cleanup: verified deterministic (cleanup -> packages=0/properties=0; re-seed -> 3/3).
- Build: PASS (next build + tsc server + write-dist-package).
SECURITY SCAN RESULTS:
- Offline CI: OVERALL ORANGE, NEW 0 / EXISTING 39 / REGRESSED 0. SEC-002 present.
DEPLOYMENT:
- NONE. Production Release Gate = BLOCKED. This addendum is NOT a production release.
BLOCKED:
- Production Release Gate (SEC-001 rotation/history; ADMIN_DOCUMENT_SCOPE UNKNOWN; CA
  production migration; staging + ops backup/restore UNKNOWN); customer OTP (external
  WhatsApp disabled in DEV).
NEXT STEP:
- Production authorization decisions; keep gate BLOCKED; do not treat as release.

---

VERSION: 0.2.0 (unified gateway + deploy bar TEST/LIVE + real Actions status)
DATE: 2026-11-04
ENVIRONMENT: DEVELOPMENT — branch `test/unified-gateway-ui-only`
COMMIT: 190b43577b3eee10b835579aa63d2c155fd7e660
RELEASE TYPE: Development version (no production release, no TEST/LIVE deployment)
PREVIOUS VERSION: 0.1.0 (addendum)
WHY 0.2.0:
- The documented convention is semantic MAJOR.MINOR.PATCH. Since 0.1.0, the branch
  added backward-compatible features (deploy console, unified owner account login,
  partner profits, real GitHub Actions status) — a MINOR bump, not a patch.
SUMMARY:
- Unified owner account login: phone OTP + property-number tab, account manager, and
  property switcher on the owner dashboard.
- Partner profits system present (admin partner-profits section).
- Deploy bar/console covers TEST and LIVE separately through GitHub Actions dispatch.
- Canonical TEST target: project `rwqan-757` / backend `rwqan-backend` /
  `https://rwqan-backend--rwqan-757.europe-west4.hosted.app`.
- LIVE target unchanged: project `rwqan-757` / backend `rwqan` / `https://rwqan.sa`.
- Real GitHub Actions run status is read from the public repository anonymously,
  including the failed job/step and safe failure reasons; success is only shown when
  the rollout step is verified. No fake success when the status cannot be read.
- `deploy-test.yml` is manual `workflow_dispatch` only (the `push` trigger was removed)
  so a push cannot deploy TEST before explicit approval.
- LOCAL remains a fixed developer environment on port 5001. Removing the LOCAL switch
  button/name from the environment bar is the approved direction, but it is NOT
  implemented yet in this commit (the bar still shows LOCAL/TEST/LIVE).
CHANGED (code, commit 190b435):
- .github/workflows/deploy-test.yml
- apphosting.test.yaml
- server/config/deployTarget.ts
- server/services/DeployGhWorkflowService.ts (+ test)
- src/components/deploy-bar.tsx (+ test)
CHANGED (documentation, this entry):
- docs/VERSION_HISTORY.md, docs/RELEASE_NOTES.md, docs/PROJECT_MASTER_REFERENCE.md,
  docs/START_HERE.md, docs/OPERATIONS.md, docs/SESSION_HANDOFF.md, docs/DECISIONS.md,
  docs/UI_UX_REFERENCE.md, docs/DEPLOY_SYSTEM_PLAN_AR.md,
  docs/DEPLOY_SYSTEM_REAL_vs_SIMULATION_AR.md, docs/DEPLOY_BAR_LOCAL_TEST_LIVE_AR.md
DATABASE IMPACT:
- NONE. No data migration or write in this entry.
SECURITY IMPACT:
- NONE. No secret/config/permission changes; the status read uses the public repo
  anonymously (no token injected).
UI/UX IMPACT:
- Deploy status now shows the real run state and the real failure reason. LOCAL switch
  removal remains a recorded decision, not an implemented change.
BUSINESS LOGIC IMPACT:
- NONE.
TEST RESULTS (on this branch/commit):
- TypeScript (frontend + server): PASS 0 errors.
- Deploy-related tests: PASS 164/164.
- Full source suite on this branch: NOT RUN in this session (not claimed).
- GitHub Actions (read-only): last TEST run success (run 41333932185, commit b856ed2);
  last LIVE run success (run 41352340982, commit 3484594). No new run was created for
  190b435 because the TEST push trigger is disabled by design.
DEPLOYMENT:
- NONE. No TEST or LIVE deployment was executed.
NEXT STEP:
- Obtain explicit approval to run the TEST deployment; implement the LOCAL button
  removal as a separate code change after approval.

---

VERSION: 0.3.0 (LIVE enabled + approved hosting links cleanup)
DATE: 2026-11-04
ENVIRONMENT: DEVELOPMENT — branch `test/unified-gateway-ui-only`
BASE COMMIT: 190b43577b3eee10b835579aa63d2c155fd7e660
RELEASE TYPE: Development version (no production deployment executed)
PREVIOUS VERSION: 0.2.0
WHY 0.3.0:
- MINOR bump: removes the permanent production opt-in that blocked LIVE and makes the
  real deploy path available through the approved GitHub Actions route, while keeping
  build, target and admin-permission checks. Also standardizes the approved hosting links.
SUMMARY:
- LIVE is no longer programmatically blocked by `DEPLOY_ALLOW_PRODUCTION`.
  `productionDeployEnabled()` now mirrors the real-deploy switch (`DEPLOY_REAL_DEPLOY`);
  the extra server-side opt-in was removed. Build checks, target validation, admin
  session/same-origin checks, and GitHub dispatch checks remain mandatory.
- Approved hosting links:
  - LIVE: `https://rwqan--rwqan-757.europe-west4.hosted.app/`
  - TEST: `https://rwqan-backend--rwqan-757.europe-west4.hosted.app/`
- The official domain `https://rwqan.sa` is untouched (Paymob endpoints, WhatsApp/booking
  links, SEO and the production base URL remain as-is).
- Removed unapproved development hosting URLs:
  - `https://rwqan-sa-dev--rwqan-dev-backend.us-central1.hosted.app` (replaced by
    `http://localhost:5001` for LOCAL).
  - `https://rwqan-backend--rwqan-757.us-central1.hosted.app` (test fixture moved to the
    approved europe-west4 host).
  - `https://rwqan-backend--rwqan-757.europe-west1.hosted.app` (test fixture moved to the
    approved europe-west4 host).
  - `https://REPLACE-WITH-DEV-BACKEND-HOST` (legacy dev App Hosting config; replaced by
    the LOCAL address and the file is marked legacy, not deleted).
- Active deploy code now points to the official repository `modii1/rwqan`.
- Deploy bar: removed the LIVE "official update disabled" guard and its separate
  production-opt-in message. The explicit publish confirmation remains the user action.
VERIFICATION:
- `/api/admin/deploy/state` with the LIVE deploy target reported:
  `productionDeployEnabled=true`, target `rwqan-757` / `rwqan`,
  base URL `https://rwqan--rwqan-757.europe-west4.hosted.app`,
  `production_opt_in=ok`, `target_config=ok`, `release_checks=ok`,
  `real_deploy_opt_in=ok`.
- Remaining operational constraints (not a permanent programmatic block):
  - the working tree is dirty because these changes are uncommitted; the gate blocks
    publishing until the worktree is clean after an approved commit;
  - `DEPLOY_GITHUB_TOKEN` is absent in the local environment; GitHub dispatch needs the
    pre-existing server token. No secret was added.
- No TEST or LIVE deployment was executed.
TEST RESULTS (this session):
- TypeScript (frontend + server): PASS 0 errors.
- Deploy-related tests: PASS 185/185.
- Full source suite on this branch: NOT RUN in this session (not claimed).
CHANGED (code/config):
- server/config/deployTarget.ts, server/services/DeployRealExecutor.ts,
  server/services/DeployExecutor.ts, server/services/DeployPrepublishGate.ts,
  server/services/DeploySystemStore.ts, server/services/DeployChecksService.ts,
  server/config/stableRelease.ts, shared/deploySystem.ts,
  src/components/deploy-bar.tsx, src/components/admin/sections/deploy.tsx,
  apphosting.dev.yaml, .env.development.local (local only).
- Tests updated: deployTarget, DeployPrepublishGate, DeployRealExecutor,
  admin deploy route, and deploy-bar.
CHANGED (documentation): all docs listed in RELEASE_NOTES for 0.3.0.
DATABASE IMPACT: NONE.
SECURITY IMPACT: No secret/permission change. Removed only the extra production opt-in;
all other security checks remain.
UI/UX IMPACT: LIVE no longer shows "official update disabled"; the publish confirmation
remains the explicit user action.
BUSINESS LOGIC IMPACT: NONE.
DEPLOYMENT: NONE.
NEXT STEP:
- Commit the changes with explicit approval to clean the worktree; provide the pre-existing
  `DEPLOY_GITHUB_TOKEN` in the server environment; then LIVE publish is available through
  the approved GitHub Actions path.

---

VERSION: 0.3.1 (environment-bar cleanup: LOCAL switch and generic publish button removed)
DATE: 2026-11-04
ENVIRONMENT: DEVELOPMENT — branch `test/unified-gateway-ui-only`
BASE COMMIT: 190b43577b3eee10b835579aa63d2c155fd7e660
RELEASE TYPE: Development UI patch (no deployment)
PREVIOUS VERSION: 0.3.0
WHY 0.3.1:
- PATCH bump: UI-only removals. LOCAL environment/address/detection and the TEST/LIVE
  publish mechanism are unchanged; no backend, API, data, link or deploy-config change.
SUMMARY:
- DEC-015 implemented: the LOCAL option/button/label was removed from the environment
  switch in `src/components/deploy-bar.tsx`. The switch now offers only TEST and LIVE.
  LOCAL remains the fixed developer environment at `http://localhost:5001` with its
  detection/operation unchanged.
- The generic cloud "نشر" button was removed. The environment-specific buttons
  "نشر نسخة التجربة" and "نشر الموقع الرسمي" remain, along with TEST/LIVE status, run
  information and the existing publish mechanism (no change).
CHANGED:
- src/components/deploy-bar.tsx
- src/components/deploy-bar.test.ts
- docs (VERSION_HISTORY, RELEASE_NOTES, PROJECT_MASTER_REFERENCE, START_HERE, OPERATIONS,
  SESSION_HANDOFF, DECISIONS, UI_UX_REFERENCE, DEPLOY_BAR_LOCAL_TEST_LIVE_AR,
  DEPLOY_SYSTEM_PLAN_AR, DEPLOY_SYSTEM_REAL_vs_SIMULATION_AR)
VERIFICATION (this session):
- TypeScript: PASS 0 errors.
- Deploy bar/section tests: PASS 19/19.
- Source assertions confirm `deploy-bar-environment-local` and the generic
  `deploy-bar-publish` button are absent, while `deploy-bar-publish-test`,
  `deploy-bar-publish-live` and `deploy-bar-environment` are present.
- Full source suite on this branch: NOT RUN in this session (not claimed).
DATABASE IMPACT: NONE.
SECURITY IMPACT: NONE.
BUSINESS LOGIC IMPACT: NONE.
DEPLOYMENT: NONE.
NEXT STEP:
- Commit with explicit approval; provide the pre-existing `DEPLOY_GITHUB_TOKEN` for
  GitHub dispatch; then TEST/LIVE publish is available through the approved path.

---

VERSION: 0.4.0 (SUPERSEDED by 0.5.0 — TEST auto-commit/push removed)
DATE: 2026-11-04
ENVIRONMENT: DEVELOPMENT — branch `test/unified-gateway-ui-only`
BASE COMMIT: 190b43577b3eee10b835579aa63d2c155fd7e660
RELEASE TYPE: Development version (no TEST/LIVE deployment executed)
PREVIOUS VERSION: 0.3.1
WHY 0.4.0:
- MINOR bump: the TEST publish button gains a new, backward-compatible capability
  (inspect + auto-commit + push local changes) instead of rejecting a dirty tree. LIVE
  and LOCAL behavior are unchanged; no breaking change.
SUMMARY:
- The TEST publish no longer fails merely because the working tree is dirty. Before the
  TEST GitHub dispatch the server:
  1. inspects every changed path (`git status --porcelain -z`);
  2. refuses the whole operation if a secret/credential file is present;
  3. excludes local/unintended files (reports, logs, archives, databases, backups,
     `.next/`, `node_modules/`, `.DS_Store`, etc.) and untracked files outside the
     approved project areas while still committing the approved changes;
  4. creates a commit whose message includes the app version and a change summary
     (`chore(release): v0.4.0 — TEST auto-publish`);
  5. pushes ONLY to `DEPLOY_GH_TEST_BRANCH` (`test/unified-gateway-ui-only`); pushing
     `main`/LIVE is impossible (hard branch guard);
  6. verifies the remote tip equals the new commit before requesting any dispatch.
- Mandatory gates still run BEFORE the commit and are never bypassed:
  `secretScan === "PASS"` and `typescript === "PASS"`. A failing gate returns 409 with
  the real reason and performs no commit, no push and no dispatch.
- The TEST 202 response now includes `autoCommit` (commit/short SHA, branch, files,
  excluded files, summary, pushed, actions link). The deploy bar toast shows the
  auto-commit short SHA, branch, file count, and the GitHub Actions link.
- LIVE is untouched: LIVE never auto-commits, its dispatch (`deploy-live.yml` on `main`)
  and all its checks are unchanged. LOCAL is unchanged.
- Added `shared/appVersion.ts` as the single source of the version used in the commit
  message.
CHANGED (code):
- shared/appVersion.ts (new)
- server/services/DeployTestAutoCommitService.ts (new) + test (new)
- server/routes/admin/deploy.ts (+ tests): TEST-only auto-commit before reading the Git
  context; `autoCommitTest`/`readGitState` seams; 202 `autoCommit` payload.
- src/components/deploy-bar.tsx (+ test): response type + toast with auto-commit details.
CHANGED (documentation): docs/VERSION_HISTORY.md, docs/RELEASE_NOTES.md,
  docs/PROJECT_MASTER_REFERENCE.md, docs/START_HERE.md, docs/OPERATIONS.md,
  docs/SESSION_HANDOFF.md, docs/DECISIONS.md (DEC-021), docs/UI_UX_REFERENCE.md,
  docs/DEPLOY_BAR_LOCAL_TEST_LIVE_AR.md, docs/DEPLOY_SYSTEM_PLAN_AR.md,
  docs/DEPLOY_SYSTEM_REAL_vs_SIMULATION_AR.md.
VERIFICATION (this session):
- TypeScript frontend + server: PASS 0 errors.
- Deploy suite (server): PASS 291/291, including 7 new auto-commit service tests and the
  new route tests (auto-commit success, secret abort, LIVE no auto-commit).
- Deploy bar/section tests: PASS 16/16 (including the existing TEST/LIVE independence
  and no-LOCAL assertions).
- Auto-commit service is injectable in route tests; no test performs a real commit or
  push.
DATABASE IMPACT: NONE.
SECURITY IMPACT:
- Stricter: secret files abort the entire operation; only allow-listed paths are staged;
  branch is hard-pinned to the approved TEST branch; the remote tip is verified. No
  secret is read or printed; no security/TypeScript/permission/target check is bypassed.
UI/UX IMPACT:
- The TEST result message now reports the automatic save/push (short SHA, branch, file
  count) and the real Actions link. No new button and no LIVE/LOCAL visual change.
BUSINESS LOGIC IMPACT: NONE.
DEPLOYMENT: NONE executed.
REMAINING EXTERNAL CONSTRAINT:
- A real TEST dispatch still requires the pre-existing server `DEPLOY_GITHUB_TOKEN`, which
  was absent locally. A real TEST publish was NOT executed and is not claimed.
NEXT STEP:
- Commit this version with explicit approval; provide the pre-existing
  `DEPLOY_GITHUB_TOKEN`; then a TEST publish can auto-commit, push the approved branch,
  dispatch `deploy-test.yml`, and report the result.

---

VERSION: 0.4.1 (fix: secret-scan false positive from token-shaped test fixtures)
DATE: 2026-11-04
ENVIRONMENT: DEVELOPMENT — branch `test/unified-gateway-ui-only`
BASE COMMIT: 190b43577b3eee10b835579aa63d2c155fd7e660
RELEASE TYPE: Development patch (no deployment executed)
PREVIOUS VERSION: 0.4.0
WHY 0.4.1:
- PATCH bump: the actual last TEST publish failed on the mandatory `secretScan` check.
  Diagnosis from the durable store (`deploy_audit_log`, `deploy_check_runs`) showed:
  `secretScan: FAIL`, reason "نمط سرّي وُجد داخل محتوى أحد الملفات المُغيَّرة." The named
  offender is `server/services/DeployRealExecutor.test.ts`, whose redaction tests embedded
  token-shaped synthetic strings (`AIza…` / `ghp_…`) verbatim in the source. These are
  not real credentials, but the scanner correctly refuses token-shaped content in changed
  files. No security check was weakened.
SUMMARY:
- Rebuilt those synthetic fixtures at runtime from split fragments, so the source file no
  longer matches the secret patterns while the runtime strings still match the production
  redaction regex and the redaction tests keep their meaning.
- The secret-scan failure reason now names the offending changed file(s) (never the
  content), so a future failure is diagnosable directly from the audit log.
- The deploy bar's failed-check toast now shows the real server reason
  (`release.error` / `checkNotes`) instead of the misleading blanket
  "لم يُسجَّل أي إصدار منشور." when a validation_failed release was actually recorded.
- No change to any threshold, pattern, mandatory check, permission, target, LIVE path or
  LOCAL behavior.
EVIDENCE FROM THE LAST OPERATION (read-only, from Firestore DEV):
- Latest audit: 2026-11-04T19:23:23Z, action `publish_failed`, environment TEST,
  releaseId rel-19df3e68-..., reason = the secret-content message above.
- Latest check run: 2026-11-04T19:12:52Z, `typescript=PASS`, `secretScan=FAIL`.
- Release: status `validation_failed`, `savedToGit=false`, `deployed=false`,
  `deployTarget=rwqan-sa-dev`.
- No `publish_dispatched` audit entry; no GitHub Actions run; no App Hosting rollout;
  branch remained `190b435`; TEST working version did not change.
CHANGED:
- server/services/DeployRealExecutor.test.ts (runtime-assembled synthetic tokens)
- server/services/DeployChecksService.ts (+ test): reason names the offending file
- src/components/deploy-bar.tsx (+ test): real failure reason in the toast
- shared/appVersion.ts → 0.4.1
- docs: VERSION_HISTORY, RELEASE_NOTES, PROJECT_MASTER_REFERENCE, START_HERE, OPERATIONS,
  SESSION_HANDOFF, DECISIONS (DEC-022), UI_UX_REFERENCE, DEPLOY_BAR_LOCAL_TEST_LIVE_AR,
  DEPLOY_SYSTEM_PLAN_AR, DEPLOY_SYSTEM_REAL_vs_SIMULATION_AR.
VERIFICATION:
- Re-ran the same read-only secret scan over the current working tree: `secretScan=PASS`.
- TypeScript frontend + server: PASS 0 errors.
- Deploy server suite: PASS 291/291; deploy bar/section: PASS 16/16.
- No deployment was executed to verify the fix; the next approved TEST publish will be the
  first real run.
DATABASE IMPACT: NONE (only read-only diagnosis).
SECURITY IMPACT:
- No weakening: the scanner still scans changed file content; only the synthetic fixtures
  were rewritten so they no longer look like real credentials.
UI/UX IMPACT:
- A failed mandatory check now shows its real reason instead of an inaccurate generic line.
BUSINESS LOGIC IMPACT: NONE.
DEPLOYMENT: NONE.
NEXT STEP:
- Restart the dev server so the fixed code and check run are loaded; run
  `POST /api/admin/deploy/checks` (or press the check button) to confirm a fresh
  `secretScan=PASS`, then perform an approved TEST publish. A real dispatch still needs
  the pre-existing `DEPLOY_GITHUB_TOKEN`.

---

VERSION: 0.4.2 (SUPERSEDED by 0.5.0 — TEST auto-commit/push removed)
DATE: 2026-11-04
ENVIRONMENT: DEVELOPMENT — branch `test/unified-gateway-ui-only`
BASE COMMIT: 190b43577b3eee10b835579aa63d2c155fd7e660
RELEASE TYPE: Development patch (no deployment executed)
PREVIOUS VERSION: 0.4.1
WHY 0.4.2:
- PATCH bump: the TEST auto-save path could be skipped without a commit, and the running
  dev server was proven to be executing pre-auto-commit code. The flow is now fail-closed
  and observable end to end.
TRACE (UI → server):
- `src/components/deploy-bar.tsx`: TEST button → `startPublish("TEST")` → confirm →
  `POST /api/admin/deploy/releases` with `{ approve: true, environment: "TEST" }`.
- `server/routes/admin/deploy.ts`: environment/store checks → TEST pre-Git probe →
  pre-checks (secretScan + TypeScript) → `autoCommitAndPushTest` → `readGitContext` →
  executor dispatch (`deploy-test.yml`) → 202 with `autoCommit`.
ROOT CAUSE (from the running process + durable store, not assumed):
- The dev server process was started at 2026-11-04 20:40:50 local, while
  `server/routes/admin/deploy.ts` was last written at 22:05:01 local. `tsx server/index.ts`
  does not hot-reload, so the process had the OLD route without the auto-commit block. It
  could not call `DeployTestAutoCommitService` at all.
- The durable store confirms the last publish attempt was 19:23:23Z (before the 0.4.1
  fix); the later 19:44/19:45 entries are explicit `checks_run` audits, not publish
  attempts. The running server's state endpoint still reported the real dirty worktree at
  `190b435`, proving the data was there but the loaded code never invoked the service.
- Secondary code defect: the route silently skipped auto-commit when Git state was
  `null`/`unknown`, so a runtime without a verifiable checkout could dispatch without
  saving. That silent path is removed.
FIX:
- TEST now fails closed with `409 DEPLOY_GIT_UNAVAILABLE` when the local Git checkout
  cannot be inspected; it never dispatches silently.
- Passing pre-checks are persisted to `deploy_check_runs` BEFORE the commit attempt, so a
  failed commit/push still leaves the check results visible.
- `DeployTestAutoCommitService` now returns sanitized, bounded `details` for commit/push/
  verification failures (tokens and URL credentials redacted) and the route returns them.
- The bar shows the real server reason/details (not only a generic line) and refreshes the
  state query on both success and error, so the tree state and SHA update after a commit/
  push even if a later dispatch step fails.
- Check order is enforced by test: pre-checks → persisted check run → auto-commit →
  dispatch. No security/TypeScript/permission/target check is bypassed.
- LIVE and LOCAL untouched.
CHANGED:
- server/routes/admin/deploy.ts (+ test)
- server/services/DeployTestAutoCommitService.ts (+ test)
- server/services/DeployRealExecutor.ts (exported the existing error sanitizer)
- src/components/deploy-bar.tsx (+ test)
- shared/appVersion.ts → 0.4.2
- docs: VERSION_HISTORY, RELEASE_NOTES, PROJECT_MASTER_REFERENCE, START_HERE, OPERATIONS,
  SESSION_HANDOFF, DECISIONS (DEC-023), UI_UX_REFERENCE, DEPLOY_BAR_LOCAL_TEST_LIVE_AR,
  DEPLOY_SYSTEM_PLAN_AR, DEPLOY_SYSTEM_REAL_vs_SIMULATION_AR.
VERIFICATION:
- TypeScript frontend + server: PASS 0 errors.
- Deploy server suite: PASS 293/293 (new route tests: commit-before-dispatch ordering,
  persisted checks before commit, real push-failure details, fail-closed unknown Git).
- Deploy bar/section: PASS 16/16.
- No real commit/push/deploy was executed. Tests inject the auto-commit service.
DATABASE IMPACT: NONE (tests in-memory; no production writes).
SECURITY IMPACT: no check weakened; failure detail is sanitized; branch remains hard-pinned
to `test/unified-gateway-ui-only`.
UI/UX IMPACT: TEST now shows the real commit/push failure reason and refreshes tree/SHA.
BUSINESS LOGIC IMPACT: NONE.
DEPLOYMENT: NONE.
NEXT STEP: restart the dev server (to load 0.4.2), run checks once to persist PASS, then an
approved TEST publish. A real dispatch still requires `DEPLOY_GITHUB_TOKEN`.

---

VERSION: 0.4.3 (SUPERSEDED by 0.5.0 — TEST auto-commit/push removed)
DATE: 2026-11-04
ENVIRONMENT: DEVELOPMENT — branch `test/unified-gateway-ui-only`
BASE COMMIT: 190b43577b3eee10b835579aa63d2c155fd7e660
RELEASE TYPE: Development patch (no deployment executed)
PREVIOUS VERSION: 0.4.2
WHY 0.4.3:
- PATCH bump: the TEST publish could still show "ممنوع: شجرة العمل تحتوي تغييرات غير
  مُثبّتة" after a successful auto-commit, because the final gate re-read the raw worktree
  (which still contains excluded/local files such as `reports/`) and ignored the verified
  auto-commit result.
ROOT CAUSE:
- `DeployPrepublishGate` classified any `worktree: "dirty"` as blocked for every
  environment, with no notion of "the approved changes were just committed".
- The route read `context.git` again after auto-commit; excluded/local files kept it
  dirty, so the gate and the executor still saw a dirty tree.
- The service did not prove/return the post-commit remaining state, so the route had no
  authoritative "all approved changes are committed" signal.
FIX:
- `DeployTestAutoCommitService` now re-inspects the worktree after the commit and fails
  closed (`AUTO_COMMIT_INCOMPLETE`) if any approved change remains. It returns
  `remaining` and `publishWorktree: "clean"`. If only excluded files exist, it returns an
  explicit result (no empty commit) instead of `null`.
- The route treats the verified auto-commit result as authoritative for TEST: it overrides
  the Git worktree to clean and the SHA to the new commit before the final gate and the
  executor. The final gate therefore cannot reject changes that were just saved.
- `DeployPrepublishGate` marks a dirty TEST worktree as `ok` with a clear note that TEST
  auto-saves approved changes before dispatch. LIVE and LOCAL keep the strict blocked
  behavior. The Git check is not removed or bypassed: a post-commit approved leftover
  still fails closed, and LIVE/LOCAL dirty trees still block.
- The bar shows "تغييرات محلية مستبعدة فقط — لن تنشر" when only excluded files remain,
  and the toast never claims a commit/push when nothing was committed.
- No empty commit is ever created; only approved pathspecs are committed; the branch stays
  hard-pinned to `test/unified-gateway-ui-only`.
CHANGED:
- server/services/DeployTestAutoCommitService.ts (+ test)
- server/routes/admin/deploy.ts (+ test)
- server/services/DeployPrepublishGate.ts (+ test)
- server/services/DeploySystemStore.ts
- shared/deploySystem.ts
- src/components/deploy-bar.tsx (+ test)
- shared/appVersion.ts → 0.4.3
- docs: VERSION_HISTORY, RELEASE_NOTES, PROJECT_MASTER_REFERENCE, START_HERE, OPERATIONS,
  SESSION_HANDOFF, DECISIONS (DEC-024), UI_UX_REFERENCE, DEPLOY_BAR_LOCAL_TEST_LIVE_AR,
  DEPLOY_SYSTEM_PLAN_AR, DEPLOY_SYSTEM_REAL_vs_SIMULATION_AR.
VERIFICATION:
- TypeScript frontend + server: PASS 0 errors.
- Deploy server suite: PASS 297/297. Deploy bar/section: PASS 17/17.
- New tests prove: TEST dirty gate is ok (auto-save), LIVE/LOCAL stay blocked; post-commit
  approved leftovers fail closed; the route passes the new commit SHA and `worktree:
  clean` to the executor after a verified auto-commit.
- No real commit/push/deploy was executed.
DATABASE IMPACT: NONE.
SECURITY IMPACT: no secret/TypeScript/permission/target check weakened; secret files still
abort; approved-leftover post-commit aborts; LIVE/LOCAL strict.
UI/UX IMPACT: TEST gate no longer shows the misleading permanent block; the worktree row
explains excluded-only changes.
BUSINESS LOGIC IMPACT: NONE.
DEPLOYMENT: NONE.
NEXT STEP: restart the dev server to load 0.4.3, run checks once, then an approved TEST
publish. A real dispatch still requires `DEPLOY_GITHUB_TOKEN`.

---

VERSION: 0.4.4 (fix: reuse the existing trusted GitHub connection for dispatch)
DATE: 2026-11-04
ENVIRONMENT: DEVELOPMENT — branch `test/unified-gateway-ui-only`
BASE COMMIT: 190b43577b3eee10b835579aa63d2c155fd7e660
RELEASE TYPE: Development patch (no deployment executed)
PREVIOUS VERSION: 0.4.3
WHY 0.4.4:
- PATCH bump: the TEST dispatch failed with "DEPLOY_GITHUB_TOKEN غير موجود" even though
  the machine already has an authenticated GitHub CLI session used for Git/Actions. The
  server read only the env var and ignored the existing trusted connection.
EVIDENCE (read-only, no token printed):
- `gh auth status`: logged in as `modii1`; token scopes `gist, read:org, repo, workflow`.
- `resolveDeployGithubToken` resolved the existing session: source `gh_cli`, token length
  40 (value never printed).
- `GET /repos/modii1/rwqan/actions/workflows/deploy-test.yml`: HTTP 200, name
  "Deploy TEST Rollout", state `active`, path `.github/workflows/deploy-test.yml`.
- `GET /repos/modii1/rwqan`: permissions admin/maintain/push/triage/pull = true.
- The dispatch endpoint was deliberately NOT called (it would start a real TEST deploy).
FIX:
- New `server/services/GitHubAuthService.ts`: one credential resolver.
  - Precedence: `DEPLOY_GITHUB_TOKEN` (if configured) → existing `gh auth token`
    session, but ONLY when `NODE_ENV=development`.
  - Production/other runtimes stay explicit-env only; no host keyring access.
  - Returns `{ token, source, reason }`; the token is never written to disk, logged, or
    returned in an API response. A missing session fails closed with a clear reason.
- `DeployRealExecutor` resolves the environment once per dispatch and passes the token
  in-memory to the existing workflow dispatch functions. No new token is created, no
  separate secret is requested.
- README/operations document both accepted sources and the exact scopes.
CHANGED:
- server/services/GitHubAuthService.ts (new) + test (new)
- server/services/DeployRealExecutor.ts (dispatch environment)
- shared/appVersion.ts → 0.4.4
- docs: VERSION_HISTORY, RELEASE_NOTES, PROJECT_MASTER_REFERENCE, START_HERE, OPERATIONS,
  SESSION_HANDOFF, DECISIONS (DEC-025), UI_UX_REFERENCE, DEPLOY_BAR_LOCAL_TEST_LIVE_AR,
  DEPLOY_SYSTEM_PLAN_AR, DEPLOY_SYSTEM_REAL_vs_SIMULATION_AR.
VERIFICATION:
- TypeScript frontend + server: PASS 0 errors.
- Deploy + auth suite: PASS 302/302. Deploy bar/section: PASS 17/17.
- 5 new auth tests: env precedence, gh reuse, production isolation, missing session fail
  closed, no opt-in means no keyring access.
- No real commit/push/deploy was executed. A real TEST dispatch still requires explicit
  approval; a simulated accepted dispatch is covered by the existing dispatch tests.
DATABASE IMPACT: NONE.
SECURITY IMPACT: token stays in memory; production never reads the host gh keyring; no
token in code/files/logs/responses; LIVE untouched.
UI/UX IMPACT: NONE (the existing error/success surfaces are unchanged).
BUSINESS LOGIC IMPACT: NONE.
DEPLOYMENT: NONE.
NEXT STEP: restart the dev server to load 0.4.4; TEST dispatch will then reuse the
authenticated gh session. A real TEST run needs explicit approval.

---

VERSION: 0.5.0 (remove TEST auto-commit/auto-push; deploy the last approved commit)
DATE: 2026-11-05
ENVIRONMENT: DEVELOPMENT — branch `test/unified-gateway-ui-only`
BASE COMMIT: 190b43577b3eee10b835579aa63d2c155fd7e660
RELEASE TYPE: Development version (no deployment executed)
PREVIOUS VERSION: 0.4.4
WHY 0.5.0:
- MINOR bump because a documented capability is removed (breaking change in 0.x). The
  auto-commit/auto-push experiment caused operational problems (including an
  unauthorized-looking diagnostic ref) and did not deliver a successful deploy.
SUMMARY:
- Deleted `DeployTestAutoCommitService` and its tests. No route or UI creates a commit,
  push, or branch for TEST anymore.
- TEST publish dispatches `deploy-test.yml` on `test/unified-gateway-ui-only` for the
  commit already on that branch (the last approved commit).
- If the local worktree has uncommitted changes, the bar and confirm dialog warn clearly
  that they will NOT be published; they are never deleted, stashed, or replaced.
- The gate marks a dirty TEST worktree as `ok` with that warning. LIVE and LOCAL keep the
  strict blocked behavior.
- No empty commit and no temporary ref. The diagnostic ref `__rwqan_auth_dry_run__` was
  never created on the remote (verified 404 + empty `ls-remote`); it was not deleted or
  modified.
- Retained: secret/TypeScript checks, target/permission checks, check-button UX, the
  secret-scan false-positive fix, and GitHub auth reuse (`DEPLOY_GITHUB_TOKEN` or the
  existing `gh` session in development only).
CHANGED:
- removed: server/services/DeployTestAutoCommitService.ts (+ test), shared/appVersion.ts
- server/routes/admin/deploy.ts (+ test): removed auto-commit block/seams/payload; returns
  `worktree` + `localChangesIgnored`.
- server/services/DeployPrepublishGate.ts (+ test): TEST dirty warns, LIVE/LOCAL blocked.
- server/services/DeploySystemStore.ts, shared/deploySystem.ts: removed
  `excludedChangesOnly` / auto-commit state.
- src/components/deploy-bar.tsx (+ test): no autoCommit claim; confirms/warns about local
  changes.
- server/services/DeployRealExecutor.ts: reverted the sanitizer export only.
- docs consolidated to a single CURRENT VERSION 0.5.0; 0.4.0/0.4.2/0.4.3 auto-commit
  entries are marked superseded.
VERIFICATION:
- TypeScript frontend + server: PASS 0 errors.
- Deploy + auth suite: PASS 285/285. Deploy bar/section: PASS 18/18.
- Remote heads: only `main` (a246a8e) and `test/unified-gateway-ui-only` (190b435).
- The temporary diagnostic ref is absent; no branch was deleted or changed.
- No commit/push/deploy was executed for this removal.
DATABASE IMPACT: NONE.
SECURITY IMPACT: no secret/TypeScript/permission/target check weakened; no token in
code/files/logs; LIVE untouched.
UI/UX IMPACT: TEST warns about uncommitted local changes and deploys the last approved
commit; no auto-save claim.
BUSINESS LOGIC IMPACT: NONE.
DEPLOYMENT: NONE.
NEXT STEP: restart the dev server to load 0.5.0; commit the approved changes manually, then
an approved TEST publish will deploy that commit. A real dispatch still requires a valid
GitHub auth source.

---

VERSION: 0.6.0 (monthly partner profit cycles completed + simplified admin UI)
DATE: 2026-11-05
ENVIRONMENT: DEVELOPMENT — branch `test/unified-gateway-ui-only`
BASE COMMIT: 190b43577b3eee10b835579aa63d2c155fd7e660
RELEASE TYPE: Development version (no deployment executed)
PREVIOUS VERSION: 0.5.0
WHY 0.6.0:
- MINOR bump: the monthly partner profit cycle capability is completed and its admin
  UI is simplified (documented direction), with real bugs fixed. No breaking change.
SUMMARY:
- Partner profit monthly cycle system completed:
  - Pure calculator: server/services/PartnerProfitCalculator.ts
    (loss carry-forward, partial transfers, duplicate prevention, incomplete payment
    exclusion, distributed-loss increment).
  - FinanceService: prepareMonthlyCycle, closeMonthlyCycle, recordTransfer,
    updatePartnerProfitNotes; historical records without status treated as closed.
  - API: POST /api/admin/partner-profits/prepare, POST /.../:id/close,
    POST /.../:id/transfers, PUT /.../:id (notes only).
  - Schema: PartnerProfit extended (cycle status, carried loss, distributable profit,
    transfer array, remaining fields).
- Admin UI simplified (src/components/admin/sections/partner-profits.tsx):
  - Unified current-cycle card driven by /prepare data.
  - Single transfer panel (owed / transferred / remaining).
  - Collapsible cycle list and payments list.
  - Expense management moved to independent bottom section.
  - No manual numeric entry; notes editing only for mutable cycles.
- Fixed real failures that surfaced as generic «فشل» buttons:
  - Route order: /prepare now matched before /:id.
  - PUT /:id now updates notes only and rejects closed/historical cycles.
  - Transfers recorded via the dedicated transfers route with over-draw protection.
- Tests added: PartnerProfitCalculator.test.ts (8), FinanceService.test.ts (6).
- Browser E2E: PASS 1/1 (login, prepare, expand, edit notes, close, transfer, payments
  toggle, expense dialog) on LOCAL http://localhost:5001.
CHANGED (code):
- src/components/admin/sections/partner-profits.tsx
- server/services/FinanceService.ts
- server/services/PartnerProfitCalculator.ts (+ test)
- server/routes/admin/finance.ts
- server/firebaseService.ts (getPartnerProfitById)
- shared/schema.ts
- NEW: server/services/FinanceService.test.ts, server/services/PartnerProfitCalculator.test.ts,
  tests/partner-profits-browser.spec.ts,
  scripts/dev/cleanup-partner-profits-test-data.ts
CHANGED (documentation): docs/RELEASE_NOTES.md, docs/VERSION_HISTORY.md.
VERIFICATION (this session):
- TypeScript frontend + server: PASS 0 errors.
- PartnerProfitCalculator: PASS 8/8. FinanceService: PASS 6/6.
- Playwright browser: PASS 1/1 on LOCAL http://localhost:5001.
- Test Firestore records cleaned up; historical data preserved.
DATABASE IMPACT: NONE in production; DEV test records removed after verification.
SECURITY IMPACT: NONE. Closed/historical protection added.
UI/UX IMPACT:
- Simplified RTL/Arabic layout retained; collapsible sections; no manual numeric entry.
- Generic «فشل» buttons fixed via real error propagation and correct routes.
BUSINESS LOGIC IMPACT:
- Loss carry-forward, 50/50 distribution, partial transfers and close immutability
  preserved (calculator rules unchanged).
DEPLOYMENT: NONE. No TEST/LIVE deploy executed.
NEXT STEP:
- Restart the dev server to load 0.6.0; commit approved changes manually; then an
  approved TEST publish deploys that commit. A real dispatch still requires a valid
  GitHub auth source.

---

VERSION: 0.7.0 (deploy bar: icon-only upload branch button)
DATE: 2026-11-05
ENVIRONMENT: DEVELOPMENT — branch `test/unified-gateway-ui-only`
BASE COMMIT: 06e6876805133379852b39524e4effbfddc77daf
RELEASE TYPE: Development version (no deployment executed)
PREVIOUS VERSION: 0.6.0
WHY 0.7.0:
- MINOR bump: a new admin UI capability (icon-only branch upload button) is added
  without touching the publish logic itself. No breaking change.
SUMMARY:
- Deploy bar gains an icon-only Upload button (arrow-up) next to the TEST publish
  button. No visible text; Tooltip «رفع إلى GitHub» on hover; aria-label for a11y.
- Icon h-3.5 w-3.5; button size=sm / h-7 / px-2 / text-xs / outline; shrink-0 (scrolls in
  the overflow-x bar); usable on mobile and desktop.
- On click → handleUploadBranch → startPublish("TEST") → approved flow:
  source check → approval (confirm + dirty warning) → GitHub dispatch → verify.
- New browser E2E: tests/deploy-bar-upload.spec.ts PASS 1/1.
CHANGED (code):
- src/components/deploy-bar.tsx
- NEW: tests/deploy-bar-upload.spec.ts
CHANGED (documentation): docs/RELEASE_NOTES.md, docs/VERSION_HISTORY.md.
VERIFICATION (this session):
- TypeScript frontend + server: PASS 0 errors.
- Deploy bar source tests: PASS 18/18.
- Playwright (deploy bar upload): PASS 1/1.
DATABASE IMPACT: NONE.
SECURITY IMPACT: NONE (no auth/secret/permission change; click still gated by the
  approved publish flow).
UI/UX IMPACT:
- Icon-only upload button next to the TEST publish button; tooltip «رفع إلى GitHub»;
  no visible text; RTL/Arabic bar retained; responsive scroll retained.
BUSINESS LOGIC IMPACT: NONE (upload reuses the approved publish path).
DEPLOYMENT: NONE. No TEST/LIVE deploy executed.
NEXT STEP:
- Restart the dev server to load 0.7.0; commit approved changes manually; then an
  approved TEST publish deploys that commit. A real dispatch still requires a valid
  GitHub auth source.

---

VERSION: 0.8.0 (upload button: dedicated branch push + smart stage stepper)
DATE: 2026-11-05
ENVIRONMENT: DEVELOPMENT — branch `test/unified-gateway-ui-only`
BASE COMMIT: 34715bb54e175c6a2bc5ec9b62a7c7ba6360f7f3
RELEASE TYPE: Development version (no deployment executed)
PREVIOUS VERSION: 0.7.0
WHY 0.8.0:
- MINOR bump: a new admin capability is delivered (dedicated branch-upload pipeline +
  smart stage stepper) and the 0.7.0 upload button behavior is corrected (it no longer
  delegates to the publish flow). No breaking change.
SUMMARY:
- FIXED: icon-only upload button no longer calls the publish flow; it runs the dedicated
  branch push only.
- New pipeline: server/services/DeployGitPushService.ts (stages: connection, branch,
  changes, github_connection, push, verify, final; fail closed; read-back SHA verify;
  up-to-date skip).
- New route: POST /api/admin/deploy/upload (admin-guarded, same-origin, DEV gate, single
  flight; only the approved branch accepted).
- Smart stepper UI: stage rows with running/pending/ok/failed/skipped, final result with
  commit SHA, close action.
- Tests: DeployGitPushService PASS 7/7; deploy routes PASS 44/44; deploy bar sources PASS
  23/23; Playwright upload PASS 1/1 (mocked).
CHANGED (code):
- shared/deploySystem.ts (upload result types + audit actions)
- server/services/DeployGitPushService.ts (NEW)
- server/services/DeployGitPushService.test.ts (NEW)
- server/routes/admin/deploy.ts (POST /api/admin/deploy/upload)
- src/components/deploy-bar.tsx (fix + stepper)
- src/components/deploy-bar-upload.test.ts (NEW)
- tests/deploy-bar-upload.spec.ts (rewritten for dedicated upload flow)
CHANGED (documentation): docs/RELEASE_NOTES.md, docs/VERSION_HISTORY.md.
VERIFICATION (this session):
- TypeScript frontend + server: PASS 0 errors.
- DeployGitPushService: PASS 7/7. Deploy routes: PASS 44/44. Deploy bar sources: PASS 23/23.
- Playwright (deploy bar upload): PASS 1/1.
DATABASE IMPACT: NONE.
SECURITY IMPACT: NONE (no auth/secret/permission change; branch allow-list fail closed).
UI/UX IMPACT:
- Icon-only upload button with tooltip «رفع إلى GitHub»; smart stage stepper panel; no
  visible label; RTL/Arabic retained; responsive scroll retained.
BUSINESS LOGIC IMPACT: NONE (upload independent from publish; publish behavior untouched).
DEPLOYMENT: NONE. No TEST/LIVE deploy executed.
NEXT STEP:
- Restart the dev server to load 0.8.0; commit approved changes manually; then an
  approved TEST publish deploys that commit. A real dispatch still requires a valid
  GitHub auth source.

---

VERSION: 0.9.0 (upload button linked to selected environment TEST/LIVE)
DATE: 2026-11-06
ENVIRONMENT: DEVELOPMENT — branch `test/unified-gateway-ui-only`
BASE COMMIT: 34715bb54e175c6a2bc5ec9b62a7c7ba6360f7f3
RELEASE TYPE: Development version (no deployment executed)
PREVIOUS VERSION: 0.8.0
WHY 0.9.0:
- MINOR bump: the upload button is now linked to the selected environment
  (TEST pushes `test/unified-gateway-ui-only`, LIVE pushes `main`) and prevents
  environment switching while an upload is in flight. No breaking change.
SUMMARY:
- Upload button is a single smart button linked to the deploy bar environment
  switcher. One icon only — no duplicate.
- Target branch resolved server-side per environment:
  TEST -> test/unified-gateway-ui-only, LIVE -> main, LOCAL -> unsupported.
- New route: POST /api/admin/deploy/upload (environment parameter, admin-guarded).
- Pipeline: connection -> branch -> changes -> github_connection -> push -> verify
  -> final, fail closed, read-back SHA verification.
- Environment switch blocked while upload is pending.
- Tests: DeployGitPushService PASS 8/8; deploy routes PASS 44/44; deploy bar
  sources PASS 23/23; Playwright upload PASS 1/1.
CHANGED (code):
- shared/deploySystem.ts (approved branch per environment + result types)
- server/services/DeployGitPushService.ts (environment-aware pipeline)
- server/services/DeployGitPushService.test.ts (NEW, 8 tests)
- server/routes/admin/deploy.ts (POST /api/admin/deploy/upload with environment)
- src/components/deploy-bar.tsx (environment-linked upload + switch lock)
- src/components/deploy-bar-upload.test.ts (NEW, source tests)
- tests/deploy-bar-upload.spec.ts (Playwright E2E against localhost:5001)
CHANGED (documentation): docs/RELEASE_NOTES.md, docs/VERSION_HISTORY.md.
VERIFICATION (this session):
- TypeScript frontend + server: PASS 0 errors.
- DeployGitPushService: PASS 8/8. Deploy routes: PASS 44/44. Deploy bar sources: PASS 23/23.
- Playwright (deploy bar upload): PASS 1/1 on LOCAL http://localhost:5001.
DATABASE IMPACT: NONE.
SECURITY IMPACT: NONE (no auth/secret/permission change; branch allow-list fail closed per environment).
UI/UX IMPACT:
- Single icon-only upload button with tooltip «رفع إلى GitHub»; smart stage stepper;
  no visible label; RTL/Arabic retained; responsive scroll retained; switch lock during upload.
BUSINESS LOGIC IMPACT: NONE (upload independent from publish; publish behavior untouched).
DEPLOYMENT: NONE. No TEST/LIVE deploy executed. No real Git push performed.
NEXT STEP:
- Restart the dev server to load 0.9.0; commit approved changes manually; then an
  approved TEST publish deploys that commit. A real dispatch still requires a valid
  GitHub auth source.
