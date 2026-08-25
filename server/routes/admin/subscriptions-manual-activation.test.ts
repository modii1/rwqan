import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";

import express from "express";

import { firebaseService } from "../../firebaseService";
import { propertyService, subscriptionService } from "../../services";
import subscriptionsRouter from "./subscriptions";
import { createPublicRegistrationPlan } from "../../../shared/freeCommissionConsent";

test("manual free activation cannot bypass a forward-tracked registration", async (t) => {
  const originals = {
    getSubscriptionByPropertyNumber:
      firebaseService.getSubscriptionByPropertyNumber,
    getMultiPropertySubscriptions:
      firebaseService.getMultiPropertySubscriptions,
    addSubscriptionToSheet: firebaseService.addSubscriptionToSheet,
    getPropertyByNumber: propertyService.getByNumber,
    approveProperty: propertyService.approve,
    getPurchasablePackageById:
      subscriptionService.getPurchasablePackageById,
  };
  let property: Record<string, unknown> = {};
  let subscriptionWrites = 0;
  let approvalWrites = 0;

  (firebaseService as any).getSubscriptionByPropertyNumber = async () => null;
  (firebaseService as any).getMultiPropertySubscriptions = async () => [];
  (firebaseService as any).addSubscriptionToSheet = async () => {
    subscriptionWrites += 1;
  };
  (propertyService as any).getByNumber = async () => property;
  (propertyService as any).approve = async () => {
    approvalWrites += 1;
  };
  (subscriptionService as any).getPurchasablePackageById = async () => ({
    id: "pkg-free",
    name: "Free",
    duration: 30,
    price: 0,
    type: "free",
    isActive: true,
  });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = { isAdmin: true };
    next();
  });
  app.use(subscriptionsRouter);

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const { port } = server.address() as AddressInfo;
  const endpoint = `http://127.0.0.1:${port}/api/admin/subscription/manual-activate`;
  const requestActivation = () => fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      propertyNumber: "PROP-TRACKED",
      packageId: "pkg-free",
      startDate: new Date().toISOString(),
      endDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1_000).toISOString(),
    }),
  });

  try {
    await t.test("tracked free registration needs matching consent", async () => {
      property = {
        propertyNumber: "PROP-TRACKED",
        name: "Tracked free",
        registrationPlan: createPublicRegistrationPlan({
          packageId: "pkg-free",
          isFree: true,
          selectedAt: "2026-08-24T10:00:00.000Z",
        }),
      };
      const response = await requestActivation();
      assert.equal(response.status, 409);
      assert.equal(
        (await response.json()).code,
        "FREE_COMMISSION_CONSENT_REQUIRED",
      );
      assert.equal(subscriptionWrites, 0);
      assert.equal(approvalWrites, 0);
    });

    await t.test("tracked paid registration cannot be converted to free", async () => {
      property = {
        propertyNumber: "PROP-TRACKED",
        name: "Tracked paid",
        registrationPlan: createPublicRegistrationPlan({
          packageId: "pkg-paid",
          isFree: false,
          selectedAt: "2026-08-24T10:00:00.000Z",
        }),
      };
      const response = await requestActivation();
      assert.equal(response.status, 409);
      assert.equal(
        (await response.json()).code,
        "PAID_REGISTRATION_PAYMENT_REQUIRED",
      );
      assert.equal(subscriptionWrites, 0);
      assert.equal(approvalWrites, 0);
    });
  } finally {
    firebaseService.getSubscriptionByPropertyNumber =
      originals.getSubscriptionByPropertyNumber;
    firebaseService.getMultiPropertySubscriptions =
      originals.getMultiPropertySubscriptions;
    firebaseService.addSubscriptionToSheet =
      originals.addSubscriptionToSheet;
    propertyService.getByNumber = originals.getPropertyByNumber;
    propertyService.approve = originals.approveProperty;
    subscriptionService.getPurchasablePackageById =
      originals.getPurchasablePackageById;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("manual activation preflights the full linked group before any write", async () => {
  const originals = {
    getSubscriptionByPropertyNumber:
      firebaseService.getSubscriptionByPropertyNumber,
    getMultiPropertySubscriptions:
      firebaseService.getMultiPropertySubscriptions,
    addSubscriptionToSheet: firebaseService.addSubscriptionToSheet,
    getPropertyByNumber: propertyService.getByNumber,
    approveProperty: propertyService.approve,
    getPurchasablePackageById:
      subscriptionService.getPurchasablePackageById,
  };
  let subscriptionWrites = 0;
  let approvalWrites = 0;

  (firebaseService as any).getSubscriptionByPropertyNumber = async (
    propertyNumber: string,
  ) => {
    if (propertyNumber === "PROP-MAIN") {
      return {
        id: "SUB-PROP-MAIN",
        propertyNumber,
        status: "ساري",
        linkedProperties: ["PROP-CHILD"],
        startDate: "2026-07-20T00:00:00.000Z",
        endDate: "2026-08-10T00:00:00.000Z",
      };
    }
    return {
      id: "SUB-PROP-CHILD",
      propertyNumber,
      status: "موقوف مؤقتاً",
      startDate: "2026-07-20T00:00:00.000Z",
      endDate: "2026-08-10T00:00:00.000Z",
    };
  };
  (firebaseService as any).getMultiPropertySubscriptions = async () => [];
  (firebaseService as any).addSubscriptionToSheet = async () => {
    subscriptionWrites += 1;
    throw new Error("subscription mutation must not start");
  };
  (propertyService as any).getByNumber = async (propertyNumber: string) => ({
    propertyNumber,
    name: propertyNumber,
  });
  (propertyService as any).approve = async () => {
    approvalWrites += 1;
    throw new Error("verification mutation must not start");
  };
  (subscriptionService as any).getPurchasablePackageById = async () => ({
    id: "PKG-1",
    name: "Test package",
    duration: 10,
    price: 100,
    type: "مميز",
    isActive: true,
  });

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = { isAdmin: true };
    next();
  });
  app.use(subscriptionsRouter);

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const { port } = server.address() as AddressInfo;
  const startDate = new Date();
  const endDate = new Date(startDate.getTime() + 10 * 24 * 60 * 60 * 1000);

  try {
    const response = await fetch(
      `http://127.0.0.1:${port}/api/admin/subscription/manual-activate`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          propertyNumber: "PROP-MAIN",
          packageId: "PKG-1",
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
        }),
      },
    );
    const payload = await response.json();

    assert.equal(response.status, 423);
    assert.equal(payload.success, false);
    assert.equal(payload.code, "PROPERTY_SUSPENDED");
    assert.match(payload.error, /PROP-CHILD/);
    assert.equal(subscriptionWrites, 0);
    assert.equal(approvalWrites, 0);
  } finally {
    firebaseService.getSubscriptionByPropertyNumber =
      originals.getSubscriptionByPropertyNumber;
    firebaseService.getMultiPropertySubscriptions =
      originals.getMultiPropertySubscriptions;
    firebaseService.addSubscriptionToSheet =
      originals.addSubscriptionToSheet;
    propertyService.getByNumber = originals.getPropertyByNumber;
    propertyService.approve = originals.approveProperty;
    subscriptionService.getPurchasablePackageById =
      originals.getPurchasablePackageById;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("admin subscriptions derives future status and hides uncorroborated legacy links", async () => {
  const originals = {
    getSubscriptions: subscriptionService.getAll,
    getPackages: subscriptionService.getPackages,
    getProperties: propertyService.getAll,
    getMultiPropertySubscriptions:
      firebaseService.getMultiPropertySubscriptions,
  };
  const futureEndDate = new Date(
    Date.now() + 20 * 24 * 60 * 60 * 1000,
  ).toISOString();
  const expiredEndDate = new Date(
    Date.now() - 2 * 24 * 60 * 60 * 1000,
  ).toISOString();

  (subscriptionService as any).getAll = async () => [
    {
      id: "SUB-MAIN",
      propertyNumber: "MAIN",
      packageId: "PKG-1",
      status: "ساري",
      subscriptionType: "مميز",
      startDate: new Date().toISOString(),
      endDate: futureEndDate,
      linkedProperties: [],
    },
    {
      id: "SUB-STALE",
      propertyNumber: "STALE",
      packageId: "PKG-1",
      status: "منتهي",
      subscriptionType: "مميز",
      startDate: new Date().toISOString(),
      endDate: futureEndDate,
      linkedProperty: "MAIN",
      cancelledAt: null,
    },
    {
      id: "SUB-CANCELLED",
      propertyNumber: "CANCELLED",
      packageId: "PKG-1",
      status: "منتهي",
      subscriptionType: "مميز",
      startDate: new Date(Date.now() - 1000).toISOString(),
      endDate: futureEndDate,
      cancelledAt: new Date().toISOString(),
    },
    {
      id: "SUB-EXPIRED",
      propertyNumber: "EXPIRED",
      packageId: "PKG-1",
      status: "ساري",
      subscriptionType: "مميز",
      startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
      endDate: expiredEndDate,
      cancelledAt: null,
    },
  ];
  (subscriptionService as any).getPackages = async () => [];
  (propertyService as any).getAll = async () => [
    { propertyNumber: "MAIN", name: "Main" },
    { propertyNumber: "STALE", name: "Stale" },
    { propertyNumber: "CANCELLED", name: "Cancelled" },
    { propertyNumber: "EXPIRED", name: "Expired" },
  ];
  (firebaseService as any).getMultiPropertySubscriptions = async () => [];

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = { isAdmin: true };
    next();
  });
  app.use(subscriptionsRouter);

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const { port } = server.address() as AddressInfo;

  try {
    const response = await fetch(
      `http://127.0.0.1:${port}/api/admin/subscriptions`,
    );
    const payload = await response.json();
    const stale = payload.find((subscription: any) =>
      subscription.propertyNumber === "STALE"
    );
    const cancelled = payload.find((subscription: any) =>
      subscription.propertyNumber === "CANCELLED"
    );
    const expired = payload.find((subscription: any) =>
      subscription.propertyNumber === "EXPIRED"
    );

    assert.equal(response.status, 200);
    assert.equal(stale.status, "ساري");
    assert.equal(stale.subscriptionType, "مميز");
    assert.equal(stale.linkedProperty, null);
    assert.equal(stale.isLinkedChild, false);
    assert.equal(cancelled.status, "منتهي");
    assert.equal(cancelled.subscriptionType, "عادي");
    assert.equal(expired.status, "منتهي");
    assert.equal(expired.subscriptionType, "عادي");
  } finally {
    subscriptionService.getAll = originals.getSubscriptions;
    subscriptionService.getPackages = originals.getPackages;
    propertyService.getAll = originals.getProperties;
    firebaseService.getMultiPropertySubscriptions =
      originals.getMultiPropertySubscriptions;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
