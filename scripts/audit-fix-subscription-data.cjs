#!/usr/bin/env node

/**
 * Audits the live subscription data without using FirebaseService getters.
 *
 * Default: read-only audit.
 * Apply guarded repairs: node scripts/audit-fix-subscription-data.cjs --fix
 *
 * Take a Firebase backup before using --fix. Every write runs in a transaction
 * and is skipped if the document changed after the audit snapshot was read.
 */

require("dotenv").config({ path: require("path").resolve(__dirname, "..", ".env") });
const admin = require("firebase-admin");

const APPLY_FIXES = process.argv.includes("--fix");
const MAX_ACTIVE_PACKAGE_DAYS = 90;
const MAX_SUBSCRIPTION_DAYS = 100;
const DAY_MS = 24 * 60 * 60 * 1000;
const ACTIVE_STATUSES = new Set([
  "نشط",
  "نشط مجاني",
  "ساري",
  "ينتهي قريباً",
  "قريب الانتهاء",
  "active",
  "free_active",
  "expiring",
]);
const SUSPENDED_STATUSES = new Set(["موقوف مؤقتاً", "suspended"]);
const PREMIUM_TYPES = new Set(["مميز", "premium", "trusted"]);

if (!process.env.FIREBASE_SERVICE_ACCOUNT) {
  throw new Error("FIREBASE_SERVICE_ACCOUNT is required");
}

if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  admin.firestore().settings({ ignoreUndefinedProperties: true });
}

const db = admin.firestore();

function toMillis(value) {
  if (value === null || value === undefined || value === "") return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value?.toDate === "function") return value.toDate().getTime();
  if (typeof value === "number") return value < 1e12 ? value * 1000 : value;
  const parsed = new Date(String(value)).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
}

function getRiyadhDayStart(referenceDate = new Date()) {
  const day = referenceDate.toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" });
  return new Date(`${day}T00:00:00+03:00`);
}

function packageDuration(data) {
  return Number(data.duration ?? data.durationDays);
}

function snapshotRecord(doc) {
  return { id: doc.id, data: doc.data(), updateTime: doc.updateTime };
}

async function loadAudit() {
  const [packageSnapshot, subscriptionSnapshot, multiSnapshot, propertySnapshot] =
    await Promise.all([
      db.collection("packages").get(),
      db.collection("subscriptions").get(),
      db.collection("multi_property_subscriptions").get(),
      db.collection("properties").get(),
    ]);

  const packages = packageSnapshot.docs.map(snapshotRecord);
  const subscriptions = subscriptionSnapshot.docs.map(snapshotRecord);
  const multiSubscriptions = multiSnapshot.docs.map(snapshotRecord);
  const properties = propertySnapshot.docs.map(snapshotRecord);
  const todayStart = getRiyadhDayStart();
  const maxEnd = new Date(todayStart.getTime() + (MAX_SUBSCRIPTION_DAYS + 1) * DAY_MS - 1);

  const activePackagesOverLimit = packages.filter(({ data }) =>
    data.isActive === true && packageDuration(data) > MAX_ACTIVE_PACKAGE_DAYS
  );
  const inactivePackagesOverLimit = packages.filter(({ data }) =>
    data.isActive === false && packageDuration(data) > MAX_ACTIVE_PACKAGE_DAYS
  );
  const activeSubscriptionsOverLimit = subscriptions.filter(({ data }) =>
    ACTIVE_STATUSES.has(String(data.status || "")) &&
    toMillis(data.endDate) > maxEnd.getTime()
  );
  const suspendedSubscriptionsOverLimit = subscriptions.filter(({ data }) =>
    SUSPENDED_STATUSES.has(String(data.status || "")) &&
    Number(data.remainingDurationMs) > MAX_SUBSCRIPTION_DAYS * DAY_MS
  );
  const expiredActiveSubscriptions = subscriptions.filter(({ data }) => {
    const endDate = toMillis(data.endDate);
    return ACTIVE_STATUSES.has(String(data.status || "")) &&
      endDate > 0 && endDate < todayStart.getTime();
  });
  const activeSubscriptionsWithoutEnd = subscriptions.filter(({ data }) =>
    ACTIVE_STATUSES.has(String(data.status || "")) && !toMillis(data.endDate)
  );
  const activeMultiOverLimit = multiSubscriptions.filter(({ data }) =>
    String(data.status || "") === "نشط" && toMillis(data.endDate) > maxEnd.getTime()
  );
  const expiredActiveMulti = multiSubscriptions.filter(({ data }) => {
    const endDate = toMillis(data.endDate);
    return String(data.status || "") === "نشط" && endDate > 0 && endDate < todayStart.getTime();
  });

  const propertyNumbers = new Set(
    properties.map(({ id, data }) => String(data.propertyNumber || id)),
  );
  const orphanSubscriptions = subscriptions.filter(({ data }) =>
    !propertyNumbers.has(String(data.propertyNumber || ""))
  );

  const activePremiumProperties = new Set(
    subscriptions
      .filter(({ data }) => {
        const endDate = toMillis(data.endDate);
        return ACTIVE_STATUSES.has(String(data.status || "")) &&
          PREMIUM_TYPES.has(String(data.subscriptionType || data.packageType || "").toLowerCase()) &&
          endDate >= todayStart.getTime();
      })
      .map(({ data }) => String(data.propertyNumber || "")),
  );
  const propertyTypeMismatches = properties.filter(({ id, data }) => {
    const propertyNumber = String(data.propertyNumber || id);
    const isPremium = PREMIUM_TYPES.has(String(data.subscriptionType || "").toLowerCase());
    return isPremium !== activePremiumProperties.has(propertyNumber);
  });

  return {
    counts: {
      packages: packages.length,
      subscriptions: subscriptions.length,
      multiPropertySubscriptions: multiSubscriptions.length,
      properties: properties.length,
    },
    todayStart,
    maxEnd,
    activePackagesOverLimit,
    inactivePackagesOverLimit,
    activeSubscriptionsOverLimit,
    suspendedSubscriptionsOverLimit,
    expiredActiveSubscriptions,
    activeSubscriptionsWithoutEnd,
    activeMultiOverLimit,
    expiredActiveMulti,
    orphanSubscriptions,
    propertyTypeMismatches,
  };
}

function publicReport(audit) {
  const ids = (records) => records.map(({ id }) => id).sort();
  return {
    mode: APPLY_FIXES ? "fix" : "audit",
    counts: audit.counts,
    limits: {
      maxActivePackageDays: MAX_ACTIVE_PACKAGE_DAYS,
      maxSubscriptionDays: MAX_SUBSCRIPTION_DAYS,
      maxEndDate: audit.maxEnd.toISOString(),
    },
    issues: {
      activePackagesOverLimit: ids(audit.activePackagesOverLimit),
      inactivePackagesOverLimitAllowed: ids(audit.inactivePackagesOverLimit),
      activeSubscriptionsOverLimit: ids(audit.activeSubscriptionsOverLimit),
      suspendedSubscriptionsOverLimit: ids(audit.suspendedSubscriptionsOverLimit),
      expiredSubscriptionsStillActive: ids(audit.expiredActiveSubscriptions),
      activeMultiSubscriptionsOverLimit: ids(audit.activeMultiOverLimit),
      expiredMultiSubscriptionsStillActive: ids(audit.expiredActiveMulti),
      propertySubscriptionTypeMismatches: ids(audit.propertyTypeMismatches),
      undatedLegacySubscriptionsPreserved: ids(audit.activeSubscriptionsWithoutEnd),
      orphanSubscriptionsPreserved: ids(audit.orphanSubscriptions),
    },
  };
}

async function guardedUpdate(collection, candidate, buildPatch) {
  const ref = db.collection(collection).doc(candidate.id);
  return db.runTransaction(async (transaction) => {
    const fresh = await transaction.get(ref);
    if (!fresh.exists) return "missing";
    if (
      candidate.updateTime &&
      fresh.updateTime &&
      !fresh.updateTime.isEqual(candidate.updateTime)
    ) {
      return "changed";
    }
    const patch = buildPatch(fresh.data());
    if (!patch || Object.keys(patch).length === 0) return "unchanged";
    transaction.update(ref, { ...patch, updatedAt: new Date().toISOString() });
    return "updated";
  });
}

async function applyRepairs(audit) {
  const results = [];
  const record = async (kind, id, promise) => {
    results.push({ kind, id, result: await promise });
  };

  for (const candidate of audit.activePackagesOverLimit) {
    await record("deactivate-package", candidate.id, guardedUpdate(
      "packages",
      candidate,
      (data) => data.isActive === true && packageDuration(data) > MAX_ACTIVE_PACKAGE_DAYS
        ? { isActive: false }
        : null,
    ));
  }

  for (const candidate of audit.activeSubscriptionsOverLimit) {
    await record("cap-subscription", candidate.id, guardedUpdate(
      "subscriptions",
      candidate,
      (data) => ACTIVE_STATUSES.has(String(data.status || "")) &&
        toMillis(data.endDate) > audit.maxEnd.getTime()
        ? { endDate: audit.maxEnd.toISOString() }
        : null,
    ));
  }

  for (const candidate of audit.suspendedSubscriptionsOverLimit) {
    await record("cap-suspended-duration", candidate.id, guardedUpdate(
      "subscriptions",
      candidate,
      (data) => SUSPENDED_STATUSES.has(String(data.status || "")) &&
        Number(data.remainingDurationMs) > MAX_SUBSCRIPTION_DAYS * DAY_MS
        ? { remainingDurationMs: MAX_SUBSCRIPTION_DAYS * DAY_MS }
        : null,
    ));
  }

  for (const candidate of audit.expiredActiveSubscriptions) {
    await record("expire-subscription", candidate.id, guardedUpdate(
      "subscriptions",
      candidate,
      (data) => {
        const endDate = toMillis(data.endDate);
        return ACTIVE_STATUSES.has(String(data.status || "")) &&
          endDate > 0 && endDate < audit.todayStart.getTime()
          ? { status: "منتهي" }
          : null;
      },
    ));
  }

  const multiCandidates = new Map();
  for (const candidate of [...audit.activeMultiOverLimit, ...audit.expiredActiveMulti]) {
    multiCandidates.set(candidate.id, candidate);
  }
  for (const candidate of multiCandidates.values()) {
    await record("repair-multi-subscription", candidate.id, guardedUpdate(
      "multi_property_subscriptions",
      candidate,
      (data) => {
        if (String(data.status || "") !== "نشط") return null;
        const endDate = toMillis(data.endDate);
        if (endDate > 0 && endDate < audit.todayStart.getTime()) {
          return { status: "منتهي" };
        }
        if (endDate > audit.maxEnd.getTime()) {
          return { endDate: audit.maxEnd.toISOString() };
        }
        return null;
      },
    ));
  }

  return results;
}

async function main() {
  const before = await loadAudit();
  console.log(JSON.stringify(publicReport(before), null, 2));

  if (!APPLY_FIXES) return;

  const results = await applyRepairs(before);
  console.log(JSON.stringify({ applied: results }, null, 2));

  const after = await loadAudit();
  console.log(JSON.stringify({ verification: publicReport(after) }, null, 2));

  const failed = results.some(({ result }) => result !== "updated" && result !== "unchanged");
  if (failed) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
