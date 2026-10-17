import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import express from "express";
import {
  BookingWorkflowError,
  bookingCommissionStore,
  buildInitialBookingWorkflow,
} from "../../services/BookingCommissionStore";
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
    customerFollowUpDelayMinutes: 2_160,
    customerFollowUpMessageLimit: 3,
    customerFollowUpLimitScope: "customer" as const,
    adminCustomerWhatsAppCooldownMinutes: 20,
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
        settings: {
          ...persisted,
          customerFollowUpDelayHours: 36,
        },
        fixedPolicy: {
          customerFollowUpDelayMinMinutes: 1,
          customerFollowUpDelayMaxMinutes: 7_200,
          customerFollowUpDelayMinHours: 1,
          customerFollowUpDelayMaxHours: 120,
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

      const {
        customerFollowUpDelayMinutes: _canonicalDelay,
        ...legacyConfiguration
      } = configuration;
      const legacyPutResponse = await fetch(
        `${baseUrl}/api/admin/booking-commissions/settings`,
        {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            settings: {
              ...legacyConfiguration,
              customerFollowUpDelayHours: 36,
            },
          }),
        },
      );
      assert.equal(legacyPutResponse.status, 200);
      assert.deepEqual(await legacyPutResponse.json(), expectedResponse);
      assert.deepEqual(updates, [configuration, configuration]);

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
            customerFollowUpDelayMinutes: 0,
          },
        },
        {
          settings: {
            ...configuration,
            customerFollowUpDelayMinutes: 7_201,
          },
        },
        {
          settings: {
            ...configuration,
            customerFollowUpMessageLimit: 1_001,
          },
        },
        {
          settings: {
            ...configuration,
            adminCustomerWhatsAppCooldownMinutes: 10_081,
          },
        },
        {
          settings: {
            ...legacyConfiguration,
            customerFollowUpDelayHours: 1.5,
          },
        },
        {
          settings: {
            ...configuration,
            customerFollowUpDelayHours: 24,
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
      assert.equal(updates.length, 2, "invalid requests never reach persistence");
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

test("admin customer WhatsApp handoff requires POST and keeps the phone behind an opaque redirect", async () => {
  const store = bookingCommissionStore as any;
  const originals = {
    claim: store.claimAdminCustomerWhatsAppContact,
    getCurrent: store.getBookingForCurrentOwner,
    getSettings: store.getFreeWorkflowSettings,
  };
  const previousSecret = process.env.SESSION_SECRET;
  let claimCalls = 0;
  const { followUp: handoffBooking } = buildInitialBookingWorkflow({
    requestCode: "ADMIN-CUSTOMER-WHATSAPP-ROUTE",
    propertyNumber: "13383",
    propertyName: "شاليه الريف المائي",
    ownerPhone: "+966500000001",
    customerPhone: "+966500000002",
    customerSubject: "admin-customer-whatsapp-route-subject",
    isFreeProperty: true,
    listedPriceOptionsHalalas: [75_000],
    now: new Date(),
  });

  try {
    process.env.SESSION_SECRET = "admin-whatsapp-route-test-secret-value-12345678";
    store.getFreeWorkflowSettings = async () => ({
      whatsappTemplates: { ...DEFAULT_BOOKING_WHATSAPP_TEMPLATES },
      adminCustomerWhatsAppCooldownMinutes: 17,
    });
    store.claimAdminCustomerWhatsAppContact = async (
      id: string,
      _now: Date,
      _templateVariant: string,
      cooldownMinutes: number,
    ) => {
      claimCalls += 1;
      assert.equal(cooldownMinutes, 17);
      if (id === "BOOK-MISSING") return null;
      if (id === "BOOK-RATE-LIMITED") {
        throw new BookingWorkflowError(
          "ADMIN_CUSTOMER_WHATSAPP_RATE_LIMITED",
          "يمكن التواصل مع العميل مرة واحدة كل 30 دقيقة.",
          429,
          1_337,
        );
      }
      return {
        ...handoffBooking,
        id,
        customerPhone: "٠٥٠ ٠٠٠ ٠٠٠٢",
      };
    };
    store.getBookingForCurrentOwner = async (id: string) => ({
      ...handoffBooking,
      id,
      customerPhone: "٠٥٠ ٠٠٠ ٠٠٠٢",
    });

    await withBookingsServer(async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/api/admin/booking-commissions/BOOK-HANDOFF/customer-whatsapp`,
        { method: "POST" },
      );
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("cache-control"), "no-store, private");
      assert.equal(response.headers.get("referrer-policy"), "no-referrer");
      const payload = await response.json();
      assert.deepEqual(Object.keys(payload), ["handoffUrl", "nextAllowedAt"]);
      assert.ok(Number.isFinite(Date.parse(payload.nextAllowedAt)));
      assert.match(
        payload.handoffUrl,
        /^\/api\/admin\/booking-commissions\/BOOK-HANDOFF\/customer-whatsapp\/open\?token=/,
      );
      assert.equal(payload.handoffUrl.includes("966500000002"), false);
      assert.equal(payload.handoffUrl.includes("wa.me"), false);

      const handoff = await fetch(`${baseUrl}${payload.handoffUrl}`, {
        redirect: "manual",
      });
      assert.equal(handoff.status, 302);
      assert.equal(handoff.headers.get("cache-control"), "no-store, private");
      assert.equal(handoff.headers.get("referrer-policy"), "no-referrer");
      const location = handoff.headers.get("location");
      assert.ok(location);
      const redirect = new URL(location);
      assert.equal(redirect.origin, "https://wa.me");
      assert.equal(redirect.pathname, "/966500000002");
      assert.equal(
        redirect.searchParams.get("text"),
        BOOKING_ADMIN_CUSTOMER_WHATSAPP_MESSAGE,
      );
      assert.equal(claimCalls, 1, "opening the signed handoff does not claim again");

      const tamperedVariantUrl = new URL(payload.handoffUrl, baseUrl);
      tamperedVariantUrl.searchParams.set(
        "templateVariant",
        "customer_followup",
      );
      const tamperedVariant = await fetch(tamperedVariantUrl, {
        redirect: "manual",
      });
      assert.equal(tamperedVariant.status, 404);
      assert.equal(tamperedVariant.headers.get("location"), null);

      const tamperedTokenUrl = new URL(payload.handoffUrl, baseUrl);
      tamperedTokenUrl.searchParams.set(
        "token",
        `${tamperedTokenUrl.searchParams.get("token")}A`,
      );
      const tamperedToken = await fetch(tamperedTokenUrl, {
        redirect: "manual",
      });
      assert.equal(tamperedToken.status, 404);
      assert.equal(tamperedToken.headers.get("location"), null);
      assert.equal(claimCalls, 1, "tampered handoffs never consume another claim");

      const invalidTemplate = await fetch(
        `${baseUrl}/api/admin/booking-commissions/BOOK-HANDOFF/customer-whatsapp`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ templateVariant: "owner_payment" }),
        },
      );
      assert.equal(invalidTemplate.status, 400);
      assert.equal(
        claimCalls,
        1,
        "invalid template input is rejected before consuming cooldown",
      );

      const safeGet = await fetch(
        `${baseUrl}/api/admin/booking-commissions/BOOK-HANDOFF/customer-whatsapp`,
        { redirect: "manual" },
      );
      assert.equal(safeGet.status, 404, "GET cannot consume the cooldown claim");
      assert.equal(claimCalls, 1);

      const missing = await fetch(
        `${baseUrl}/api/admin/booking-commissions/BOOK-MISSING/customer-whatsapp`,
        { method: "POST" },
      );
      assert.equal(missing.status, 404);
      assert.equal(missing.headers.get("cache-control"), "no-store, private");
      assert.equal(missing.headers.get("referrer-policy"), "no-referrer");
      assert.deepEqual(await missing.json(), {
        code: "BOOKING_NOT_FOUND",
        error: "Booking not found",
      });

      const limited = await fetch(
        `${baseUrl}/api/admin/booking-commissions/BOOK-RATE-LIMITED/customer-whatsapp`,
        { method: "POST" },
      );
      assert.equal(limited.status, 429);
      assert.equal(limited.headers.get("retry-after"), "1337");
      assert.deepEqual(await limited.json(), {
        code: "ADMIN_CUSTOMER_WHATSAPP_RATE_LIMITED",
        error: "يمكن التواصل مع العميل مرة واحدة كل 30 دقيقة.",
      });

      store.claimAdminCustomerWhatsAppContact = async () => ({
        ...handoffBooking,
        id: "BOOK-INVALID",
        customerPhone: "invalid",
      });
      const invalid = await fetch(
        `${baseUrl}/api/admin/booking-commissions/BOOK-INVALID/customer-whatsapp`,
        { method: "POST" },
      );
      assert.equal(invalid.status, 400);
      assert.deepEqual(await invalid.json(), {
        code: "INVALID_CUSTOMER_PHONE",
        error: "Invalid customer phone",
      });
    });
  } finally {
    store.claimAdminCustomerWhatsAppContact = originals.claim;
    store.getBookingForCurrentOwner = originals.getCurrent;
    store.getFreeWorkflowSettings = originals.getSettings;
    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;
  }
});
