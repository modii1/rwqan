import assert from "node:assert/strict";
import "dotenv/config";

import admin from "firebase-admin";

import { createOwnerSubscriptionPaymentPlan } from "../server/utils/ownerSubscriptionPayment";

const runId = `GROUP-RENEWAL-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const ids = {
  package: `${runId}-VIP`,
  main: `${runId}-MAIN`,
  child: `${runId}-CHILD`,
  extra: `${runId}-EXTRA`,
  fourth: `${runId}-FOURTH`,
  fifth: `${runId}-FIFTH`,
  overflow: `${runId}-OVERFLOW`,
  pairPayment: `${runId}-PAY-PAIR`,
  triplePayment: `${runId}-PAY-TRIPLE`,
};

async function main() {
  const { firebaseService } = await import("../server/firebaseService");
  const { resolveOwnerSubscriptionGroup } = await import(
    "../server/utils/ownerSubscriptionGroup"
  );
  if (admin.apps.length === 0) {
    throw new Error("Firebase is not configured");
  }
  const db = admin.firestore();
  const createdRefs = new Map<string, FirebaseFirestore.DocumentReference>();
  const remember = (collection: string, id: string) => {
    const ref = db.collection(collection).doc(id);
    createdRefs.set(ref.path, ref);
    return ref;
  };
  const set = async (collection: string, id: string, data: Record<string, unknown>) => {
    await remember(collection, id).set(data);
  };
  const now = new Date();
  const endDate = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000).toISOString();
  const propertyNumbers = [
    ids.main,
    ids.child,
    ids.extra,
    ids.fourth,
    ids.fifth,
    ids.overflow,
  ];

  try {
    // Exercise the explicit package model that production will use after the
    // code deployment: 50 includes two properties, then 25 for each extra.
    await set("packages", ids.package, {
      id: ids.package,
      name: "VIP live integration test",
      duration: 30,
      durationDays: 30,
      price: 50,
      pricePerProperty: 25,
      propertyCount: 2,
      maxProperties: 5,
      type: "مميز",
      isActive: true,
    });
    for (const propertyNumber of propertyNumbers) {
      await set("properties", propertyNumber, {
        propertyNumber,
        name: propertyNumber,
        pin: "1234",
        subscriptionType: "مميز",
        verificationStatus: "approved",
        createdAt: now.toISOString(),
      });
    }
    await set("subscriptions", `SUB-${ids.main}`, {
      id: `SUB-${ids.main}`,
      propertyNumber: ids.main,
      packageId: ids.package,
      status: "نشط",
      startDate: now.toISOString(),
      endDate,
      linkedProperties: [ids.child],
      propertyCount: 2,
    });
    await set("subscriptions", `SUB-${ids.child}`, {
      id: `SUB-${ids.child}`,
      propertyNumber: ids.child,
      packageId: ids.package,
      status: "نشط",
      startDate: now.toISOString(),
      endDate,
      linkedProperty: ids.main,
      propertyCount: 1,
    });
    await remember("properties", ids.child).update({ linkedProperty: ids.main });

    const childContext = await resolveOwnerSubscriptionGroup(ids.child);
    assert.equal(childContext.mainPropertyNumber, ids.main);
    assert.deepEqual(childContext.propertyNumbers, [ids.main, ids.child]);

    const pkg = await firebaseService.getPurchasablePackageById(ids.package);
    assert.ok(pkg);
    const pairPlan = createOwnerSubscriptionPaymentPlan({
      action: "extend",
      mainPropertyNumber: childContext.mainPropertyNumber,
      existingLinkedPropertyNumbers: childContext.linkedPropertyNumbers,
      requestedPropertyNumbers: [],
      pkg,
    });
    assert.equal(pairPlan.pricing.total, 50);
    assert.deepEqual(pairPlan.linkedPropertyNumbers, [ids.child]);

    const triplePlan = createOwnerSubscriptionPaymentPlan({
      action: "extend",
      mainPropertyNumber: childContext.mainPropertyNumber,
      existingLinkedPropertyNumbers: childContext.linkedPropertyNumbers,
      requestedPropertyNumbers: [ids.child, ids.extra],
      pkg,
    });
    assert.equal(triplePlan.pricing.total, 75);
    assert.deepEqual(triplePlan.requestedPropertyNumbers, [ids.extra]);

    const pairPayment = await firebaseService.createPayment({
      id: ids.pairPayment,
      propertyNumber: ids.main,
      packageId: ids.package,
      amount: pairPlan.pricing.total,
      finalAmount: pairPlan.pricing.total,
      status: "pending",
      action: "extend",
      paymentMethod: "بطاقة",
      secondPropertyNumber: ids.child,
      additionalProperties: pairPlan.linkedPropertyNumbers,
      linkedProperties: pairPlan.linkedPropertyNumbers,
    } as any);
    createdRefs.set(
      db.collection("payments").doc(ids.pairPayment).path,
      db.collection("payments").doc(ids.pairPayment),
    );
    assert.equal(pairPayment.propertyNumber, ids.main);
    assert.equal(pairPayment.finalAmount, 50);

    const triplePayment = await firebaseService.createPayment({
      id: ids.triplePayment,
      propertyNumber: ids.main,
      packageId: ids.package,
      amount: triplePlan.pricing.total,
      finalAmount: triplePlan.pricing.total,
      status: "pending",
      action: "extend",
      paymentMethod: "تحويل بنكي",
      secondPropertyNumber: ids.child,
      additionalProperties: triplePlan.linkedPropertyNumbers,
      linkedProperties: triplePlan.linkedPropertyNumbers,
    } as any);
    createdRefs.set(
      db.collection("payments").doc(ids.triplePayment).path,
      db.collection("payments").doc(ids.triplePayment),
    );
    assert.equal(triplePayment.finalAmount, 75);

    const fivePlan = createOwnerSubscriptionPaymentPlan({
      action: "extend",
      mainPropertyNumber: ids.main,
      existingLinkedPropertyNumbers: [ids.child],
      requestedPropertyNumbers: [ids.extra, ids.fourth, ids.fifth],
      pkg,
    });
    assert.equal(fivePlan.pricing.total, 125);
    assert.throws(
      () => createOwnerSubscriptionPaymentPlan({
        action: "extend",
        mainPropertyNumber: ids.main,
        existingLinkedPropertyNumbers: fivePlan.linkedPropertyNumbers,
        requestedPropertyNumbers: [ids.overflow],
        pkg,
      }),
      /كحد أقصى/,
    );

    for (const propertyNumber of propertyNumbers) {
      assert.equal(
        (await db.collection("payment_action_locks").doc(propertyNumber).get()).exists,
        false,
      );
    }

    console.log(JSON.stringify({
      ok: true,
      runId,
      scenarios: {
        childInitiatedCanonicalMain: childContext.mainPropertyNumber,
        existingPairAmount: pairPlan.pricing.total,
        pairPlusOneAmount: triplePlan.pricing.total,
        fivePropertyAmount: fivePlan.pricing.total,
        packageLimit: fivePlan.maximumPropertyCount,
        paymentLocksCreated: false,
      },
    }, null, 2));
  } finally {
    for (const paymentId of [ids.pairPayment, ids.triplePayment]) {
      remember("payments", paymentId);
    }
    for (const propertyNumber of propertyNumbers) {
      remember("properties", propertyNumber);
      remember("subscriptions", `SUB-${propertyNumber}`);
      remember("payment_action_locks", propertyNumber);
    }
    remember("packages", ids.package);
    const refs = Array.from(createdRefs.values());
    for (let offset = 0; offset < refs.length; offset += 400) {
      const batch = db.batch();
      for (const ref of refs.slice(offset, offset + 400)) batch.delete(ref);
      await batch.commit();
    }
  }
}

await main();
