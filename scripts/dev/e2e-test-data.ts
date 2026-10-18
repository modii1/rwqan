/**
 * DEV-ONLY E2E test-data system.
 *
 * Safety contract (enforced at runtime, not by convention):
 *  - Refuses to run unless NODE_ENV=development.
 *  - Refuses to run unless the Firebase project is exactly `rwqan-sa-dev`.
 *  - Refuses to run unless the R2 bucket is exactly `rwqan-sa-dev`.
 *  - Refuses to run when external services are enabled.
 *  - Never touches production ids/credentials.
 *  - Idempotent: fixed document ids, deterministic content, re-running overwrites.
 *  - Every record is clearly marked as synthetic (`testData: true` + `E2E_TEST_` label).
 *
 * NOTE: the owner-login UI accepts only a 5-digit property number, so the login
 * fixtures use an isolated synthetic block (90001-90003) and every record carries
 * the E2E_TEST_ marker so cleanup can find them precisely.
 */
import "../../server/config/loadEnv";
import { db } from "../../server/config/firebase";
import { hashPassword } from "../../server/utils/password";
import {
  assertDevelopmentIsolation,
  assertFirebaseDevIsolation,
  externalServicesEnabled,
  getFirebaseProjectId,
} from "../../server/config/runtimeEnvironment";
import { assertR2DevIsolation } from "../../server/utils/r2";
import { createCustomerSubject } from "../../server/utils/customerSubject";

export const E2E_PREFIX = "E2E_TEST_";
export const E2E_DEV_PROJECT_ID = "rwqan-sa-dev";
export const E2E_DEV_R2_BUCKET = "rwqan-sa-dev";

/**
 * Registry of the synthetic DEV logins for manual testing. Non-secret metadata
 * only; never stores credentials. Admin credentials are env-backed
 * (ADMIN_CODE/ADMIN_PASSWORD from .env.development.local) and are NOT persisted.
 * The customer login is OTP (WhatsApp) based and is BLOCKED in DEV.
 */
export const E2E_TEST_USERS_COLLECTION = "test_users";
export const CUSTOMER_ACCOUNTS_COLLECTION = "customer_accounts";

export const E2E_ADMIN_USER_ID = `${E2E_PREFIX}USER_ADMIN`;
export const E2E_CUSTOMER_USER_ID = `${E2E_PREFIX}USER_CUSTOMER_1`;

/** Synthetic customer phone used only for a DEV customer_accounts record. */
export const E2E_CUSTOMER_PHONE = "966500000001";
export const E2E_CUSTOMER_LABEL = `${E2E_PREFIX}CUSTOMER_1`;

export type E2EPersona = {
  propertyNumber: string;
  pin: string;
  ownerLabel: string;
};

export const E2E_PERSONAS = {
  /** Owner with an active premium subscription. */
  ownerPrimary: { propertyNumber: "90001", pin: "511111", ownerLabel: `${E2E_PREFIX}OWNER_1` },
  /** Owner whose subscription is expired. */
  ownerExpired: { propertyNumber: "90002", pin: "522222", ownerLabel: `${E2E_PREFIX}OWNER_2` },
  /** Public property available for booking flows. */
  bookingProperty: { propertyNumber: "90003", pin: "533333", ownerLabel: `${E2E_PREFIX}BOOKING_1` },
} as const satisfies Record<string, E2EPersona>;

export const E2E_PACKAGE_IDS = {
  oneProperty: `${E2E_PREFIX}PKG_1PROP`,
  twoProperties: `${E2E_PREFIX}PKG_2PROP`,
  ninetyDays: `${E2E_PREFIX}PKG_90D`,
} as const;

export const E2E_DISCOUNT_CODE = `${E2E_PREFIX}SAVE10`;

const PROPERTY_NUMBERS = Object.values(E2E_PERSONAS).map((p) => p.propertyNumber);
const SUBSCRIPTION_IDS = PROPERTY_NUMBERS.map((n) => `SUB-${n}`);
const REQUEST_ID = `${E2E_PREFIX}REQ_1`;
const OWNER_IDS = PROPERTY_NUMBERS;

export interface DevTargetInfo {
  projectId: string;
  r2Bucket: string;
}

/** Throws unless this process is provably pointed at the isolated DEV target. */
export function assertDevTestTarget(env: NodeJS.ProcessEnv = process.env): DevTargetInfo {
  if (env.NODE_ENV !== "development") {
    throw new Error(
      `E2E test data refused: NODE_ENV must be "development" (found: ${env.NODE_ENV ?? "undefined"})`,
    );
  }

  // Reuses the same guards the server enforces at startup.
  assertDevelopmentIsolation(env);
  assertFirebaseDevIsolation(env);
  assertR2DevIsolation(env);

  const projectId = getFirebaseProjectId(env);
  if (projectId !== E2E_DEV_PROJECT_ID) {
    throw new Error(
      `E2E test data refused: Firebase project must be exactly ${E2E_DEV_PROJECT_ID} (found: ${projectId ?? "none"})`,
    );
  }

  const r2Bucket = env.R2_BUCKET_NAME?.trim();
  if (r2Bucket !== E2E_DEV_R2_BUCKET) {
    throw new Error(
      `E2E test data refused: R2 bucket must be exactly ${E2E_DEV_R2_BUCKET} (found: ${r2Bucket ?? "none"})`,
    );
  }

  if (externalServicesEnabled(env)) {
    throw new Error(
      "E2E test data refused: external services must be disabled in DEV (ALLOW_EXTERNAL_SERVICES_IN_DEVELOPMENT must not be true)",
    );
  }

  if (!db) {
    throw new Error("E2E test data refused: Firestore is not initialized");
  }

  return { projectId, r2Bucket };
}

function getDb(): FirebaseFirestore.Firestore {
  if (!db) throw new Error("Firestore is not initialized");
  return db;
}

function baseProperty(
  propertyNumber: string,
  name: string,
  ownerLabel: string,
  city: string,
  direction: "شمال" | "جنوب" | "شرق" | "غرب",
  type: "قسم" | "قسمين",
  facilities: string[],
  verificationStatus: "approved" | "pending",
) {
  const now = new Date().toISOString();
  return {
    propertyNumber,
    name,
    whatsappNumber: `96650000${propertyNumber.slice(-4)}`,
    location: "",
    city,
    direction,
    type,
    facilities,
    imagesFolderUrl: "",
    imagesLink: "",
    prices: {
      display: "",
      weekday: "400",
      weekend: "650",
      overnight: "900",
      special: "",
      holidays: "1000",
    },
    subscriptionType: "عادي" as const,
    lastUpdate: now,
    subscriptionDate: now.split("T")[0],
    pin: "",
    verificationStatus,
    imageUrls: [],
    createdAt: now,
    updatedAt: now,
    // Synthetic markers used for precise cleanup.
    testData: true,
    testDataLabel: ownerLabel,
  };
}

export interface SeedSummary {
  packages: string[];
  properties: string[];
  owners: string[];
  subscriptions: string[];
  discounts: string[];
  requests: string[];
  customerAccounts: string[];
  testUsers: string[];
}

/** Creates/overwrites deterministic synthetic DEV data. Safe to run repeatedly. */
export async function seedDevTestData(): Promise<SeedSummary> {
  const target = assertDevTestTarget();
  const firestore = getDb();
  const now = new Date();

  const packages = [
    {
      id: E2E_PACKAGE_IDS.oneProperty,
      name: "باقة اختبار — عقار واحد (30 يوم)",
      duration: 30,
      price: 50,
      pricePerProperty: 50,
      type: "عادي" as const,
      features: ["اختبار", "عقار واحد"],
      description: "باقة اصطناعية لاختبارات DEV فقط",
      isActive: true,
      propertyCount: 1,
      maxProperties: 5,
    },
    {
      id: E2E_PACKAGE_IDS.twoProperties,
      name: "باقة اختبار — عقارين (30 يوم)",
      duration: 30,
      price: 100,
      pricePerProperty: 50,
      type: "مميز" as const,
      features: ["اختبار", "عقارين", "تميّز"],
      description: "باقة اصطناعية لاختبارات DEV فقط",
      isActive: true,
      propertyCount: 2,
      maxProperties: 10,
    },
    {
      id: E2E_PACKAGE_IDS.ninetyDays,
      name: "باقة اختبار — 90 يوم",
      duration: 90,
      price: 150,
      pricePerProperty: 50,
      type: "عادي" as const,
      features: ["اختبار", "90 يوم"],
      description: "باقة اصطناعية لاختبارات DEV فقط",
      isActive: true,
      propertyCount: 1,
      maxProperties: 5,
    },
  ];

  for (const pkg of packages) {
    await firestore
      .collection("packages")
      .doc(pkg.id)
      .set({ ...pkg, createdAt: now.toISOString(), testData: true }, { merge: false });
  }

  const properties = [
    {
      ...baseProperty(
        E2E_PERSONAS.ownerPrimary.propertyNumber,
        "عقار اختبار المالك الأول",
        E2E_PERSONAS.ownerPrimary.ownerLabel,
        "بريدة",
        "شمال",
        "قسمين",
        ["مسبح", "ملعب", "مكيف", "واي فاي"],
        "approved",
      ),
    },
    {
      ...baseProperty(
        E2E_PERSONAS.ownerExpired.propertyNumber,
        "عقار اختبار المالك الثاني",
        E2E_PERSONAS.ownerExpired.ownerLabel,
        "عنيزة",
        "جنوب",
        "قسم",
        ["بدون مسبح", "ملعب"],
        "approved",
      ),
    },
    {
      ...baseProperty(
        E2E_PERSONAS.bookingProperty.propertyNumber,
        "عقار اختبار الحجز",
        E2E_PERSONAS.bookingProperty.ownerLabel,
        "الرس",
        "شرق",
        "قسم",
        ["مسبح", "مناسبات"],
        "approved",
      ),
    },
  ];

  for (const property of properties) {
    await firestore
      .collection("properties")
      .doc(property.propertyNumber)
      .set(property, { merge: false });
  }

  // Owner accounts (hashed PIN — DEV enforces hashed-only credentials).
  for (const persona of Object.values(E2E_PERSONAS)) {
    const hashed = await hashPassword(persona.pin);
    await firestore
      .collection("owners")
      .doc(persona.propertyNumber)
      .set(
        {
          ownerId: persona.propertyNumber,
          phone: `96650000${persona.propertyNumber.slice(-4)}`,
          password: hashed,
          resetCode: "",
          resetExpire: "",
          lastReset: "",
          testData: true,
          testDataLabel: persona.ownerLabel,
        },
        { merge: false },
      );
  }

  const toIso = (d: Date) => d.toISOString();
  const plusDays = (d: Date, days: number) =>
    new Date(d.getTime() + days * 24 * 60 * 60 * 1000);

  // Active premium subscription for the primary owner.
  await firestore
    .collection("subscriptions")
    .doc(`SUB-${E2E_PERSONAS.ownerPrimary.propertyNumber}`)
    .set(
      {
        id: `SUB-${E2E_PERSONAS.ownerPrimary.propertyNumber}`,
        propertyNumber: E2E_PERSONAS.ownerPrimary.propertyNumber,
        packageId: E2E_PACKAGE_IDS.twoProperties,
        subscriptionType: "مميز",
        packageType: "مميز",
        startDate: toIso(now),
        endDate: toIso(plusDays(now, 30)),
        status: "نشط",
        propertyCount: 1,
        createdAt: toIso(now),
        cancelledAt: null,
        cancelReason: null,
        suspendedAt: null,
        remainingDurationMs: null,
        testData: true,
        testDataLabel: E2E_PERSONAS.ownerPrimary.ownerLabel,
      },
      { merge: false },
    );

  // Expired subscription for the secondary owner.
  await firestore
    .collection("subscriptions")
    .doc(`SUB-${E2E_PERSONAS.ownerExpired.propertyNumber}`)
    .set(
      {
        id: `SUB-${E2E_PERSONAS.ownerExpired.propertyNumber}`,
        propertyNumber: E2E_PERSONAS.ownerExpired.propertyNumber,
        packageId: E2E_PACKAGE_IDS.oneProperty,
        subscriptionType: "عادي",
        packageType: "عادي",
        startDate: toIso(plusDays(now, -60)),
        endDate: toIso(plusDays(now, -30)),
        status: "منتهي",
        propertyCount: 1,
        createdAt: toIso(plusDays(now, -60)),
        cancelledAt: null,
        cancelReason: null,
        suspendedAt: null,
        remainingDurationMs: null,
        testData: true,
        testDataLabel: E2E_PERSONAS.ownerExpired.ownerLabel,
      },
      { merge: false },
    );

  // Discount code (percentage) for pricing/discount verification.
  await firestore
    .collection("discounts")
    .doc(E2E_DISCOUNT_CODE)
    .set(
      {
        id: E2E_DISCOUNT_CODE,
        code: E2E_DISCOUNT_CODE,
        type: "نسبة",
        value: 10,
        expiryDate: "2030-12-31",
        isActive: true,
        usageCount: 0,
        createdAt: toIso(now),
        testData: true,
      },
      { merge: false },
    );

  // One synthetic contact request for the primary owner.
  await firestore
    .collection("requests")
    .doc(REQUEST_ID)
    .set(
      {
        id: REQUEST_ID,
        propertyNumber: E2E_PERSONAS.ownerPrimary.propertyNumber,
        requestCode: "E2E-REQ-1",
        timestamp: toIso(now),
        clientPhone: "966500000000",
        actorType: "anonymous",
        ipAddress: "127.0.0.1",
        deviceType: "desktop",
        dayOfWeek: "الاثنين",
        hourOfDay: 12,
        createdAt: toIso(now),
        testData: true,
      },
      { merge: false },
    );

  // ---------------------------------------------------------------------------
  // DEV test identities (manual login fixtures). Non-secret; testData-marked.
  // ---------------------------------------------------------------------------

  // Customer account record. Collection/id match the real auth model
  // (customer_accounts/{createCustomerSubject(phone)}). Login itself is OTP-based
  // and BLOCKED in DEV (WhatsApp disabled) — see docs/DEV_E2E_REPORT.md.
  const customerSubject = createCustomerSubject(E2E_CUSTOMER_PHONE);
  const stamp = toIso(now);
  await firestore
    .collection(CUSTOMER_ACCOUNTS_COLLECTION)
    .doc(customerSubject)
    .set(
      {
        id: customerSubject,
        schemaVersion: 1,
        phone: E2E_CUSTOMER_PHONE,
        fullName: "عميل اختبار DEV",
        email: null,
        favoritePropertyNumbers: [],
        createdAt: stamp,
        updatedAt: stamp,
        lastLoginAt: stamp,
        testData: true,
        testDataLabel: E2E_CUSTOMER_LABEL,
      },
      { merge: false },
    );

  // Human-readable registry of the synthetic DEV logins. Contains NO credentials.
  const testUserIds = [
    E2E_ADMIN_USER_ID,
    ...Object.values(E2E_PERSONAS).map(
      (persona) => `${E2E_PREFIX}USER_OWNER_${persona.propertyNumber}`,
    ),
    E2E_CUSTOMER_USER_ID,
  ];
  const testUsers: Array<{ id: string; data: Record<string, unknown> }> = [
    {
      id: E2E_ADMIN_USER_ID,
      data: {
        role: "admin",
        authSource: "env:ADMIN_CODE / ADMIN_PASSWORD (.env.development.local)",
        loginPath: "/owner/login?mode=admin",
        credentialsPersistedHere: false,
        note: "Admin auth is a shared DEV env credential; no admin user record exists.",
      },
    },
    ...Object.values(E2E_PERSONAS).map((persona) => ({
      id: `${E2E_PREFIX}USER_OWNER_${persona.propertyNumber}`,
      data: {
        role: "owner",
        propertyNumber: persona.propertyNumber,
        loginPath: "/owner/login",
        authSource: "owners/{propertyNumber}.password (argon2id)",
      },
    })),
    {
      id: E2E_CUSTOMER_USER_ID,
      data: {
        role: "customer",
        phone: E2E_CUSTOMER_PHONE,
        customerSubject,
        loginPath: "/customer/login",
        authSource: "contact-identity OTP (WhatsApp)",
        loginBlockedInDev: true,
        blockedReason: "WhatsApp delivery disabled in DEV (DELIVERY_FAILED / 502).",
      },
    },
  ];
  for (const user of testUsers) {
    await firestore
      .collection(E2E_TEST_USERS_COLLECTION)
      .doc(user.id)
      .set({ ...user.data, id: user.id, testData: true, createdAt: stamp }, { merge: false });
  }

  const summary: SeedSummary = {
    packages: packages.map((p) => p.id),
    properties: properties.map((p) => p.propertyNumber),
    owners: [...OWNER_IDS],
    subscriptions: [...SUBSCRIPTION_IDS],
    discounts: [E2E_DISCOUNT_CODE],
    requests: [REQUEST_ID],
    customerAccounts: [customerSubject],
    testUsers: testUserIds,
  };
  console.log(`[E2E SEED] target=${target.projectId} bucket=${target.r2Bucket}`);
  console.log(`[E2E SEED] ${JSON.stringify(summary)}`);
  return summary;
}

async function deleteIds(
  collectionName: string,
  ids: string[],
): Promise<number> {
  const firestore = getDb();
  let deleted = 0;
  for (const id of ids) {
    const ref = firestore.collection(collectionName).doc(id);
    const doc = await ref.get();
    if (doc.exists) {
      await ref.delete();
      deleted += 1;
    }
  }
  return deleted;
}

async function deleteMarked(collectionName: string): Promise<number> {
  const firestore = getDb();
  const snapshot = await firestore
    .collection(collectionName)
    .where("testData", "==", true)
    .get();
  let deleted = 0;
  for (const doc of snapshot.docs) {
    await doc.ref.delete();
    deleted += 1;
  }
  return deleted;
}

/** Deletes ONLY records created by this system. Safe to run repeatedly. */
export async function cleanupDevTestData(): Promise<Record<string, number>> {
  const target = assertDevTestTarget();
  const result: Record<string, number> = {};

  result.packages = await deleteMarked("packages");
  result.discounts = await deleteMarked("discounts");
  result.requests = await deleteIds("requests", [REQUEST_ID]);
  result.subscriptions =
    (await deleteIds("subscriptions", [...SUBSCRIPTION_IDS])) +
    (await deleteMarked("subscriptions"));
  result.owners = await deleteIds("owners", [...OWNER_IDS]);
  result.properties =
    (await deleteIds("properties", [...PROPERTY_NUMBERS])) +
    (await deleteMarked("properties"));
  result.testUsers = await deleteMarked(E2E_TEST_USERS_COLLECTION);
  result.customerAccounts = await deleteMarked(CUSTOMER_ACCOUNTS_COLLECTION);

  console.log(`[E2E CLEANUP] target=${target.projectId} bucket=${target.r2Bucket}`);
  console.log(`[E2E CLEANUP] ${JSON.stringify(result)}`);
  return result;
}
