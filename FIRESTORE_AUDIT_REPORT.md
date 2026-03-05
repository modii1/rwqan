# Firestore Read Audit Report

**Date:** March 5, 2026  
**Target:** 63K reads/day root cause analysis  
**Architecture:** All data access is server-side via Firebase Admin SDK (no client-side Firestore SDK)

---

## Executive Summary

| Finding | Count |
|---------|-------|
| **Full collection reads (no constraints)** | **23** |
| **orderBy-only reads (no limit)** | **7** |
| **Constrained reads (where/limit)** | **15** |
| **Single doc reads** | **~25** |
| **onSnapshot listeners** | **0** |
| **Client-side Firestore calls** | **0** |
| **getCountFromServer** | **0** |

**Root cause of 63K reads/day:** Full collection scans on every admin page load, scheduler runs, and especially the `/api/track-pageview` endpoint which reads ALL requests on EVERY page visit.

---

## CRITICAL FINDINGS (Highest Impact)

### 1. `/api/track-pageview` reads ALL requests on every page view
- **File:** `server/routes/tracking.ts` Line 155
- **Pattern:** `analyticsService.getAllRequests()` → `firebaseService.getRequests()` → `this.db.collection("requests").orderBy("timestamp", "desc").get()`
- **Impact:** If `requests` has N docs, each page view costs N reads. With 100 requests and 100 page views/day = **10,000 reads/day just from this**.
- **Priority:** 🔴 **CRITICAL**

### 2. `/api/admin/alerts` does 6 full collection reads per call
- **File:** `server/routes/admin/analytics.ts` Lines 248-273
- **Collections read:** `subscriptions` (full), `payments` (full), `requests` (full), `properties` (full), `suggestions` (full), `property_addons` (full)
- **Pattern:** `Promise.all([subscriptionService.getAll(), paymentService.getAll(), analyticsService.getAllRequests(), propertyService.getAll(), firebaseService.getSuggestions()])` then later `firebaseService.getAllPropertyAddOns()`
- **Impact:** If each collection averages 50 docs = **300+ reads per admin dashboard load**
- **Priority:** 🔴 **CRITICAL**

### 3. Scheduler reads ALL payments every 15 minutes
- **File:** `server/scheduler.ts` Lines 289-336
- **Pattern:** `expireOldPendingPayments()` → `firebaseService.getPayments()` → full collection read
- **Frequency:** Every 15 minutes = **96 full collection reads/day** on payments alone
- **Priority:** 🔴 **CRITICAL**

### 4. `getProfitsSummary()` cascades into 3 full collection reads
- **File:** `server/firebaseService.ts` Lines 843-950
- **Pattern:** `getPayments()` + `getFeeConfigs()` + `getExpenses()` — all full collection reads
- **Triggered by:** `GET /api/admin/partner-profits/summary`
- **Priority:** 🔴 **HIGH**

---

## COLLECTION-BY-COLLECTION ANALYSIS

---

### `requests` Collection

| # | File | Line | Pattern | Constraints | Type | Priority |
|---|------|------|---------|------------|------|----------|
| 1 | `server/firebaseService.ts` | 391 | `this.db.collection("requests").orderBy("timestamp", "desc").get()` | orderBy only, NO limit | One-time | 🔴 HIGH |
| 2 | `server/storage.ts` | 372-373 | `col.orderBy('timestamp', 'desc').limit(1000).get()` | orderBy + limit(1000) | One-time | 🟡 MEDIUM |
| 3 | `server/routes/tracking.ts` | 155 | `analyticsService.getAllRequests()` — fetches ALL then filters in JS | None (full scan) | One-time | 🔴 CRITICAL |
| 4 | `server/routes/admin/analytics.ts` | 14 | `analyticsService.getAllRequests()` in `/api/admin/requests` | None (full scan) | One-time | 🔴 HIGH |
| 5 | `server/routes/admin/analytics.ts` | 30 | `analyticsService.getAllRequests()` in `/api/admin/visitors` | None (full scan) | One-time | 🔴 HIGH |
| 6 | `server/routes/admin/analytics.ts` | 164 | `analyticsService.getAllRequests()` in `/api/admin/analytics` | None (full scan) | One-time | 🔴 HIGH |
| 7 | `server/routes/admin/analytics.ts` | 270 | `analyticsService.getAllRequests()` in `/api/admin/alerts` | None (full scan) | One-time | 🔴 HIGH |
| 8 | `server/routes/owner.ts` | 186 | `analyticsService.getAllRequests()` in `/api/owner/analytics` | None (full scan) | One-time | 🔴 HIGH |
| 9 | `server/routes/owner.ts` | 263 | `analyticsService.getAllRequests()` in `/api/owner/requests` | None (full scan) | One-time | 🔴 HIGH |
| 10 | `server/services/AnalyticsService.ts` | 30 | `firebaseService.getRequests()` in `getTopProperties()` | None (full scan) | One-time | 🟡 MEDIUM |
| 11 | `server/services/AnalyticsService.ts` | 47 | `firebaseService.getRequests()` in `getDeviceDistribution()` | None (full scan) | One-time | 🟡 MEDIUM |

**Total exposure per admin dashboard load:** ALL requests read **5 times** (requests, visitors, analytics, alerts, owner).  
**Biggest problem:** `/api/track-pageview` reads ALL of them on **every public page visit**.

---

### `properties` Collection

| # | File | Line | Pattern | Constraints | Type | Priority |
|---|------|------|---------|------------|------|----------|
| 1 | `server/firebaseService.ts` | 76 | `this.db.collection("properties").get()` | None | One-time | 🔴 HIGH |
| 2 | `server/firebaseService.ts` | 81 | `this.db.collection("properties").doc(propertyNumber).get()` | Single doc | One-time | 🟢 LOW |
| 3 | `server/storage.ts` | 140-141 | `col.get()` (full collection) | None | One-time | 🔴 HIGH |
| 4 | `server/storage.ts` | 146-147 | `col.where('propertyNumber', '==', propertyNumber).limit(1).get()` | where + limit(1) | One-time | 🟢 LOW |
| 5 | `server/routes/properties.ts` | 15 | `propertyService.getAll()` in `GET /api/properties` (public) | None (full scan) | One-time | 🔴 HIGH |
| 6 | `server/routes/admin/properties.ts` | 27 | `propertyService.getAll()` in `GET /api/admin/properties` | None (full scan) | One-time | 🔴 HIGH |
| 7 | `server/routes/admin/analytics.ts` | 14,30,164,270 | `propertyService.getAll()` in analytics/alerts endpoints | None (full scan) | One-time | 🔴 HIGH |
| 8 | `server/routes/admin/payments.ts` | 55 | `propertyService.getAll()` in `GET /api/admin/payments` | None (full scan) | One-time | 🔴 HIGH |
| 9 | `server/routes/admin/subscriptions.ts` | 70 | `propertyService.getAll()` in `GET /api/admin/subscriptions` | None (full scan) | One-time | 🔴 HIGH |
| 10 | `server/routes/public.ts` | 38 | `propertyService.getAll()` in `/sitemap.xml` | None (full scan) | One-time | 🟡 MEDIUM |
| 11 | `server/scheduler.ts` | 82 | `storage.getProperties()` in daily scheduler | None (full scan) | One-time | 🟡 MEDIUM |

**Total exposure per admin dashboard load:** ALL properties read **4-5 times** across different endpoints.

---

### `payments` Collection

| # | File | Line | Pattern | Constraints | Type | Priority |
|---|------|------|---------|------------|------|----------|
| 1 | `server/firebaseService.ts` | 336 | `this.db.collection("payments").orderBy("createdAt", "desc").get()` | orderBy only, NO limit | One-time | 🔴 HIGH |
| 2 | `server/firebaseService.ts` | 341 | `this.db.collection("payments").doc(id).get()` | Single doc | One-time | 🟢 LOW |
| 3 | `server/firebaseService.ts` | 366-369 | `this.db.collection("payments").where("propertyNumber", "==", ...).get()` | where (property) | One-time | 🟢 LOW |
| 4 | `server/storage.ts` | 409-410 | `col.orderBy('createdAt', 'desc').get()` | orderBy only, NO limit | One-time | 🔴 HIGH |
| 5 | `server/routes/admin/payments.ts` | 54 | `paymentService.getAll()` in `GET /api/admin/payments` | None (full scan) | One-time | 🔴 HIGH |
| 6 | `server/routes/admin/analytics.ts` | 269 | `paymentService.getAll()` in `/api/admin/alerts` | None (full scan) | One-time | 🔴 HIGH |
| 7 | `server/firebaseService.ts` | 818 | `getPayments()` inside `calculateMonthlyProfits()` | None (full scan) | One-time | 🔴 HIGH |
| 8 | `server/firebaseService.ts` | 843 | `getPayments()` inside `getProfitsSummary()` | None (full scan) | One-time | 🔴 HIGH |
| 9 | `server/scheduler.ts` | 303 | `firebaseService.getPayments()` in `expireOldPendingPayments()` — runs every 15 min | None (full scan) | One-time | 🔴 CRITICAL |

**Total daily exposure:** Scheduler reads ALL payments **96 times/day** (every 15 min). Admin dashboard adds more. `calculateMonthlyProfits` and `getProfitsSummary` each do a full scan.

---

### `subscriptions` Collection

| # | File | Line | Pattern | Constraints | Type | Priority |
|---|------|------|---------|------------|------|----------|
| 1 | `server/firebaseService.ts` | 140 | `this.db.collection("subscriptions").get()` | None | One-time | 🔴 HIGH |
| 2 | `server/firebaseService.ts` | 146-148 | `.collection("subscriptions").where("propertyNumber", "==", ...).get()` | where (property) | One-time | 🟢 LOW |
| 3 | `server/firebaseService.ts` | 236-238 | `.collection("subscriptions").where("propertyNumber", "==", ...).orderBy("startDate", "desc").get()` | where + orderBy | One-time | 🟢 LOW |
| 4 | `server/firebaseService.ts` | 272-274 | `.collection("subscriptions").where("propertyNumber", "==", ...).where("status", "in", [...]).get()` | 2x where | One-time | 🟢 LOW |
| 5 | `server/firebaseService.ts` | 1218-1219 | `.collection("subscriptions").where("propertyNumber", "==", ...).limit(1).get()` | where + limit(1) | One-time | 🟢 LOW |
| 6 | `server/storage.ts` | 241-242 | `col.get()` (full collection) | None | One-time | 🔴 HIGH |
| 7 | `server/storage.ts` | 247-249 | `col.where('propertyNumber', '==', ...).get()` | where (property) | One-time | 🟢 LOW |
| 8 | `server/routes/admin/subscriptions.ts` | 68 | `subscriptionService.getAll()` in `GET /api/admin/subscriptions` | None (full scan) | One-time | 🔴 HIGH |
| 9 | `server/routes/admin/analytics.ts` | 268-269 | `subscriptionService.getAll()` in `/api/admin/alerts` | None (full scan) | One-time | 🔴 HIGH |
| 10 | `server/scheduler.ts` | 81 | `storage.getSubscriptions()` in daily scheduler | None (full scan) | One-time | 🟡 MEDIUM |
| 11 | `server/routes/admin/analytics.ts` | 91 | `subscriptionService.getAll()` in test-expired-notifications | None (full scan) | One-time | 🟡 MEDIUM |

---

### `suggestions` Collection

| # | File | Line | Pattern | Constraints | Type | Priority |
|---|------|------|---------|------------|------|----------|
| 1 | `server/firebaseService.ts` | 436 | `this.db.collection("suggestions").orderBy("createdAt", "desc").get()` | orderBy only, NO limit | One-time | 🟡 MEDIUM |
| 2 | `server/storage.ts` | 387-388 | `col.orderBy('createdAt', 'desc').get()` | orderBy only, NO limit | One-time | 🟡 MEDIUM |
| 3 | `server/routes/admin/analytics.ts` | 272 | `firebaseService.getSuggestions()` in `/api/admin/alerts` | None (full scan) | One-time | 🟡 MEDIUM |

---

### `fee_configs` Collection

| # | File | Line | Pattern | Constraints | Type | Priority |
|---|------|------|---------|------------|------|----------|
| 1 | `server/firebaseService.ts` | 606 | `this.db.collection("fee_configs").get()` — `getFeeConfigs()` | None | One-time | 🟡 MEDIUM |
| 2 | `server/firebaseService.ts` | 611 | `this.db.collection("fee_configs").doc(id).get()` | Single doc | One-time | 🟢 LOW |
| 3 | `server/firebaseService.ts` | 636 | `this.db.collection("fee_configs").get()` — in `removeDuplicateFeeConfigs()` | None | One-time | 🟡 MEDIUM |
| 4 | `server/firebaseService.ts` | 843-845 | `getFeeConfigs()` inside `getProfitsSummary()` | None (cascaded) | One-time | 🟡 MEDIUM |
| 5 | `server/routes/admin/finance.ts` | 203 | `financeService.getFeeConfigs()` in `GET /api/admin/fee-configs` | None (full scan) | One-time | 🟡 MEDIUM |

---

### `discounts` Collection

| # | File | Line | Pattern | Constraints | Type | Priority |
|---|------|------|---------|------------|------|----------|
| 1 | `server/firebaseService.ts` | 398 | `this.db.collection("discounts").where("isActive", "==", true).get()` | where (isActive) | One-time | 🟢 LOW |
| 2 | `server/firebaseService.ts` | 403 | `this.db.collection("discounts").get()` — `getAllDiscountCodes()` | None | One-time | 🟡 MEDIUM |
| 3 | `server/firebaseService.ts` | 415 | `.where("code", "==", code).limit(1).get()` | where + limit(1) | One-time | 🟢 LOW |
| 4 | `server/firebaseService.ts` | 418 | `.doc(code).get()` — fallback | Single doc | One-time | 🟢 LOW |
| 5 | `server/storage.ts` | 325-326 | `col.get()` (full collection) | None | One-time | 🟡 MEDIUM |
| 6 | `server/routes/admin/finance.ts` | 74 | `firebaseService.getAllDiscountCodes()` in `GET /api/admin/discounts` | None (full scan) | One-time | 🟡 MEDIUM |

---

### `packages` Collection

| # | File | Line | Pattern | Constraints | Type | Priority |
|---|------|------|---------|------------|------|----------|
| 1 | `server/firebaseService.ts` | 288 | `.where("isActive", "==", true).get()` — `getPackages()` | where (isActive) | One-time | 🟢 LOW |
| 2 | `server/firebaseService.ts` | 296 | `.doc(id).get()` | Single doc | One-time | 🟢 LOW |
| 3 | `server/firebaseService.ts` | 313 | `this.db.collection("packages").get()` — `getAllPackages()` | None | One-time | 🟡 MEDIUM |
| 4 | `server/storage.ts` | 292-293 | `col.get()` (full collection) | None | One-time | 🟡 MEDIUM |
| 5 | `server/routes/admin/packages.ts` | 14 | `firebaseService.getAllPackages()` | None (full scan) | One-time | 🟡 MEDIUM |
| 6 | `server/routes/public.ts` | 338 | `subscriptionService.getPackages()` (uses where isActive) | Constrained | One-time | 🟢 LOW |

---

## OTHER COLLECTIONS WITH FULL READS

| Collection | File | Line | Pattern | Constraints | Priority |
|-----------|------|------|---------|-------------|----------|
| `expenses` | `firebaseService.ts` | 667 | `.collection("expenses").get()` | None | 🟡 MEDIUM |
| `bank_accounts` | `firebaseService.ts` | 712 | `.collection("bank_accounts").get()` | None | 🟢 LOW |
| `feature_flags` | `firebaseService.ts` | 749 | `.collection("feature_flags").get()` | None | 🟢 LOW |
| `partner_profits` | `firebaseService.ts` | 778 | `.collection("partner_profits").orderBy("monthYear", "desc").get()` | orderBy, no limit | 🟡 MEDIUM |
| `whatsapp_logs` | `firebaseService.ts` | 959 | `.collection("whatsapp_logs").orderBy("createdAt", "desc").get()` | orderBy, no limit | 🟡 MEDIUM |
| `verification_logs` | `firebaseService.ts` | 968 | `.collection("verification_logs").orderBy("date", "desc").get()` | orderBy, no limit | 🟡 MEDIUM |
| `property_addons` | `firebaseService.ts` | 529 | `.collection("property_addons").get()` | None | 🟡 MEDIUM |
| `addon_packages` | `firebaseService.ts` | 574 | `.collection("addon_packages").get()` | None | 🟢 LOW |
| `ocr_results` | `firebaseService.ts` | 1192 | `.collection("ocr_results").get()` | None | 🟢 LOW |
| `blog_posts` | `firebaseService.ts` | 456 | `.collection("blog_posts").get()` (when not onlyPublished) | None | 🟡 MEDIUM |
| `multi_property_subscriptions` | `firebaseService.ts` | 244 | `.collection("multi_property_subscriptions").orderBy("createdAt", "desc").get()` | orderBy, no limit | 🟢 LOW |
| `profits` | `storage.ts` | 357 | `col.get()` (full collection) | None | 🟡 MEDIUM |

---

## `onSnapshot` ANALYSIS

**Finding: Zero onSnapshot listeners in application code.**

All matches for `onSnapshot` were in the bundled frontend file (`public/assets/index-CMLX-Mdk.js`) and are unrelated to Firestore — they come from a floating-point/UI library. The project uses **exclusively one-time `.get()` reads** via the Firebase Admin SDK.

---

## READ AMPLIFICATION HOTSPOTS

### Hotspot 1: Admin Dashboard Load
When an admin opens the dashboard, the frontend fires these API calls (each doing `useQuery`):

| Endpoint | Collections Read (full) | Reads per call |
|----------|------------------------|----------------|
| `GET /api/admin/alerts` | subscriptions + payments + requests + properties + suggestions + property_addons | 6 collections |
| `GET /api/admin/properties` | properties | 1 collection |
| `GET /api/admin/payments` | payments + properties | 2 collections |
| `GET /api/admin/subscriptions` | subscriptions + properties + packages | 3 collections |
| `GET /api/admin/requests` | requests + properties | 2 collections |
| `GET /api/admin/analytics` | requests + properties | 2 collections |
| `GET /api/admin/partner-profits/summary` | payments + fee_configs + expenses | 3 collections |
| `GET /api/admin/discounts` | discounts | 1 collection |
| `GET /api/admin/fee-configs` | fee_configs | 1 collection |
| `GET /api/admin/bank-accounts` | bank_accounts | 1 collection |
| `GET /api/admin/feature-flags` | feature_flags | 1 collection |

**Total: ~23 full collection reads per admin page load.**  
If average collection has 50 docs → **~1,150 Firestore reads per admin dashboard visit.**

### Hotspot 2: `/api/track-pageview` (PUBLIC)
- Reads **entire `requests` collection** for de-duplication
- Called on every public page visit
- If requests has 500 docs and there are 100 page views/day = **50,000 reads/day**

### Hotspot 3: Scheduler (runs continuously)
- **Every 15 minutes:** `getPayments()` full collection read + `getFeatureFlag()` (1 read)
- **Daily at noon:** `getSubscriptions()` + `getProperties()` + `getWhatsAppLogs()` + `getAllPropertyAddOns()` + `getPayments()` — 5 full collection reads + per-subscription inner reads

### Hotspot 4: Owner Dashboard
When an owner logs in, these endpoints are called:

| Endpoint | Collections Read | Notes |
|----------|-----------------|-------|
| `GET /api/owner/analytics` | ALL requests + analytics doc | Full scan of requests |
| `GET /api/owner/requests` | ALL requests | Full scan, then filter by property |
| `GET /api/owner/payments` | payments (where propertyNumber) | ✅ Constrained |
| `GET /api/owner/current-subscription` | subscriptions (where propertyNumber) | ✅ Constrained |
| `GET /api/owner/addons` | ALL addon_packages | Full scan |
| `GET /api/owner/property-addons` | property_addons (where propertyNumber) | ✅ Constrained |

**Key issue:** `/api/owner/analytics` and `/api/owner/requests` each read ALL requests just to filter for one property.

---

## ESTIMATED DAILY READ BREAKDOWN

Assuming: ~50 properties, ~50 subscriptions, ~200 payments, ~500 requests, ~20 other small collections

| Source | Calculation | Est. Reads/Day |
|--------|------------|----------------|
| `/api/track-pageview` (100 views/day × 500 requests) | 100 × 500 | **50,000** |
| Scheduler (96 runs × ~200 payments) | 96 × 200 | **~19,200** |
| Admin dashboard (5 loads/day × 1,150 reads) | 5 × 1,150 | **~5,750** |
| Owner dashboards (10 logins/day × 500+500 requests) | 10 × 1,000 | **~10,000** |
| Scheduler daily (subscriptions+properties+whatsapp+addons+payments) | 1 × ~820 | **~820** |
| Public API calls (properties, packages) | ~50 × 70 | **~3,500** |
| Other admin section loads | ~20 × 100 | **~2,000** |
| **TOTAL ESTIMATE** | | **~63,000+** |

---

## PRIORITY FIXES (Recommended)

### 🔴 P0 — Fix Immediately (saves ~50K reads/day)

1. **`/api/track-pageview`** — Do NOT read all requests. Use an in-memory cache or dedicated collection/counter instead of scanning all requests to check last visit.

2. **Owner analytics/requests endpoints** — Add `.where("propertyNumber", "==", propertyNumber)` to the Firestore query instead of fetching ALL and filtering in JS.

### 🔴 P1 — Fix Soon (saves ~19K reads/day)

3. **`expireOldPendingPayments()`** — Add `.where("status", "in", ["قيد المراجعة", "قيد التحقق"]).get()` instead of reading ALL payments. Most payments don't need checking.

4. **Scheduler daily run** — Cache properties and subscriptions in memory, or add date-based `.where()` constraints.

### 🟡 P2 — Optimize (saves ~5K reads/day)

5. **Admin dashboard** — Implement server-side caching (e.g., 5-minute TTL cache) for `getProperties()`, `getSubscriptions()`, `getPayments()`, `getRequests()` so multiple admin endpoints share one read.

6. **`getProfitsSummary()`** — Add date range `.where()` constraints instead of reading all payments/expenses.

7. **Admin alerts endpoint** — Use aggregation or cached summaries instead of 6 parallel full collection scans.

### 🟢 P3 — Nice to Have

8. Add `.limit()` to all `orderBy`-only queries (suggestions, whatsapp_logs, verification_logs, partner_profits).
9. Use `getCountFromServer()` where only counts are needed instead of fetching all documents.
10. Use Firestore composite indexes + pagination for admin list views.
