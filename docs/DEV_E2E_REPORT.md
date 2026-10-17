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
  .env.development.local (current DEV TEST values:
  admin / 123).
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

SAFE DEV E2E STATUS: PASS
PRODUCTION RELEASE GATE = BLOCKED
