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

test("customer bookings reject owner and admin sessions and clear stale customer access", async (t) => {
  const originalGetCustomerBookingsFromSession =
    bookingCommissionService.getCustomerBookingsFromSession;
  const seenTokens: string[] = [];

  (bookingCommissionService as any).getCustomerBookingsFromSession = async (token: string) => {
    seenTokens.push(token);
    return { bookings: [] };
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

    for (const role of ["owner", "admin"] as const) {
      await t.test(`${role} session cannot reuse a customer booking cookie`, async () => {
        const response = await fetch(`${baseUrl}/api/customer/bookings`, {
          headers: {
            cookie: staleCookie,
            ...(role === "owner"
              ? { "x-owner": "PROPERTY-1" }
              : { "x-admin": "1" }),
          },
        });

        assert.equal(response.status, 401);
        assert.deepEqual(await response.json(), {
          code: "CUSTOMER_BOOKING_SESSION_REQUIRED",
          error: "افتح رابط المتابعة المرسل إلى واتساب لعرض الحجوزات",
        });
        const setCookie = response.headers.get("set-cookie") || "";
        assert.match(setCookie, new RegExp(`${BOOKING_CUSTOMER_SESSION_COOKIE}=;`));
        assert.match(setCookie, /HttpOnly/i);
        assert.match(setCookie, /SameSite=Lax/i);
        assert.match(response.headers.get("cache-control") || "", /no-store/);
      });
    }

    await t.test("a customer-only session can still load its booking profile", async () => {
      const response = await fetch(`${baseUrl}/api/customer/bookings`, {
        headers: { cookie: staleCookie },
      });

      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { bookings: [] });
      assert.deepEqual(seenTokens, ["stale-forwarded-token"]);
    });

    assert.deepEqual(seenTokens, ["stale-forwarded-token"]);
  } finally {
    bookingCommissionService.getCustomerBookingsFromSession =
      originalGetCustomerBookingsFromSession;
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => {
        server!.close((error?: Error) => (error ? reject(error) : resolve()));
      });
    }
  }
});
