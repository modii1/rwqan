import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import { requireAdmin, requireSameOrigin } from "../middleware";
import { bookingCommissionStore } from "../../services/BookingCommissionStore";
import bookingPaymentRoutes from "./booking-payments";

test("admin bank-transfer review route is session protected and validates its decision shape", async () => {
  const originalResolve = bookingCommissionStore.resolveBankTransferAttempt;
  const reviews: unknown[] = [];
  (bookingCommissionStore as any).resolveBankTransferAttempt = async (
    input: unknown,
  ) => {
    reviews.push(input);
    return {
      status: "rejected",
      bookingId: "BOOK-ADMIN-BANK",
      attemptId: "ATT-ADMIN-BANK",
      propertyReleased: false,
      reviewReason: "receipt_rejected_by_admin",
    };
  };

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = {
      ...(req.get("x-test-admin") === "1" ? { isAdmin: true } : {}),
    };
    next();
  });
  app.use("/api/admin", requireSameOrigin, requireAdmin);
  app.use(bookingPaymentRoutes);
  let server: Server | undefined;

  try {
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      server!.once("listening", resolve);
      server!.once("error", reject);
    });
    const { port } = server.address() as AddressInfo;
    const endpoint = `http://127.0.0.1:${port}/api/admin/booking-commissions/BOOK-ADMIN-BANK/bank-transfer-review`;

    const crossSite = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "sec-fetch-site": "cross-site",
        "x-test-admin": "1",
      },
      body: JSON.stringify({
        attemptId: "ATT-ADMIN-BANK",
        resolution: "reject",
      }),
    });
    assert.equal(crossSite.status, 403);

    const anonymous = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "sec-fetch-site": "same-origin",
      },
      body: JSON.stringify({
        attemptId: "ATT-ADMIN-BANK",
        resolution: "reject",
      }),
    });
    assert.equal(anonymous.status, 401);

    const invalid = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "sec-fetch-site": "same-origin",
        "x-test-admin": "1",
      },
      body: JSON.stringify({
        attemptId: "ATT-ADMIN-BANK",
        resolution: "refund",
      }),
    });
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).code, "INVALID_BOOKING_INPUT");
    assert.equal(reviews.length, 0);

    const valid = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "sec-fetch-site": "same-origin",
        "x-test-admin": "1",
      },
      body: JSON.stringify({
        attemptId: "ATT-ADMIN-BANK",
        resolution: "reject",
      }),
    });
    assert.equal(valid.status, 200);
    assert.equal(valid.headers.get("cache-control"), "no-store, private");
    assert.deepEqual(await valid.json(), {
      status: "rejected",
      bookingId: "BOOK-ADMIN-BANK",
      attemptId: "ATT-ADMIN-BANK",
      propertyReleased: false,
      reviewReason: "receipt_rejected_by_admin",
    });
    assert.deepEqual(reviews, [{
      bookingId: "BOOK-ADMIN-BANK",
      attemptId: "ATT-ADMIN-BANK",
      resolution: "reject",
    }]);
  } finally {
    (bookingCommissionStore as any).resolveBankTransferAttempt = originalResolve;
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => {
        server!.close((error?: Error) => (error ? reject(error) : resolve()));
      });
    }
  }
});
