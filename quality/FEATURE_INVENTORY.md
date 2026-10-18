# RUQAN - Phase 6G Feature Inventory (DEV only)

- Source: Existing codebase in repo (no production changes, no external services enabled in DEV)
- Server: Express + Next.js hybrid on port 5001 (dev), Firestore (prod project rwqan-757 in general; DEV uses isolated dev identities via runtime guards)
- Identity guards: assertProductionSecurityEnvironment, assertDevelopmentIsolation, assertFirebaseDevIsolation, assertR2DevIsolation (from code)
- Payment/External: ALLOW_EXTERNAL_SERVICES_IN_DEVELOPMENT=false in dev; no Paymob/WhatsApp/Enjazatik/Gemini/OCR/Drive creds present. Schedulers may be disabled in dev.
- Persistence: Firestore; Drizzle/Neon present as scaffold (chat models only)

## Core Features (from discovery)

### Subscriptions/Packages
- Firestore collection `packages` (not hardcoded). 
- shared/subscriptionPackagePolicy.ts: MAX_ACTIVE_SUBSCRIPTION_PACKAGE_DAYS=90, SUBSCRIPTION_RENEWAL_WINDOW_DAYS=10, MAX_SUBSCRIPTION_REMAINING_DAYS=100; normalize/isPurchasable helpers.
- shared/subscriptionPricing.ts: pricing calculation (included properties, legacy VIP handling pkg-month-2properties), calculateSubscriptionPrice.
- shared/subscriptionType.ts: normalize types/statuses (premium/normal, active/suspended/expired etc).
- server/utils/paymentScenarioFlow.ts: subscription action validation, payment action validation, calculateActionDates, resolvePaymentPropertyPlan, activateVerifiedPaymentSubscription, queueVerifiedNewPropertyForAdminApproval, syncMultiPropertyRecord.
- server/utils/dateUtils.ts: Riyadh timezone, capAtMaxDays, MAX_SUBSCRIPTION_DAYS, calculateSubscriptionEndDate, calculateExtensionEndDate, calculateRemainingDays.

### Booking/Commission
- shared/booking.ts: commission logic/constants (COMMISSION_PAYMENT_WINDOW_MS, reminder offsets, calculateBookingCommissionHalalas, scheduleCommissionReminders, toPublicDto/toAdminDto). 
- booking commission enforcement via routes and worker (server/services/BookingNotificationWorker, routes/bookings.ts).

### Properties
- Public/protected property APIs; property verification, links, multi-property groups.

### Auth/Roles
- owner/admin/customer; routes in server/routes/auth.ts.

### Admin
- admin sections under server/routes/admin/*.

### Payments/Calculation
- POST /api/payment/calculate (public.ts) — pure calculation (no money movement). 
- Discount validation, packages listing /api/packages, occasions.

### Data Isolation/Guards
- DEV isolation enforced at startup (server/index.ts calls assert*DevIsolation).

## Test Coverage Targets (6G)

- Business-logic (in-process): subscription policy (duration <=90 active), renewal window (10), pricing math, extension/activation rules, date capping, validation boundaries. Use REAL modules only.
- Live API (against :5001): safe public GETs (/api/packages, /), safe POSTs like /api/payment/calculate with valid dev-safe inputs; no destructive writes. 
- Browser E2E (Playwright, headless): core navigation (/, /properties, /owner/login UI elements), responsive smoke, basic form rendering. NOT_RUN if blocked.
- Health: combine quality results + security summary (Phase 6F) into RUQAN PLATFORM HEALTH (GREEN/ORANGE/RED).

Notes:
- NOT_RUN != PASS. 
- No business-logic changes. 
- No external services. 
- No commit/push.
- Stop after PHASE 6G COMPLETE.
