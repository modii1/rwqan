# PROJECT MASTER REFERENCE — Ruqan / Rwqan

CURRENT VERSION: 0.5.0 (TEST publish reverted to the last approved commit; auto-commit/push removed)
VERSION DATE: 2026-11-05
CURRENT BRANCH / COMMIT: test/unified-gateway-ui-only @ 190b43577b3eee10b835579aa63d2c155fd7e660
  (0.5.0 changes are in the working tree, not yet committed)
CURRENT ENVIRONMENT: DEVELOPMENT (LOCAL on port 5001) with TEST/LIVE deploy targets
CURRENT STATUS: DEV version — TEST publish deploys the last approved commit on
  `test/unified-gateway-ui-only`; it never creates commits, pushes, or branches. Local
  uncommitted changes are warned about and are never published. GitHub dispatch reuses
  `DEPLOY_GITHUB_TOKEN` or the existing `gh` session in development. LIVE/LOCAL unchanged.
  No production release and no deployment executed for this entry.
LAST VERIFIED: 2026-11-05 (TS 0 errors frontend+server; deploy+auth suite 285/285 PASS;
  deploy bar/section 18/18 PASS; the temporary diagnostic ref is absent from the remote;
  no deploy executed)
DEPLOY TARGETS:
  - LOCAL: local developer machine, http://localhost:5001 (fixed; the LOCAL switch button
    was removed from the environment bar in 0.3.1 — DEC-015 implemented)
  - TEST: project rwqan-757 / backend rwqan-backend /
    https://rwqan-backend--rwqan-757.europe-west4.hosted.app (workflow deploy-test.yml on
    branch test/unified-gateway-ui-only; manual workflow_dispatch only). The TEST publish
    auto-commits only approved paths and hard-refuses any branch other than the approved
    TEST branch.
  - LIVE: project rwqan-757 / backend rwqan /
    https://rwqan--rwqan-757.europe-west4.hosted.app (workflow deploy-live.yml on main);
    official domain https://rwqan.sa is untouched; enabled by DEPLOY_REAL_DEPLOY with
    build/target/permission checks still enforced. LIVE never auto-commits.
SECURITY STATUS: See SECURITY_STATUS.md (SEC-001 open/BLOCKED; AUTHZ-001 closed)
TEST STATUS: See SESSION_HANDOFF.md / VERSION_HISTORY entries
PRODUCTION READINESS: NOT_CLAIMED — Production Release Gate = BLOCKED
LAST RELEASE: NONE ON RECORD (development version 0.4.0 only)
NEXT SAFE ACTION: commit the 0.4.0 changes with explicit approval; provide the pre-existing
DEPLOY_GITHUB_TOKEN for GitHub dispatch; then the TEST publish can auto-commit/push and
dispatch. SEC-001 rotation remains pending; ADMIN_DOCUMENT_SCOPE stays
UNKNOWN/BLOCKED_BY_MISSING_MODEL (ratified DEC-004/DEC-012, no invented roles).

---

## 1. Project Identity
- Name: Ruqan / Rwqan (Arabic-first, RTL)
- Repo (DEV clone): `C:\Users\zerof\Desktop\rwqan-sa-opencode`
- Official remote: `https://github.com/modii1/rwqan` (remote `origin`)
- Backup: `C:\Users\zerof\Desktop\rwqan-sa-full-backup.git`
- Legacy local folder `C:\Users\zerof\Desktop\rwqan-sa` was removed earlier; do not
  recreate it. The official remote + backup are the recovery sources.

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
- Deploy target note (0.2.0): the DEV *data* project (`rwqan-sa-dev`) is separate from
  the TEST *deploy* target (`rwqan-757` / backend `rwqan-backend`). Do not confuse them.
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
- Owner unified account (0.2.0): phone OTP login via `OwnerAccountStore`/`OwnerAccountService`,
  plus the property-number tab; one account can access its linked properties and switch
  between them from the owner dashboard.
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

## 27.1 Deploy Bar / Environments (0.5.0)
- UI: `src/components/deploy-bar.tsx` + admin section `sections/deploy.tsx`.
- API: `/api/admin/deploy/*` (state, checks, releases, restore, status).
- TEST and LIVE are separate targets; the bar shows the real GitHub Actions run state.
- TEST: project `rwqan-757` / backend `rwqan-backend` /
  `https://rwqan-backend--rwqan-757.europe-west4.hosted.app`; workflow
  `deploy-test.yml` on branch `test/unified-gateway-ui-only` (manual dispatch only).
- TEST publish deploys the last approved commit on
  `test/unified-gateway-ui-only`. It NEVER creates a commit, push, or branch. If the local
  worktree has uncommitted changes, the bar warns that they will not be published; it does
  not delete, stash, or replace them.
- The pre-deploy gate marks a dirty TEST worktree as `ok` with that warning (deploying the
  last approved commit is still valid). LIVE and LOCAL keep the strict blocked behavior.
- A failed mandatory check shows its real server reason. The secret-scan reason names the
  offending changed file(s), never the content.
- GitHub dispatch uses one credential resolver: explicit `DEPLOY_GITHUB_TOKEN`, or the
  existing authenticated `gh` session in development only. The token is memory-only and
  never written/logged; production requires the explicit env token.
- LIVE: project `rwqan-757` / backend `rwqan` /
  `https://rwqan--rwqan-757.europe-west4.hosted.app`; workflow `deploy-live.yml` on
  `main`. The official domain `https://rwqan.sa` remains untouched. LIVE is enabled by
  `DEPLOY_REAL_DEPLOY` with no separate production opt-in; build, target and permission
  checks remain mandatory. LIVE never auto-commits.
- Status is read from the public GitHub repository anonymously (read-only); when it
  cannot be read, a reason is shown and no success is claimed.
- LOCAL is a fixed local environment (port 5001). The LOCAL switch button was removed
  from the bar in 0.3.1 (DEC-015); LOCAL detection/operation are unchanged.
- The generic cloud "نشر" button was removed; the environment-specific TEST/LIVE publish
  buttons, their status and the publish mechanism remain unchanged.

## 28. Production Deployment
- LIVE deploy is available through the approved GitHub Actions path when
  `DEPLOY_REAL_DEPLOY` is enabled; there is no separate production opt-in. Build, target
  and permission checks still apply. No deployment was executed for 0.4.1.
- A formal production release still requires the documented
  `PRODUCTION RELEASE GATE = PASS` and explicit approval.

## 29. Post-Deployment Verification
- Health, critical UI, auth, authz, critical APIs, storage, business logic, static assets.

## 30. Known Issues / Blocked / Deferred / UNKNOWN
- See SECURITY_STATUS.md, SESSION_HANDOFF.md, DECISIONS.md.
- Production data gate NOT cleared.

## 31. Current Version
- CURRENT VERSION: **0.5.0** (2026-11-05) — branch `test/unified-gateway-ui-only`,
  base commit `190b43577b3eee10b835579aa63d2c155fd7e660`; 0.5.0 changes are in the
  working tree (not yet committed).
- Full entry: `docs/VERSION_HISTORY.md`; notes: `docs/RELEASE_NOTES.md`.
- Previous versions: 0.4.4, 0.4.3, 0.4.2, 0.4.1, 0.4.0, 0.3.1, 0.3.0, 0.2.0 and 0.1.0 +
  addendum (preserved in history; 0.4.0/0.4.2/0.4.3 auto-commit are superseded).

## 32. Next Safe Action
- Finish documentation system (this session), then continue safe security/verification phases.