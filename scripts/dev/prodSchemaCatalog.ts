/**
 * Production schema catalog (structure only, no production data).
 *
 * The field names below were captured with a READ-ONLY service account against
 * the production project `rwqan-757` (listCollections + Object.keys on up to 3
 * sampled documents per collection). No field values, credentials, phone
 * numbers, OTPs, sessions, receipts or payment data were read or copied.
 *
 * Purpose: keep the DEV project (`rwqan-sa-dev`) structurally aligned with
 * production so features can be exercised on TEST without importing any
 * production data.
 *
 * Ownership classes:
 *  - "seeded"  : this catalog seeds safe synthetic documents into DEV.
 *  - "e2e"     : covered by scripts/dev/e2e-test-data.ts (existing seed).
 *  - "runtime" : created on demand by the application; never pre-seeded.
 */
export type SchemaParityClass = "seeded" | "e2e" | "runtime";

export interface ProdCollectionSchema {
  readonly collection: string;
  /** Canonical production field names (top-level only). */
  readonly fields: readonly string[];
  readonly parity: SchemaParityClass;
  /** Safe synthetic documents used only when parity === "seeded". */
  readonly sampleDocs?: ReadonlyArray<{ id: string; data: Record<string, unknown> }>;
  /** Verified production-vs-code differences that must not be "fixed" in code. */
  readonly note?: string;
}

const PARITY_MARKER = { testData: true, schemaParitySeed: true } as const;
const ISO = "2026-01-01T00:00:00.000Z";
const DAY = "2026-01-01";

export const PROD_SCHEMA: readonly ProdCollectionSchema[] = [
  {
    collection: "settings",
    fields: [
      "allNotifications", "customerDailyLimit", "customerFollowUpDelayMinutes",
      "freeOwnerDailyLimit", "freePropertyContactDailyLimit", "newPayment",
      "newProperty", "newSubscription", "optionalCommissionReminderDays",
      "propertyUpdate", "propertyVerification", "receiptUpload", "schemaVersion",
      "smartRequest", "subscriptionExpired", "subscriptionRenewal", "updatedAt",
      "updatedBy", "whatsappTemplates",
    ],
    parity: "seeded",
    sampleDocs: [
      {
        id: "notification_settings",
        data: {
          allNotifications: true, newProperty: true, newSubscription: true,
          subscriptionRenewal: true, receiptUpload: true, propertyUpdate: true,
          newPayment: true, smartRequest: true, propertyVerification: true,
          subscriptionExpired: true, updatedAt: ISO, ...PARITY_MARKER,
        },
      },
      {
        id: "booking_free_workflow_limits",
        data: {
          schemaVersion: 1, customerDailyLimit: 3, freeOwnerDailyLimit: 3,
          freePropertyContactDailyLimit: 3, customerFollowUpDelayMinutes: 1440,
          optionalCommissionReminderDays: [3, 4],
          updatedAt: ISO, updatedBy: "schema-parity-seed", ...PARITY_MARKER,
        },
      },
    ],
  },
  {
    collection: "fee_configs",
    fields: ["fixedFee", "id", "isActive", "isLocal", "name", "nameEn", "percentage", "updatedAt", "vatRate"],
    parity: "seeded",
    sampleDocs: [
      { id: "fee-test-mada", data: { id: "fee-test-mada", name: "مدى", nameEn: "Mada", percentage: 1, fixedFee: 1, vatRate: 15, isActive: true, isLocal: true, updatedAt: ISO, ...PARITY_MARKER } },
      { id: "fee-test-visa-local", data: { id: "fee-test-visa-local", name: "فيزا محلي", nameEn: "Visa Local", percentage: 2.7, fixedFee: 1, vatRate: 15, isActive: true, isLocal: true, updatedAt: ISO, ...PARITY_MARKER } },
    ],
  },
  {
    collection: "expenses",
    fields: ["amount", "category", "createdAt", "date", "description", "expenseType", "id", "isActive", "title"],
    parity: "seeded",
    note: "PROD baseline lacks the distributed-expense fields (durationMonths/startDate/endDate/monthlyAmount) that current code writes for expenseType='موزعة'.",
    sampleDocs: [
      { id: "EXP-TEST-1", data: { id: "EXP-TEST-1", title: "مصروف اختبار DEV", amount: 100, category: "أخرى", description: "سجل اصطناعي للتوافق البنيوي", date: DAY, expenseType: "مرة واحدة", isActive: true, createdAt: ISO, ...PARITY_MARKER } },
    ],
  },
  {
    collection: "partner_profits",
    fields: ["activeSubscriptions", "createdAt", "id", "monthYear", "netProfitAfterExpenses", "partnerPercentage", "partnerShare", "totalExpenses", "totalRevenue", "transferStatus"],
    parity: "seeded",
    sampleDocs: [
      { id: "PP-TEST-1", data: { id: "PP-TEST-1", monthYear: "2026/01", activeSubscriptions: 1, totalRevenue: 100, partnerShare: 50, partnerPercentage: 50, totalExpenses: 0, netProfitAfterExpenses: 50, transferStatus: "pending", createdAt: ISO, ...PARITY_MARKER } },
    ],
  },
  {
    collection: "multi_property_subscriptions",
    fields: ["additionalProperties", "createdAt", "endDate", "id", "linkedProperties", "packageId", "paymentId", "propertyCount", "propertyNumber1", "propertyNumber2", "startDate", "status", "updatedAt"],
    parity: "seeded",
    sampleDocs: [
      { id: "MPS-TEST-1", data: { id: "MPS-TEST-1", packageId: "E2E_TEST_PKG_2PROP", propertyNumber1: "90001", propertyNumber2: "90002", additionalProperties: [], linkedProperties: ["90001", "90002"], propertyCount: 2, startDate: ISO, endDate: ISO, status: "نشط", createdAt: ISO, updatedAt: ISO, ...PARITY_MARKER } },
    ],
  },
  {
    collection: "occasions",
    fields: ["createdAt", "days", "description", "endDate", "id", "isActive", "name", "slug", "startDate", "theme", "type", "updatedAt"],
    parity: "seeded",
    sampleDocs: [
      { id: "occ-test-eid", data: { id: "occ-test-eid", name: "مناسبة اختبار DEV", slug: "dev-test-occasion", type: "custom", startDate: ISO, endDate: ISO, days: [{ key: "day1", label: "اليوم الأول", date: DAY }], isActive: false, theme: "default", description: "مناسبة اصطناعية", createdAt: ISO, updatedAt: ISO, ...PARITY_MARKER } },
    ],
  },
  {
    collection: "occasion_properties",
    fields: ["addedBy", "approvedByAdmin", "availability", "createdAt", "id", "occasionId", "prices", "propertyNumber", "updatedAt"],
    parity: "seeded",
    sampleDocs: [
      { id: "occ-test-eid-90003", data: { id: "occ-test-eid-90003", occasionId: "occ-test-eid", propertyNumber: "90003", availability: { day1: true }, prices: { day1: "500" }, addedBy: "admin", approvedByAdmin: true, createdAt: ISO, updatedAt: ISO, ...PARITY_MARKER } },
    ],
  },
  {
    collection: "property_seo",
    fields: ["keywords", "metaTitle", "propertyNumber", "seoDescription", "updatedAt"],
    parity: "seeded",
    sampleDocs: [
      { id: "90003", data: { propertyNumber: "90003", seoDescription: "وصف اختبار DEV", metaTitle: "عنوان اختبار DEV", keywords: ["اختبار"], updatedAt: ISO, ...PARITY_MARKER } },
    ],
  },
  {
    collection: "property_addons",
    fields: ["addOnPackageId", "createdAt", "createdBy", "endDate", "id", "paymentId", "propertyNumber", "startDate", "status"],
    parity: "seeded",
    note: "PROD baseline lacks `source`/`updatedAt` written by current code (propertyAddOnSchema).",
    sampleDocs: [
      { id: "ADDON-TEST-1", data: { id: "ADDON-TEST-1", propertyNumber: "90003", addOnPackageId: "ADDONPKG-TEST-1", status: "active", startDate: ISO, endDate: ISO, createdBy: "admin", createdAt: ISO, ...PARITY_MARKER } },
    ],
  },
  {
    collection: "addon_packages",
    fields: ["category", "createdAt", "description", "duration", "durationDays", "id", "isActive", "name", "price", "updatedAt"],
    parity: "seeded",
    sampleDocs: [
      { id: "ADDONPKG-TEST-1", data: { id: "ADDONPKG-TEST-1", name: "إضافة اختبار DEV", description: "إضافة اصطناعية", price: 10, duration: 30, durationDays: 30, category: "اعلان", isActive: true, createdAt: ISO, updatedAt: ISO, ...PARITY_MARKER } },
    ],
  },
  {
    collection: "addon_history",
    fields: ["action", "addOnPackageId", "createdAt", "createdBy", "id", "notes", "propertyNumber", "timestamp"],
    parity: "seeded",
    sampleDocs: [
      { id: "ADDONHIST-TEST-1", data: { id: "ADDONHIST-TEST-1", propertyNumber: "90003", addOnPackageId: "ADDONPKG-TEST-1", action: "activated", timestamp: ISO, notes: "سجل اختبار", createdBy: "system", createdAt: ISO, ...PARITY_MARKER } },
    ],
  },
  {
    collection: "addon_logs",
    fields: ["action", "addOnPackageId", "id", "notes", "propertyNumber", "timestamp"],
    parity: "seeded",
    sampleDocs: [
      { id: "ADDONLOG-TEST-1", data: { id: "ADDONLOG-TEST-1", propertyNumber: "90003", addOnPackageId: "ADDONPKG-TEST-1", action: "activated", notes: "سجل اختبار", timestamp: ISO, ...PARITY_MARKER } },
    ],
  },
  {
    collection: "suggestions",
    fields: ["city", "createdAt", "id", "name", "phone", "suggestion"],
    parity: "seeded",
    note: "PROD rows predate the optional `status` field written by current code (defaults to 'جديد').",
    sampleDocs: [
      { id: "SUG-TEST-1", data: { id: "SUG-TEST-1", name: "مقترح اختبار", phone: "966000000000", city: "بريدة", suggestion: "اقتراح اصطناعي للتوافق البنيوي", createdAt: ISO, ...PARITY_MARKER } },
    ],
  },
  {
    collection: "verification_logs",
    fields: ["action", "admin", "date", "propertyNumber", "reason"],
    parity: "seeded",
    sampleDocs: [
      { id: "VERIF-TEST-1", data: { propertyNumber: "90003", action: "approved", reason: "توثيق اختبار DEV", admin: "admin-test", date: ISO, ...PARITY_MARKER } },
    ],
  },
  {
    collection: "ocr_results",
    fields: ["confidence", "createdAt", "extractedAmount", "extractedDate", "extractedIban", "extractedReference", "fullText", "paymentId"],
    parity: "seeded",
    note: "PROD contains legacy rows with `fullText`; current code writes `rawText` (shared/schema.ts ocrResultSchema). Both coexist in PROD.",
    sampleDocs: [
      { id: "OCR-TEST-1", data: { paymentId: "PAY-TEST-OCR-1", extractedAmount: 100, extractedDate: DAY, extractedIban: "TEST-IBAN-PLACEHOLDER", extractedReference: "TEST-REF", confidence: 99, fullText: "نص اختبار اصطناعي", createdAt: ISO, ...PARITY_MARKER } },
    ],
  },
  {
    collection: "whatsapp_notifications",
    fields: ["apiResponse", "createdAt", "id", "message", "ownerPhone", "propertyName", "propertyNumber", "status", "type"],
    parity: "seeded",
    sampleDocs: [
      { id: "WANOTIF-TEST-1", data: { id: "WANOTIF-TEST-1", propertyNumber: "90003", propertyName: "عقار اختبار الحجز", ownerPhone: "966000000000", type: "test", message: "رسالة اختبار اصطناعية", status: "success", apiResponse: "TEST", createdAt: ISO, ...PARITY_MARKER } },
    ],
  },
  {
    collection: "bank_accounts",
    fields: ["accountNumber", "bankName", "beneficiaryName", "createdAt", "iban", "id", "isActive", "isDefault"],
    parity: "seeded",
    sampleDocs: [
      { id: "BANK-TEST-1", data: { id: "BANK-TEST-1", bankName: "بنك اختبار", beneficiaryName: "مستفيد اختبار", iban: "TEST-IBAN-PLACEHOLDER", accountNumber: "TEST-ACCOUNT", isActive: true, isDefault: true, createdAt: ISO, ...PARITY_MARKER } },
    ],
  },
  {
    collection: "blog_posts",
    fields: ["author", "content", "coverImage", "createdAt", "excerpt", "id", "keywords", "metaDescription", "metaTitle", "slug", "status", "title", "updatedAt"],
    parity: "seeded",
    sampleDocs: [
      { id: "BLOG-TEST-1", data: { id: "BLOG-TEST-1", title: "مقال اختبار DEV", slug: "dev-test-post", excerpt: "مقتطف", content: "محتوى اختبار", coverImage: "", metaTitle: "عنوان", metaDescription: "وصف", keywords: ["اختبار"], author: "روقان", status: "مسودة", createdAt: ISO, updatedAt: ISO, ...PARITY_MARKER } },
    ],
  },
  {
    collection: "backups",
    fields: ["autoBackup", "backupData", "backupName", "backupType", "completedAt", "createdAt", "dataTypes", "description", "filesCount", "id", "sizeInMB", "status"],
    parity: "seeded",
    sampleDocs: [
      { id: "BK-TEST-1", data: { id: "BK-TEST-1", backupType: "جزئي", backupName: "نسخة اختبار DEV", status: "مكتمل", dataTypes: ["properties"], filesCount: 0, sizeInMB: 0, backupData: {}, autoBackup: false, description: "نسخة اصطناعية", createdAt: ISO, completedAt: ISO, ...PARITY_MARKER } },
    ],
  },
  {
    collection: "maintenance_backups",
    fields: ["childPropertyNumber", "createdAt", "id", "kind", "mainPropertyNumber", "multi", "multiPropertySubscriptions", "payment", "paymentId", "properties", "propertyNumbers", "subscriptions", "type"],
    parity: "seeded",
    sampleDocs: [
      { id: "MBK-TEST-1", data: { id: "MBK-TEST-1", type: "test", kind: "test", mainPropertyNumber: "90001", childPropertyNumber: "90002", multi: false, paymentId: "PAY-TEST-1", payment: {}, properties: {}, propertyNumbers: ["90001", "90002"], subscriptions: {}, multiPropertySubscriptions: {}, createdAt: ISO, ...PARITY_MARKER } },
    ],
  },

  // ── Covered by scripts/dev/e2e-test-data.ts ────────────────────────────────
  { collection: "properties", fields: ["adminAvailabilityHold", "availabilityNote", "capacity", "city", "commissionHold", "commissionHoldOverride", "createdAt", "direction", "facilities", "imageUrls", "imagesFolderUrl", "imagesLink", "lastChanges", "lastUpdate", "linkedProperty", "location", "muteExpiryNotification", "name", "pendingPaidSubscription", "pin", "priceHolidays", "priceOvernight", "priceWeekday", "priceWeekend", "prices", "propertyNumber", "registrationPlan", "smartVerificationPassed", "smartVerificationPassedAt", "smartVerificationSource", "subscriptionDate", "subscriptionType", "type", "updatedAt", "verificationStatus", "whatsappNumber"], parity: "e2e" },
  { collection: "subscriptions", fields: ["cancelReason", "cancelledAt", "endDate", "id", "packageId", "packageType", "paymentId", "propertyCount", "propertyNumber", "remainingDurationMs", "startDate", "status", "subscriptionType", "suspendedAt", "updatedAt"], parity: "e2e" },
  { collection: "packages", fields: ["createdAt", "duration", "durationDays", "features", "id", "isActive", "name", "price", "type"], parity: "e2e" },
  { collection: "discounts", fields: ["code", "createdAt", "expiryDate", "isActive", "type", "usageCount", "value"], parity: "e2e" },
  { collection: "owners", fields: ["lastReset", "ownerId", "password", "phone", "resetCode", "resetExpire"], parity: "e2e" },
  { collection: "requests", fields: ["device", "id", "ip", "propertyName", "propertyNumber", "requestCode", "requestCount", "timestamp"], parity: "e2e", note: "PROD rows are legacy/migrated and use device/ip/requestCount; current code writes ipAddress/deviceType/dayOfWeek/hourOfDay/clientPhone/actorType/customerSubject. Both shapes coexist in PROD — code must NOT be rewritten to match the legacy rows." },
  { collection: "customer_accounts", fields: ["createdAt", "email", "favoritePropertyNumbers", "fullName", "id", "lastLoginAt", "phone", "schemaVersion", "updatedAt"], parity: "e2e" },

  // ── Runtime / security / booking-engine (application-managed) ──────────────
  { collection: "feature_flags", fields: ["description", "id", "isEnabled", "key", "name", "updatedAt"], parity: "runtime" },
  { collection: "payments", fields: ["acqFees", "action", "amount", "completedAt", "createdAt", "discountAmount", "discountCode", "feeAmount", "finalAmount", "id", "merchantFees", "netAmount", "packageId", "paymentMethod", "paymobOrderId", "pendingEndDate", "pendingPrice", "pendingStartDate", "pendingSubscriptionType", "propertyNumber", "receiptUrl", "secondPropertyNumber", "status", "totalFees", "transactionId", "vatAmount"], parity: "runtime" },
  { collection: "whatsapp_logs", fields: ["createdAt", "id", "message", "phone", "propertyName", "propertyNumber", "response", "status", "type"], parity: "runtime" },
  { collection: "server_sessions", fields: ["data", "expiresAtMillis", "expiresAtTtl", "updatedAt"], parity: "runtime" },
  { collection: "admin_login_attempt_limits", fields: ["attemptCount", "expiresAtTtl", "updatedAt", "windowStartedAt"], parity: "runtime" },
  { collection: "owner_login_attempt_limits", fields: ["attempts", "expiresAtTtl", "schemaVersion", "scope", "updatedAt", "windowStartedAt"], parity: "runtime" },
  { collection: "contact_ip_rate_limits", fields: ["acceptedCount", "expiresAtTtl", "updatedAt", "windowStartedAt"], parity: "runtime" },
  { collection: "contact_property_daily_limits", fields: ["acceptedCount", "expiresAtTtl", "propertyNumber", "updatedAt", "windowEndsAt", "windowStartedAt"], parity: "runtime" },
  { collection: "contact_request_attempt_limits", fields: ["attemptCount", "expiresAtTtl", "updatedAt", "windowStartedAt"], parity: "runtime" },
  { collection: "contact_cooldowns", fields: ["expiresAt", "lastAcceptedAt", "propertyNumber", "updatedAt"], parity: "runtime" },
  { collection: "contact_events", fields: ["actorType", "deviceType", "id", "outcome", "propertyNumber", "requestCode", "timestamp", "visitorKey"], parity: "runtime" },
  { collection: "contact_identity_sessions", fields: ["clientPhone", "createdAt", "expiresAt", "expiresAtTtl", "id", "updatedAt", "verificationVersion", "verifiedAt", "visitorId"], parity: "runtime" },
  { collection: "customer_phone_otp_challenges", fields: ["attemptCount", "codeHash", "consumedAt", "createdAt", "exhaustedAt", "expiresAt", "expiresAtTtl", "id", "maxAttempts", "phoneSubject", "schemaVersion", "updatedAt"], parity: "runtime" },
  { collection: "customer_phone_otp_issue_limits", fields: ["expiresAtTtl", "id", "issueCount", "scope", "updatedAt", "windowStartedAt"], parity: "runtime" },
  { collection: "owner_accounts", fields: ["authVersion", "createdAt", "id", "lastLoginAt", "phoneSubject", "schemaVersion", "status", "updatedAt"], parity: "runtime" },
  { collection: "owner_account_phone_indexes", fields: ["createdAt", "ownerAccountId", "phoneSubject", "schemaVersion", "updatedAt"], parity: "runtime" },
  { collection: "owner_property_memberships", fields: ["createdAt", "isPrimary", "ownerAccountId", "propertyNumber", "revokedAt", "schemaVersion", "status", "updatedAt"], parity: "runtime" },
  { collection: "owner_account_otp_challenges", fields: ["attemptCount", "codeHash", "consumedAt", "createdAt", "exhaustedAt", "expiresAt", "expiresAtTtl", "id", "maxAttempts", "ownerAccountId", "phoneSubject", "propertyNumber", "purpose", "schemaVersion", "updatedAt"], parity: "runtime" },
  { collection: "owner_account_otp_issue_limits", fields: ["expiresAtTtl", "id", "issueCount", "scope", "updatedAt", "windowStartedAt"], parity: "runtime" },
  { collection: "booking_commission_transaction_bindings", fields: ["attemptId", "bookingId", "createdAt", "success", "transactionId"], parity: "runtime" },
  { collection: "booking_customer_followup_states", fields: ["campaignEndsAt", "campaignId", "campaignStartedAt", "createdAt", "customerSubject", "effectiveLimitScope", "finalReminderJobId", "finalReminderSentAt", "propertyOrdinarySlotsReserved", "schemaVersion", "sharedOrdinarySlotsReserved", "updatedAt"], parity: "runtime" },
  { collection: "booking_followups", fields: ["activeAttemptId", "activeCustomerNotificationJobId", "adminCustomerWhatsAppLastOpenedAt", "bookingDecision", "bookingStatus", "commissionAmountHalalas", "commissionDueAt", "commissionNoticeSentAt", "commissionPaidAt", "commissionReminderOffsetsSent", "commissionStatus", "complianceStatus", "confirmationFacts", "confirmedAt", "contactRequestId", "createdAt", "customerFollowUpDelayMinutes", "customerFollowUpMessageLimit", "customerPhone", "customerSubject", "declinedAt", "disputeReason", "disputeStatus", "disputedAt", "enforcementDeferredUntil", "enforcementLastError", "enforcementLeaseExpiresAt", "enforcementLeaseToken", "events", "followUpDueAt", "freeEligibilityRevokedAt", "id", "isFreeProperty", "listedPriceOptionsHalalas", "ownerPhone", "paidAttemptId", "propertyName", "propertyNumber", "questionnaireStartedAt", "requestCode", "schemaVersion", "updatedAt"], parity: "runtime" },
  { collection: "booking_free_workflow_limits_audit", fields: ["id", "next", "previous", "type", "updatedAt", "updatedBy"], parity: "runtime" },
  { collection: "booking_notification_manual_resend_audit", fields: ["bookingId", "id", "notificationKind", "requestedAt", "requestedBy", "resendJobId", "schemaVersion", "sourceJobId", "type"], parity: "runtime" },
  { collection: "booking_notification_outbox", fields: ["attempts", "bookingId", "claimedAt", "createdAt", "failedAt", "id", "isFreeProperty", "kind", "leaseExpiresAt", "leaseToken", "propertyNumber", "providerError", "quotaCategory", "recipientPhone", "recipientQuotaKey", "recipientRole", "reminderOffsetDays", "scheduledAt", "sentAt", "status", "suppressedAt", "updatedAt"], parity: "runtime" },
  { collection: "booking_notification_quotas", fields: ["category", "count", "expiresAtTtl", "recipientQuotaKey", "recipientRole", "updatedAt", "windowEndsAt", "windowStartedAt"], parity: "runtime" },
  { collection: "booking_short_links", fields: ["createdAt", "expiresAt", "expiresAtTtl", "purpose", "schemaVersion", "token"], parity: "runtime" },
];

export const PROD_COLLECTION_NAMES: readonly string[] = PROD_SCHEMA.map((entry) => entry.collection);

export const SEEDED_COLLECTIONS: readonly string[] = PROD_SCHEMA
  .filter((entry) => entry.parity === "seeded")
  .map((entry) => entry.collection);

export function getSchemaEntry(collection: string): ProdCollectionSchema | undefined {
  return PROD_SCHEMA.find((entry) => entry.collection === collection);
}

/**
 * Collections the application creates lazily that were NOT present in the
 * production probe. They are runtime-only and must never be pre-seeded (they
 * hold security/limit state), so they are tracked outside PROD_SCHEMA to keep
 * the "54 verified production collections" invariant exact.
 *
 * `payment_action_locks` is intentionally absent: it is referenced only by test
 * doubles / legacy scripts, not by shipped server code.
 */
export const CODE_ONLY_RUNTIME_COLLECTIONS: ReadonlyArray<{
  collection: string;
  fields: readonly string[];
  note: string;
}> = [
  {
    collection: "contact_identity_issue_limits",
    fields: ["expiresAtTtl", "id", "issueCount", "updatedAt", "windowStartedAt"],
    note: "Created on demand by consumeContactIdentityIssueLimit (firebaseService.ts:4659). Absent from the PROD probe because PROD has not hit the identity issue limit yet; also TTL-cleaned via deleteExpiredEphemeralSecurityData.",
  },
];

export const PROD_ALIGNED_COLLECTION_NAMES: readonly string[] = [
  ...PROD_COLLECTION_NAMES,
  ...CODE_ONLY_RUNTIME_COLLECTIONS.map((entry) => entry.collection),
];
