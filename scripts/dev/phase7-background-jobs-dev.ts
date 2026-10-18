/**
 * DEV-only Phase 7 harness for background jobs / schedulers / workers.
 *
 * Safety contract (enforced by assertDevTestTarget):
 *  - NODE_ENV must be development; Firebase project + R2 bucket must be `rwqan-sa-dev`;
 *    and external services must be disabled.
 *  - Creates only synthetic `testData: true` documents (properties 90004/90005 and
 *    their subscriptions/payments) and deletes exactly those documents afterwards.
 *
 * Run:
 *   $env:NODE_ENV="development"; npx tsx scripts/dev/phase7-background-jobs-dev.ts
 */
import "../../server/config/loadEnv";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { assertDevTestTarget } from "./e2e-test-data";
import { db } from "../../server/config/firebase";
import { firebaseService } from "../../server/firebaseService";
import {
  externalServicesEnabled,
  getFirebaseProjectId,
} from "../../server/config/runtimeEnvironment";
import { shouldStartScheduledBackgroundWork } from "../../server/config/schedulerStartup";
import { shouldStartBookingCommissionWorker } from "../../server/services/BookingNotificationWorker";
import {
  downgradeExpiredSubscriptions,
  expireOldPendingPayments,
  updateRemainingDaysInSheet,
} from "../../server/scheduler";

const BASE = "http://localhost:5001";
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const SUB_PROPERTY = "90004";
const SUB_ID = `SUB-${SUB_PROPERTY}`;
const ACTIVE_PROPERTY = "90006";
const ACTIVE_SUB_ID = `SUB-${ACTIVE_PROPERTY}`;
const PAY_PROPERTY = "90005";
const PAY_CARD_ID = "PAY-P7-CARD";
const PAY_CARD_ID_2 = "PAY-P7-CARD-CONC";
const PAY_BANK_ID = "PAY-P7-BANK";

type ResultStatus = "PASS" | "FAIL" | "BLOCKED" | "NA";
interface CaseResult {
  id: string;
  name: string;
  status: ResultStatus;
  detail: string;
}

const results: CaseResult[] = [];
const cleanupDocs: Array<{ collection: string; id: string }> = [];
const notes: string[] = [];

function record(id: string, name: string, status: ResultStatus, detail: string) {
  results.push({ id, name, status, detail });
  console.log(`[${status}] ${id} ${name} — ${detail}`);
}

function iso(msFromNow: number): string {
  return new Date(Date.now() + msFromNow).toISOString();
}

function requireDb() {
  if (!db) throw new Error("Firestore not initialized");
  return db;
}

async function setDoc(collection: string, id: string, data: Record<string, unknown>) {
  await requireDb().collection(collection).doc(id).set(
    { ...data, id, testData: true, testDataLabel: "E2E_TEST_phase7" },
    { merge: false },
  );
  cleanupDocs.push({ collection, id });
}

async function getDoc(
  collection: string,
  id: string,
): Promise<Record<string, any> | null> {
  const snap = await requireDb().collection(collection).doc(id).get();
  return snap.exists ? (snap.data() as Record<string, any>) : null;
}

async function findSubByProperty(
  propertyNumber: string,
): Promise<Record<string, any> | null> {
  const snap = await requireDb()
    .collection("subscriptions")
    .where("propertyNumber", "==", propertyNumber)
    .get();
  return snap.empty ? null : (snap.docs[0].data() as Record<string, any>);
}

async function cleanup() {
  if (!db) return;
  for (const { collection, id } of cleanupDocs) {
    try {
      await requireDb().collection(collection).doc(id).delete();
    } catch (error) {
      console.warn(`[cleanup] failed ${collection}/${id}: ${(error as Error).message}`);
    }
  }
}

async function main() {
  assertDevTestTarget();

  // ── ISOL-001: DEV isolation gates ────────────────────────────────────────
  {
    const schedulersDev = shouldStartScheduledBackgroundWork({ NODE_ENV: "development" });
    const schedulersOptIn = shouldStartScheduledBackgroundWork({
      NODE_ENV: "development",
      ENABLE_SCHEDULERS_IN_DEVELOPMENT: "true",
    });
    const workerDev = shouldStartBookingCommissionWorker({ NODE_ENV: "development" });
    const workerOptIn = shouldStartBookingCommissionWorker({
      NODE_ENV: "development",
      ENABLE_BOOKING_WORKER_IN_DEVELOPMENT: "true",
    });
    const project = getFirebaseProjectId();
    const bucket = process.env.R2_BUCKET_NAME?.trim();
    const external = externalServicesEnabled();

    const ok =
      schedulersDev === false &&
      schedulersOptIn === true &&
      workerDev === false &&
      workerOptIn === true &&
      project === "rwqan-sa-dev" &&
      bucket === "rwqan-sa-dev" &&
      external === false;

    record(
      "ISOL-001",
      "schedulers + worker OFF by default in DEV, start only on exact opt-in",
      ok ? "PASS" : "FAIL",
      `schedulersDev=${schedulersDev} schedulersOptIn=${schedulersOptIn} workerDev=${workerDev} ` +
        `workerOptIn=${workerOptIn} project=${project} bucket=${bucket} externalServices=${external}`,
    );
  }

  // ── ISOL-002: worker endpoint rejects unauthenticated callers ────────────
  {
    try {
      const res = await fetch(`${BASE}/api/internal/booking-worker`, { method: "POST" });
      record(
        "ISOL-002",
        "internal booking-worker endpoint rejects unauthenticated callers",
        res.status === 401 || res.status === 403 ? "PASS" : "FAIL",
        `status=${res.status} (expected 401/403 without worker secret)`,
      );
    } catch (error) {
      record("ISOL-002", "internal booking-worker auth", "BLOCKED", (error as Error).message);
    }
  }

  // ── SUB-001/002: expired premium subscription downgrade + idempotency ────
  {
    await setDoc("properties", SUB_PROPERTY, {
      propertyNumber: SUB_PROPERTY,
      name: "عقار اختبار المهمة المجدولة",
      subscriptionType: "مميز",
      verificationStatus: "approved",
      updatedAt: iso(0),
    });
    await setDoc("subscriptions", SUB_ID, {
      id: SUB_ID,
      propertyNumber: SUB_PROPERTY,
      packageId: "E2E_TEST_pkg",
      subscriptionType: "مميز",
      packageType: "مميز",
      status: "نشط",
      startDate: iso(-60 * DAY_MS),
      endDate: iso(-5 * DAY_MS),
      createdAt: iso(-60 * DAY_MS),
      cancelledAt: null,
    });

    const first = await downgradeExpiredSubscriptions();
    const subAfter = await findSubByProperty(SUB_PROPERTY);
    const propAfter = await getDoc("properties", SUB_PROPERTY);
    const downgraded =
      subAfter?.status === "منتهي" &&
      subAfter?.subscriptionType === "عادي" &&
      propAfter?.subscriptionType === "عادي";
    record(
      "SUB-001",
      "expired premium subscription is downgraded (status + premium type removed)",
      downgraded ? "PASS" : "FAIL",
      `run1=${first} subStatus=${subAfter?.status} subType=${subAfter?.subscriptionType} propType=${propAfter?.subscriptionType}`,
    );

    const second = await downgradeExpiredSubscriptions();
    const subAfter2 = await findSubByProperty(SUB_PROPERTY);
    const idempotent = second === 0 && subAfter2?.status === "منتهي";
    record(
      "SUB-002",
      "re-running the downgrade job is a no-op (no duplicate effect)",
      idempotent ? "PASS" : "FAIL",
      `run2=${second} subStatus=${subAfter2?.status}`,
    );
  }

  // ── PAY-001: pending card payment is never activated without proof ───────
  {
    await setDoc("payments", PAY_CARD_ID, {
      id: PAY_CARD_ID,
      propertyNumber: PAY_PROPERTY,
      packageId: "E2E_TEST_pkg",
      amount: 50,
      finalAmount: 50,
      discountAmount: 0,
      status: "قيد المراجعة",
      paymentMethod: "بطاقة",
      action: "subscribe",
      createdAt: iso(-2 * HOUR_MS),
    });

    const timeoutFlag = await firebaseService.getFeatureFlag("FEATURE_TIMEOUTS");
    notes.push(`FEATURE_TIMEOUTS=${timeoutFlag}`);

    await expireOldPendingPayments();
    const payAfter = await getDoc("payments", PAY_CARD_ID);
    const subAfter = await findSubByProperty(PAY_PROPERTY);

    const notActivated =
      subAfter === null &&
      payAfter?.status !== "مدفوع" &&
      payAfter?.status !== "مكتمل" &&
      payAfter?.status !== "نجح";
    record(
      "PAY-001",
      "pending card payment is not activated without payment proof",
      notActivated ? "PASS" : "FAIL",
      `timeoutsEnabled=${timeoutFlag} paymentStatus=${payAfter?.status} subscriptionCreated=${subAfter !== null}`,
    );
  }

  // ── PAY-002: idempotency of the payment-expiry job ───────────────────────
  {
    const before = await getDoc("payments", PAY_CARD_ID);
    const second = await expireOldPendingPayments();
    const after = await getDoc("payments", PAY_CARD_ID);
    record(
      "PAY-002",
      "re-running the payment-expiry job does not change a settled status",
      before?.status === after?.status ? "PASS" : "FAIL",
      `runExpired=${second} statusBefore=${before?.status} statusAfter=${after?.status}`,
    );
  }

  // ── PAY-003: concurrent expiry of the same payment happens at most once ──
  {
    await setDoc("payments", PAY_CARD_ID_2, {
      id: PAY_CARD_ID_2,
      propertyNumber: PAY_PROPERTY,
      packageId: "E2E_TEST_pkg",
      amount: 50,
      finalAmount: 50,
      discountAmount: 0,
      status: "قيد المراجعة",
      paymentMethod: "بطاقة",
      action: "subscribe",
      createdAt: iso(-2 * HOUR_MS),
    });
    const [a, b] = await Promise.all([
      expireOldPendingPayments(),
      expireOldPendingPayments(),
    ]);
    const after = await getDoc("payments", PAY_CARD_ID_2);
    // Firestore transactions guarantee the same pending attempt is settled once,
    // so the two runs together must settle it exactly once (never twice).
    const onceOnly = a + b === 1 && after?.status === "ملغي - انتهت المهلة";
    record(
      "PAY-003",
      "two concurrent expiry runs settle the same payment exactly once",
      onceOnly ? "PASS" : "FAIL",
      `runA=${a} runB=${b} finalStatus=${after?.status}`,
    );
  }

  // ── PAY-004: pending bank transfer cannot be auto-approved ───────────────
  {
    await setDoc("payments", PAY_BANK_ID, {
      id: PAY_BANK_ID,
      propertyNumber: PAY_PROPERTY,
      packageId: "E2E_TEST_pkg",
      amount: 50,
      finalAmount: 50,
      discountAmount: 0,
      status: "قيد التحقق",
      paymentMethod: "تحويل بنكي",
      action: "subscribe",
      createdAt: iso(-4 * DAY_MS),
    });
    await expireOldPendingPayments();
    const after = await getDoc("payments", PAY_BANK_ID);
    const subAfter = await findSubByProperty(PAY_PROPERTY);
    const notActivated =
      subAfter === null && after?.status !== "مدفوع" && after?.status !== "مكتمل";
    record(
      "PAY-004",
      "pending bank transfer is not auto-approved / activated",
      notActivated ? "PASS" : "FAIL",
      `paymentStatus=${after?.status} subscriptionCreated=${subAfter !== null}`,
    );
  }

  // ── REMIND-001: remaining-days job runs but sends nothing in DEV ─────────
  {
    await setDoc("properties", ACTIVE_PROPERTY, {
      propertyNumber: ACTIVE_PROPERTY,
      name: "عقار اختبار الأيام المتبقية",
      subscriptionType: "عادي",
      verificationStatus: "approved",
      updatedAt: iso(0),
    });
    await setDoc("subscriptions", ACTIVE_SUB_ID, {
      id: ACTIVE_SUB_ID,
      propertyNumber: ACTIVE_PROPERTY,
      packageId: "E2E_TEST_pkg",
      subscriptionType: "عادي",
      packageType: "عادي",
      status: "نشط",
      startDate: iso(-20 * DAY_MS),
      endDate: iso(10 * DAY_MS),
      createdAt: iso(-20 * DAY_MS),
      cancelledAt: null,
    });

    const summary = await updateRemainingDaysInSheet();
    const subDoc = await getDoc("subscriptions", ACTIVE_SUB_ID);
    const noSend = summary.notificationsSent === 0;
    const stillActive = subDoc?.status === "نشط";
    record(
      "REMIND-001",
      "remaining-days job runs on DEV but sends nothing (external services off)",
      noSend && stillActive && summary.updated >= 1 ? "PASS" : "FAIL",
      `result=${JSON.stringify(summary)} activeSubStatus=${subDoc?.status}`,
    );
    notes.push(
      "updateRemainingDaysInSheet sent 0 notifications in DEV (external services disabled).",
    );
    notes.push(
      "Observation: FirebaseStorage.updateAllSubscriptionsRemainingDays delegates to " +
        "updateSubscriptionRemainingDays, which updates only `status` (via getSubscriptionByPropertyNumber) " +
        "and does not persist a `remainingDays` field. The parallel firebaseService." +
        "updateAllSubscriptionsRemainingDays (which does persist `remainingDays`) is not used by the scheduler path.",
    );
  }
}

async function writeReport() {
  const dir = join(process.cwd(), "quality", "reports");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = join(dir, "phase7-background-jobs.json");
  const passed = results.filter((r) => r.status === "PASS").length;
  const failed = results.filter((r) => r.status === "FAIL").length;
  const blocked = results.filter((r) => r.status === "BLOCKED").length;
  const na = results.filter((r) => r.status === "NA").length;
  const payload = {
    phase: 7,
    scope: "background jobs / schedulers / workers — DEV only",
    generatedAt: new Date().toISOString(),
    summary: { total: results.length, passed, failed, blocked, na },
    notes,
    results,
  };
  writeFileSync(path, JSON.stringify(payload, null, 2), "utf8");
  console.log(`\nPhase 7 report written to ${path}`);
  console.log(`Summary: ${passed} PASS / ${failed} FAIL / ${blocked} BLOCKED / ${na} NA`);
}

main()
  .catch((error) => {
    console.error("[PHASE7] fatal:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await cleanup();
    await writeReport();
  });
