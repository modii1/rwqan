import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import {
  createBookingShortLinkHandler,
  createOwnerPaymentShortLinkHandler,
} from "./bookings";
import { BookingShortLinkError } from "../services/BookingShortLinkService";
import { BookingTokenService } from "../services/BookingTokenService";

const SECRET = "booking-short-route-test-secret-value-123456789";

async function withShortLinkServer(
  resolve: (code: string) => Promise<{ token: string; expiresAt: string }>,
  run: (baseUrl: string) => Promise<void>,
  options: { purpose?: "customer_response" | "owner_payment" } = {},
): Promise<void> {
  const app = express();
  const ownerPayment = options.purpose === "owner_payment";
  app.get(
    ownerPayment ? "/p/:code" : "/b/:code",
    ownerPayment
      ? createOwnerPaymentShortLinkHandler(resolve)
      : createBookingShortLinkHandler(resolve),
  );
  const server = await new Promise<ReturnType<typeof app.listen>>((resolveServer, reject) => {
    const listening = app.listen(0, "127.0.0.1", () => resolveServer(listening));
    listening.once("error", reject);
  });
  const { port } = server.address() as AddressInfo;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolveServer, reject) => {
      server.close((error?: Error) => error ? reject(error) : resolveServer());
    });
  }
}

test("short owner-payment route redirects only to the local purpose-bound commission page", async () => {
  const previousSecret = process.env.SESSION_SECRET;
  const now = Date.now();
  process.env.SESSION_SECRET = SECRET;
  const expiresAt = new Date(now + 60_000).toISOString();
  const ownerToken = new BookingTokenService({ secret: SECRET, now: () => now }).issue({
    bookingId: "BOOK-SHORT-OWNER-1",
    purpose: "owner_payment",
    expiresAt,
  });

  try {
    await withShortLinkServer(
      async (code) => {
        assert.equal(code, "P".repeat(10));
        return { token: ownerToken, expiresAt };
      },
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/p/${"P".repeat(10)}`, {
          redirect: "manual",
        });
        assert.equal(response.status, 302);
        assert.equal(
          response.headers.get("location"),
          `/booking-commission/${encodeURIComponent(ownerToken)}`,
        );
        assert.equal(response.headers.get("cache-control"), "no-store, private");
        assert.equal(response.headers.get("referrer-policy"), "no-referrer");
        assert.equal(
          response.headers.get("x-robots-tag"),
          "noindex, nofollow, noarchive",
        );
        assert.equal(response.headers.get("x-content-type-options"), "nosniff");
      },
      { purpose: "owner_payment" },
    );

    const customerToken = new BookingTokenService({ secret: SECRET, now: () => now }).issue({
      bookingId: "BOOK-SHORT-OWNER-1",
      purpose: "customer_response",
      expiresAt,
    });
    await withShortLinkServer(
      async () => ({ token: customerToken, expiresAt }),
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/p/${"C".repeat(10)}`, {
          redirect: "manual",
        });
        assert.equal(response.status, 404);
        assert.equal(response.headers.get("location"), null);
      },
      { purpose: "owner_payment" },
    );

    await withShortLinkServer(
      async () => ({
        token: ownerToken,
        expiresAt: new Date(Date.parse(expiresAt) + 1_000).toISOString(),
      }),
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/p/${"M".repeat(10)}`, {
          redirect: "manual",
        });
        assert.equal(response.status, 404);
        assert.equal(response.headers.get("location"), null);
      },
      { purpose: "owner_payment" },
    );
  } finally {
    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;
  }
});

test("short owner-payment route returns the hardened bounded error responses", async () => {
  const cases = [
    {
      code: "N".repeat(10),
      error: new BookingShortLinkError(
        "SHORT_LINK_NOT_FOUND",
        "missing",
      ),
      status: 404,
    },
    {
      code: "X".repeat(10),
      error: new BookingShortLinkError(
        "SHORT_LINK_EXPIRED",
        "expired",
      ),
      status: 410,
    },
  ];

  for (const scenario of cases) {
    await withShortLinkServer(
      async () => {
        throw scenario.error;
      },
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/p/${scenario.code}`, {
          redirect: "manual",
        });
        assert.equal(response.status, scenario.status);
        assert.equal(response.headers.get("location"), null);
        assert.equal(response.headers.get("cache-control"), "no-store, private");
        assert.equal(response.headers.get("referrer-policy"), "no-referrer");
        assert.equal(
          response.headers.get("x-robots-tag"),
          "noindex, nofollow, noarchive",
        );
        assert.equal(response.headers.get("x-content-type-options"), "nosniff");
        assert.equal(await response.text(), "الرابط غير متاح");
      },
      { purpose: "owner_payment" },
    );
  }
});

test("short booking route redirects only to the local purpose-bound booking page", async () => {
  const previousSecret = process.env.SESSION_SECRET;
  const now = Date.now();
  process.env.SESSION_SECRET = SECRET;
  const expiresAt = new Date(now + 60_000).toISOString();
  const token = new BookingTokenService({ secret: SECRET, now: () => now }).issue({
    bookingId: "BOOK-SHORT-ROUTE-1",
    purpose: "customer_response",
    expiresAt,
  });

  try {
    await withShortLinkServer(
      async () => ({ token, expiresAt }),
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/b/${"A".repeat(10)}`, {
          redirect: "manual",
        });
        assert.equal(response.status, 302);
        assert.equal(
          response.headers.get("location"),
          `/booking/${encodeURIComponent(token)}`,
        );
        assert.equal(response.headers.get("cache-control"), "no-store, private");
        assert.equal(response.headers.get("referrer-policy"), "no-referrer");
        assert.equal(
          response.headers.get("x-robots-tag"),
          "noindex, nofollow, noarchive",
        );
        assert.equal(response.headers.get("x-content-type-options"), "nosniff");
      },
    );

    await withShortLinkServer(
      async (code) => {
        assert.equal(code, "L".repeat(22));
        return { token, expiresAt };
      },
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/b/${"L".repeat(22)}`, {
          redirect: "manual",
        });
        assert.equal(response.status, 302);
        assert.equal(
          response.headers.get("location"),
          `/booking/${encodeURIComponent(token)}`,
        );
      },
    );

    await withShortLinkServer(
      async () => ({
        token: "https://attacker.example/redirect",
        expiresAt,
      }),
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/b/${"B".repeat(10)}`, {
          redirect: "manual",
        });
        assert.equal(response.status, 404);
        assert.equal(response.headers.get("location"), null);
      },
    );

    const ownerToken = new BookingTokenService({ secret: SECRET, now: () => now }).issue({
      bookingId: "BOOK-SHORT-ROUTE-1",
      purpose: "owner_payment",
      expiresAt,
    });
    await withShortLinkServer(
      async () => ({ token: ownerToken, expiresAt }),
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/b/${"E".repeat(10)}`, {
          redirect: "manual",
        });
        assert.equal(response.status, 404);
        assert.equal(response.headers.get("location"), null);
      },
    );
  } finally {
    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;
  }
});

test("short booking route returns bounded not-found and expired responses", async () => {
  const cases = [
    {
      code: "malformed",
      error: new BookingShortLinkError(
        "SHORT_LINK_MALFORMED",
        "malformed",
      ),
      status: 404,
    },
    {
      code: "C".repeat(10),
      error: new BookingShortLinkError(
        "SHORT_LINK_NOT_FOUND",
        "missing",
      ),
      status: 404,
    },
    {
      code: "D".repeat(10),
      error: new BookingShortLinkError(
        "SHORT_LINK_EXPIRED",
        "expired",
      ),
      status: 410,
    },
  ];

  for (const scenario of cases) {
    await withShortLinkServer(
      async () => {
        throw scenario.error;
      },
      async (baseUrl) => {
        const response = await fetch(`${baseUrl}/b/${scenario.code}`, {
          redirect: "manual",
        });
        assert.equal(response.status, scenario.status);
        assert.equal(response.headers.get("location"), null);
        assert.equal(response.headers.get("cache-control"), "no-store, private");
        assert.equal(response.headers.get("referrer-policy"), "no-referrer");
        assert.equal(await response.text(), "الرابط غير متاح");
      },
    );
  }
});
