import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";

import express from "express";
import session from "express-session";

import { firebaseService } from "../firebaseService";
import { propertyService, subscriptionService } from "../services";
import ownerRouter from "./owner";

test("administrative suspension blocks every owner verification entry before work", async () => {
  const originals = {
    getSubscriptionByPropertyNumber:
      firebaseService.getSubscriptionByPropertyNumber,
    getPropertyByNumber: propertyService.getByNumber,
  };
  let propertyReads = 0;

  (firebaseService as any).getSubscriptionByPropertyNumber = async (
    propertyNumber: string,
  ) => ({
    id: `SUB-${propertyNumber}`,
    propertyNumber,
    packageId: "PKG-1",
    startDate: "2026-07-01T00:00:00.000Z",
    endDate: "2026-08-01T00:00:00.000Z",
    status: "موقوف مؤقتاً",
    suspendedAt: "2026-07-20T00:00:00.000Z",
    remainingDurationMs: 12 * 24 * 60 * 60 * 1000,
  });
  (propertyService as any).getByNumber = async () => {
    propertyReads += 1;
    throw new Error("property verification must not start while suspended");
  };

  const app = express();
  app.use(express.json());
  app.use(
    session({
      secret: "owner-suspension-test-secret",
      resave: false,
      saveUninitialized: true,
      cookie: { secure: false },
    }),
  );
  app.use((req, _res, next) => {
    req.session.propertyNumber = "PROP-SUSPENDED";
    next();
  });
  app.use(ownerRouter);

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const requests: Array<{ path: string; body?: Record<string, string> }> = [
      { path: "/api/owner/property/run-verification" },
      { path: "/api/owner/property/activate" },
      { path: "/api/owner/payment/PAY-SUSPENDED/rescan" },
      {
        path: "/api/owner/verify-second-property",
        body: { secondPropertyNumber: "PROP-SECOND" },
      },
      {
        path: "/api/owner/request-additional-property",
        body: { additionalPropertyNumber: "PROP-SECOND" },
      },
    ];

    for (const request of requests) {
      const response = await fetch(`${baseUrl}${request.path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request.body || {}),
      });
      const payload = await response.json();
      assert.equal(response.status, 423, request.path);
      assert.equal(payload.code, "PROPERTY_SUSPENDED", request.path);
      assert.equal(payload.notificationRequired, false, request.path);
    }

    const crossOriginRescan = await fetch(
      `${baseUrl}/api/owner/payment/PAY-SUSPENDED/rescan`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://evil.example",
        },
        body: "{}",
      },
    );
    assert.equal(crossOriginRescan.status, 403);
    assert.equal(
      (await crossOriginRescan.json()).code,
      "CROSS_ORIGIN_REQUEST",
    );
    assert.equal(propertyReads, 0);
  } finally {
    firebaseService.getSubscriptionByPropertyNumber =
      originals.getSubscriptionByPropertyNumber;
    propertyService.getByNumber = originals.getPropertyByNumber;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("saving edits on a suspended property never starts automatic verification", async () => {
  const originals = {
    getSubscriptionByPropertyNumber:
      firebaseService.getSubscriptionByPropertyNumber,
    updateProperty: firebaseService.updateProperty,
    updateVerificationStatus: firebaseService.updateVerificationStatus,
    getPropertyByNumber: propertyService.getByNumber,
    updateOwnerProperty: propertyService.update,
    getCurrentSubscription: subscriptionService.getByProperty,
  };
  let ownerUpdates = 0;
  let ownerUpdatePayload: Record<string, unknown> | null = null;
  let verificationWork = 0;

  (firebaseService as any).getSubscriptionByPropertyNumber = async () => ({
    id: "SUB-PROP-SUSPENDED",
    propertyNumber: "PROP-SUSPENDED",
    status: "موقوف مؤقتاً",
    startDate: "2026-07-01T00:00:00.000Z",
    endDate: "2026-08-01T00:00:00.000Z",
  });
  (propertyService as any).getByNumber = async () => ({
    propertyNumber: "PROP-SUSPENDED",
    name: "Suspended property",
    verificationStatus: "pending",
  });
  (propertyService as any).update = async (
    _propertyNumber: string,
    updates: Record<string, unknown>,
  ) => {
    ownerUpdates += 1;
    ownerUpdatePayload = updates;
    return {
      propertyNumber: "PROP-SUSPENDED",
      name: "Suspended property",
      verificationStatus: "pending",
    };
  };
  (subscriptionService as any).getByProperty = async () => {
    verificationWork += 1;
    throw new Error("automatic verification must not inspect subscriptions");
  };
  (firebaseService as any).updateProperty = async () => {
    verificationWork += 1;
    throw new Error("automatic verification must not write property state");
  };
  (firebaseService as any).updateVerificationStatus = async () => {
    verificationWork += 1;
    throw new Error("automatic verification must not write verification state");
  };

  const app = express();
  app.use(express.json());
  app.use(
    session({
      secret: "owner-suspension-edit-test-secret",
      resave: false,
      saveUninitialized: true,
      cookie: { secure: false },
    }),
  );
  app.use((req, _res, next) => {
    req.session.propertyNumber = "PROP-SUSPENDED";
    next();
  });
  app.use(ownerRouter);

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const { port } = server.address() as AddressInfo;

  try {
    const response = await fetch(
      `http://127.0.0.1:${port}/api/owner/property`,
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          commissionHold: { active: false, obligationIds: [] },
          "commissionHold.active": false,
          "commissionHold.obligationIds": [],
          verificationStatus: "approved",
          "subscription.status": "active",
          propertyNumber: "PROP-ATTACKER-CONTROLLED",
        }),
      },
    );
    assert.equal(response.status, 200);
    assert.equal((await response.json()).propertyNumber, "PROP-SUSPENDED");
    assert.equal(ownerUpdates, 1, "ordinary edits remain available");
    assert.deepEqual(
      ownerUpdatePayload,
      { lastChanges: "تحديث عام" },
      "server-owned hold, identity, verification, subscription, and dotted fields are ignored",
    );
    assert.equal(verificationWork, 0, "all verification work must be skipped");
  } finally {
    firebaseService.getSubscriptionByPropertyNumber =
      originals.getSubscriptionByPropertyNumber;
    firebaseService.updateProperty = originals.updateProperty;
    firebaseService.updateVerificationStatus =
      originals.updateVerificationStatus;
    propertyService.getByNumber = originals.getPropertyByNumber;
    propertyService.update = originals.updateOwnerProperty;
    subscriptionService.getByProperty = originals.getCurrentSubscription;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
