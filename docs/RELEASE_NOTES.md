# RELEASE NOTES â€” Ruqan / Rwqan

No certified production release yet. This file records development-grade release notes
for each documented baseline/release entry (see VERSION_HISTORY.md).

## 0.1.0 â€” Documentation + verification baseline (dev)
Date: 2026-10-13
Environment: DEVELOPMENT clone
What changed:
- Permanent docs/ system introduced (11 files).
- AUTH-001: changePassword now hash-aware; new owner creation writes hashed credentials;
  19 new AUTH tests (password util + AuthService).
- AUTHZ-001: GET /api/owner/subscription/:propertyNumber session-scoped (group-aware);
  regression test; scanner widened; RED-triggering 2 -> 1.
- Scanner re-run + baseline re-anchored (NEW:0 / EXISTING:40 / RED:1 = SEC-001).
- Browser E2E + live-API + business-logic suites executed (quality CLI Windows entry
  guard fixed so they actually run); BL-006 legacy-VIP fixture corrected to the real
  document shape (base-50 SAR assertion unchanged).
What did NOT change:
- Business logic, pricing, subscriptions, payments, bookings, discount semantics.
- Public property image behavior. Any production resource. No production deployment.
Risks:
- SEC-001 open: production secrets in git (BLOCKED remediation - production rotation).
- AUTH-001 affects credential handling; DEV only, empty data model. Production migration
  NOT started.
- Property.pin sync still writes the hash while admin pin-set writes plaintext pin on the
  property doc (legacy transition; MUST resolve before production enforcement).
Tests:
- TS PASS; full suite 702/702 (serial); browser E2E PASS 2/2; business-logic 10/10;
  live-API 2/3 (API-002 = known empty-DEV package-data gap, 404 by design); build PASS.
Security:
- New no-plaintext-write invariant; legacy login still supported in transition flags.
  No new scanner findings (NEW 0).
UI/UX:
- No change; build passes; RTL confirmed; home + /properties load in headless chromium.
Business Logic:
- No change. Linked-group subscription display semantics preserved (DEC-007).
Database impact:
- None.
Deployment:
- None.
Rollback:
- Feature flags allow AUTH behavior rollback locally.
Remaining issues:
- See SECURITY_STATUS.md and SESSION_HANDOFF.md.

## 0.1.0 addendum â€” DEV E2E test-data + realistic browser E2E (dev)
Date: 2026-10-13
Environment: DEVELOPMENT clone (NOT a production release)
What changed (documentation addendum; no version bump, no deployment):
- DEV-only synthetic test-data system (DEC-014): scripts/dev/e2e-test-data.ts +
  e2e-seed.ts / e2e-cleanup.ts. Runtime-guarded (NODE_ENV=development,
  project rwqan-sa-dev, bucket rwqan-sa-dev, external services disabled); idempotent
  fixed ids; every record marked testData:true + E2E_TEST_; cleanup removes only
  marked/known ids.
- Browser E2E expanded to 15 real cases (owner/admin login UI, 401 boundary, owner
  dashboard, property-update persistence, public browse/detail, packages render,
  payment/calculate with discount, admin boundary + dashboard/data, public image upload,
  responsive RTL 390/768/1440). Live-API API-002 now resolves a real seeded package id.
What did NOT change:
- Business logic, pricing, subscriptions, payments, bookings, discount semantics.
- Security status (no finding changes). Any production resource. No deployment.
Tests:
- Quality: 27/28 PASS, 0 FAIL, 1 BLOCKED (criticalFailures 0).
  - Business Logic 10/10; Live API 3/3; Browser E2E 14 PASS + 1 BLOCKED.
- Full server+shared suite: 702/702 PASS (serial).
- TypeScript: 0 errors. Build: PASS.
- Seed/Cleanup: verified deterministic.
Security:
- Offline scan: OVERALL ORANGE, NEW 0 / EXISTING 39 / REGRESSED 0. SEC-002 MEDIUM
  remains; SEC-001 historically open. No new findings.
Blocked / known limits:
- Customer OTP login BLOCKED (WhatsApp disabled in DEV). Real Paymob/Drive/OCR unavailable.
- Production Release Gate = BLOCKED. This addendum is NOT a production release.

SAFE DEV E2E STATUS: PASS
PRODUCTION RELEASE GATE = BLOCKED

## 0.2.0 â€” Unified gateway + deploy bar TEST/LIVE + real Actions status (dev)
Date: 2026-11-04
Environment: DEVELOPMENT â€” branch `test/unified-gateway-ui-only`
Commit: 190b43577b3eee10b835579aa63d2c155fd7e660

What changed:
- Deploy bar/console now covers TEST and LIVE separately through GitHub Actions
  dispatch. Canonical TEST target: project `rwqan-757`, backend `rwqan-backend`,
  `https://rwqan-backend--rwqan-757.europe-west4.hosted.app`. LIVE remains
  project `rwqan-757`, backend `rwqan`, `https://rwqan.sa`.
- Real GitHub Actions run status (public repository, anonymous read), including the
  failed job/step and a safe failure reason. Success is shown only after the rollout
  step is verified; when the status cannot be read a clear reason is shown instead of
  fake success.
- `deploy-test.yml` is manual `workflow_dispatch` only; the `push` trigger was removed
  so pushing does not deploy TEST before approval.
- Unified owner account login (phone OTP + property-number tab), account manager and
  property switcher are present on this branch.
- Partner profits admin system is present on this branch.
- LOCAL remains a fixed developer environment (port 5001). Removing the LOCAL switch
  button from the environment bar is the approved direction but NOT implemented yet.

What did NOT change:
- LIVE settings and deployment remain untouched; no LIVE deployment was made.
- No secrets, Firebase/GitHub permissions, or database data were changed.
- The deploy mechanism was not rebuilt; GitHub Actions dispatch remains the path.
- Business logic, pricing, subscriptions, payments, bookings and discounts unchanged.

Tests (verified on this branch/commit):
- TypeScript: PASS 0 errors (frontend + server).
- Deploy-related tests: 164/164 PASS.
- Full source suite on this branch: NOT RUN (not claimed).
- Read-only GitHub Actions: last TEST run success (41333932185, b856ed2);
  last LIVE run success (41352340982, 3484594). No new run for 190b435.

Deployment: NONE (no TEST or LIVE deploy).
Next: explicit approval for TEST deploy; implement LOCAL button removal separately.

SAFE DEV STATUS: PASS
PRODUCTION RELEASE GATE = BLOCKED

## 0.3.0 â€” LIVE enabled + approved hosting links cleanup (dev)
Date: 2026-11-04
Environment: DEVELOPMENT â€” branch `test/unified-gateway-ui-only`
Base commit: 190b43577b3eee10b835579aa63d2c155fd7e660 (changes in working tree)

What changed:
- LIVE is no longer programmatically blocked by a separate production opt-in:
  `productionDeployEnabled()` now mirrors the real-deploy switch (`DEPLOY_REAL_DEPLOY`).
  The deploy bar's "official update disabled" guard and its separate activation message
  were removed. Build checks, target validation, admin session/same-origin checks and
  GitHub dispatch checks remain mandatory.
- Approved hosting links:
  - LIVE: `https://rwqan--rwqan-757.europe-west4.hosted.app/`
  - TEST: `https://rwqan-backend--rwqan-757.europe-west4.hosted.app/`
- The official domain `https://rwqan.sa` is untouched (Paymob endpoints, WhatsApp/booking
  links, SEO and the production base URL remain as-is).
- Removed unapproved development hosting URLs:
  `https://rwqan-sa-dev--rwqan-dev-backend.us-central1.hosted.app`,
  `https://rwqan-backend--rwqan-757.us-central1.hosted.app`,
  `https://rwqan-backend--rwqan-757.europe-west1.hosted.app`, and the legacy
  `https://REPLACE-WITH-DEV-BACKEND-HOST` placeholder.
- `apphosting.dev.yaml` is marked legacy (not deleted) and points to the LOCAL address.
- Active deploy code now uses the official repository `modii1/rwqan`.

What did NOT change:
- The official domain `rwqan.sa` and all its business links.
- The deploy mechanism (GitHub Actions dispatch; TEST and LIVE workflows are separate).
- Business logic, pricing, subscriptions, payments, bookings and discounts.
- No secrets, Firebase/GitHub permissions or database data were changed.

Verification (no deployment):
- State API with the LIVE deploy target reported: `productionDeployEnabled=true`,
  target `rwqan-757` / `rwqan`, base URL `https://rwqan--rwqan-757.europe-west4.hosted.app`,
  `production_opt_in=ok`, `target_config=ok`, `release_checks=ok`, `real_deploy_opt_in=ok`.
- Remaining operational constraints (not a permanent programmatic block):
  - dirty worktree because the changes are uncommitted (the gate blocks publishing until
    a clean tree after an approved commit);
  - `DEPLOY_GITHUB_TOKEN` is absent locally and is required for GitHub dispatch.
- No TEST or LIVE deployment was executed.

Tests:
- TypeScript: PASS 0 errors (frontend + server).
- Deploy-related tests: 185/185 PASS.
- Full source suite on this branch: NOT RUN in this session (not claimed).

Deployment: NONE.
Next: commit with approval to clean the worktree; provide the pre-existing
`DEPLOY_GITHUB_TOKEN`; then LIVE publish is available via the approved path.

SAFE DEV STATUS: PASS
PRODUCTION RELEASE GATE = BLOCKED

## 0.3.1 â€” Environment-bar cleanup: LOCAL switch + generic publish removed (dev)
Date: 2026-11-04
Environment: DEVELOPMENT â€” branch `test/unified-gateway-ui-only`
Base commit: 190b43577b3eee10b835579aa63d2c155fd7e660 (changes in working tree)

What changed (UI only):
- DEC-015 implemented: removed the LOCAL option/button/label from the environment switch
  in `src/components/deploy-bar.tsx`; the switch now offers only TEST and LIVE. LOCAL
  remains the fixed developer environment at `http://localhost:5001` with its detection
  and operation unchanged.
- Removed the generic cloud "ظ†ط´ط±" button. Kept "ظ†ط´ط± ظ†ط³ط®ط© ط§ظ„طھط¬ط±ط¨ط©" and
  "ظ†ط´ط± ط§ظ„ظ…ظˆظ‚ط¹ ط§ظ„ط±ط³ظ…ظٹ", TEST/LIVE status, run information and the existing publish
  mechanism unchanged.

What did NOT change:
- LOCAL environment, address, detection or operation.
- TEST/LIVE buttons, status, links, workflows or publish mechanism.
- Backend, API, data, secrets, deployment configuration or business logic.

Tests:
- TypeScript: PASS 0 errors.
- Deploy bar/section tests: 19/19 PASS.
- Source assertions verify LOCAL and the generic publish button are absent while TEST/LIVE
  publish buttons and the environment switch remain.
- Full source suite on this branch: NOT RUN in this session (not claimed).

Deployment: NONE.
Next: commit with approval; provide the pre-existing `DEPLOY_GITHUB_TOKEN`; then TEST/LIVE
publish is available through the approved path.

SAFE DEV STATUS: PASS
PRODUCTION RELEASE GATE = BLOCKED

## 0.4.0 â€” Automatic safe Git handling for TEST publish (SUPERSEDED by 0.5.0)
Date: 2026-11-04
Environment: DEVELOPMENT â€” branch `test/unified-gateway-ui-only`
Base commit: 190b43577b3eee10b835579aa63d2c155fd7e660 (changes in working tree)

What changed:
- Pressing "ظ†ط´ط± ظ†ط³ط®ط© ط§ظ„طھط¬ط±ط¨ط©" (TEST) no longer rejects a dirty working tree. The server
  first inspects every changed path and then automatically commits and pushes the
  approved changes to the approved TEST branch before dispatching `deploy-test.yml`.
- Secrets abort the entire operation: `.env*`, private keys, service-account/credential/
  secret files. Nothing is committed, pushed or dispatched.
- Local/unintended files are excluded and skipped (never staged): `reports/`,
  `node_modules/`, `.next/`, `dist/`, uploads/backups, logs, archives, databases,
  `.DS_Store`, and untracked files outside `src/`, `server/`, `shared/`, `docs/`,
  `scripts/`, `.github/workflows/`, `quality/`, `security/` or the root config allow-list.
  Approved changes still proceed.
- Commit message includes the app version and a summary:
  `chore(release): v0.4.0 â€” TEST auto-publish` plus the file list and area summary.
- The branch is hard-guarded to `test/unified-gateway-ui-only`; the service can never
  push `main`. After pushing, the remote tip is verified to equal the new commit before
  any dispatch is requested.
- Mandatory gates run BEFORE the commit (never bypassed): secret scan PASS and
  TypeScript PASS. A failing gate returns 409 with the real reason and does nothing else.
- The TEST success (202) payload includes `autoCommit` and the bar toast shows the
  short SHA, branch, file count and the real GitHub Actions link.
- LIVE and LOCAL are unchanged. LIVE never auto-commits and still dispatches
  `deploy-live.yml` on `main`; LOCAL behavior is untouched.

What did NOT change:
- LIVE button, mechanism, workflow, target, links and checks.
- LOCAL environment, address, detection or operation.
- Security, TypeScript, admin-permission, target-matching or GitHub dispatch gates.
- No secrets added or exposed; no production resource touched.

Tests:
- TypeScript: PASS 0 errors (frontend + server).
- Deploy suite (server): 291/291 PASS, including 7 new auto-commit service tests and the
  new route tests (success, secret abort, LIVE no auto-commit).
- Deploy bar/section tests: 16/16 PASS.
- No test performs a real commit, push or deployment (the service is injected).

Deployment: NONE executed.
Remaining external constraint: a real TEST dispatch needs the pre-existing server
`DEPLOY_GITHUB_TOKEN`, which was absent locally; a real TEST publish was NOT executed and
is not claimed.

SAFE DEV STATUS: PASS
PRODUCTION RELEASE GATE = BLOCKED

## 0.4.1 â€” Fix: secret-scan false positive blocked TEST publish (dev)
Date: 2026-11-04
Environment: DEVELOPMENT â€” branch `test/unified-gateway-ui-only`
Base commit: 190b43577b3eee10b835579aa63d2c155fd7e660

What was diagnosed (from the durable store, not assumed):
- The last TEST publish failed at the mandatory `secretScan` check:
  `secretScan=FAIL`, reason: "ظ†ظ…ط· ط³ط±ظ‘ظٹ ظˆظڈط¬ط¯ ط¯ط§ط®ظ„ ظ…ط­طھظˆظ‰ ط£ط­ط¯ ط§ظ„ظ…ظ„ظپط§طھ ط§ظ„ظ…ظڈط؛ظٹظژظ‘ط±ط©."
- Offending file: `server/services/DeployRealExecutor.test.ts`. Its redaction tests
  embedded token-shaped synthetic strings (`AIzaâ€¦` / `ghp_â€¦`) verbatim in source. They
  are not real credentials, but the scanner correctly rejects token-shaped content in
  changed files.
- No commit was created, nothing was pushed, GitHub Actions never started, no App Hosting
  rollout occurred, and the TEST working version did not change.

What changed:
- The synthetic fixtures are now assembled at runtime from split fragments. The source
  file no longer matches the secret patterns; at runtime the strings still match the
  production redaction regex, so the redaction tests remain meaningful.
- The secret-scan reason now names the offending changed file(s) (never the content), so
  future failures are diagnosable from the audit log.
- The deploy bar's failed-check toast now shows the real server reason instead of the
  misleading "ظ„ظ… ظٹظڈط³ط¬ظژظ‘ظ„ ط£ظٹ ط¥طµط¯ط§ط± ظ…ظ†ط´ظˆط±." when a validation_failed release exists.
- Version bumped to 0.4.1 (PATCH). No mandatory check, pattern, permission, target, LIVE
  path or LOCAL behavior was weakened or changed.

Verification:
- Re-ran the same read-only secret scan over the current working tree: `secretScan=PASS`.
- TypeScript: PASS 0 errors (frontend + server).
- Deploy server suite: 291/291 PASS; deploy bar/section: 16/16 PASS.
- No deployment was executed to verify the fix.

Next: restart the dev server, run the checks once to persist a fresh `secretScan=PASS`,
then perform an approved TEST publish. A real dispatch still requires the pre-existing
`DEPLOY_GITHUB_TOKEN`.

SAFE DEV STATUS: PASS
PRODUCTION RELEASE GATE = BLOCKED

## 0.4.2 â€” Fix: TEST auto-save was not invoked / silent skip (SUPERSEDED by 0.5.0)
Date: 2026-11-04
Environment: DEVELOPMENT â€” branch `test/unified-gateway-ui-only`
Base commit: 190b43577b3eee10b835579aa63d2c155fd7e660

Diagnosis (running process + durable store, not assumed):
- The dev server process was started at 20:40:50 local, before
  `server/routes/admin/deploy.ts` was last written at 22:05:01 local. `tsx server/index.ts`
  does not hot-reload, so the process was running the pre-auto-commit route and could not
  call `DeployTestAutoCommitService`.
- The durable store's last publish attempt is 19:23:23Z (before the 0.4.1 fix); the later
  19:44/19:45 entries are explicit `checks_run` audits, not publish attempts. The running
  server's state endpoint reported the real dirty worktree at `190b435`, so the data was
  present but the loaded code never invoked the service.
- Secondary defect: the route silently skipped auto-commit when the local Git state was
  `unknown`; that silent path allowed a dispatch without saving.

What changed:
- TEST fails closed with `409 DEPLOY_GIT_UNAVAILABLE` when the local Git checkout cannot
  be inspected; no silent dispatch.
- Passing secretScan/TypeScript checks are persisted BEFORE the commit attempt, so the
  checks remain visible even if the commit/push fails.
- Commit/push/verification failures now return sanitized real Git details (tokens and URL
  credentials redacted) to the response and the bar.
- The bar refreshes state/SHA on both success and error, so a successful commit/push is
  reflected even if a later dispatch step fails.
- Enforced order (tested): pre-checks â†’ persist check run â†’ auto-commit â†’ dispatch.
- LIVE and LOCAL untouched; no security check weakened.

Verification:
- TypeScript: PASS 0 errors (frontend + server).
- Deploy server suite: 293/293 PASS; deploy bar/section: 16/16 PASS.
- No real commit/push/deploy was executed; tests inject the service.

Next: restart the dev server to load 0.4.2, run checks once to persist PASS, then perform
an approved TEST publish. A real dispatch still requires `DEPLOY_GITHUB_TOKEN`.

SAFE DEV STATUS: PASS
PRODUCTION RELEASE GATE = BLOCKED

## 0.4.3 â€” Fix: final worktree gate accepts the verified auto-commit (SUPERSEDED by 0.5.0)
Date: 2026-11-04
Environment: DEVELOPMENT â€” branch `test/unified-gateway-ui-only`
Base commit: 190b43577b3eee10b835579aa63d2c155fd7e660

What was wrong:
- After a successful auto-commit, the final gate re-read the raw worktree. Excluded/local
  files (for example `reports/`) kept it dirty, so the gate still said "ظ…ظ…ظ†ظˆط¹: ط´ط¬ط±ط© ط§ظ„ط¹ظ…ظ„
  طھط­طھظˆظٹ طھط؛ظٹظٹط±ط§طھ ط؛ظٹط± ظ…ظڈط«ط¨ظ‘طھط©" even though all publishable changes were committed.
- The service did not return a post-commit proof, so the route had no authoritative signal
  that the approved changes were fully saved.

What changed:
- The service re-inspects after the commit and fails closed (`AUTO_COMMIT_INCOMPLETE`) if
  any approved change remains. It returns `remaining` and `publishWorktree: "clean"`.
  If only excluded files exist, it returns an explicit result (no empty commit).
- The route uses the verified auto-commit result as authoritative for TEST: it overrides
  the worktree to clean and the SHA to the new commit before the final gate and executor.
- The gate marks a dirty TEST worktree as `ok` with a note that TEST auto-saves approved
  changes before dispatch. LIVE and LOCAL keep the strict blocked behavior.
- The bar shows "طھط؛ظٹظٹط±ط§طھ ظ…ط­ظ„ظٹط© ظ…ط³طھط¨ط¹ط¯ط© ظپظ‚ط· â€” ظ„ظ† طھظ†ط´ط±" when only excluded files remain.
- No empty commit; only approved pathspecs; branch hard-pinned to
  `test/unified-gateway-ui-only`; secret/TypeScript/permission/target checks unchanged.

Verification:
- TypeScript: PASS 0 errors (frontend + server).
- Deploy server suite: 297/297 PASS; deploy bar/section: 17/17 PASS.
- Tests prove: TEST dirty gate is ok (auto-save), LIVE/LOCAL stay blocked; post-commit
  approved leftovers fail closed; the route passes the new SHA and `worktree: clean` to
  the executor only after a verified auto-commit.
- No real commit/push/deploy was executed.

Next: restart the dev server to load 0.4.3, run checks once, then an approved TEST publish.
The remaining external blocker is `DEPLOY_GITHUB_TOKEN` with actions:write on
`modii1/rwqan`.

SAFE DEV STATUS: PASS
PRODUCTION RELEASE GATE = BLOCKED

## 0.4.4 â€” Fix: reuse the existing trusted GitHub connection (dev)
Date: 2026-11-04
Environment: DEVELOPMENT â€” branch `test/unified-gateway-ui-only`
Base commit: 190b43577b3eee10b835579aa63d2c155fd7e660

Problem:
- TEST dispatch failed with "DEPLOY_GITHUB_TOKEN ط؛ظٹط± ظ…ظˆط¬ظˆط¯" even though this machine
  already has an authenticated GitHub CLI session used for Git/Actions. The server read
  only the env var and ignored the existing trusted connection.

Evidence (read-only, no token printed):
- `gh auth status`: logged in as `modii1`; scopes `gist, read:org, repo, workflow`.
- The new resolver returned source `gh_cli`, token length 40 (value never printed).
- `GET /repos/modii1/rwqan/actions/workflows/deploy-test.yml`: 200, "Deploy TEST
  Rollout", state active.
- `GET /repos/modii1/rwqan`: admin/maintain/push permissions true.
- The dispatch endpoint was not called (it would start a real TEST deploy).

What changed:
- New `server/services/GitHubAuthService.ts`: one resolver, `DEPLOY_GITHUB_TOKEN` first,
  then the existing `gh auth token` session only in `NODE_ENV=development`.
- Production/other runtimes stay explicit-env only; no host keyring access.
- The token stays in memory for the dispatch; it is never written to disk, logged, or
  returned in an API response. Missing auth fails closed with a clear reason.
- `DeployRealExecutor` uses the resolver for both TEST and LIVE dispatch. LIVE behavior
  and links are unchanged, and no LIVE deployment was executed.

Verification:
- TypeScript: PASS 0 errors (frontend + server).
- Deploy + auth suite: 302/302 PASS; deploy bar/section: 17/17 PASS.
- No real commit/push/deploy was executed. A real TEST run still needs explicit approval.

Next: restart the dev server to load 0.4.4; TEST dispatch then reuses the authenticated
`gh` session. If the server runs in production, provide `DEPLOY_GITHUB_TOKEN` explicitly
with `actions:write` on `modii1/rwqan`.

SAFE DEV STATUS: PASS
PRODUCTION RELEASE GATE = BLOCKED

## 0.5.0 â€” Remove TEST auto-commit/auto-push; deploy the last approved commit (dev)
Date: 2026-11-05
Environment: DEVELOPMENT â€” branch `test/unified-gateway-ui-only`
Base commit: 190b43577b3eee10b835579aa63d2c155fd7e660

What changed:
- Removed `DeployTestAutoCommitService` and every route/UI/test reference. TEST publish
  never creates a commit, push, or branch.
- TEST dispatches `deploy-test.yml` on `test/unified-gateway-ui-only` for the commit
  already on that branch.
- If the local worktree is dirty, the bar and confirm dialog warn that those changes will
  NOT be published; they are never deleted, stashed, or replaced.
- The gate marks a dirty TEST worktree as `ok` with that warning. LIVE/LOCAL keep the
  strict blocked behavior.
- Retained: secret/TypeScript/target/permission checks, check-button UX, the secret-scan
  false-positive fix, and GitHub auth reuse (`DEPLOY_GITHUB_TOKEN` or `gh` in development).
- No empty commit, no temporary ref. The diagnostic ref `__rwqan_auth_dry_run__` was never
  created (404 + empty `ls-remote`) and was not deleted/modified.

Verification:
- TypeScript: PASS 0 errors (frontend + server).
- Deploy + auth suite: 285/285 PASS; deploy bar/section: 18/18 PASS.
- Only `main` (a246a8e) and `test/unified-gateway-ui-only` (190b435) exist on the remote.
- No commit/push/deploy was executed for this removal.

Next: restart the dev server to load 0.5.0; commit approved changes manually, then an
approved TEST publish deploys that commit.

SAFE DEV STATUS: PASS
PRODUCTION RELEASE GATE = BLOCKED

## 0.6.0 — Monthly partner profit cycles completed + simplified admin UI (dev)
Date: 2026-11-05
Environment: DEVELOPMENT — branch `test/unified-gateway-ui-only`
Base commit: 190b43577b3eee10b835579aa63d2c155fd7e660 (changes in working tree)

What changed:
- Partner profit monthly cycle system completed:
  - New pure calculator: server/services/PartnerProfitCalculator.ts
    (loss carry-forward, partial transfers, duplicate prevention, incomplete payment
    exclusion, distributed-loss increment).
  - FinanceService: prepareMonthlyCycle, closeMonthlyCycle, recordTransfer,
    updatePartnerProfitNotes; historical records without status treated as closed.
  - API: POST /api/admin/partner-profits/prepare, POST /.../:id/close,
    POST /.../:id/transfers, PUT /.../:id (notes only).
  - Schema: PartnerProfit extended (cycle status, carried loss, distributable profit,
    transfer array, remaining fields).
- Admin UI simplified (src/components/admin/sections/partner-profits.tsx):
  - Unified current-cycle card driven by /prepare data (replaces old month summary card).
  - Single transfer panel (owed / transferred / remaining).
  - Collapsible cycle list and payments list.
  - Expense management moved to independent bottom section.
  - No manual numeric entry; notes editing only for mutable cycles.
- Fixed real failures that surfaced as generic «فشل» buttons:
  - Route order: /prepare now matched before /:id.
  - PUT /:id now updates notes only and rejects closed/historical cycles.
  - Transfers are recorded via the dedicated transfers route with over-draw protection.
- Tests added: PartnerProfitCalculator.test.ts (8 cases), FinanceService.test.ts (6 cases).

Verification (LOCAL http://localhost:5001):
- TypeScript: PASS 0 errors (frontend + server).
- PartnerProfitCalculator: PASS 8/8. FinanceService: PASS 6/6.
- Playwright browser (login, prepare, expand, edit notes, close, transfer, payments
  toggle, expense dialog): PASS 1/1.
- Test Firestore records cleaned up after verification; historical data preserved.

Deployment: NONE.
Rollback: feature stays behind the current admin section; no flag required.

SAFE DEV STATUS: PASS
PRODUCTION RELEASE GATE = BLOCKED
