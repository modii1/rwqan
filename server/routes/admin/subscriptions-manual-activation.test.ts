import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";

import express from "express";

import { firebaseService } from "../../firebaseService";
import { propertyService, subscriptionService } from "../../services";
import subscriptionsRouter from "./subscriptions";

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
