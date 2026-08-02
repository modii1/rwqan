import assert from "node:assert/strict";
import "dotenv/config";

const runId = `LOCKFREE-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ids = {
  package: `${runId}-PACKAGE`,
  solo: `${runId}-SOLO`,
  editable: `${runId}-EDITABLE`,
  main: `${runId}-MAIN`,
  child: `${runId}-CHILD`,
  adminMain: `${runId}-ADMIN-MAIN`,
  adminChild: `${runId}-ADMIN-CHILD`,
  soloPayment1: `${runId}-PAY-SOLO-1`,
  soloPayment2: `${runId}-PAY-SOLO-2`,
  linkedPaymentMain: `${runId}-PAY-LINKED-MAIN`,
  linkedPaymentChild: `${runId}-PAY-LINKED-CHILD`,
};

const propertyIds = [
  ids.solo,
  ids.editable,
  ids.main,
  ids.child,
  ids.adminMain,
  ids.adminChild,
];
const subscriptionIds = [
  ids.main,
  ids.child,
  ids.adminMain,
  ids.adminChild,
];
const paymentIds = [
  ids.soloPayment1,
  ids.soloPayment2,
  ids.linkedPaymentMain,
  ids.linkedPaymentChild,
];

async function main() {
  const { firebaseService } = await import("../server/firebaseService");
  const admin = (await import("firebase-admin")).default;
  if (admin.apps.length === 0) throw new Error("Firebase is not configured");
  const db = admin.firestore();

  const createdRefs: FirebaseFirestore.DocumentReference[] = [];
  const remember = (collection: string, id: string) => {
    const ref = db.collection(collection).doc(id);
    createdRefs.push(ref);
    return ref;
  };
  const set = async (collection: string, id: string, data: Record<string, unknown>) => {
    await remember(collection, id).set(data);
  };
  const future = new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString();
  const now = new Date().toISOString();

  try {
    await set("packages", ids.package, {
      id: ids.package,
      name: "اختبار إزالة أقفال الدفع",
      duration: 30,
      durationDays: 30,
      maxProperties: 3,
      propertyCount: 3,
      isActive: true,
      price: 1,
    });
    for (const propertyNumber of propertyIds) {
      await set("properties", propertyNumber, {
        propertyNumber,
        name: `TEST ${propertyNumber}`,
        subscriptionType: "عادي",
        verificationStatus: "approved",
        createdAt: now,
      });
    }

    for (const propertyNumber of [ids.solo, ids.editable, ids.main, ids.child, ids.adminMain, ids.adminChild]) {
      await set("payment_action_locks", propertyNumber, {
        propertyNumber,
        paymentId: `${runId}-LEGACY-LOCK`,
        action: "upgrade",
        state: "processing",
        reservedAt: now,
      });
    }

    const soloPayment1 = await firebaseService.createPayment({
      id: ids.soloPayment1,
      propertyNumber: ids.solo,
      packageId: ids.package,
      amount: 1,
      finalAmount: 1,
      status: "pending",
      action: "new",
      paymentMethod: "بطاقة",
    } as any);
    const soloPayment2 = await firebaseService.createPayment({
      id: ids.soloPayment2,
      propertyNumber: ids.solo,
      packageId: ids.package,
      amount: 1,
      finalAmount: 1,
      status: "pending",
      action: "new",
      paymentMethod: "بطاقة",
    } as any);
    createdRefs.push(
      db.collection("payments").doc(ids.soloPayment1),
      db.collection("payments").doc(ids.soloPayment2),
    );
    assert.equal(soloPayment1.id, ids.soloPayment1);
    assert.equal(soloPayment2.id, ids.soloPayment2);

    const claims = await Promise.all([
      firebaseService.claimPaymentFulfillment(ids.soloPayment1),
      firebaseService.claimPaymentFulfillment(ids.soloPayment1),
    ]);
    assert.equal(claims.filter((claim) => claim.status === "claimed").length, 1);
    assert.equal(claims.filter((claim) => claim.status === "processing").length, 1);
    const claimed = claims.find((claim) => claim.status === "claimed");
    assert.ok(claimed?.status === "claimed");
    await firebaseService.releasePaymentFulfillment(ids.soloPayment1, claimed.token);

    await firebaseService.updateProperty(ids.editable, { name: "TEST EDITED WITH LEGACY LOCK" } as any);
    assert.equal((await firebaseService.getPropertyByNumber(ids.editable))?.name, "TEST EDITED WITH LEGACY LOCK");
    await firebaseService.deleteProperty(ids.editable);
    assert.equal(await firebaseService.getPropertyByNumber(ids.editable), null);

    await set("subscriptions", `SUB-${ids.main}`, {
      id: `SUB-${ids.main}`,
      propertyNumber: ids.main,
      packageId: ids.package,
      subscriptionType: "مميز",
      status: "نشط",
      startDate: now,
      endDate: future,
      linkedProperties: [ids.child],
      propertyCount: 2,
    });
    await set("subscriptions", `SUB-${ids.child}`, {
      id: `SUB-${ids.child}`,
      propertyNumber: ids.child,
      packageId: ids.package,
      subscriptionType: "مميز",
      status: "نشط",
      startDate: now,
      endDate: future,
      linkedProperty: ids.main,
    });
    await Promise.all([
      firebaseService.createPayment({
        id: ids.linkedPaymentMain,
        propertyNumber: ids.main,
        packageId: ids.package,
        amount: 1,
        finalAmount: 1,
        status: "pending",
        action: "upgrade",
        paymentMethod: "بطاقة",
        additionalProperties: [ids.child],
        linkedProperties: [ids.child],
      } as any),
      firebaseService.createPayment({
        id: ids.linkedPaymentChild,
        propertyNumber: ids.child,
        packageId: ids.package,
        amount: 1,
        finalAmount: 1,
        status: "pending",
        action: "upgrade",
        paymentMethod: "بطاقة",
      } as any),
    ]);
    createdRefs.push(
      db.collection("payments").doc(ids.linkedPaymentMain),
      db.collection("payments").doc(ids.linkedPaymentChild),
    );

    await firebaseService.unlinkLinkedPropertiesAtomically({
      mainPropertyNumber: ids.main,
      propertyNumbers: [ids.child],
    });
    assert.deepEqual(
      (await firebaseService.getSubscriptionByPropertyNumber(ids.main))?.linkedProperties,
      [],
    );
    assert.equal(
      (await firebaseService.getSubscriptionByPropertyNumber(ids.child))?.linkedProperty || "",
      "",
    );

    await set("subscriptions", `SUB-${ids.adminMain}`, {
      id: `SUB-${ids.adminMain}`,
      propertyNumber: ids.adminMain,
      packageId: ids.package,
      subscriptionType: "مميز",
      status: "نشط",
      startDate: now,
      endDate: future,
      linkedProperties: [],
      propertyCount: 1,
    });
    await firebaseService.mutateLinkedPropertyGroupAtomically({
      mainPropertyNumber: ids.adminMain,
      addPropertyNumbers: [ids.adminChild],
      approveAddedProperties: true,
    });
    assert.deepEqual(
      (await firebaseService.getSubscriptionByPropertyNumber(ids.adminMain))?.linkedProperties,
      [ids.adminChild],
    );
    await firebaseService.unlinkLinkedPropertiesAtomically({
      mainPropertyNumber: ids.adminMain,
      propertyNumbers: [ids.adminChild],
    });
    assert.deepEqual(
      (await firebaseService.getSubscriptionByPropertyNumber(ids.adminMain))?.linkedProperties,
      [],
    );

    for (const propertyNumber of propertyIds) {
      const lock = await db.collection("payment_action_locks").doc(propertyNumber).get();
      assert.equal(lock.data()?.paymentId, `${runId}-LEGACY-LOCK`);
    }

    console.log(JSON.stringify({
      ok: true,
      runId,
      scenarios: [
        "solo payments ignore legacy property locks",
        "one payment remains idempotent under concurrent fulfillment claims",
        "property update and delete ignore legacy locks",
        "linked main and child payments can coexist without group locks",
        "owner-style unlink succeeds while legacy locks exist",
        "admin-style add and unlink succeed while legacy locks exist",
      ],
    }, null, 2));
  } finally {
    for (const id of paymentIds) createdRefs.push(db.collection("payments").doc(id));
    for (const propertyNumber of propertyIds) {
      createdRefs.push(
        db.collection("properties").doc(propertyNumber),
        db.collection("payment_action_locks").doc(propertyNumber),
      );
    }
    for (const propertyNumber of subscriptionIds) {
      createdRefs.push(db.collection("subscriptions").doc(`SUB-${propertyNumber}`));
    }
    for (const propertyNumber of [ids.main, ids.adminMain]) {
      createdRefs.push(
        db.collection("multi_property_subscriptions").doc(
          `MULTI-${encodeURIComponent(propertyNumber)}`,
        ),
      );
    }
    createdRefs.push(db.collection("packages").doc(ids.package));
    const uniqueRefs = [...new Map(createdRefs.map((ref) => [ref.path, ref])).values()];
    for (let offset = 0; offset < uniqueRefs.length; offset += 400) {
      const batch = db.batch();
      for (const ref of uniqueRefs.slice(offset, offset + 400)) batch.delete(ref);
      await batch.commit();
    }
  }
}

await main();
