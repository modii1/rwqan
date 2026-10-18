# DECISIONS LOG — Ruqan / Rwqan

## DEC-001: Argon2id password hashing
DECISION ID: DEC-001
DATE: 2026-10-13 (selected earlier)
CONTEXT: Owner credentials stored plaintext; need migration-safe hashing.
DECISION: Use Argon2id. `owners.password` canonical; `properties.pin` synchronized
temporarily; dual-read legacy/hashed; migration-on-login behind flags.
REASON: Memory-hard KDF, preferred over bcrypt unless incompatibility proven.
ALTERNATIVES: bcrypt (rejected unless proven needed); no-hash (rejected).
IMPACT: AuthService + password utility + new-write hashing + flags.
STATUS: LOCKED. Implemented for DEV (empty model).

## DEC-002: Feature flag defaults
DECISION ID: DEC-002
DATE: 2026-10-13
CONTEXT: AUTH migration enforcement claims.
DECISION:
AUTH_HASH_MIGRATION_ENABLED: DEV true, PROD false initially.
AUTH_ENFORCE_HASHED_ONLY: DEV true (new empty model), PROD false during transition.
REASON: DEV has no legacy records; PROD requires backward compatibility.
STATUS: LOCKED.

## DEC-003: R2 documents — private vs public
DECISION ID: DEC-003
DATE: 2026-10-13
CONTEXT: Property images vs receipts/private docs.
DECISION: Property images remain PUBLIC by design. Private docs stored private with
objectKey; authenticated download with short-lived (120s) presigned GET target.
REASON: Public images are intentional product behavior; private docs must not be
anonymously readable.
STATUS: LOCKED (implementation pending DEV).

## DEC-004: Private doc admin scope
DECISION ID: DEC-004
DATE: 2026-10-13
CONTEXT: No document-specific admin rule exists.
DECISION: Reuse existing requireAdmin; do not invent roles. If exact scope cannot be
proven, mark BLOCKED_BY_MISSING_MODEL and stop.
STATUS: LOCKED POLICY; ADMIN_DOCUMENT_SCOPE = UNKNOWN / BLOCKED_BY_MISSING_MODEL.

RATIFIED & CODE-VERIFIED (2026-10-13) — explicit decision owner approval:
- Approved: use the EXISTING requireAdmin only. Do NOT create a new admin document
  role/permission. Do NOT assume scope is wider or narrower than the code proves.
- Code evidence confirms the blocker stands:
  * requireAdmin (server/routes/middleware.ts:21) is a binary check
    (req.session.isAdmin -> 401/next); no role, permission, or scope model exists.
  * No ADMIN_DOCUMENT_SCOPE / permission / custom role concept anywhere in server/**.
  * No admin endpoint serves private documents under a documented scope: bank-transfer
    and add-on receipts are stored PUBLIC (guessable keys; findings R2-001/FILES-001/002),
    and booking-commission receipts use a token-scoped collection flow
    (bookings.ts parseBookingCommissionReceipt) — neither is scope-gated by requireAdmin.
- CONCLUSION: ADMIN_DOCUMENT_SCOPE = UNKNOWN / BLOCKED_BY_MISSING_MODEL is CONFIRMED.
  Do not bypass this blocker. Private R2 implementation must NOT assume unproven
  admin document permissions.
- No code change made for this ratification.

## DEC-005: Migration measurement
DECISION ID: DEC-005
DATE: 2026-10-13
CONTEXT: No completion measurement exists.
DECISION: Use explicit non-secret credential-format marker (Option B) + derived
classification fallback (Option A). Counts only; no PII/credentials exposure.
STATUS: DESIGN APPROVED (not implemented).

## DEC-006: No production migration now
DECISION ID: DEC-006
DATE: 2026-10-13
CONTEXT: DEV empty; production not touched.
DECISION: No production data migration, no production writes, no destructive ops.
STATUS: LOCKED.

## DEC-007: Owner subscription endpoint IDOR fix (AUTHZ-001)
DECISION ID: DEC-007
DATE: 2026-10-13
CONTEXT: GET /api/owner/subscription/:propertyNumber returned any property's
subscription/profile to any logged-in owner. Owner dashboards legitimately read the
group's main/child subscription, so a strict session-only guard would break the UX.
DECISION: Group-aware allow-list: the session property plus the members of its linked
group (sessionSubscription.linkedProperty + linkedProperties). Foreign properties get
HTTP 403. Regression test added. The scanner rule was widened to recognize
session-scoped guards (still fires when a handler reads a caller param without a
session check).
REASON: Closes enumeration without changing the real linked-property flows.
ALTERNATIVES: strict equality (rejected - breaks linked-property dashboard).
STATUS: LOCKED. Implemented and verified (test PASS; scanner RED-triggers dropped
from 2 to 1).

## DEC-008: Scanner baseline re-anchor after review
DECISION ID: DEC-008
DATE: 2026-10-13
CONTEXT: Line-shifting edits (AUTH/AUTHZ fixes) changed finding fingerprints; 12 known
findings were mislabelled NEW and 13 stale entries RESOLVED. No new vulnerability
classes existed.
DECISION: Re-ran scanner with --update-baseline after manual review of all 12 items
(the identical known issues), preserving their open status. Post-update: NEW:0,
EXISTING:40, RED-TRIGGERING:1.
REASON: Keeps CI meaningful without hiding findings (SEC-001 remains open/RED).
STATUS: DONE.

## DEC-009: SEC-001 remediation deferred to production
DECISION ID: DEC-009
DATE: 2026-10-13
CONTEXT: Production secrets tracked in git (.env). Working-tree .env currently deleted;
index/history still contain secrets.
DECISION: Do NOT attempt secret rotation or history rewrite from DEV. Record as BLOCKED
with remediation plan (rotate prod secrets; stop tracking .env; optional history purge).
REASON: These are production/ops actions requiring authorization; not safe from this
clone.
STATUS: BLOCKED (open).

## DEC-010: Fix quality CLI entry guard for Windows
DECISION ID: DEC-010
DATE: 2026-10-13
CONTEXT: quality/src/cli.ts used `import.meta.url === 'file://' + process.argv[1]`,
which never matched on Windows (missing leading slash / encoding), so the quality
(quality/ + live-API + browser-E2E) suites silently never ran there; the on-disk report
was stale (Oct 10) and misattributed as current.
DECISION: Use the proven pattern from security/src/cli.ts: compare against
`pathToFileURL(process.argv[1]).href`.
REASON: Makes the existing suites actually runnable on the DEV platform; tooling fix
only (no business/test logic change).
STATUS: LOCKED. Verified: full quality run produced a fresh report with real results.

## DEC-011: BL-006 fixture correction + API-002 recorded as environmental
DECISION ID: DEC-011
DATE: 2026-10-13
CONTEXT: quality/suites/businessLogic.ts BL-006 supplied `pricePerProperty:25` to the
legacy VIP package, which in the real model marks it "normalized" (base=price=25), so
its assertion of 50 SAR failed. Evidence: shared/subscriptionPricing.ts JSDoc and
shared/subscriptionPricing.test.ts use the true legacy document WITHOUT pricePerProperty.
DECISION: Correct the fixture to the real document shape (no pricePerProperty); keep the
50 SAR assertion. Do NOT touch the pricing modules (business logic preserved).
Also: live-api API-002 (POST /api/payment/calculate -> 404 in DEV) is the known empty-
DEV package-data gap (subscriptionPackages collection empty; route 404s by design).
DECISION: do NOT weaken the assertion and do NOT seed DEV data; record as environmental.
REASON: Preserves real behavior and test strength; both differences were pre-existing
miscredits, not this session's changes.
STATUS: LOCKED. Verified: business-logic suite 10/10 PASS; API-002 documented as the
sole environmental live-API failure.

## DEC-012: ADMin document scope ratified as BLOCKED_BY_MISSING_MODEL
DECISION ID: DEC-012
DATE: 2026-10-13
CONTEXT: Ratification of DEC-004 by the decision owner (explicit instruction to review
against code; no new roles/permissions).
DECISION: Confirm and freeze ADMIN_DOCUMENT_SCOPE = UNKNOWN / BLOCKED_BY_MISSING_MODEL.
Reuse requireAdmin only; never create or assume an admin document role; never assume
scope broader/narrower than code proves. Private R2 implementation must not depend on
unproven permissions.
REASON: requireAdmin is a binary isAdmin check; no document-scope/permission model exists
in code; no admin private-document endpoint exists to define such a scope.
IMPACT: Private R2 hardening stays BLOCKED pending a real document-scope model (or a
further explicit owner decision). No code change.
STATUS: LOCKED (owner-ratified).

## DEC-013: .env Git cleanup (SEC-001 partial remediation)
DECISION ID: DEC-013
DATE: 2026-10-13
CONTEXT: Owner authorized ONLY safe .env Git-tracking cleanup in the DEV clone.
DECISION:
- Remove `.env` from the git index (git rm --cached) — reversible via
  git restore --staged .env. No commit, no push, no history rewrite.
- Keep `.env` ignored (rule already present, .gitignore:28). Confirm
  `.env.development.local` stays ignored (rule .gitignore:27) and is the DEV source.
- Confirm `.env.template` (tracked) is placeholder-only (audited HEAD + worktree:
  21 secret keys, 0 real-looking values, 0 matches with .env.development.local).
- Do NOT change any credential value anywhere; NO rotation; NO revocation.
- Do NOT claim SEC-001 fully resolved: historical Git copies still contain the old .env.
REASON: Stop further exposure from the tracked index while strictly avoiding the
production-only remediation steps (rotation/history purge).
IMPACT: DEV behavior unchanged (loadEnv reads .env.development.local; .env absent and
not required). Env-guard tests 33/33 PASS; DEV load check PASS.
STATUS: DONE (cleanup); SEC-001 remains OPEN for historical copies + rotation
(BLOCKED - awaits production authorization).

## DEC-014: DEV-only synthetic E2E test-data system
DECISION ID: DEC-014
DATE: 2026-10-13
CONTEXT: Need safe, realistic, repeatable DEV end-to-end testing of auth/owner/
customer/subscription/admin/file/responsive flows. DEV Firestore is intentionally
empty, so live-API cases (e.g. API-002 payment/calculate) had no package data and
404'd (recorded as environmental in DEC-011). Absolutely no production target, no
real providers, no faking of success.
DECISION:
- Add a DEV-only test-data module: scripts/dev/e2e-test-data.ts with thin entrypoints
  scripts/dev/e2e-seed.ts and scripts/dev/e2e-cleanup.ts.
- Runtime safety guard (throws otherwise): NODE_ENV must be "development"; Firebase
  project must be exactly rwqan-sa-dev; R2 bucket must be exactly rwqan-sa-dev;
  external services must be disabled. Reuses the server's own isolation guards.
- Data is synthetic and clearly marked: every record carries `testData: true` plus an
  `E2E_TEST_` label. Fixed document ids make seed/cleanup idempotent.
- Owner login fixtures use an isolated 5-digit property block (90001-90003) because the
  owner-login UI accepts exactly 5 digits; PINs are stored as argon2id hashes via the
  existing server password utility (DEV enforces hashed-only credentials).
- Cleanup deletes ONLY marked/known ids (no broad collection deletes).
- Expand quality/suites/browserE2E.ts to exercise real UI + same-origin API flows
  (owner/admin login, dashboard, property update persistence, public browse/detail,
  packages rendering, payment/calculate with discount, admin boundary + data, public
  image upload, mobile/tablet/desktop RTL). Authenticated assertions run fetch() in the
  browser page to exercise the real session cookie.
- live-api API-002 now resolves a real seeded package id instead of a hard-coded
  (missing) one; assertion strength unchanged.
REASON: Enables realistic, repeatable DEV E2E while honoring every safety rule
(no production, no external providers, no weakened assertions, no fake success).
IMPACT: None on production or business logic. quality/tsconfig.json adds lib "dom"
(browser globals used inside page.evaluate).
STATUS: LOCKED. Verified: seed+cleanup idempotent; quality 27/28 PASS (1 BLOCKED =
customer OTP needs WhatsApp, disabled in DEV; criticalFailures 0); full server+shared
suite 702/702 PASS; npm run build PASS; offline security scan NEW:0 / REGRESSED:0.
Production Release Gate remains BLOCKED (SEC-001 + admin-doc-scope + prod migration).