# RELEASE NOTES — Ruqan / Rwqan

No certified production release yet. This file records development-grade release notes
for each documented baseline/release entry (see VERSION_HISTORY.md).

## 0.1.0 — Documentation + verification baseline (dev)
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

## 0.1.0 addendum — DEV E2E test-data + realistic browser E2E (dev)
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