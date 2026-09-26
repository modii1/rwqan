import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";

import express from "express";

import { firebaseService } from "../firebaseService";
import { propertyService, subscriptionService } from "../services";
import { ownerAccountStore } from "../services/OwnerAccountStore";
import ownerRouter from "./owner";

const PROPERTY_NUMBER = "12345";
const ACCOUNT_ID = "A".repeat(43);

test("owner property GET and PUT never expose legacy credentials", async () => {
  const originals = {
    validate: ownerAccountStore.validateActiveMembership,
    propertyGet: propertyService.getByNumber,
    propertyUpdate: propertyService.update,
    subscriptionGet: subscriptionService.getByProperty,
    firebaseSubscriptionGet: firebaseService.getSubscriptionByPropertyNumber,
  };
  const property = {
    propertyNumber: PROPERTY_NUMBER,
    name: "Visible property",
    whatsappNumber: "0500000000",
    city: "بريدة",
    direction: "شمال",
    type: "قسم",
    facilities: [],
    prices: {
      weekday: "100",
      weekend: "120",
      overnight: "140",
      holidays: "160",
    },
    subscriptionType: "عادي",
    verificationStatus: "approved",
    pin: "1234",
    password: "legacy-password",
    resetCode: "654321",
    resetCodeExpires: "2099-01-01T00:00:00.000Z",
  };
  let propertyUpdateCalls = 0;
  (ownerAccountStore as any).validateActiveMembership = async (input: any) =>
    input.ownerAccountId === ACCOUNT_ID &&
    input.authVersion === 1 &&
    input.propertyNumber === PROPERTY_NUMBER;
  (propertyService as any).getByNumber = async () => ({ ...property });
  (propertyService as any).update = async () => {
    propertyUpdateCalls += 1;
    return { ...property };
  };
  const activeSubscription = {
    propertyNumber: PROPERTY_NUMBER,
    packageId: "pkg",
    status: "active",
    startDate: "2026-09-01T00:00:00.000Z",
    endDate: "2026-10-01T00:00:00.000Z",
  };
  (subscriptionService as any).getByProperty = async () => activeSubscription;
  (firebaseService as any).getSubscriptionByPropertyNumber = async () =>
    activeSubscription;

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = req.get("x-owner-account") === "true"
      ? {
          propertyNumber: PROPERTY_NUMBER,
          ownerAccountId: ACCOUNT_ID,
          authVersion: 1,
        }
      : { propertyNumber: PROPERTY_NUMBER };
    next();
  });
  app.use(ownerRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    for (const accountSession of [false, true]) {
      const headers = accountSession
        ? { "x-owner-account": "true" }
        : undefined;
      const getResponse = await fetch(`${baseUrl}/api/owner/property`, {
        headers,
      });
      assert.equal(getResponse.status, 200);
      const getPayload = await getResponse.json();
      assert.equal(getPayload.propertyNumber, PROPERTY_NUMBER);
      for (const credential of [
        "pin",
        "password",
        "resetCode",
        "resetCodeExpires",
      ]) {
        assert.equal(
          Object.prototype.hasOwnProperty.call(getPayload, credential),
          false,
        );
      }

      const putResponse = await fetch(`${baseUrl}/api/owner/property`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          ...(headers || {}),
        },
        body: "{}",
      });
      assert.equal(putResponse.status, 200);
      const putPayload = await putResponse.json();
      assert.equal(putPayload.propertyNumber, PROPERTY_NUMBER);
      for (const credential of [
        "pin",
        "password",
        "resetCode",
        "resetCodeExpires",
      ]) {
        assert.equal(
          Object.prototype.hasOwnProperty.call(putPayload, credential),
          false,
        );
      }
    }

    const legacyPhoneChange = await fetch(`${baseUrl}/api/owner/property`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ whatsappNumber: "0500000001" }),
    });
    assert.equal(legacyPhoneChange.status, 403);
    assert.equal((await legacyPhoneChange.json()).code, "OWNER_ACCOUNT_REQUIRED");
    assert.equal(propertyUpdateCalls, 2);
  } finally {
    ownerAccountStore.validateActiveMembership = originals.validate;
    propertyService.getByNumber = originals.propertyGet;
    propertyService.update = originals.propertyUpdate;
    subscriptionService.getByProperty = originals.subscriptionGet;
    firebaseService.getSubscriptionByPropertyNumber =
      originals.firebaseSubscriptionGet;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
