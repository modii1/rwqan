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