# SESSION HANDOFF — Ruqan / Rwqan

SESSION: 2026-10-13 (FULL DEV REALISTIC PRODUCT E2E / UX / BUSINESS-FLOW TEST —
synthetic DEV data + real browser E2E)
  + DEC-004 ratification (no roles invented; admin doc scope stays UNKNOWN/BLOCKED)

LATEST COMPLETED (DEV E2E test-data + realistic browser E2E):
- New DEV-only synthetic test-data system (DEC-014):
  - scripts/dev/e2e-test-data.ts (+ e2e-seed.ts / e2e-cleanup.ts). Runtime guards:
    NODE_ENV=development, project=rwqan-sa-dev, bucket=rwqan-sa-dev, external services
    disabled. Idempotent fixed ids; every record marked testData:true + E2E_TEST_ label.
    Owners use 5-digit block 90001-90003 (login UI maxLength=5) with argon2id hashed pins.
  - Verified idempotent: cleanup -> API shows packages=0/properties=0; re-seed ->
    packages=3/properties=3.
- Expanded quality/suites/browserE2E.ts from 2 nav cases to 15 real cases:
  owner login/logout UI, admin login UI, unauth 401 boundary, owner dashboard,
  property-update persistence, public browse/detail, packages render UI,
  payment/calculate (base 100 -> afterDiscount 90, total 92.25 with E2E_TEST_SAVE10),
  admin boundary + admin dashboard/data, public image upload (R2 = 200), which
  actually SUCCEEDS in DEV, mobile/tablet/desktop RTL + no overflow.
  Authenticated assertions run fetch() in the browser page (real session cookie).
- quality live-api API-002 fixed: now resolves a real seeded package id (was a hard-coded
  missing id). Assertion strength unchanged. API 3/3 PASS.
- quality/tsconfig.json: added lib "dom"/"dom.iterable" (browser globals in page.evaluate).
- Customer OTP login remains BLOCKED (needs WhatsApp; disabled in DEV) — challenge returns
  502 (or 429 rate-limited). Recorded BLOCKED, not faked.

ADDENDUM (manual DEV login fixtures + DEV-only guards/sink, 2026-10-13):
- Extended scripts/dev/e2e-test-data.ts with DEV manual-login fixtures (still DEV-guarded,
  testData-marked, idempotent; NO auth bypass added):
  - customer_accounts/{createCustomerSubject("966500000001")} synthetic customer doc.
  - test_users/{E2E_TEST_USER_ADMIN, E2E_TEST_USER_OWNER_90001..90003,
    E2E_TEST_USER_CUSTOMER_1} non-secret login registry (no credentials stored).
  - cleanupDevTestData() deletes both collections by testData marker.
- DEV admin credentials in .env.development.local (current values: admin / 123)
  are flagged DEV-only via DEV_ONLY_ADMIN_CREDENTIALS=true (the legacy DEV_ONLY_ value
  prefix is still honored). The guard assertDevOnlyAdminCredentialsIsolation
  (server/config/runtimeEnvironment.ts) wired into server/index.ts refuses DEV-only
  credentials unless NODE_ENV=development AND Firebase project = rwqan-sa-dev
  (constant renamed DEV_ADMIN_FIREBASE_PROJECT_ID -> DEV_FIREBASE_PROJECT_ID).
  Production/unflagged creds unaffected.
- DEV customer OTP transport sink (Option A): devCustomerOtpSinkEnabled() in
  runtimeEnvironment.ts + defaultCustomerPhoneOtpSender in CustomerPhoneOtpService.ts.
  When NODE_ENV=development AND DEV_CUSTOMER_OTP_SINK=console AND external services disabled
  AND project=rwqan-sa-dev, the REAL OTP is printed to the server console ("[DEV OTP] ...")
  instead of WhatsApp; otherwise it delegates to sendOwnerWhatsApp. Key documented (empty)
  in .env.template. No new endpoint, no bypass, no weakening: code remains random, HMAC
  hashed, verified normally.
- Verified in DEV (project rwqan-sa-dev): admin login (DEV_ONLY_...) ok + isAdmin; owner
  90001/511111 (and 90002/522222, 90003/533333) ok; customer OTP end-to-end ok
  (challenge -> console code -> /api/contact-identity/verify kind=client -> identity
  kind=client). Old placeholder admin creds now 401. Cleanup removed testUsers:5 +
  customerAccounts:1; re-seed recreated them (same customer subject hash) — idempotent.
- Login URLs: admin /owner/login?mode=admin (-> /admin); owner /owner/login;
  customer /customer/login (-> /profile). Details in docs/DEV_E2E_REPORT.md section 4A.
- No Production touch; no auth logic change; no bypass; no commit/push.

ADDENDUM (DEV owner images fix, 2026-10-13):
- Root cause: DEV R2_PUBLIC_URL is the placeholder https://your-dev-public-r2-domain.example
  (assertR2DevIsolation forbids the production public host), so every image URL emitted by
  /api/owner/r2-images and the received files pointed at a non-resolvable host -> broken
  <img> on /owner/images even though the objects exist in the (private) rwqan-sa-dev bucket.
- Fix (server/routes/owner.ts only): added GET /api/owner/r2-image (requireOwner; key must be
  under the session propertyNumber prefix + image extension; streams the private R2 object with
  its Content-Type, Cache-Control private). In NODE_ENV=development the r2-images list and the
  upload response now return that proxy URL instead of the placeholder public URL; in production
  the public URL behavior is byte-for-byte unchanged. Delete handler now derives the object key
  from either the proxy URL or the public URL form.
  - No bucket made public; no secrets exposed; no public/random URLs created; bucket stays private.
- Data note: the 3 pre-existing "images" for 90001 were stale DEV placeholders (all identical
  1x1 transparent PNGs, same ETag, stored as image/jpeg). They were removed via the normal owner
  delete flow and replaced with 3 real generated DEV JPEGs (640x480) through the normal upload
  flow; verified 200 image/jpeg byte-identical, and rendered in a real headless Chromium
  (naturalWidth 640x480, 0 broken) before and after page.reload().
- Full suite 712/712 PASS; root tsc --noEmit 0 errors. DEV server left running.

LATEST RESULTS (this session):
- quality dashboard: 27/28 PASS, 0 FAIL, 1 BLOCKED (external OTP), criticalFailures 0.
  business-logic 10/10; live-api 3/3; browser-e2e 14 PASS + 1 BLOCKED.
- Full server+shared suite: 712/712 PASS serial (no forced NODE_ENV).
- TypeScript: root `tsc --noEmit` 0 errors; quality `tsc -p quality/tsconfig.json` 0 errors.
- Build: PASS (next build + tsc server + dist).
- Offline security scan: total 39 / OVERALL ORANGE / NEW 0 / EXISTING 39 / REGRESSED 0 /
  RESOLVED 0; SEC-001 no longer fires statically (still open historically); SEC-002 MEDIUM
  remains. No new findings from this session.
- Production Release Gate = BLOCKED (unchanged).

PREVIOUS SESSION (master governance closure — browser E2E, security, regression)
  + DEC-004 ratification (no roles invented; admin doc scope stays UNKNOWN/BLOCKED)

CURRENT STATE:
- All safe DEV phases EXHAUSTED: AUTH-001 follow-ups DONE; AUTHZ-001 FIXED; security
  toolchain DONE; DEV isolation + smoke DONE; business logic DONE (no change);
  UI/UX/build DONE; browser E2E DONE (real Playwright, PASS); backup/rollback DONE
  (routes pass; ops runbook UNKNOWN); version/release formalized (0.1.0).
- DEC-004 reviewed against code and RATIFIED as-is by the owner: use existing
  requireAdmin only; NO new admin document role/permission; ADMIN_DOCUMENT_SCOPE =
  UNKNOWN / BLOCKED_BY_MISSING_MODEL stays (evidence in DECISION log DEC-004/DEC-012).
  Private R2 hardening remains BLOCKED; not bypassed.
- Production Release Gate = BLOCKED.

LAST COMPLETED (this follow-up):
- Verified in code: requireAdmin is binary isAdmin (server/routes/middleware.ts:21);
  no role/permission/ADMIN_DOCUMENT_SCOPE model exists in server/**; no admin endpoint
  serves private documents under a documented scope (receipts PUBLIC / booking-commission
  token-scoped). Conclusion reaffirmed: blocker is real, no bypass.
- DECISIONS.md DEC-004 ratified + DEC-012 added; SECURITY_STATUS.md updated.
- No code change; no Production touch; no rotation; no history purge; no Private R2.

LAST COMPLETED (SEC-001 .env cleanup, authorized cleanup-only scope 2026-10-13):
- `.env` removed from the Git index (`git rm --cached .env`; reversible via
  `git restore --staged .env`). No longer in `git ls-files`; .gitignore:28 covers it.
- Audited `.env.template` (tracked; HEAD + worktree): 21 secret keys, ZERO real-looking
  values, none matching .env.development.local. `.env.development.local` (ignored,
  untracked) still loads DEV (rwqan-sa-dev; rwqan-sa-dev R2; no external-service keys).
- Env guard tests 33/33 PASS; DEV load check PASS (15 vars from .env.development.local).
- NO credential rotation; NO Production changes; NO history rewrite; NO commit/push.
- SEC-001 NOT fully resolved: historical Git copies still contain the old .env; rotation
  remains BLOCKED awaiting production authorization.

LAST COMPLETED:
- AUTH-001: changePassword hash-aware verification; syncOwnerFromProperties writes hashed
  PIN (no new plaintext); password.test.ts + AuthService.test.ts (19 tests).
- AUTHZ-001: group-aware session guard on GET /api/owner/subscription/:propertyNumber;
  regression test owner-subscription-access.test.ts; scanner rule widened; RED 2->1.
- Browser E2E executed against the DEV server (localhost:5001, rwqan-sa-dev):
  - quality/src/cli.ts Windows entry-guard bug fixed (was `file://${argv}`; now
    pathToFileURL — same pattern as security/src/cli.ts). The CLI previously did
    nothing on Windows; the report it produced was stale (Oct 10).
  - business-logic suite 10/10 PASS.
  - browser-e2e suite 2/2 PASS (headless chromium - home + /properties load).
  - live-api suite 2/3; only API-002 FAIL = POST /api/payment/calculate returns 404 in
    DEV because the subscriptionPackages collection is empty (no seeding in DEV by rule)
    and the route correctly returns 404 "الباقة غير موجودة" for a missing package.
    NOT a regression; assertion intentionally NOT weakened; recorded as the known
    API-002 DEV package-data gap.
  - BL-006 (quality dashboard) fixed: its fixture wrongly added pricePerProperty (which
    makes the package "normalized"); the real legacy VIP doc has no pricePerProperty
    (evidence: shared/subscriptionPricing.test.ts). Base 50 SAR assertion unchanged.
- Security re-scan (offline): NEW:0 / EXISTING:40 / REGRESSED:0 / RESOLVED:0;
  RED-triggering still 1 (SEC-001). AUTHZ-001 absent. No findings from this session.
- Regression: TypeScript 0 errors; full suite 702/702 PASS serial; AUTH+IDOR 20/20 PASS;
  DEV smoke PASS; build PASS (next + tsc server + dist).
- Full suite must NOT be run with NODE_ENV=development: paymob/whatsapp/worker tests
  statically expect a non-dev env (Paymob disabled in DEV) — 22 false failures appear.
  Correct invocation: plain `node --import tsx --test --test-concurrency=1` (702 files
  count across server/+shared test trees; earlier 639 was a narrower enumeration).

FILES CHANGED (this session, safe scope):
- docs/*
- quality/src/cli.ts (Windows-safe entry guard; pathToFileURL)
- quality/suites/businessLogic.ts (BL-006 legacy-VIP fixture corrected to real doc shape)
- (previous session: server/auth/owner/security/docs changes — see below)

VERSION: 0.1.0

TEST RESULTS:
- TypeScript: PASS 0 errors
- Full suite: PASS 702/702 serial (no forced NODE_ENV)
- AUTH-001 + AUTHZ-001 regression: PASS 20/20
- Business-logic dashboard suite: PASS 10/10
- Browser E2E (Playwright chromium, localhost:5001 DEV server): PASS 2/2
- Live-API suite: PASS 2/3 (API-002 = known empty-DEV data gap, 404 by design)
- Build: PASS (next build + tsc --project tsconfig.server.json + write-dist-package)
- Security scan (offline CI): NEW 0 / EXISTING 40 / REGRESSED 0 / RED-trigger 1 (SEC-001)
- DEV smoke: PASS (server boots with guards; Firebase rwqan-sa-dev; R2 rwqan-sa-dev;
  /api/packages=[])

SECURITY RESULTS:
- RED-triggering remains 1 (SEC-001). AUTHZ-001 closed (absent from scan).
- SEC-001 (production secrets in git/.env) CONFIRMED open. Working-tree .env deleted;
  commit index/history contains secrets. Remediation = production rotation (BLOCKED).
- AUTH-001 not declared fully closed: production migration + enforcement pending.

CURRENT BLOCKER:
- SEC-001 (needs production authorization).
- Private R2 hardening BLOCKED pending ADMIN_DOCUMENT_SCOPE (UNKNOWN /
  BLOCKED_BY_MISSING_MODEL — owner-ratified, DEC-004/DEC-012). No roles to invent,
  no assumption beyond code.
- CA production migration NOT performed (DEV-empty models).
- Ops backup/restore runbook UNKNOWN; staging UNKNOWN.

UNKNOWN:
- production migration completion measurement; ops backup/restore; staging; exact admin
  document scope for private docs (requires a document-scope model in code OR a further
  explicit owner decision; not assumed today).

NEXT SAFE ACTION:
1. Get production authorization decision on SEC-001 rotation + whether to purge history.
2. Ops: run E2E/open questions require staging + backup/restore evidence (UNKNOWN).
3. Private R2 hardening needs a real document-scope model (owner-approved design) before
   any permission-sensitive implementation.
4. Then proceed to production security rollout per locked plan (gate STAYS BLOCKED).

DO NOT TOUCH:
- Production paths, production Firebase/R2/Paymob/WhatsApp/Drive/Gemini/OCR.
- package.json/package-lock.json without explicit need.
- Existing business logic without impact note.
- Do not declare PRODUCTION READY (gate evidence incomplete).

ADDENDUM (RWQAN DEPLOY — Phase C durable DEV registry, 2026-10-15):
- Durable release registry + audit log now persist to Firestore project rwqan-sa-dev only,
  via Admin SDK (rules still deny all client access). Collections: deploy_releases (keep 5),
  deploy_audit_log (keep 50), deploy_system_state/current.
- Fail-closed factory (server/services/FirestoreDeploySystemStore.ts): writes only when
  deployPersistenceProjectConfirmed() (project_id === rwqan-sa-dev) AND Admin SDK present;
  otherwise UnavailableDeploySystemStore → state.persistent=false, writes 503 DEPLOY_STORE_UNAVAILABLE.
- Server-derived trust fields (never client): git commit/branch/tag/remote (read-only local git),
  status (validation_failed on failed/blocked secret scan, else simulated; never deployed),
  createdBy/actor = admin session, savedToGit/deployed = false always.
- Read-only deploy checks (server/services/DeployChecksService.ts): secret scan over git-status
  changed files (names + content); full tsc/tests/build stay NOT_RUN with reason (Phase E/CI).
- API: GET /api/admin/deploy/state, POST /environment, POST /releases, POST /releases/:id/restore
  (all async; requireSameOrigin+requireAdmin+DEV gate; Cache-Control no-store private).
- UI: admin section shows persistence + checks + change summary; global deploy bar shows empty
  state. "نشر" clearly = save record only (no commit/push/deploy).
- Verified live against rwqan-sa-dev (create/list/order/retain-5/audit), then cleaned up.
  tsc 0 errors; tests 69/69 (server+service+gate 18, runtimeEnvironment 43, components 8).
- Docs: docs/DEPLOY_SYSTEM_PHASE_C_AR.md. No commit/push/deploy; Phase D/E/F not started.