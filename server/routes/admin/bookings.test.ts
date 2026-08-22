import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import express from "express";
import { bookingCommissionStore } from "../../services/BookingCommissionStore";
import { BOOKING_ADMIN_CUSTOMER_WHATSAPP_MESSAGE } from "../../services/BookingCommissionService";
import { DEFAULT_BOOKING_WHATSAPP_TEMPLATES } from "../../../shared/booking";
import bookingsRouter from "./bookings";

async function withBookingsServer(
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use(bookingsRouter);

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

test("admin booking settings GET and PUT expose the strict full-replacement contract", async () => {
  const store = bookingCommissionStore as any;
  const originals = {
    getSettings: store.getFreeWorkflowSettings,
    updateSettings: store.updateFreeWorkflowSettings,
  };
  const configuration = {
    customerDailyLimit: 4,
    freeOwnerDailyLimit: 5,
    freePropertyContactDailyLimit: 6,
    whatsappTemplates: { ...DEFAULT_BOOKING_WHATSAPP_TEMPLATES },
    optionalCommissionReminderDays: [3] as Array<3 | 4>,
  };
  const persisted = {
    ...configuration,
    updatedAt: "2026-08-18T10:00:00.000Z",
    updatedBy: "admin" as const,
    source: "firestore" as const,
  };
  const updates: unknown[] = [];
  const environmentNames = [
    "ENJAZATIK_URL",
    "ENJAZATIK_TOKEN",
    "BOOKING_WORKER_SECRET",
    "PUBLIC_BASE_URL",
    "NODE_ENV",
  ] as const;
  const previousEnvironment = Object.fromEntries(
    environmentNames.map((name) => [name, process.env[name]]),
  );
  const mutableEnvironment = process.env as Record<string, string | undefined>;

  try {
    process.env.ENJAZATIK_URL = "https://provider.example/send";
    process.env.ENJAZATIK_TOKEN = "provider-token";
    process.env.BOOKING_WORKER_SECRET = "w".repeat(32);
    process.env.PUBLIC_BASE_URL = "https://booking.example";
    mutableEnvironment.NODE_ENV = "production";
    store.getFreeWorkflowSettings = async () => persisted;
    store.updateFreeWorkflowSettings = async (settings: unknown) => {
      updates.push(settings);
      return persisted;
    };

    await withBookingsServer(async (baseUrl) => {
      const getResponse = await fetch(
        `${baseUrl}/api/admin/booking-commissions/settings`,
      );
      assert.equal(getResponse.status, 200);
      assert.equal(getResponse.headers.get("cache-control"), "no-store, private");
      const expectedResponse = {
        settings: persisted,
        fixedPolicy: {
          customerFollowUpDelayHours: 24,
          commissionPaymentWindowDays: 5,
          mandatoryCommissionReminderDays: [5],
          allowedOptionalCommissionReminderDays: [3, 4],
          templateSyntaxVersion: 1,
          templateMaxLength: 2_000,
        },
        operationalHealth: {
          whatsappProviderConfigured: true,
          workerSecretConfigured: true,
          publicBaseUrlConfigured: true,
          publicBaseUrlValid: true,
        },
      };
      assert.deepEqual(await getResponse.json(), expectedResponse);

      const putResponse = await fetch(
        `${baseUrl}/api/admin/booking-commissions/settings`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            settings: configuration,
          }),
        },
      );
      assert.equal(putResponse.status, 200);
      assert.equal(putResponse.headers.get("cache-control"), "no-store, private");
      assert.deepEqual(await putResponse.json(), expectedResponse);
      assert.deepEqual(updates, [configuration]);

      for (const body of [
        {
          settings: {
            ...configuration,
            freePropertyContactDailyLimit: 1_001,
          },
        },
        {
          settings: {
            ...configuration,
            extra: true,
          },
        },
        { settings: { ...configuration, whatsappTemplates: {} } },
        { settings: { ...configuration, optionalCommissionReminderDays: [5] } },
      ]) {
        const invalidResponse = await fetch(
          `${baseUrl}/api/admin/booking-commissions/settings`,
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          },
        );
        assert.equal(invalidResponse.status, 400);
        assert.deepEqual(await invalidResponse.json(), {
          code: "INVALID_BOOKING_INPUT",
          error: "بيانات الحجز غير مكتملة أو غير صحيحة",
        });
      }
      assert.equal(updates.length, 1, "invalid requests never reach persistence");
    });
  } finally {
    store.getFreeWorkflowSettings = originals.getSettings;
    store.updateFreeWorkflowSettings = originals.updateSettings;
    for (const name of environmentNames) {
      const value = previousEnvironment[name];
      if (value === undefined) delete mutableEnvironment[name];
      else mutableEnvironment[name] = value;
    }
  }
});

test("admin customer WhatsApp handoff redirects privately without returning the phone as JSON", async () => {
  const store = bookingCommissionStore as any;
  const originalGetBooking = store.getBookingForCurrentOwner;

  try {
    store.getBookingForCurrentOwner = async (id: string) => {
      if (id === "BOOK-MISSING") return null;
      return {
        id,
        customerPhone: "٠٥٠ ٠٠٠ ٠٠٠٢",
      };
    };

    await withBookingsServer(async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/admin/booking-commissions/BOOK-HANDOFF/customer-whatsapp`,
        { redirect: "manual" },
      );
      assert.equal(response.status, 302);
      assert.equal(response.headers.get("cache-control"), "no-store, private");
      assert.equal(response.headers.get("referrer-policy"), "no-referrer");
      const location = response.headers.get("location");
      assert.ok(location);
      const redirect = new URL(location);
      assert.equal(redirect.origin, "https://wa.me");
      assert.equal(redirect.pathname, "/966500000002");
      assert.equal(
        redirect.searchParams.get("text"),
        BOOKING_ADMIN_CUSTOMER_WHATSAPP_MESSAGE,
      );
      assert.equal(response.headers.get("content-type")?.includes("json"), false);

      const missing = await fetch(
        `${baseUrl}/api/admin/booking-commissions/BOOK-MISSING/customer-whatsapp`,
        { redirect: "manual" },
      );
      assert.equal(missing.status, 404);
      assert.equal(missing.headers.get("cache-control"), "no-store, private");
      assert.equal(missing.headers.get("referrer-policy"), "no-referrer");
      assert.deepEqual(await missing.json(), {
        code: "BOOKING_NOT_FOUND",
        error: "Booking not found",
      });

      store.getBookingForCurrentOwner = async () => ({
        id: "BOOK-INVALID",
        customerPhone: "invalid",
      });
      const invalid = await fetch(
        `${baseUrl}/api/admin/booking-commissions/BOOK-INVALID/customer-whatsapp`,
        { redirect: "manual" },
      );
      assert.equal(invalid.status, 400);
      assert.deepEqual(await invalid.json(), {
        code: "INVALID_CUSTOMER_PHONE",
        error: "Invalid customer phone",
      });
    });
  } finally {
    store.getBookingForCurrentOwner = originalGetBooking;
  }
});
