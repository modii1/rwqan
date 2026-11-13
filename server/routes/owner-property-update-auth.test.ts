import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";

import { propertyService, subscriptionService } from "../services";
import { firebaseService } from "../firebaseService";
import { ownerAccountStore } from "../services/OwnerAccountStore";
import ownerRouter from "./owner";

// Keep this test fully offline: no WhatsApp/external calls.
(process.env as any).NODE_ENV = "development";
(process.env as any).ALLOW_EXTERNAL_SERVICES_IN_DEVELOPMENT = "false";

type Session = {
  propertyNumber?: string;
  ownerAccountId?: string;
  authVersion?: number;
};

async function withOwnerServer(
  session: Session,
  run: (
    request: (body: Record<string, unknown>) => Promise<Response>,
    updates: any[],
  ) => Promise<void>,
  property: Record<string, unknown>,
) {
  const originals = {
    getProperty: propertyService.getByNumber,
    updateProperty: propertyService.update,
    getSubscription: subscriptionService.getByProperty,
    getFirebaseSubscription: firebaseService.getSubscriptionByPropertyNumber,
    updateVerificationStatus: firebaseService.updateVerificationStatus,
    updateFirebaseProperty: firebaseService.updateProperty,
    validateMembership: ownerAccountStore.validateActiveMembership,
  };
  const updates: any[] = [];

  (propertyService as any).getByNumber = async (propertyNumber: string) =>
    propertyNumber === property.propertyNumber ? property : null;
  (propertyService as any).update = async (
    propertyNumber: string,
    patch: any,
  ) => {
    updates.push({ propertyNumber, patch });
    return { ...property, ...patch };
  };
  (subscriptionService as any).getByProperty = async () => null;
  (firebaseService as any).getSubscriptionByPropertyNumber = async () => null;
  (firebaseService as any).updateVerificationStatus = async () => undefined;
  (firebaseService as any).updateProperty = async () => undefined;
  (ownerAccountStore as any).validateActiveMembership = async () => true;

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = { ...session };
    next();
  });
  app.use(ownerRouter);

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const { port } = server.address() as AddressInfo;

  const request = (body: Record<string, unknown>) =>
    fetch(`http://127.0.0.1:${port}/api/owner/property`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  try {
    await run(request, updates);
  } finally {
    (propertyService as any).getByNumber = originals.getProperty;
    (propertyService as any).update = originals.updateProperty;
    (subscriptionService as any).getByProperty = originals.getSubscription;
    (firebaseService as any).getSubscriptionByPropertyNumber =
      originals.getFirebaseSubscription;
    (firebaseService as any).updateVerificationStatus =
      originals.updateVerificationStatus;
    (firebaseService as any).updateProperty = originals.updateFirebaseProperty;
    (ownerAccountStore as any).validateActiveMembership =
      originals.validateMembership;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  return updates;
}

const CURRENT_PROPERTY = {
  propertyNumber: "PROP-UPDATE-1",
  name: "الاسم القديم",
  whatsappNumber: "0550000000",
  location: "بريدة",
  city: "بريدة",
  direction: "شمال",
  type: "شقة",
  capacity: 2,
  facilities: [],
  prices: {},
  verificationStatus: "pending",
};

test("a legacy PIN session can save the owner form when the phone is unchanged", async () => {
  await withOwnerServer(
    { propertyNumber: "PROP-UPDATE-1" },
    async (request, updates) => {
      const response = await request({
        name: "الاسم الجديد",
        whatsappNumber: "0550000000",
        city: "بريدة",
      });
      const payload = await response.json();
      assert.equal(response.status, 200, JSON.stringify(payload));
      assert.equal(updates.length, 1);
      assert.equal(updates[0].propertyNumber, "PROP-UPDATE-1");
      assert.equal(updates[0].patch.name, "الاسم الجديد");
      assert.equal(
        Object.prototype.hasOwnProperty.call(updates[0].patch, "whatsappNumber"),
        false,
        "an unchanged phone must not be rewritten",
      );
    },
    CURRENT_PROPERTY,
  );
});

test("a legacy PIN session cannot change the phone number", async () => {
  await withOwnerServer(
    { propertyNumber: "PROP-UPDATE-1" },
    async (request, updates) => {
      const response = await request({
        name: "الاسم الجديد",
        whatsappNumber: "0551111111",
      });
      const payload = await response.json();
      assert.equal(response.status, 403);
      assert.equal(payload.code, "OWNER_ACCOUNT_REQUIRED");
      assert.equal(updates.length, 0, "no write may happen on a rejected change");
    },
    CURRENT_PROPERTY,
  );
});

test("a verified owner account can change the phone number", async () => {
  await withOwnerServer(
    {
      propertyNumber: "PROP-UPDATE-1",
      ownerAccountId: "owner-account-1",
      authVersion: 1,
    },
    async (request, updates) => {
      const response = await request({
        name: "الاسم الجديد",
        whatsappNumber: "0551111111",
      });
      const payload = await response.json();
      assert.equal(response.status, 200, JSON.stringify(payload));
      assert.equal(updates.length, 1);
      assert.equal(updates[0].patch.whatsappNumber, "551111111");
    },
    CURRENT_PROPERTY,
  );
});

test("a session bound to another property cannot update this one", async () => {
  await withOwnerServer(
    { propertyNumber: "PROP-OTHER" },
    async (request, updates) => {
      const response = await request({ name: "محاولة" });
      assert.equal(response.status, 404);
      assert.equal(updates.length, 0);
    },
    CURRENT_PROPERTY,
  );
});
