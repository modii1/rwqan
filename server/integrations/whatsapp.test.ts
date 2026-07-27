import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import express from "express";
import { firebaseService } from "../firebaseService";
import whatsappRouter, {
  createPropertyOwnerWhatsAppSender,
  notifyOwnerSubscriptionActivated,
  notifyOwnerSubscriptionExpired,
  notifyOwnerSubscriptionExpiringSoon,
} from "./whatsapp";

test("property owner sender rechecks suspension immediately before every retry", async () => {
  const suspensionStates = [false, true];
  let suspensionChecks = 0;
  let sends = 0;
  const delays: number[] = [];
  const send = createPropertyOwnerWhatsAppSender({
    isSuspended: async () =>
      suspensionStates[suspensionChecks++] ?? true,
    send: async (_phone, _message, retries) => {
      assert.equal(retries, 0, "the guarded sender must own the retry boundary");
      sends += 1;
      return { success: false, error: "temporary transport failure" };
    },
    delay: async (milliseconds) => {
      delays.push(milliseconds);
    },
  });

  const result = await send({
    ownerPhone: "0500000000",
    propertyNumber: "10001",
    message: "test",
    retries: 2,
  });

  assert.deepEqual(result, {
    success: false,
    suppressed: true,
    code: "PROPERTY_SUSPENDED",
    error: "العقار موقوف مؤقتاً ولن تصله إشعارات حتى إعادة التفعيل",
  });
  assert.equal(suspensionChecks, 2);
  assert.equal(sends, 1);
  assert.deepEqual(delays, [5000]);
});

test("property owner sender fails closed when suspension lookup fails", async () => {
  const lookupError = new Error("firebase unavailable");
  let sends = 0;
  const send = createPropertyOwnerWhatsAppSender({
    isSuspended: async () => {
      throw lookupError;
    },
    send: async () => {
      sends += 1;
      return { success: true };
    },
    delay: async () => undefined,
  });

  const result = await send({
    ownerPhone: "0500000000",
    propertyNumber: "10001",
    message: "test",
  });

  assert.equal(result.success, false);
  assert.equal(result.suppressed, true);
  assert.equal(result.code, "SUSPENSION_LOOKUP_FAILED");
  assert.equal(sends, 0);
});

test("property owner sender can succeed after a guarded retry", async () => {
  let suspensionChecks = 0;
  let sends = 0;
  const delays: number[] = [];
  const send = createPropertyOwnerWhatsAppSender({
    isSuspended: async () => {
      suspensionChecks += 1;
      return false;
    },
    send: async () => {
      sends += 1;
      return sends === 2
        ? { success: true }
        : { success: false, error: "temporary transport failure" };
    },
    delay: async (milliseconds) => {
      delays.push(milliseconds);
    },
  });

  const result = await send({
    ownerPhone: "0500000000",
    propertyNumber: "10001",
    message: "test",
    retries: 2,
  });

  assert.deepEqual(result, { success: true });
  assert.equal(suspensionChecks, 2);
  assert.equal(sends, 2);
  assert.deepEqual(delays, [5000]);
});

test("every subscription-owner notification wrapper uses the suspension guard", async () => {
  const originalGetSubscriptionByPropertyNumber =
    firebaseService.getSubscriptionByPropertyNumber;
  let suspensionChecks = 0;
  (firebaseService as any).getSubscriptionByPropertyNumber = async () => {
    suspensionChecks += 1;
    return { status: "suspended" };
  };

  try {
    const results = await Promise.all([
      notifyOwnerSubscriptionActivated({
        ownerPhone: "0500000000",
        propertyNumber: "10001",
        propertyName: "Test property",
        endDate: "2026-08-01",
      }),
      notifyOwnerSubscriptionExpiringSoon({
        ownerPhone: "0500000000",
        propertyNumber: "10001",
        propertyName: "Test property",
        daysLeft: 3,
      }),
      notifyOwnerSubscriptionExpired({
        ownerPhone: "0500000000",
        propertyNumber: "10001",
        propertyName: "Test property",
      }),
    ]);

    assert.equal(suspensionChecks, 3);
    for (const result of results) {
      assert.equal(result.success, false);
      assert.equal(result.suppressed, true);
      assert.equal(result.code, "PROPERTY_SUSPENDED");
    }
  } finally {
    firebaseService.getSubscriptionByPropertyNumber =
      originalGetSubscriptionByPropertyNumber;
  }
});

test("WhatsApp HTTP routes require same-origin admin access without intercepting unrelated routes", async () => {
  const originalGetRequests = firebaseService.getRequests;
  let requestReads = 0;
  (firebaseService as any).getRequests = async () => {
    requestReads += 1;
    return [{ id: "request-1" }];
  };

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = {
      isAdmin: req.get("x-test-admin") === "yes",
    };
    next();
  });
  app.use("/api/whatsapp", whatsappRouter);
  app.get("/public-after-whatsapp", (_req, res) => res.json({ ok: true }));

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const privilegedRoutes = [
      ["GET", "/api/whatsapp/logs"],
      ["GET", "/api/whatsapp/stats"],
      ["GET", "/api/whatsapp/requests"],
      ["POST", "/api/whatsapp/send"],
      ["POST", "/api/whatsapp/send-admin"],
    ] as const;

    for (const [method, path] of privilegedRoutes) {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: { "content-type": "application/json" },
        ...(method === "POST" ? { body: JSON.stringify({ message: "test", text: "test" }) } : {}),
      });
      assert.equal(response.status, 401, `${method} ${path} must reject a missing admin session`);
    }
    assert.equal(requestReads, 0, "unauthorized requests must not reach Firebase");

    const crossOrigin = await fetch(`${baseUrl}/api/whatsapp/requests`, {
      headers: {
        "x-test-admin": "yes",
        origin: "https://evil.example",
      },
    });
    assert.equal(crossOrigin.status, 403);
    assert.equal(requestReads, 0, "cross-origin requests must not reach Firebase");

    const authorized = await fetch(`${baseUrl}/api/whatsapp/requests`, {
      headers: { "x-test-admin": "yes" },
    });
    assert.equal(authorized.status, 200);
    assert.deepEqual(await authorized.json(), [{ id: "request-1" }]);
    assert.equal(requestReads, 1);

    const publicRoute = await fetch(`${baseUrl}/public-after-whatsapp`);
    assert.equal(publicRoute.status, 200);
    assert.deepEqual(await publicRoute.json(), { ok: true });
  } finally {
    firebaseService.getRequests = originalGetRequests;
    await new Promise<void>((resolve, reject) => {
      server.close((error?: Error) => (error ? reject(error) : resolve()));
    });
  }
});
