# PROJECT MASTER REFERENCE — Ruqan / Rwqan

CURRENT VERSION: 0.1.0 (documentation + verification baseline, tracked in VERSION_HISTORY.md)
CURRENT ENVIRONMENT: DEVELOPMENT (rwqan-sa-opencode clone)
CURRENT STATUS: VERIFIED BASELINE — docs complete; AUTH-001 follow-ups done; AUTHZ-001 fixed;
  scanner NEW:0; browser E2E + build + smoke PASS; production readiness not claimed
LAST VERIFIED: 2026-10-13 (TS 0 errors; tests 702/702 serial; browser E2E 2/2 PASS;
  build PASS; DEV smoke PASS; scanner RED-trigger 1 = SEC-001)
SECURITY STATUS: See SECURITY_STATUS.md (SEC-001 open/BLOCKED; AUTHZ-001 closed)
TEST STATUS: See SESSION_HANDOFF.md / VERSION_HISTORY entries
PRODUCTION READINESS: NOT_CLAIMED — Production Release Gate = BLOCKED
LAST RELEASE: NONE ON RECORD (doc baseline 0.1.0 only)
NEXT SAFE ACTION: Production authorization on SEC-001 rotation; Private R2 hardening
needs a real document-scope model (owner-approved) — ADMIN_DOCUMENT_SCOPE stays
UNKNOWN/BLOCKED_BY_MISSING_MODEL (ratified DEC-004/DEC-012, no invented roles); then
production rollout per the locked plan.

---

## 1. Project Identity
- Name: Ruqan / Rwqan (Arabic-first, RTL)
- Repo (DEV clone): `C:\Users\zerof\Desktop\rwqan-sa-opencode`
- Production/Original (DO NOT TOUCH during DEV): `C:\Users\zerof\Desktop\rwqan-sa`

## 2. Purpose
Property-management SaaS: owners, properties, subscriptions, payments, discounts,
requests, analytics, booking commission receipts, WhatsApp notifications, admin.

## 3. Architecture
- Node.js/Express server (`server/`)
- Next.js/React frontend (app/)
- Firebase/Firestore as DB (primary)
- Cloudflare R2 (image/receipt storage)
- Multer (upload), express-session (sessions)
- Schedulers/workers (booking commission, smart scheduler)
- Route modules composed in `server/routes/index.ts`

## 4. Technology Stack
- Node `v24.x`, npm `11.x`, `"type": "module"`
- Express 4, Next.js, React, Tailwind, Radix UI
- `@aws-sdk/client-s3` (R2), `@aws-sdk/s3-request-presigner`
- `argon2` (AUTH)
- Firebase Admin SDK
- Multer, express-session, memorystore, cookie-parser, cors

## 5. Application Structure (summary)
- `server/` — API + services + utils + config
  - `server/routes/` — route modules including admin/ subfolder
  - `server/services/` — AuthService, BookingCommissionReceiptService, integrations
  - `server/utils/` — helpers, r2, password, runtimeEnvironment-related utils
  - `server/config/` — runtimeEnvironment (guards), loadEnv
  - `server/firebaseService.ts` — Firestore data layer
  - `server/storage.ts` — backup storage abstraction
- `quality/` — quality/security suites
- `security/` — security scanner
- `docs/` — permanent project system documents

## 6. DEV / PROD Boundaries
- DEV: `NODE_ENV=development`, PORT 5001, `PUBLIC_BASE_URL=http://localhost:5001`,
  Firebase `rwqan-sa-dev`, R2 bucket `rwqan-sa-dev`, external services DISABLED,
  Paymob NOT USED.
- PROD: guarded by `assertProductionSecurityEnvironment`, `assertDevelopmentIsolation`,
  `assertFirebaseDevIsolation`, `assertR2DevIsolation` in DEV.

## 7. Firebase
- DEV project: `rwqan-sa-dev`, project number 467810513087, region me-central2.
- DEV DB is NEW and EMPTY. No seed of production-like data.
- Isolation: `assertFirebaseDevIsolation` refuses non-DEV project in DEV when credentials present.

## 8. Firestore
- Collections: owners, properties, requests, subscriptions, packages, payments,
  discounts, verification_logs, booking_followups, customer_accounts, etc.
  (confirmation pending full inventory)

## 9. R2
- DEV bucket: `rwqan-sa-dev`.
- Property images intentionally PUBLIC.
- Private objects: receipts/\*, booking-commission-receipts/\* (must NOT be public).
- Isolation: `assertR2DevIsolation`.
- Presigner: `@aws-sdk/s3-request-presigner` added. 120s short-lived signed GET target.

## 10. Paymob
- NOT used in DEV. Real credentials absent in DEV are not a startup blocker.
- Integration guarded by external-services isolation.

## 11. WhatsApp / Meta
- NOT used in DEV (external-service blocked unless explicit override). Owner password reset
  uses OTP via WhatsApp/Enjazatik only when configured.

## 12. Google Drive
- NOT used in DEV. Blocked by external-service isolation.

## 13. Gemini / OCR
- NOT used in DEV. External-service isolation guards integrations.

## 14. Workers / Schedulers
- `server/scheduler.ts`, `server/smartScheduler.ts`, booking commission worker
  (BookingNotificationWorker). Details pending full inventory.

## 15. Authentication
- Owner: PIN/password via AuthService. Argon2id hashing introduced (AUTH-001).
  - `owners.password` canonical; `properties.pin` synchronized temporarily.
  - flags: AUTH_HASH_MIGRATION_ENABLED, AUTH_ENFORCE_HASHED_ONLY.
  - DEV default: migration enabled; hashed-only enabled.
  - PROD default: both disabled until validated.
- Admin: ADMIN_CODE/ADMIN_PASSWORD; session `isAdmin`.
- Sessions: express-session.

## 16. Authorization
- `requireOwner` (session propertyNumber), `requireAdmin` (session isAdmin),
  `requireSameOrigin`.
- Central admin boundary: `app.use("/api/admin", requireSameOrigin, requireAdmin)`.
- No named role hierarchy. Do not invent roles.

## 17. Ownership / Tenant Isolation
- Owner operations scoped to session propertyNumber.
- IDOR hardening: AUTHZ-001 ownership enforcement in owner delete flow.
- Cross-owner access must be denied at backend.

## 18. File Security
- FILES-001: receipt upload Multer limits + MIME whitelist.
- FILES-002: image delete defensive URL validation.
- Private docs must be authenticated + signed GET (120s) target; property images public.

## 19. Secrets
- Never expose. Tracked secrets are known risk. Document findings without printing values.
- `.env` may contain secrets; must never be committed/printed.

## 20. Security Architecture (layers)
1. Env isolation 2. Secrets 3. Auth 4. AuthZ 5. Ownership 6. Input validation
7. File validation 8. Storage isolation 9. Payment integrity 10. Webhook verification
11. Rate limiting 12. Headers 13. CORS/CSRF 14. SSRF 15. Logging/PII 16. Deps
17. Static analysis 18. Runtime tests 19. Regression 20. Backup/rollback
21. Monitoring/health 22. Incident containment 23. Recovery

## 21. Business Logic
- Preserve existing semantics. Document any change (BUSINESS LOGIC IMPACT).
- Public property images are intentionally public.
- Booking/commission/pricing/subscription/discount/payment logic must not be altered
  casually.

## 22. UI/UX
- Arabic-first, RTL, mobile-first, responsive. See UI_UX_REFERENCE.md.
- Use existing components/patterns before new design.

## 23. Testing
- Node test runner (node:test) for server unit; vitest available; quality suites.
- Record PASS/FAIL/BLOCKED/NOT_RUN/UNKNOWN.

## 24. Security Toolchain
- security/ scanner; gitleaks/codeql/osv/trivy/semgrep/ZAP when available (NOT_RUN when absent).

## 25. Backup / Restore
- Admin backup routes exist (app-level export). Operational verified backup/restore runbook:
  UNKNOWN / OPERATIONAL DECISION REQUIRED.

## 26. Rollback
- Feature flags allow controlled AUTH rollback. Fully verified ops rollback runbook:
  UNKNOWN.

## 27. Release Process
- See docs/RELEASE_NOTES.md, VERSION_HISTORY.md, OPERATIONS.md.
- Every release has version + docs + evidence.

## 28. Production Deployment
- NOT authorized/started. Requires PRODUCTION RELEASE GATE = PASS and explicit approval.

## 29. Post-Deployment Verification
- Health, critical UI, auth, authz, critical APIs, storage, business logic, static assets.

## 30. Known Issues / Blocked / Deferred / UNKNOWN
- See SECURITY_STATUS.md, SESSION_HANDOFF.md, DECISIONS.md.
- Production data gate NOT cleared.

## 31. Current Version
- VERSION_HISTORY.md to define. Current WORKING baseline recorded there.

## 32. Next Safe Action
- Finish documentation system (this session), then continue safe security/verification phases.