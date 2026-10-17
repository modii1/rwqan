import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";

import express from "express";

import { firebaseService } from "../../firebaseService";
import { propertyService } from "../../services";
import testingRouter from "./testing";

test("smart verification rejects a suspended optional second property before verification work", async () => {
  const originals = {
    getSubscriptionByPropertyNumber:
      firebaseService.getSubscriptionByPropertyNumber,
    getPropertyByNumber: propertyService.getByNumber,
  };
  const subscriptionReads: string[] = [];
  let propertyReads = 0;

  (firebaseService as any).getSubscriptionByPropertyNumber = async (
    propertyNumber: string,
  ) => {
    subscriptionReads.push(propertyNumber);
    if (propertyNumber !== "PROP-SECOND") return null;
    return {
      id: "SUB-PROP-SECOND",
      propertyNumber,
      status: "suspended",
      startDate: "2026-07-01T00:00:00.000Z",
      endDate: "2026-08-01T00:00:00.000Z",
    };
  };
  (propertyService as any).getByNumber = async () => {
    propertyReads += 1;
    throw new Error("verification must not read properties while either one is suspended");
  };

  const app = express();
  app.use(express.json());
  app.use(testingRouter);

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const { port } = server.address() as AddressInfo;

  try {
    const response = await fetch(
      `http://127.0.0.1:${port}/api/admin/smart-verify`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          propertyNumber: "PROP-PRIMARY",
          secondPropertyNumber: "PROP-SECOND",
        }),
      },
    );
    const payload = await response.json();

    assert.equal(response.status, 423);
    assert.equal(payload.code, "PROPERTY_SUSPENDED");
    assert.deepEqual(subscriptionReads, ["PROP-PRIMARY", "PROP-SECOND"]);
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
