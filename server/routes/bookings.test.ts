import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import cookieParser from "cookie-parser";
import express from "express";
import bookingRoutes from "./bookings";
import {
  BOOKING_CUSTOMER_SESSION_COOKIE,
  bookingCommissionService,
} from "../services/BookingCommissionService";
import {
  CONTACT_IDENTITY_COOKIE_NAME,
  contactIdentityService,
} from "../services/ContactIdentityService";

test("customer bookings require a verified contact identity and isolate its phone", async (t) => {
  const originalGetCustomerBookingsFromSession =
    bookingCommissionService.getCustomerBookingsFromSession;
  const originalGetCustomerBookingsForVerifiedPhone =
    bookingCommissionService.getCustomerBookingsForVerifiedPhone;
  const originalResolveContactIdentity = contactIdentityService.resolve;
  const seenPhones: string[] = [];

  (contactIdentityService as any).resolve = async (token: unknown) => {
    const clientPhone = token === "verified-contact-one"
      ? "512345678"
      : token === "verified-contact-two"
        ? "598765432"
        : null;
    return clientPhone
      ? {
          clientPhone,
          sessionId: `contact-session-${clientPhone}`,
          visitorId: `contact-visitor-${clientPhone}`,
          verifiedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 60_000).toISOString(),
        }
      : null;
  };
  (bookingCommissionService as any).getCustomerBookingsFromSession = async () => {
    throw new Error("the legacy booking token must not authorize a customer profile");
  };
  (bookingCommissionService as any).getCustomerBookingsForVerifiedPhone = async (
    phone: string,
  ) => {
    seenPhones.push(phone);
    return {
      identity: { maskedPhone: phone === "512345678" ? "05•• ••5678" : "05•• ••5432" },
      bookings: [{ id: `booking-${phone}` }],
    };
  };

  const expectedUnauthorized = {
    code: "CUSTOMER_BOOKING_SESSION_REQUIRED",
    error: "افتح رابط المتابعة المرسل إلى واتساب لعرض الحجوزات",
  };

  const assertBookingCookieCleared = (response: Response) => {
    const setCookie = response.headers.get("set-cookie") || "";
    assert.match(setCookie, new RegExp(`${BOOKING_CUSTOMER_SESSION_COOKIE}=;`));
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);
    return setCookie;
  };

  const app = express();
  app.use(cookieParser());
  app.use((req, _res, next) => {
    (req as any).session = {
      ...(req.get("x-owner") ? { propertyNumber: req.get("x-owner") } : {}),
      ...(req.get("x-admin") ? { isAdmin: true } : {}),
    };
    next();
  });
  app.use(bookingRoutes);

  let server: Server | undefined;
  try {
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      server!.once("listening", resolve);
      server!.once("error", reject);
    });
    const { port } = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${port}`;
    const staleCookie = `${BOOKING_CUSTOMER_SESSION_COOKIE}=stale-forwarded-token`;

    await t.test("a cross-origin site cannot read a verified customer profile", async () => {
      const readsBefore = seenPhones.length;
      const response = await fetch(`${baseUrl}/api/customer/bookings`, {
        headers: {
          origin: "https://evil.example",
          cookie: `${CONTACT_IDENTITY_COOKIE_NAME}=verified-contact-one`,
        },
      });

      assert.equal(response.status, 403);
      assert.equal((await response.json()).code, "CROSS_ORIGIN_REQUEST");
      assert.equal(seenPhones.length, readsBefore);
    });

    for (const role of ["owner", "admin"] as const) {
      await t.test(`${role} session cannot reuse customer profile credentials`, async () => {
        const response = await fetch(`${baseUrl}/api/customer/bookings`, {
          headers: {
            cookie: `${staleCookie}; ${CONTACT_IDENTITY_COOKIE_NAME}=verified-contact-one`,
            ...(role === "owner"
              ? { "x-owner": "PROPERTY-1" }
              : { "x-admin": "1" }),
          },
        });

        assert.equal(response.status, 401);
        assert.deepEqual(await response.json(), expectedUnauthorized);
        assertBookingCookieCleared(response);
        assert.match(response.headers.get("cache-control") || "", /no-store/);
      });
    }

    await t.test("a legacy booking token alone cannot load a customer profile", async () => {
      const response = await fetch(`${baseUrl}/api/customer/bookings`, {
        headers: { cookie: staleCookie },
      });

      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), expectedUnauthorized);
      assertBookingCookieCleared(response);
      assert.deepEqual(seenPhones, []);
    });

    await t.test("a missing contact identity fails closed", async () => {
      const response = await fetch(`${baseUrl}/api/customer/bookings`);

      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), expectedUnauthorized);
      assertBookingCookieCleared(response);
      assert.deepEqual(seenPhones, []);
    });

    await t.test("an invalid contact identity clears both identity and legacy booking access", async () => {
      const response = await fetch(`${baseUrl}/api/customer/bookings`, {
        headers: {
          cookie: `${staleCookie}; ${CONTACT_IDENTITY_COOKIE_NAME}=invalid-or-expired-token`,
        },
      });

      assert.equal(response.status, 401);
      assert.deepEqual(await response.json(), expectedUnauthorized);
      const setCookie = assertBookingCookieCleared(response);
      assert.match(setCookie, new RegExp(`${CONTACT_IDENTITY_COOKIE_NAME}=;`));
      assert.deepEqual(seenPhones, []);
    });

    await t.test("a verified contact identity alone loads its own profile", async () => {
      const response = await fetch(`${baseUrl}/api/customer/bookings`, {
        headers: {
          cookie: `${CONTACT_IDENTITY_COOKIE_NAME}=verified-contact-one`,
        },
      });

      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        identity: { maskedPhone: "05•• ••5678" },
        bookings: [{ id: "booking-512345678" }],
      });
      assert.deepEqual(seenPhones, ["512345678"]);
    });

    await t.test("a different verified number ignores and clears another number's legacy token", async () => {
      const response = await fetch(`${baseUrl}/api/customer/bookings`, {
        headers: {
          cookie: `${staleCookie}; ${CONTACT_IDENTITY_COOKIE_NAME}=verified-contact-two`,
        },
      });

      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        identity: { maskedPhone: "05•• ••5432" },
        bookings: [{ id: "booking-598765432" }],
      });
      assertBookingCookieCleared(response);
      assert.deepEqual(seenPhones, ["512345678", "598765432"]);
    });
  } finally {
    bookingCommissionService.getCustomerBookingsFromSession =
      originalGetCustomerBookingsFromSession;
    bookingCommissionService.getCustomerBookingsForVerifiedPhone =
      originalGetCustomerBookingsForVerifiedPhone;
    contactIdentityService.resolve = originalResolveContactIdentity;
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => {
        server!.close((error?: Error) => (error ? reject(error) : resolve()));
      });
    }
  }
});
