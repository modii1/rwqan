import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import { firebaseService } from "../firebaseService";
import { registerRoutes } from "./index";

test("central admin boundary protects modular routes without hiding auth or public routes", async () => {
  const originalInitializeSheets = firebaseService.initializeSheets;
  (firebaseService as any).initializeSheets = async () => undefined;

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = req.get("x-admin") ? { isAdmin: true } : {};
    next();
  });

  let server: Server | undefined;
  try {
    server = await registerRoutes(app);
    app.get("/public-route-after-api", (_req, res) => res.json({ ok: true }));
    server.listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      server!.once("listening", resolve);
      server!.once("error", reject);
    });
    const { port } = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${port}`;

    const adminData = await fetch(`${baseUrl}/api/admin/properties`);
    assert.equal(adminData.status, 401);
    assert.deepEqual(await adminData.json(), { error: "Admin Login Required" });

    const bookingSettings = await fetch(
      `${baseUrl}/api/admin/booking-commissions/settings`,
    );
    assert.equal(bookingSettings.status, 401);
    assert.deepEqual(await bookingSettings.json(), { error: "Admin Login Required" });

    const customerWhatsApp = await fetch(
      `${baseUrl}/api/admin/booking-commissions/BOOK-PRIVATE/customer-whatsapp`,
      { redirect: "manual" },
    );
    assert.equal(customerWhatsApp.status, 401);
    assert.deepEqual(await customerWhatsApp.json(), {
      error: "Admin Login Required",
    });

    const crossOriginAdmin = await fetch(`${baseUrl}/api/admin/properties`, {
      headers: { origin: "https://evil.example", "x-admin": "1" },
    });
    assert.equal(crossOriginAdmin.status, 403);
    assert.equal((await crossOriginAdmin.json()).code, "CROSS_ORIGIN_REQUEST");

    const crossOriginBookingSettings = await fetch(
      `${baseUrl}/api/admin/booking-commissions/settings`,
      {
        method: "PUT",
        headers: {
          "content-type": "application/json",
          origin: "https://evil.example",
          "x-admin": "1",
        },
        body: JSON.stringify({
          settings: {
            customerDailyLimit: 4,
            freeOwnerDailyLimit: 5,
            freePropertyContactDailyLimit: 6,
          },
        }),
      },
    );
    assert.equal(crossOriginBookingSettings.status, 403);
    assert.equal(
      (await crossOriginBookingSettings.json()).code,
      "CROSS_ORIGIN_REQUEST",
    );

    const crossOriginCustomerWhatsApp = await fetch(
      `${baseUrl}/api/admin/booking-commissions/BOOK-PRIVATE/customer-whatsapp`,
      {
        redirect: "manual",
        headers: { origin: "https://evil.example", "x-admin": "1" },
      },
    );
    assert.equal(crossOriginCustomerWhatsApp.status, 403);
    assert.equal(
      (await crossOriginCustomerWhatsApp.json()).code,
      "CROSS_ORIGIN_REQUEST",
    );

    const authenticatedUnknownRoute = await fetch(`${baseUrl}/api/admin/not-a-route`, {
      headers: { origin: baseUrl, "x-admin": "1" },
    });
    assert.equal(authenticatedUnknownRoute.status, 404);

    const adminSession = await fetch(`${baseUrl}/api/admin/session`);
    assert.equal(adminSession.status, 200);
    assert.deepEqual(await adminSession.json(), { isAdmin: false });

    const publicRoute = await fetch(`${baseUrl}/public-route-after-api`);
    assert.equal(publicRoute.status, 200);
    assert.deepEqual(await publicRoute.json(), { ok: true });
  } finally {
    firebaseService.initializeSheets = originalInitializeSheets;
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => {
        server!.close((error?: Error) => (error ? reject(error) : resolve()));
      });
    }
  }
});
