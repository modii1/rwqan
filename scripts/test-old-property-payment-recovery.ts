import assert from "node:assert/strict";
import "dotenv/config";

import admin from "firebase-admin";

const runId = `OLD-PROPERTY-RECOVERY-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ids = {
  package: `${runId}-VIP`,
  oldMain: `${runId}-MAIN`,
  oldChild: `${runId}-CHILD`,
  oldPayment: `${runId}-PAY-OLD`,
  newProperty: `${runId}-NEW`,
  newPayment: `${runId}-PAY-NEW`,
};

async function main() {
  const { firebaseService } = await import("../server/firebaseService");
  const { paymentService } = await import("../server/services/PaymentService");
  const { adminApprovalService } = await import(
    "../server/services/AdminApprovalService"
  );
  if (admin.apps.length === 0) throw new Error("Firebase is not configured");

  const db = admin.firestore();
  const createdRefs = new Map<string, FirebaseFirestore.DocumentReference>();
  const remember = (collection: string, id: string) => {
    const ref = db.collection(collection).doc(id);
    createdRefs.set(ref.path, ref);
    return ref;
  };
  const set = async (
    collection: string,
    id: string,
    data: Record<string, unknown>,
  ) => remember(collection, id).set(data);
  const now = new Date();
  const pendingEndDate = new Date(
    now.getTime() + 30 * 24 * 60 * 60 * 1000,
  ).toISOString();

  const originalRequireCompleteProperty =
    adminApprovalService.requireCompleteProperty;
  const originalRequireCompleteLinkedProperties =
    adminApprovalService.requireCompleteLinkedProperties;
  const originalAddVerificationLog = firebaseService.addVerificationLog;

  try {
    await set("packages", ids.package, {
      id: ids.package,
      name: "Old property recovery integration package",
      duration: 30,
      durationDays: 30,
      price: 50,
      pricePerProperty: 25,
      propertyCount: 2,
      maxProperties: 5,
      type: "مميز",
      isActive: true,
    });
    await set("properties", ids.oldMain, {
      propertyNumber: ids.oldMain,
      name: ids.oldMain,
      pin: "1234",
      subscriptionType: "عادي",
      verificationStatus: "pending",
      smartVerificationPassed: true,
      pendingPaidSubscription: true,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    await set("properties", ids.oldChild, {
      propertyNumber: ids.oldChild,
      name: ids.oldChild,
      pin: "1234",
      subscriptionType: "عادي",
      verificationStatus: "approved",
      linkedProperty: ids.oldMain,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    await set("subscriptions", `SUB-${ids.oldMain}`, {
      id: `SUB-${ids.oldMain}`,
      propertyNumber: ids.oldMain,
      packageId: ids.package,
      paymentId: `${runId}-PRIOR-PAYMENT`,
      status: "منتهي",
      startDate: "2026-07-01",
      endDate: "",
      cancelledAt: "2026-08-01T00:00:00.000Z",
      cancelReason: "admin",
      linkedProperties: [ids.oldChild],
      propertyCount: 2,
      subscriptionType: "عادي",
    });
    await set("subscriptions", `SUB-${ids.oldChild}`, {
      id: `SUB-${ids.oldChild}`,
      propertyNumber: ids.oldChild,
      packageId: ids.package,
      paymentId: `${runId}-PRIOR-PAYMENT`,
      status: "منتهي",
      startDate: "2026-07-01",
      endDate: "",
      cancelledAt: "2026-08-01T00:00:00.000Z",
      cancelReason: "admin",
      linkedProperty: ids.oldMain,
      propertyCount: 1,
      subscriptionType: "عادي",
    });
    await set("payments", ids.oldPayment, {
      id: ids.oldPayment,
      propertyNumber: ids.oldMain,
      packageId: ids.package,
      amount: 50,
      finalAmount: 50,
      status: "نجح - قيد التحقق",
      action: "new",
      paymentMethod: "APPLE_PAY",
      additionalProperties: [ids.oldChild],
      linkedProperties: [ids.oldChild],
      secondPropertyNumber: ids.oldChild,
      pendingPropertyApproval: true,
      propertyApprovalQueuedAt: now.toISOString(),
      pendingStartDate: now.toISOString(),
      pendingEndDate,
      fulfillmentState: "failed",
      completedAt: now.toISOString(),
      createdAt: now.toISOString(),
    });

    await set("properties", ids.newProperty, {
      propertyNumber: ids.newProperty,
      name: ids.newProperty,
      pin: "1234",
      subscriptionType: "عادي",
      verificationStatus: "pending",
      smartVerificationPassed: true,
      pendingPaidSubscription: true,
      createdAt: now.toISOString(),
    });
    await set("payments", ids.newPayment, {
      id: ids.newPayment,
      propertyNumber: ids.newProperty,
      packageId: ids.package,
      amount: 50,
      finalAmount: 50,
      status: "نجح - قيد التحقق",
      action: "new",
      paymentMethod: "APPLE_PAY",
      pendingPropertyApproval: true,
      propertyApprovalQueuedAt: now.toISOString(),
      pendingStartDate: now.toISOString(),
      pendingEndDate,
      fulfillmentState: "failed",
      completedAt: now.toISOString(),
      createdAt: now.toISOString(),
    });

    (adminApprovalService as any).requireCompleteProperty = async (
      propertyNumber: string,
    ) => ({
      property: await firebaseService.getPropertyByNumber(propertyNumber),
      imageCount: 3,
      validation: {
        isComplete: true,
        missingFields: [],
        warnings: [],
        completionScore: 100,
      },
    });
    (adminApprovalService as any).requireCompleteLinkedProperties = async () =>
      undefined;
    (firebaseService as any).addVerificationLog = async () => undefined;

    const recovered = await paymentService.approveBankTransfer(ids.oldPayment);
    assert.deepEqual(recovered, { outcome: "activated" });

    const oldPayment = await firebaseService.getPaymentById(ids.oldPayment);
    const oldMainProperty = await firebaseService.getPropertyByNumber(ids.oldMain);
    const oldChildProperty = await firebaseService.getPropertyByNumber(ids.oldChild);
    const oldMainSubscription =
      await firebaseService.getSubscriptionByPropertyNumber(ids.oldMain);
    const oldChildSubscription =
      await firebaseService.getSubscriptionByPropertyNumber(ids.oldChild);
    assert.equal(oldPayment?.status, "مكتمل");
    assert.equal(oldPayment?.fulfillmentState, "fulfilled");
    assert.ok(oldPayment?.fulfilledAt);
    assert.equal(oldPayment?.pendingPropertyApproval, false);
    assert.equal(oldMainProperty?.verificationStatus, "approved");
    assert.equal((oldMainProperty as any)?.pendingPaidSubscription, false);
    assert.equal(oldChildProperty?.verificationStatus, "approved");
    assert.equal(oldMainSubscription?.status, "نشط");
    assert.ok(oldMainSubscription?.endDate);
    assert.equal(oldMainSubscription?.paymentId, ids.oldPayment);
    assert.deepEqual(oldMainSubscription?.linkedProperties, [ids.oldChild]);
    assert.equal(oldChildSubscription?.status, "نشط");
    assert.equal(oldChildSubscription?.paymentId, ids.oldPayment);
    assert.equal(oldChildSubscription?.linkedProperty, ids.oldMain);

    const genuinelyNew = await paymentService.approveBankTransfer(ids.newPayment);
    assert.deepEqual(genuinelyNew, {
      outcome: "queued",
      alreadyProcessed: true,
    });
    assert.equal(
      await firebaseService.getSubscriptionByPropertyNumber(ids.newProperty),
      null,
    );
    const newPayment = await firebaseService.getPaymentById(ids.newPayment);
    assert.equal(newPayment?.status, "نجح - قيد التحقق");
    assert.equal(newPayment?.pendingPropertyApproval, true);

    for (const propertyNumber of [
      ids.oldMain,
      ids.oldChild,
      ids.newProperty,
    ]) {
      assert.equal(
        (await db.collection("payment_action_locks").doc(propertyNumber).get())
          .exists,
        false,
      );
    }

    console.log(JSON.stringify({
      ok: true,
      runId,
      scenarios: {
        oldLinkedPropertyRecovered: true,
        oldPaymentStatus: oldPayment?.status,
        oldMainVerificationStatus: oldMainProperty?.verificationStatus,
        oldChildVerificationStatus: oldChildProperty?.verificationStatus,
        linkedPropertyCount: oldMainSubscription?.linkedProperties?.length || 0,
        genuinelyNewPropertyStillQueued: genuinelyNew.outcome === "queued",
        paymentLocksCreated: false,
      },
    }, null, 2));
  } finally {
    (adminApprovalService as any).requireCompleteProperty =
      originalRequireCompleteProperty;
    (adminApprovalService as any).requireCompleteLinkedProperties =
      originalRequireCompleteLinkedProperties;
    (firebaseService as any).addVerificationLog = originalAddVerificationLog;

    for (const paymentId of [ids.oldPayment, ids.newPayment]) {
      remember("payments", paymentId);
    }
    for (const propertyNumber of [
      ids.oldMain,
      ids.oldChild,
      ids.newProperty,
    ]) {
      remember("properties", propertyNumber);
      remember("subscriptions", `SUB-${propertyNumber}`);
      remember("payment_action_locks", propertyNumber);
    }
    remember("packages", ids.package);

    const multiSnapshot = await db.collection("multi_property_subscriptions").get();
    for (const document of multiSnapshot.docs) {
      const data = document.data();
      const values = [
        data.propertyNumber1,
        data.propertyNumber2,
        ...(data.additionalProperties || []),
        ...(data.linkedProperties || []),
      ].map((value) => String(value || ""));
      if (values.some((value) => value.startsWith(runId))) {
        createdRefs.set(document.ref.path, document.ref);
      }
    }

    const refs = Array.from(createdRefs.values());
    for (let offset = 0; offset < refs.length; offset += 400) {
      const batch = db.batch();
      for (const ref of refs.slice(offset, offset + 400)) batch.delete(ref);
      await batch.commit();
    }
  }
}

await main();
