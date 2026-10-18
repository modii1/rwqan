# DEV E2E / UX / BUSINESS-FLOW TEST — FINAL REPORT

DATE: 2026-10-13
SCOPE: Safe, repeatable, DEV-only realistic end-to-end testing (synthetic data + real
browser E2E) for Ruqan/Rwqan. Production NOT touched.

1. OBJECTIVE
Build a safe, repeatable DEV-only pipeline (synthetic personas/properties/packages/
subscriptions/discounts/requests + seed/cleanup) and run realistic product E2E/UX/
business-flow tests (auth, owner, customer, subscriptions, admin, files, responsive RTL).

2. ENVIRONMENT
- Clone: C:\Users\zerof\Desktop\rwqan-sa-opencode (DEV).
- Firebase: rwqan-sa-dev (project 467810513087, me-central2). R2: rwqan-sa-dev.
- Server: http://localhost:5001, NODE_ENV=development, external services disabled.
- Browser: Playwright chromium, headless.

3. SAFETY / GUARDRAILS
- Test data is DEV-only and refuses to run unless NODE_ENV=development AND
  project=rwqan-sa-dev AND bucket=rwqan-sa-dev AND external services disabled.
- Production Firebase/R2/Paymob/WhatsApp/Drive never contacted.
- No commits/pushes; no credential rotation; no history rewrite; no prod migration.
- No fake success: blocked flows are reported BLOCKED, not PASS.

4. TEST DATA (SYNTHETIC, idempotent, marked)
- scripts/dev/e2e-test-data.ts (+ e2e-seed.ts / e2e-cleanup.ts).
- packages: E2E_TEST_PKG_1PROP (30d/50, عادي, 1 property), E2E_TEST_PKG_2PROP
  (30d/100, مميز, 2 properties), E2E_TEST_PKG_90D (90d/150).
- discount: E2E_TEST_SAVE10 (10%, active).
- owners/properties: 90001 (active premium), 90002 (expired), 90003 (booking);
  argon2id-hashed pins; 5-digit block required by the owner-login UI.
- subscriptions: SUB-90001 (نشط مميز), SUB-90002 (منتهي). request E2E_TEST_REQ_1.
- All records carry testData:true + E2E_TEST_ label; cleanup removes only marked/known ids.

4A. MANUAL DEV LOGIN FIXTURES (for hands-on testing)
- Admin: open http://localhost:5001/owner/login?mode=admin -> lands on /admin dashboard.
  Credentials are the shared DEV env values ADMIN_CODE / ADMIN_PASSWORD from
  .env.development.local. The actual values are NOT recorded in this document;
  read them directly from that git-ignored file when needed.
  These are flagged DEV-only via DEV_ONLY_ADMIN_CREDENTIALS=true (the legacy
  DEV_ONLY_ value prefix is still honored) and enforced by a runtime isolation
  guard: accepted only when NODE_ENV=development AND the Firebase project is
  rwqan-sa-dev. Auth is env-backed (server/services/AuthService.ts) — NO admin
  user record exists.
- Owner: open http://localhost:5001/owner/login (UI accepts a 5-digit property number only).
  - 90001 / 511111  (active premium)   E2E_TEST_OWNER_1
  - 90002 / 522222  (expired)          E2E_TEST_OWNER_2
  - 90003 / 533333  (public booking)   E2E_TEST_BOOKING_1
- Customer: open http://localhost:5001/customer/login (test phone 966500000001). Login is
  OTP-based. In an isolated DEV run the REAL OTP is delivered to the SERVER CONSOLE instead
  of WhatsApp through a DEV-only transport sink (DEV_CUSTOMER_OTP_SINK=console), guarded by
  NODE_ENV=development + project rwqan-sa-dev + external services disabled. Steps:
  1) type the phone and request the code; 2) read the 6-digit code from the "[DEV OTP]" line
  in the server console / dev_e2e_server.log; 3) enter it -> redirect to /profile.
  This keeps the real ceremony (random code, HMAC hashed, verified normally) — no auth
  bypass, no new endpoint, no cookie forging. Without the sink, DEV returns
  DELIVERY_FAILED / HTTP 502 (WhatsApp disabled).
- Registry docs: test_users/{E2E_TEST_USER_ADMIN, E2E_TEST_USER_OWNER_90001..90003,
  E2E_TEST_USER_CUSTOMER_1} hold non-secret login metadata only (no credentials).
- Verified in DEV: admin login ok, owner 90001 login ok (session valid), and the customer
  OTP flow ok (challenge -> console code -> /api/contact-identity/verify -> identity kind=client).
- Owner images in DEV: the bucket is private and R2_PUBLIC_URL is a placeholder, so images are
  served through the owner-authenticated proxy GET /api/owner/r2-image (DEV only). Verified in a
  real browser: 3/3 gallery images on /owner/images render 640x480 (0 broken) and persist after
  page reload. Production image URLs are unchanged.

5. FLOWS COVERED
- Auth: owner login/logout (real UI), admin login (real UI), unauth 401 boundary,
  customer OTP boundary (BLOCKED - external).
- Owner: dashboard render, property update persistence (edit -> reload -> restore).
- Customer (public): properties list API + list page + property detail page.
- Subscriptions: packages render on /subscription; payment/calculate base + discount.
- Admin: admin/owner boundary (owner rejected 401), admin dashboard + admin properties list.
- Files: owner public image upload (real R2 write in DEV) = 200.
- Responsive/RTL: mobile 390, tablet 768, desktop 1440; dir=rtl; no horizontal overflow.

6. RESULTS — QUALITY DASHBOARD (quality/reports/phase6g-quality.json)
- TOTAL 28 | PASS 27 | FAIL 0 | BLOCKED 1 | criticalFailures 0 (exit 0).
- business-logic: 10/10 PASS.
- live-api: 3/3 PASS (API-002 now uses a seeded package).
- browser-e2e: 14 PASS + 1 BLOCKED (E2E-AUTH-005 customer OTP = WhatsApp disabled in DEV).

7. RESULTS — REGRESSION / BUILD / SECURITY
- TypeScript: root `tsc --noEmit` 0 errors; quality tsconfig 0 errors.
- Full server+shared suite: 702/702 PASS serial (no forced NODE_ENV; ~186s).
- Build: PASS (next build + tsc --project tsconfig.server.json + write-dist-package).
- Offline security scan: total 39 / OVERALL ORANGE / NEW 0 / EXISTING 39 /
  REGRESSED 0 / RESOLVED 0. SEC-001 no longer fires statically (historically open);
  SEC-002 MEDIUM remains. No findings introduced by this session.
- Seed/cleanup idempotency verified (cleanup -> 0/0; re-seed -> 3/3).

8. FAILURE CLASSIFICATION
- REAL BUG: none found.
- TEST BUG (fixed): browser cases used ctx.request without session (=> 401) and clicked
  before hydration; API-002 hard-coded a missing package id. Fixed in-suite.
- TEST DATA BUG (fixed): empty DEV had no packages (API-002) -> seeded synthetic packages.
- ENVIRONMENTAL: dev-server cold-compile timing (addressed with networkidle + retry);
  earlier full-suite 700/699/1 was an order/timing flake (702/702 reproduced twice).
- EXPECTED BLOCKED EXTERNAL: customer OTP login (WhatsApp disabled in DEV), 502/429.
- KNOWN GAP: none new.
- SECURITY BLOCKER: SEC-001 (historical Git .env copies + rotation) — unchanged/blocks gate.

9. FILES ADDED/CHANGED (all DEV/test scope)
- ADDED: scripts/dev/e2e-test-data.ts, scripts/dev/e2e-seed.ts, scripts/dev/e2e-cleanup.ts.
- CHANGED: quality/suites/browserE2E.ts (expanded), quality/suites/liveApi.ts (API-002),
  quality/tsconfig.json (lib +dom), docs/DECISIONS.md (DEC-014), docs/OPERATIONS.md,
  docs/SESSION_HANDOFF.md, docs/DEV_E2E_REPORT.md (this file).
- NO changes to server business logic, shared logic, or production code.

10. REPEATABILITY
- Deterministic: fixed ids, marked records, explicit cleanup, seed re-runnable.
- Quality run reproduced green (critical=0) across successive runs after flake fixes.

11. PRODUCTION TOUCHED: NO.
12. CREDENTIALS ROTATED/REVOKED: NO.
13. COMMIT/PUSH: NO.
14. HISTORY REWRITTEN: NO.
15. PRIVATE R2 IMPLEMENTED: NO (BLOCKED by DEC-004/DEC-012).
16. PRODUCTION MIGRATION PERFORMED: NO.
17. BUSINESS LOGIC WEAKENED: NO.
18. ASSERTIONS WEAKENED: NO.
19. SYNTHETIC DATA REACHED PRODUCTION: NO (guarded + marked).
20. OUTSTANDING BLOCKERS: SEC-001 (rotation/history), ADMIN_DOCUMENT_SCOPE UNKNOWN,
    production AUTH migration, ops backup/restore + staging evidence.
21. KNOWN EXTERNAL LIMITS: customer OTP (WhatsApp), real Paymob, Google Drive/OCR.
22. NEXT SAFE ACTIONS: get production authorization for SEC-001 rotation/history decision;
    define a real document-scope model before private R2; capture staging/backup evidence.
23. EVIDENCE: quality/reports/phase6g-quality.json; scripts/dev/*; docs/DECISIONS.md DEC-014.
24. VERDICT: SAFE DEV E2E STATUS = PASS (27/28; 1 BLOCKED external; 0 real bugs;
    702/702 tests; build PASS; security NEW 0).
25. R2 PHASE 6 (2026-10-15): DEV R2 integration re-verified — 15 PASS / 0 FAIL / 1 N/A
    (harness scripts/dev/r2-dev-integration-test.ts; evidence quality/reports/phase6-r2.json).
26. BACKGROUND JOBS PHASE 7 (2026-10-15): DEV schedulers/workers verified — 9 PASS / 0 FAIL
    (harness scripts/dev/phase7-background-jobs-dev.ts; evidence quality/reports/phase7-background-jobs.json).
    Schedulers + booking worker are OFF by default in DEV (opt-in only); expired-subscription
    downgrade, pending-payment expiry (never activates without proof), concurrent once-only
    settlement, and the daily remaining-days job (0 sends in DEV) all verified. Report:
    docs/BACKGROUND_JOBS_REPORT_AR.md.
    Admin upload content validation added + Multer 4xx handling; R2-003/FILES-004 code-mitigated;
    R2-001 still BLOCKED by DEC-004/DEC-012. See docs/R2_REPORT_AR.md.

27. FIRESTORE SCHEMA PARITY DEV<->PROD (2026-10-18)
- Source of truth: a READ-ONLY probe against production `rwqan-757`
  (listCollections + Object.keys on up to 3 sampled documents per collection).
  NO production field values, phones, OTPs, sessions, receipts or payment data
  were read or copied — field NAMES only.
- CORRECTION: production has 54 collections, not 36. Every collection in the
  earlier 36-name list exists in production, but 18 additional collections were
  unlisted (addon_history, addon_logs, addon_packages,
  admin_login_attempt_limits, backups, bank_accounts, blog_posts,
  booking_commission_transaction_bindings, booking_customer_followup_states,
  booking_followups, booking_free_workflow_limits_audit,
  booking_notification_manual_resend_audit, booking_notification_outbox,
  booking_notification_quotas, booking_short_links, contact_cooldowns,
  contact_events, contact_identity_sessions).
- The real production field names also differ from several idealized zod
  schemas in `shared/` (for example `requests` in production uses
  device/ip/requestCount, not dayOfWeek/hourOfDay/ipAddress). Parity therefore
  follows the observed production schema, not the zod shape.
- Artifacts:
  - `scripts/dev/prodSchemaCatalog.ts` — 54 collections with canonical
    production field names and an ownership class:
    `seeded` | `e2e` | `runtime`.
  - `scripts/dev/seed-schema-parity.ts` — DEV-only, guarded, idempotent seeder
    (and `--verify` / `--cleanup`). Reuses the E2E isolation guards
    (NODE_ENV=development, project exactly `rwqan-sa-dev`, bucket exactly
    `rwqan-sa-dev`, external services disabled). Every document is marked
    `testData:true` + `schemaParitySeed:true`.
  - `scripts/dev/prodSchemaCatalog.test.ts` — 10 tests guarding the catalog.
- Applied to DEV: 22 synthetic documents across 21 previously missing
  collections, including the two real `settings` documents
  (`notification_settings`, `booking_free_workflow_limits`) and `fee_configs`.
- Ownership split (kept deliberately — no fake data is created just to reach a
  count):
  - `seeded` 21 collections -> safe synthetic docs, marked
    `testData:true` + `schemaParitySeed:true`.
  - `e2e` 7 collections (properties, subscriptions, packages, discounts, owners,
    requests, customer_accounts) -> owned by scripts/dev/e2e-test-data.ts.
  - `runtime` 26 collections (sessions, rate limits, OTP challenges, owner
    accounts, booking engine/outbox/quotas, payments, whatsapp_logs,
    feature_flags, contact_cooldowns/events) -> NEVER pre-seeded; they hold
    security/limit state or are produced by real usage.
- Verified: DEV now exposes 33/54 verified-production collections (38 collections
  total including the 5 DEV-only ones: deploy_audit_log, deploy_check_runs,
  deploy_releases, deploy_system_state, test_users). The 21 absent ones are all
  `runtime` and are intentionally never pre-seeded.

27A. CODE <-> PROD COLLECTION AUDIT (static, read-only)
- Scanned all non-test `.ts/.tsx` under server/, shared/, src/, scripts/,
  quality/ for literal `collection("...")` references: 41 distinct names.
- In code but NOT in production (1): `contact_identity_issue_limits`. It is a
  genuine runtime collection (created on demand by
  `consumeContactIdentityIssueLimit`, firebaseService.ts:4659, and TTL-cleaned by
  `deleteExpiredEphemeralSecurityData`). PROD simply has not consumed an
  identity-issue limit yet. Tracked separately as
  `CODE_ONLY_RUNTIME_COLLECTIONS` so the "54 verified production collections"
  invariant stays exact — it is never pre-seeded.
- `payment_action_locks` is referenced ONLY by test doubles and legacy scripts
  (server/business code does not use it) -> no production parity action.
- 15 production collections have no inline `collection("...")` literal because
  they are resolved through named constants (e.g. `server_sessions` via
  `FirestoreSessionStore`, `owner_login_attempt_limits` via
  `OwnerLoginRateLimiter`, `booking_*` via the booking stores). Not a gap.
- Verified production-vs-code FIELD drift, now documented in the catalog with a
  `note` (asserted by test) instead of being "fixed" in code:
  - `requests` — PROD rows are legacy migrated data using device/ip/requestCount;
    current code writes ipAddress/deviceType/dayOfWeek/hourOfDay/
    clientPhone/actorType/customerSubject. Both shapes coexist in PROD.
  - `ocr_results` — PROD legacy rows use `fullText`; current code writes
    `rawText` (shared/schema.ts ocrResultSchema).
  - `suggestions` — PROD rows predate the optional `status` field.
  - `expenses` — PROD baseline lacks the distributed-expense fields
    (durationMonths/startDate/endDate/monthlyAmount).
  - `property_addons` — PROD baseline lacks `source`/`updatedAt`.
  None of these require a code change; rewriting code to match legacy rows would
  regress current behaviour.

27B. IDEMPOTENCY / NON-DESTRUCTIVENESS PROOF
- Method: read-only DEV snapshot before and after re-running the seeder —
  document counts for all 38 collections + a SHA-256 content fingerprint of all
  documents for 28 collections (every `seeded` collection plus the business
  collections the seeder must never touch: properties, subscriptions, payments,
  owners, requests, customer_accounts, discounts, packages, feature_flags).
- Result: 0 count diffs and 0 fingerprint diffs. Re-running the seed changes
  nothing and creates no duplicates. Existing e2e-seeded business data is
  byte-identical before and after.
- The seeder uses fixed document ids with `merge:true`, so it only ever
  overwrites its own marked documents. `--cleanup` removes only documents marked
  `schemaParitySeed:true`.

- Verified: `tsc --noEmit` 0 errors; parity tests 10/10 PASS; behavioural check
  below.
- Verified behaviourally (real server, TEST env, authenticated):
  GET /api/admin/settings/notifications -> HTTP 200 and returns the values
  written into `settings/notification_settings` (allNotifications=true,
  smartRequest=true), proving the server reads the aligned DEV schema.
- PRODUCTION WRITTEN/READ DATA: NONE (read-only schema inspection only).
- Nothing was deleted: no files, no collections, no documents, no prior code
  changes; the deploy bar and the publish/restore system were not modified.

28. REAL APP HOSTING ROLLOUT — STILL BLOCKED (external, re-verified 2026-10-18)
- Re-probed read-only from this environment; results:
  - `projects/rwqan-sa-dev/locations/us-central1/backends.list` ->
    HTTP 403 "Firebase App Hosting API has not been used in project
    rwqan-sa-dev before or it is disabled."
    Enable URL:
    https://console.developers.google.com/apis/api/firebaseapphosting.googleapis.com/overview?project=rwqan-sa-dev
  - IAM permission introspection (`projects.testIamPermissions`) is NOT
    available from this environment (HTTP 404, non-JSON HTML response), so the
    granted permission set cannot be enumerated here. No permission claim is
    made beyond the observed 403.
  - Neither `firebase` nor `gcloud` is installed (`Get-Command` -> MISSING), and
    Node `execFile` cannot resolve Windows `.cmd` shims, so no official CLI
    path exists either.
- Consequence: `rwqan-dev-backend` cannot be created and no rollout can be
  issued or waited on from here. Deploy/restore therefore stays fail-closed:
  a TEST restore reaches the real executor, fails at the `deploy` stage, and is
  recorded as `restored:false` with the real failure detail. Nothing is recorded
  as published or restored without a successful real rollout.
- Needed from the project owner (outside this environment, not performable
  here):
  1) Enable the Firebase App Hosting API on `rwqan-sa-dev`.
  2) Grant the DEV deploy identity `firebaseapphosting.backends.create`,
     `firebaseapphosting.rollouts.create`, `firebaseapphosting.builds.create`,
     and (if the API must be enabled via CLI/API) `serviceusage.services.enable`.
  3) Optionally install the `firebase` CLI so rollouts can be issued and polled
     without writing an App Hosting client.
- NOT done here, and intentionally not attempted: enabling the App Hosting API,
  changing any IAM binding, changing billing, touching secrets, or substituting
  production for the missing dev backend.

SAFE DEV E2E STATUS: PASS
PRODUCTION RELEASE GATE = BLOCKED

29. REAL RESTORE — ENV SEPARATION + PREVIEW/RESTORE ALIGNMENT (2026-10-18)
- Data-integrity report (files/collections/records): NONE created, modified, or
  deleted. No git history rewritten; no secrets rotated; no IAM/billing changes.
  Production written/read data: NONE.
- ENV SEPARATION (new rule, implemented as one shared pure helper):
  `evaluateRestoreEnvironment(sourceEnvironment, targetEnvironment,
  { liveRestoreApproved })` in `shared/deploySystem.ts`, used by BOTH the store
  gate (`evaluateRestore`) and the restore preview so preview and restore share
  exactly one rule. Default target when unspecified: `TEST`.
  - TARGET = TEST -> allowed for ANY source, INCLUDING the LIVE-source official
    stable release (the isolated DEV backend is the only safe target).
  - TARGET = LIVE -> refused unless production is explicitly enabled:
    `LIVE_RESTORE_DISABLED` when not approved; and even when approved, a
    TEST-source release is refused with `RESTORE_TARGET_SOURCE_MISMATCH`.
  A LIVE-source stable release is therefore restorable into the isolated TEST
  target, which is what makes the console restore button usable without ever
  touching production.
- PREVIEW/RESTORE GATE ALIGNED: the working-tree state is now reported for
  INFORMATION ONLY and is NOT a restore blocker. A restore re-materializes an
  IMMUTABLE full-SHA commit and the real hosting rollout is built from that
  commit, so uncommitted local edits cannot affect it. Previously the preview
  blocked on a dirty worktree while the real restore route did not consult it, so
  the preview could say `canRestore:false` while the restore still ran; now both
  sides share one rule.
- Files touched: `shared/deploySystem.ts`,
  `server/services/DeploySystemStore.ts`,
  `server/services/FirestoreDeploySystemStore.ts`,
  `server/services/DeployRestoreService.ts`,
  `server/routes/admin/deploy.ts`; tests `shared/deploySystem.test.ts` (new),
  `server/services/DeployRestoreService.test.ts`,
  `server/routes/admin/deploy.test.ts`.
- Verified statically: `tsc --noEmit` 0 errors; every test file matching
  deploy|Deploy|stable|Stable -> 200/200 PASS (was 191 before this change).
- Verified behaviourally against the REAL running DEV server (TEST env, real
  admin session):
  - Official stable release `rel-stable-6c49647abdc14cd5176808fe79839e7ef3d7ebe9`
    (source env LIVE): restore preview now returns `canRestore:true`,
    `blockers:[]`, `targetEnvironment:"TEST"` — the old LIVE-source block is gone
    and the dirty worktree is no longer a blocker.
  - Confirmed restore -> the real executor was invoked against `rwqan-dev-backend`
    and failed at the `deploy` stage -> HTTP 502 `RESTORE_FAILED`, NO success
    shape, and the audit shows `restore_snapshot` + `restore_rejected` with NO
    `restore_real`. Release set and deployed-release set are identical before and
    after; nothing is recorded as published or restored.
  - Switching the console to LIVE and retrying -> HTTP 409 `LIVE_RESTORE_DISABLED`
    (no rollout attempted); the environment was switched back to TEST.
- `.env` SAFE AUDIT (analysis only; no values printed, nothing changed/rotated):
  - `.env.development.local` holds the real DEV secrets and is git-ignored
    (matched by `.gitignore` `.env*.local`). It is not to be printed or copied.
  - The ONLY tracked env file is `.env.template`, and it contains PLACEHOLDERS
    only (no real PEM key, no private-key JSON, no long secret line) — no real
    secret is committed to git.
  - `DEPLOY_ALLOW_PRODUCTION` is absent, so production deploy/restore is
    fail-closed by default.
  - Documented, not performed: the DEV admin code/password are short
    (low-entropy) and the DEV env also holds R2/Paymob keys whose scope
    (sandbox vs live) was not inspected; both are DEV-only and git-ignored.
- Credentials redacted from this document: section 4A no longer prints the DEV
  admin code/password; it now points to the git-ignored `.env.development.local`.
- Still blocked (unchanged, external): a real rollout cannot succeed until the
  Firebase App Hosting API is enabled on `rwqan-sa-dev` (see section 28). The
  restore therefore fails closed with the real failure detail — never a fake
  success.

29A. OPEN ITEMS / RECOMMENDATIONS (not performed here)
- Enable the Firebase App Hosting API and grant the DEV deploy identity the App
  Hosting create permissions (section 28) to let a real TEST rollout succeed.
- Optionally rotate the DEV R2/Paymob keys and lengthen the DEV admin code and
  password (DEV only; requires project-owner action; intentionally not done here).
