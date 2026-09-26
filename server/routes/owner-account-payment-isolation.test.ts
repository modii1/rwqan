import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";

import express from "express";

import { firebaseService } from "../firebaseService";
import { paymentService, propertyService, subscriptionService } from "../services";
import { ownerAccountStore } from "../services/OwnerAccountStore";
import { storage } from "../storage";
import ownerRouter from "./owner";

const ACCOUNT_ID = "A".repeat(43);
const CURRENT_PROPERTY = "11111";
const FOREIGN_PROPERTY = "22222";

async function startOwnerAccountApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = {
      propertyNumber: CURRENT_PROPERTY,
      ownerAccountId: ACCOUNT_ID,
      authVersion: 1,
    };
    next();
  });
  app.use(ownerRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  return {
    server,
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
  };
}

test("owner-account payment history excludes payments with a stale live linked target", async () => {
  const originals = {
    validate: ownerAccountStore.validateActiveMembership,
    list: ownerAccountStore.listActiveMemberships,
    property: firebaseService.getPropertyByNumber,
    subscription: firebaseService.getSubscriptionByPropertyNumber,
    linked: firebaseService.getSubscriptionsLinkedToProperty,
    multi: firebaseService.getMultiPropertySubscriptions,
    payments: paymentService.getByProperty,
  };
  const paymentReads: string[] = [];
  (ownerAccountStore as any).validateActiveMembership = async (input: any) =>
    input.ownerAccountId === ACCOUNT_ID &&
    input.authVersion === 1 &&
    input.propertyNumber === CURRENT_PROPERTY;
  (ownerAccountStore as any).listActiveMemberships = async () => [{
    ownerAccountId: ACCOUNT_ID,
    propertyNumber: CURRENT_PROPERTY,
    status: "active",
    isPrimary: true,
  }];
  (firebaseService as any).getPropertyByNumber = async (propertyNumber: string) => ({
    propertyNumber,
    pin: "same-legacy-pin",
  });
  (firebaseService as any).getSubscriptionByPropertyNumber = async (
    propertyNumber: string,
  ) => propertyNumber === CURRENT_PROPERTY
    ? { propertyNumber, linkedProperty: FOREIGN_PROPERTY }
    : { propertyNumber };
  (firebaseService as any).getSubscriptionsLinkedToProperty = async () => [{
    propertyNumber: CURRENT_PROPERTY,
    linkedProperty: FOREIGN_PROPERTY,
  }];
  (firebaseService as any).getMultiPropertySubscriptions = async () => [];
  (paymentService as any).getByProperty = async (propertyNumber: string) => {
    paymentReads.push(propertyNumber);
    return [{
      id: `PAY-${propertyNumber}`,
      propertyNumber,
      status: "مكتمل",
      packageId: "pkg",
      amount: 100,
      finalAmount: 100,
      paymentMethod: "بطاقة",
      createdAt: "2026-09-26T00:00:00.000Z",
    }];
  };

  const { server, baseUrl } = await startOwnerAccountApp();
  try {
    const response = await fetch(`${baseUrl}/api/owner/payments`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(paymentReads, [CURRENT_PROPERTY]);
    assert.deepEqual(payload, []);
    assert.doesNotMatch(JSON.stringify(payload), new RegExp(FOREIGN_PROPERTY));
  } finally {
    ownerAccountStore.validateActiveMembership = originals.validate;
    ownerAccountStore.listActiveMemberships = originals.list;
    firebaseService.getPropertyByNumber = originals.property;
    firebaseService.getSubscriptionByPropertyNumber = originals.subscription;
    firebaseService.getSubscriptionsLinkedToProperty = originals.linked;
    firebaseService.getMultiPropertySubscriptions = originals.multi;
    paymentService.getByProperty = originals.payments;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("owner account subscription response hides a stale foreign parent", async () => {
  const originals = {
    validate: ownerAccountStore.validateActiveMembership,
    subscription: firebaseService.getSubscriptionByPropertyNumber,
    property: firebaseService.getPropertyByNumber,
  };
  (ownerAccountStore as any).validateActiveMembership = async (input: any) =>
    input.ownerAccountId === ACCOUNT_ID &&
    input.authVersion === 1 &&
    input.propertyNumber === CURRENT_PROPERTY;
  (firebaseService as any).getSubscriptionByPropertyNumber = async () => ({
    propertyNumber: CURRENT_PROPERTY,
    linkedProperty: FOREIGN_PROPERTY,
    packageId: "pkg",
    status: "active",
    startDate: "2026-09-01T00:00:00.000Z",
    endDate: "2026-10-01T00:00:00.000Z",
    propertyCount: 2,
  });
  (firebaseService as any).getPropertyByNumber = async () => ({
    propertyNumber: CURRENT_PROPERTY,
    name: "Current property",
  });

  const { server, baseUrl } = await startOwnerAccountApp();
  try {
    const response = await fetch(
      `${baseUrl}/api/owner/subscription/${CURRENT_PROPERTY}`,
    );
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.subscription.linkedProperty, undefined);
    assert.doesNotMatch(JSON.stringify(payload), new RegExp(FOREIGN_PROPERTY));
  } finally {
    ownerAccountStore.validateActiveMembership = originals.validate;
    firebaseService.getSubscriptionByPropertyNumber = originals.subscription;
    firebaseService.getPropertyByNumber = originals.property;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("owner account cannot retry a payment owned by another account", async () => {
  const originals = {
    validate: ownerAccountStore.validateActiveMembership,
    getPayment: paymentService.getById,
    retry: firebaseService.reservePaymentActionForRetry,
    subscription: firebaseService.getSubscriptionByPropertyNumber,
  };
  let retryCalls = 0;
  (ownerAccountStore as any).validateActiveMembership = async (input: any) =>
    input.propertyNumber === CURRENT_PROPERTY;
  (paymentService as any).getById = async () => ({
    id: "PAY-FOREIGN",
    propertyNumber: CURRENT_PROPERTY,
    packageId: "pkg",
    status: "مرفوض",
    amount: 100,
    finalAmount: 100,
    paymentMethod: "بطاقة",
    additionalProperties: [FOREIGN_PROPERTY],
  });
  (firebaseService as any).getSubscriptionByPropertyNumber = async () => null;
  (firebaseService as any).reservePaymentActionForRetry = async () => {
    retryCalls += 1;
    throw new Error("must not retry");
  };

  const { server, baseUrl } = await startOwnerAccountApp();
  try {
    const response = await fetch(`${baseUrl}/api/owner/payment/retry`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paymentId: "PAY-FOREIGN" }),
    });
    assert.equal(response.status, 403);
    assert.equal(retryCalls, 0);
  } finally {
    ownerAccountStore.validateActiveMembership = originals.validate;
    paymentService.getById = originals.getPayment;
    firebaseService.reservePaymentActionForRetry = originals.retry;
    firebaseService.getSubscriptionByPropertyNumber = originals.subscription;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("owner verification rejects a stale linked payment before property mutation", async () => {
  const originals = {
    validate: ownerAccountStore.validateActiveMembership,
    suspendedSubscription: firebaseService.getSubscriptionByPropertyNumber,
    property: propertyService.getByNumber,
    subscription: subscriptionService.getByProperty,
    payments: paymentService.getByProperty,
    paymentUpdate: paymentService.update,
    propertyUpdate: firebaseService.updateProperty,
    verificationUpdate: firebaseService.updateVerificationStatus,
  };
  const mutations: string[] = [];
  (ownerAccountStore as any).validateActiveMembership = async (input: any) =>
    input.ownerAccountId === ACCOUNT_ID &&
    input.authVersion === 1 &&
    input.propertyNumber === CURRENT_PROPERTY;
  (firebaseService as any).getSubscriptionByPropertyNumber = async () => null;
  (propertyService as any).getByNumber = async () => ({
    propertyNumber: CURRENT_PROPERTY,
    name: "Current property",
    verificationStatus: "pending",
  });
  (subscriptionService as any).getByProperty = async () => null;
  (paymentService as any).getByProperty = async () => [{
    id: "PAY-STALE-VERIFY",
    propertyNumber: CURRENT_PROPERTY,
    packageId: "pkg",
    status: "نجح - قيد التحقق",
    amount: 100,
    finalAmount: 100,
    paymentMethod: "بطاقة",
    additionalProperties: [FOREIGN_PROPERTY],
    createdAt: "2026-09-26T00:00:00.000Z",
  }];
  (paymentService as any).update = async () => {
    mutations.push("payment");
    throw new Error("must not bind a stale payment");
  };
  (firebaseService as any).updateProperty = async () => {
    mutations.push("property");
    throw new Error("must not mutate property");
  };
  (firebaseService as any).updateVerificationStatus = async () => {
    mutations.push("verification");
    throw new Error("must not mutate verification");
  };

  const { server, baseUrl } = await startOwnerAccountApp();
  try {
    const response = await fetch(`${baseUrl}/api/owner/property/run-verification`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assert.equal(response.status, 403);
    assert.deepEqual(mutations, []);
  } finally {
    ownerAccountStore.validateActiveMembership = originals.validate;
    firebaseService.getSubscriptionByPropertyNumber = originals.suspendedSubscription;
    propertyService.getByNumber = originals.property;
    subscriptionService.getByProperty = originals.subscription;
    paymentService.getByProperty = originals.payments;
    paymentService.update = originals.paymentUpdate;
    firebaseService.updateProperty = originals.propertyUpdate;
    firebaseService.updateVerificationStatus = originals.verificationUpdate;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("owner account activation revalidates persisted linked properties before fulfillment", async () => {
  const originals = {
    validate: ownerAccountStore.validateActiveMembership,
    suspendedSubscription: firebaseService.getSubscriptionByPropertyNumber,
    property: propertyService.getByNumber,
    payments: paymentService.getByProperty,
    package: storage.getPackageById,
    subscription: subscriptionService.getByProperty,
    claim: firebaseService.claimPaymentFulfillment,
  };
  let claimCalls = 0;
  (ownerAccountStore as any).validateActiveMembership = async (input: any) =>
    input.propertyNumber === CURRENT_PROPERTY;
  (firebaseService as any).getSubscriptionByPropertyNumber = async () => null;
  (propertyService as any).getByNumber = async () => ({
    propertyNumber: CURRENT_PROPERTY,
    name: "Current property",
    verificationStatus: "approved",
  });
  (paymentService as any).getByProperty = async () => [{
    id: "PAY-CURRENT",
    propertyNumber: CURRENT_PROPERTY,
    packageId: "pkg",
    status: "مكتمل",
    action: "new",
    amount: 100,
    finalAmount: 100,
    paymentMethod: "بطاقة",
    secondPropertyNumber: FOREIGN_PROPERTY,
  }];
  (storage as any).getPackageById = async () => ({
    id: "pkg",
    name: "Package",
    price: 100,
    duration: 90,
    type: "مميز",
  });
  (subscriptionService as any).getByProperty = async () => null;
  (firebaseService as any).claimPaymentFulfillment = async () => {
    claimCalls += 1;
    return { status: "claimed", token: "token" };
  };

  const { server, baseUrl } = await startOwnerAccountApp();
  try {
    const response = await fetch(`${baseUrl}/api/owner/property/activate`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ status: "approved" }),
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, "LINKED_PROPERTY_FORBIDDEN");
    assert.equal(claimCalls, 0);
  } finally {
    ownerAccountStore.validateActiveMembership = originals.validate;
    firebaseService.getSubscriptionByPropertyNumber = originals.suspendedSubscription;
    propertyService.getByNumber = originals.property;
    paymentService.getByProperty = originals.payments;
    storage.getPackageById = originals.package;
    subscriptionService.getByProperty = originals.subscription;
    firebaseService.claimPaymentFulfillment = originals.claim;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("owner account confirmation rejects a stale linked target before claiming fulfillment", async () => {
  const originals = {
    validate: ownerAccountStore.validateActiveMembership,
    payment: firebaseService.getPaymentById,
    package: storage.getPackageById,
    property: firebaseService.getPropertyByNumber,
    subscriptions: firebaseService.getSubscriptionsByProperty,
    claim: firebaseService.claimPaymentFulfillment,
  };
  let claimCalls = 0;
  (ownerAccountStore as any).validateActiveMembership = async (input: any) =>
    input.propertyNumber === CURRENT_PROPERTY;
  (firebaseService as any).getPaymentById = async () => ({
    id: "PAY-CURRENT",
    propertyNumber: CURRENT_PROPERTY,
    packageId: "pkg",
    status: "مكتمل",
    action: "extend",
    amount: 100,
    finalAmount: 100,
    paymentMethod: "بطاقة",
    additionalProperties: [FOREIGN_PROPERTY],
  });
  (storage as any).getPackageById = async () => ({
    id: "pkg",
    name: "Package",
    price: 100,
    duration: 90,
    type: "مميز",
  });
  (firebaseService as any).getPropertyByNumber = async () => ({
    propertyNumber: CURRENT_PROPERTY,
    name: "Current property",
  });
  (firebaseService as any).getSubscriptionsByProperty = async () => [];
  (firebaseService as any).claimPaymentFulfillment = async () => {
    claimCalls += 1;
    return { status: "claimed", token: "token" };
  };

  const { server, baseUrl } = await startOwnerAccountApp();
  try {
    const response = await fetch(`${baseUrl}/api/owner/subscription/confirm`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        action: "extend",
        packageId: "pkg",
        paymentId: "PAY-CURRENT",
      }),
    });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, "LINKED_PROPERTY_FORBIDDEN");
    assert.equal(claimCalls, 0);
  } finally {
    ownerAccountStore.validateActiveMembership = originals.validate;
    firebaseService.getPaymentById = originals.payment;
    storage.getPackageById = originals.package;
    firebaseService.getPropertyByNumber = originals.property;
    firebaseService.getSubscriptionsByProperty = originals.subscriptions;
    firebaseService.claimPaymentFulfillment = originals.claim;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
