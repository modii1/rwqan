import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";

import express from "express";

import { CommissionHoldOwnerChangeError } from "../firebaseService";
import { propertyService } from "../services";
import { ownerAccountStore } from "../services/OwnerAccountStore";
import adminPropertiesRouter from "./admin/properties";
import ownerRouter from "./owner";

async function listen(app: express.Express): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

test("owner property edits expose the commission-hold transfer guard as 423", async () => {
  const originals = {
    getByNumber: propertyService.getByNumber,
    update: propertyService.update,
    validateMembership: ownerAccountStore.validateActiveMembership,
  };
  (propertyService as any).getByNumber = async () => ({
    propertyNumber: "PROP-HELD",
    name: "Held property",
    whatsappNumber: "501234567",
    commissionHold: { active: true, obligationIds: ["BOOK-1"] },
  });
  (propertyService as any).update = async () => {
    throw new CommissionHoldOwnerChangeError();
  };
  (ownerAccountStore as any).validateActiveMembership = async (input: any) =>
    input.ownerAccountId === "A".repeat(43) &&
    input.authVersion === 1 &&
    input.propertyNumber === "PROP-HELD";

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = {
      propertyNumber: "PROP-HELD",
      ownerAccountId: "A".repeat(43),
      authVersion: 1,
    };
    next();
  });
  app.use(ownerRouter);
  const server = await listen(app);

  try {
    const response = await fetch(`${server.baseUrl}/api/owner/property`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ whatsappNumber: "0501234599" }),
    });
    assert.equal(response.status, 423);
    assert.deepEqual(await response.json(), {
      error: "لا يمكن تغيير رقم واتساب بينما العقار موقوف بسبب عمولة حجز. يجب حل العمولة وإلغاء الإيقاف أولاً.",
      code: "COMMISSION_HOLD_ACTIVE",
    });
  } finally {
    propertyService.getByNumber = originals.getByNumber;
    propertyService.update = originals.update;
    ownerAccountStore.validateActiveMembership = originals.validateMembership;
    await server.close();
  }
});

test("both general admin property edits return 423 for held transfers and discard direct hold fields", async () => {
  const originalUpdate = propertyService.update;
  const received: Array<Record<string, unknown>> = [];
  (propertyService as any).update = async (
    propertyNumber: string,
    updates: Record<string, unknown>,
  ) => {
    received.push({ ...updates });
    if (Object.prototype.hasOwnProperty.call(updates, "whatsappNumber")) {
      throw new CommissionHoldOwnerChangeError();
    }
    return { propertyNumber, ...updates };
  };

  const app = express();
  app.use(express.json());
  app.use(adminPropertiesRouter);
  const server = await listen(app);

  try {
    for (const path of [
      "/api/admin/property/PROP-HELD",
      "/api/admin/properties/PROP-HELD",
    ]) {
      const response = await fetch(`${server.baseUrl}${path}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ whatsappNumber: "0501234599" }),
      });
      assert.equal(response.status, 423, path);
      assert.equal((await response.json()).code, "COMMISSION_HOLD_ACTIVE", path);
    }

    received.length = 0;
    for (const path of [
      "/api/admin/property/PROP-HELD",
      "/api/admin/properties/PROP-HELD",
    ]) {
      const response = await fetch(`${server.baseUrl}${path}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Safe edit",
          commissionHold: { active: false, obligationIds: [] },
          "commissionHold.active": false,
          "commissionHold.obligationIds": [],
        }),
      });
      assert.equal(response.status, 200, path);
    }
    assert.deepEqual(received, [
      { name: "Safe edit" },
      { name: "Safe edit" },
    ]);
  } finally {
    propertyService.update = originalUpdate;
    await server.close();
  }
});
