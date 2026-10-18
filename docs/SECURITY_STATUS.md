# SECURITY STATUS — Ruqan / Rwqan

Last updated: 2026-10-14 (session)
Scope: DEVELOPMENT clone (rwqan-sa-opencode). NOT a production attestation.

> **Launch decision: NO-GO** (production). Summary + blocker table + close-out evidence:
> [`LAUNCH_GATE_REPORT.md`](./LAUNCH_GATE_REPORT.md). This file holds the technical detail.

## Session Snapshot (2026-10-14)
- TypeScript: **clean (0 errors)** (`tsc --noEmit`).
- Full test suite: **1026/1026 pass** (34 suites, 0 fail). One run hit a transient Node
  test-runner IPC error (`Unable to deserialize cloned data`) on `tracking.test.ts`; the
  re-run passed 1026/1026 → flaky runner, not a test failure.
- Scanner (`scan-2026-10-14T0905`, `--ci --no-network`): **26 open findings**, OVERALL ORANGE,
  **Secrets section GREEN** (SEC-001 no longer fires because `.env` was removed from the index;
  the historical-commit exposure is still tracked as BLOCKED below).
- This session closed **13** findings: AUTH-002, AUTH-003, AUTH-004 (×2), SSRF-001,
  FILES-001, FILES-002, FILES-003, LOG-001, LOG-003 (×2), ERR-001, SEC-002.
- Scanner `RESOLVED: 0` is a baseline-correlation artifact (line-shift makes edited findings
  appear as NEW/EXISTING); it does NOT mean nothing was fixed.

## Baseline (from earlier phases)
- Security scanner baseline: Phase 6F started the security/ toolchain; this session
  re-ran it (no-network CI mode) and re-anchored security/baseline.json after review.

## Scanner Results
### Baseline 2026-10-13 (`--no-network`) — historical record
- OVERALL: [RED] (worst section: Secrets critical)
- Sections: Dependencies GREEN · Firebase GREEN · Security ORANGE (high) ·
  Authorization ORANGE (medium) · Payments ORANGE (medium) · Files ORANGE (high) ·
  R2 ORANGE (medium) · External Services ORANGE (medium) · Secrets RED (critical)
- NEW: 0 · EXISTING: 40 · REGRESSED: 0 · RESOLVED: 0
- RED-TRIGGERING (blocking for CI): 1 — SEC-001 only
- AUTHZ-001 no longer present (fixed in phase: group-aware session guard + rule widened).
- Re-run after the browser-E2E/regression phase (scan-2026-10-13T0904): identical counts.
- External tools (gitleaks/semgrep/codeql/osv/trivy/ZAP): NOT INSTALLED (DEV limitation)

> **Discrepancy (recorded, unresolved):** the documented baseline is 40 findings / RED, but the
> first scan of the 2026-10-14 session (`secscan.log`) showed **39** findings with Secrets at
> **ORANGE (medium)**, not RED — a delta of 1 (SEC-001). Most likely because `.env` was already
> removed from the index in the earlier cleanup, so the SEC-001 rule stopped firing. Which scan
> `security/baseline.json` actually encodes was NOT independently verified.

### Current 2026-10-14 (`scan-2026-10-14T0905`, `--ci --no-network true`)
- OVERALL: [ORANGE] (worst section: high) · **26 open findings**
- Sections: Security ORANGE (high) · Dependencies GREEN (low) · **Secrets GREEN** ·
  Authorization ORANGE (medium) · Payments ORANGE (medium) · Files ORANGE (high) ·
  Firebase GREEN (low) · R2 ORANGE (medium) · External Services ORANGE (medium)
- NEW: 6 · EXISTING: 20 · REGRESSED: 0 · RESOLVED: 0 · CONFIDENCE: HIGH 25 / LOW 1
- Progression this session: 39 → 36 → 29 → **26**.
- Open IDs: AUTH-001, AUTH-005, SSRF-002, LOG-002, DEPS-001 (×6), AUTHZ-002, ADMIN-001 (×2),
  PAY-001, PAY-002, FILES-004, R2-001, R2-002, R2-003, FB-001, FB-002, DRIVE-001, DRIVE-002,
  EXT-001 (×2), EXT-002 (26 total).
- Full classification (Blocked / mitigated-in-code / low-config-heuristic): see
  [`LAUNCH_GATE_REPORT.md`](./LAUNCH_GATE_REPORT.md) §4–§5.

## BLOCKING FINDING (RED-trigger)
- SEC-001 [CRITICAL] Production secrets tracked in git (.env) — PARTIALLY REMEDIATED.
  UPDATE 2026-10-14: the scanner no longer fires SEC-001 (Secrets section is now GREEN)
  because `.env` was removed from the index/worktree. This does NOT close the risk:
  historical Git commits still contain the old `.env` with production secrets.
  Current facts: `.env` is tracked in the git index/history. The working-tree .env file
  is deleted; the .env index entry was removed (git rm --cached) on 2026-10-13 (authorized
  cleanup-only scope). `.env` is now covered by .gitignore:28 (.env) and no longer listed
  by `git ls-files`.
  .env.template (tracked): audited 2026-10-13 — 21 secret keys in HEAD and worktree,
  ZERO real-looking values (placeholders/empty only); no values match .env.development.local.
  .env.development.local (untracked, ignored via `.gitignore:27: .env*.local`): DEV-loads
  15 vars; project rwqan-sa-dev; external-service keys absent (isolation intact).
  REMAINING (NOT resolved): historical Git copies (HEAD + commits) still contain the old
  .env with production secrets. REMEDIATION (STILL BLOCKED — requires production
  authorization):
    1) rotate all production secrets (Firebase, R2, Paymob, WhatsApp/Enjazatik, sessions)
       in PRODUCTION,
    2) optionally purge history or move to a fresh repository,
    3) add a leak-prevention tool (e.g., gitleaks) to CI.
  Until historical copies are handled, the production secret gate is STILL BLOCKED.
  No credential rotation, no history rewrite, no commit/push performed in the cleanup.

## AUTH-001 (Argon2id)
- Implemented: dual-read owner credential path; hashed verification; legacy compatibility
  during migration; migration-on-login guarded by AUTH_HASH_MIGRATION_ENABLED.
- New password writes (change/reset/set-new) are hashed (no plaintext).
- changePassword current-password verification is now hash-aware (was plaintext-only):
  hashed -> argon2 verify; plaintext -> legacy compare; property.pin fallback when no
  owner password; AUTH_ENFORCE_HASHED_ONLY gates legacy acceptance.
- New owner sync (syncOwnerFromProperties) now hashes the PIN on creation — no new
  plaintext credentials are ever written.
- Flags:
  - AUTH_HASH_MIGRATION_ENABLED: DEV default true, PROD default false initially.
  - AUTH_ENFORCE_HASHED_ONLY: DEV default true (empty model), PROD default false.
- Owner credential canonical field: `owners.password`; `properties.pin` synchronized
  temporarily for compatibility.
- Tests: server/utils/password.test.ts + server/services/AuthService.test.ts (19 tests,
  PASS). AUTH-001 NOT declared fully closed: production migration + enforcement rollout
  remain future work.

## Known / Open Items
- AUTHZ-001 (IDOR: GET /api/owner/subscription/:propertyNumber) — FIXED this session
  with a group-aware session guard (own property + linked group members only; foreign
  property -> 403). Regression test added
  (server/routes/owner-subscription-access.test.ts). The scanner rule was widened to
  recognize session-scoped guards — the vulnerability class is closed for this endpoint.
- AUTH-001 production plaintext migration: NOT performed (DEV data new/empty). Locked plan exists.
- R2/private documents: property images remain intentionally PUBLIC. Receipts and
  booking-commission-receipts must remain private. Presigner added (120s signed GET target).
  Implementation pending — BLOCKED pending the documented admin document-scope decision.
- R2 Phase 6 (DEV) — 2026-10-15: R2 integration verified on DEV with a new harness
  (`scripts/dev/r2-dev-integration-test.ts`): 15 PASS / 0 FAIL / 1 N/A (`tsc` 0). Added
  magic-byte/content validation to the admin R2 image upload (`server/routes/admin/images.ts`,
  parity with the owner path) and a Multer-aware API error handler
  (`server/index.ts`: LIMIT_FILE_SIZE -> 413, other -> 400; was an opaque 500). Verified:
  R2-003 (public image listing blocked for non-approved property, restored -> 200) and
  FILES-004 (propertyNumber strictly validated `^[0-9]{4,8}$`) are code-mitigated. R2-001
  stays BLOCKED (needs the DEC-004/DEC-012 document-scope model); R2-002 only mitigated by
  `assertR2DevIsolation`. Full report: [`R2_REPORT_AR.md`](./R2_REPORT_AR.md). Presigned-URL
  model unresolved; see above.
- Background jobs / schedulers Phase 7 (DEV) — 2026-10-15: schedulers and the booking
  commission worker are OFF outside production by default and start only on the exact opt-in
  `ENABLE_SCHEDULERS_IN_DEVELOPMENT=true` (or `ENABLE_BOOKING_WORKER_IN_DEVELOPMENT=true`);
  DEV boot log confirms the worker is disabled. DEV harness
  (`scripts/dev/phase7-background-jobs-dev.ts`) = 9 PASS / 0 FAIL (`tsc` 0). Verified:
  expired-subscription downgrade + idempotency, pending-payment expiry that never activates a
  subscription without payment proof, concurrent once-only settlement, bank-transfer never
  auto-approved, and the daily remaining-days job sending 0 notifications in DEV (external
  services off). Full report: [`BACKGROUND_JOBS_REPORT_AR.md`](./BACKGROUND_JOBS_REPORT_AR.md).
  expiry is N/A (no presigned URLs are issued). No commit/push/deploy; no policy change.
- Admin document scope: UNKNOWN / BLOCKED_BY_MISSING_MODEL — RATIFIED & CODE-VERIFIED
  2026-10-13 (DEC-004/DEC-012). requireAdmin is a binary isAdmin check
  (server/routes/middleware.ts:21); NO role/permission/document-scope model exists in
  server/**. No admin endpoint serves private documents under a documented scope:
  bank-transfer + add-on receipts are PUBLIC (R2-001/FILES-001/002), booking-commission
  receipts are token-scoped (bookings.ts parseBookingCommissionReceipt). Private R2
  hardening stays BLOCKED until a real document-scope model exists; do NOT invent roles.
- Migration measurement: NOT_AVAILABLE; design (non-secret marker) proposed, not implemented.
- Backup/restore ops runbook: UNKNOWN / OPERATIONAL DECISION REQUIRED.
- Staging: UNKNOWN.
- Secret hygiene: SEC-001 confirmed (see above); rotation is a production-side action (BLOCKED).
- Residual scanner findings (current 2026-10-14, 26 open; see LAUNCH_GATE_REPORT §4–§5):
  Security AUTH-001/005, SSRF-002, LOG-002; Authorization AUTHZ-002, ADMIN-001 (×2);
  Payments PAY-001/002; Files FILES-004, R2-001/R2-003; R2-002; DRIVE-001/002; EXT-001 (×2)/
  EXT-002; Firebase FB-001/002; DEPS-001 (×6).
  Closed this session (13): AUTH-002/003/004, SSRF-001, FILES-001/002/003, LOG-001/003,
  ERR-001, SEC-002.

## Isolation Guards (DEV) — VERIFIED
- DEV boot this session: Firebase Admin (rwqan-sa-dev) + R2 (bucket rwqan-sa-dev)
  initialized; guards passed; Paymob keys absent -> non-blocking in DEV; booking worker
  disabled outside production. assertProductionSecurityEnvironment /
  assertDevelopmentIsolation / assertFirebaseDevIsolation / assertR2DevIsolation all PASS
  (unit + boot). External services blocked in DEV unless explicitly allowed.

## Status Classification
- LOCAL DEV READINESS: GREEN — TS 0 errors, tests 1026/1026 (serial), scanner 26 open
  (every open ID already existed at session start; the scanner's "NEW: 6" are line-shift
  re-correlations, not genuinely new findings; 13 closed). (Historic: browser E2E PASS,
  dev smoke PASS, build PASS from 2026-10-13.)
- PRODUCTION RELEASE READINESS: NO-GO — SEC-001 historical secrets; AUTH-001 migration not
  performed; R2-001 private-serving model unresolved; ADMIN-001/PAY-001/AUTH-005/DRIVE-001
  decisions open; staging + ops backup/restore UNKNOWN. See LAUNCH_GATE_REPORT.md.