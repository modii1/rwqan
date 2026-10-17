# ARCHIVE / ARCHITECTURE — Ruqan / Rwqan

See PROJECT_MASTER_REFERENCE.md for the living architecture reference.
This file documents the architecture decisions and structural map (summary).

## Runtime Layers
1. Frontend: Next.js/React (app/), Tailwind + Radix UI, Arabic-first RTL mobile-first.
2. Backend: Express (server/routes compiled via server/routes/index.ts), middlewares.
3. Data: Firebase/Firestore via server/firebaseService.ts (+ storage.ts backup abstraction).
4. Storage: Cloudflare R2 via server/utils/r2.ts + services (receipts, images).
5. Integrations: paymob, whatsapp, googleDrive, aiReceiptScanner (Gemini/OCR) — external.

## Route Map (server/routes)
- auth, owner, properties, public, tracking, contactIdentity, customer, webhooks, bookings
- admin/analytics|properties|subscriptions|payments|content|finance|settings|addons|backup|images|packages|testing|linked-properties|occasions|bookings|booking-payments

## Quality / E2E toolchain (quality/)
- In-process business-logic suite (real modules) + live-API suite (DEV server :5001) +
  browser E2E suite (Playwright headless chromium) via quality/src/cli.ts.
- CLI entry guard fixed for Windows (pathToFileURL pattern, DEC-010); suites verified
  runnable and passing (business-logic 10/10, E2E 2/2, live-API 2/3 — API-002 is the
  known empty-DEV package-data gap).

## Guards (server/config/runtimeEnvironment.ts + server/utils/r2.ts + loadEnv)
- assertProductionSecurityEnvironment
- assertDevelopmentIsolation
- assertFirebaseDevIsolation
- assertR2DevIsolation
- externalServicesEnabled

## Auth
- Owner: AuthService.validateOwnerPin (Argon2id dual-read, flags)
- Password change/reset: AuthService (hashed writes)
- Admin: AdminLoginRateLimiter + session isAdmin, requireSameOrigin, requireAdmin

## Data model (Firestore) — partial
- owners (ownerId, phone, password, resetCode, resetExpire, lastReset)
- properties (propertyNumber, pin, whatsappNumber, ...)
- requests, subscriptions, packages, payments, discounts, customer_accounts,
  booking_followups, verification_logs

## Dev vs Prod
- DEV: rwqan-sa-dev (empty), R2 rwqan-sa-dev, port 5001, external disabled.
- PROD: guarded; never accessed from DEV.

## Change Control
- Surgical edits only. Every real change is tracked through docs/.