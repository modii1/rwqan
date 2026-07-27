import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import express from "express";
import { firebaseService } from "../../firebaseService";
import { propertyService, subscriptionService } from "../../services";
import settingsRouter from "./settings";

const originals = {
  getSubscriptionByPropertyNumber:
    firebaseService.getSubscriptionByPropertyNumber,
  getOwnerPhone: firebaseService.getOwnerPhone,
  getPropertyByNumber: propertyService.getByNumber,
  getSubscriptions: subscriptionService.getAll,
};

test.afterEach(() => {
  firebaseService.getSubscriptionByPropertyNumber =
    originals.getSubscriptionByPropertyNumber;
  firebaseService.getOwnerPhone = originals.getOwnerPhone;
  propertyService.getByNumber = originals.getPropertyByNumber;
  subscriptionService.getAll = originals.getSubscriptions;
});

async function withSettingsServer(
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use(settingsRouter);

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const { port } = server.address() as AddressInfo;

  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error?: Error) => (error ? reject(error) : resolve()));
    });
  }
}

test("manual owner notification returns a structured lock response for suspended property", async () => {
  let propertyReads = 0;
  (firebaseService as any).getSubscriptionByPropertyNumber = async () => ({
    status: "موقوف مؤقتاً",
  });
  (propertyService as any).getByNumber = async () => {
    propertyReads += 1;
    return { propertyNumber: "10001", name: "Test property" };
  };

  await withSettingsServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/admin/send-owner-notification`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        propertyNumber: "10001",
        notificationType: "custom",
        customMessage: "test",
      }),
    });

    assert.equal(response.status, 423);
    const body = await response.json();
    assert.equal(body.success, false);
    assert.equal(body.code, "PROPERTY_SUSPENDED");
    assert.match(body.error, /موقوف مؤقتاً/);
    assert.equal(propertyReads, 0, "blocked requests must stop before property work");
  });
});

test("manual custom notification is suppressed if the property is stopped during dispatch", async () => {
  const suspensionStates = ["active", "suspended"];
  let suspensionChecks = 0;
  (firebaseService as any).getSubscriptionByPropertyNumber = async () => ({
    status: suspensionStates[suspensionChecks++] ?? "suspended",
  });
  (firebaseService as any).getOwnerPhone = async () => "0500000000";
  (propertyService as any).getByNumber = async () => ({
    propertyNumber: "10001",
    name: "Test property",
  });

  await withSettingsServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/admin/send-owner-notification`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        propertyNumber: "10001",
        notificationType: "custom",
        customMessage: "test",
      }),
    });

    assert.equal(response.status, 423);
    const body = await response.json();
    assert.equal(body.code, "PROPERTY_SUSPENDED");
    assert.equal(suspensionChecks, 2, "dispatch must recheck suspension after preflight");
  });
});

test("bulk owner notifications skip current and legacy suspended subscriptions", async () => {
  let propertyReads = 0;
  let ownerPhoneReads = 0;
  (subscriptionService as any).getAll = async () => [
    {
      propertyNumber: "10001",
      status: "موقوف مؤقتاً",
      endDate: "2026-01-01T00:00:00.000Z",
    },
    {
      propertyNumber: "10002",
      status: "suspended",
      endDate: "2026-01-01T00:00:00.000Z",
    },
  ];
  (propertyService as any).getByNumber = async () => {
    propertyReads += 1;
    return null;
  };
  (firebaseService as any).getOwnerPhone = async () => {
    ownerPhoneReads += 1;
    return "0500000000";
  };

  await withSettingsServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/admin/send-bulk-notifications`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notificationType: "all" }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      success: true,
      sentCount: 0,
      suspendedCount: 2,
    });
    assert.equal(propertyReads, 0);
    assert.equal(ownerPhoneReads, 0);
  });
});
