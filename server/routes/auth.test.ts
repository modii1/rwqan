import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import cookieParser from "cookie-parser";
import express from "express";
import authRouter from "./auth";
import { firebaseService } from "../firebaseService";
import { authService } from "../services";
import {
  CONTACT_IDENTITY_COOKIE_NAME,
  contactIdentityService,
} from "../services/ContactIdentityService";
import { BOOKING_CUSTOMER_SESSION_COOKIE } from "../services/BookingCommissionService";

test("successful owner login clears and revokes dormant customer access", async () => {
  const originalValidateOwnerPin = authService.validateOwnerPin;
  const originalRevoke = contactIdentityService.revoke;
  const contactToken = "a".repeat(43);
  const revokedTokens: unknown[] = [];

  (authService as any).validateOwnerPin = async () => true;
  (contactIdentityService as any).revoke = async (token: unknown) => {
    revokedTokens.push(token);
  };

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use((req, _res, next) => {
    (req as any).session = {
      save(callback: (error?: Error) => void) {
        callback();
      },
    };
    next();
  });
  app.use(authRouter);

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const { port } = server.address() as AddressInfo;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/owner/login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `${CONTACT_IDENTITY_COOKIE_NAME}=${contactToken}; ${BOOKING_CUSTOMER_SESSION_COOKIE}=legacy-booking-token`,
      },
      body: JSON.stringify({ propertyNumber: "12345", pin: "valid-pin" }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.deepEqual(revokedTokens, [contactToken]);
    const setCookie = response.headers.get("set-cookie") || "";
    assert.match(setCookie, new RegExp(`${CONTACT_IDENTITY_COOKIE_NAME}=;`));
    assert.match(setCookie, new RegExp(`${BOOKING_CUSTOMER_SESSION_COOKIE}=;`));
    assert.match(setCookie, /HttpOnly/i);
    assert.match(setCookie, /SameSite=Lax/i);
  } finally {
    authService.validateOwnerPin = originalValidateOwnerPin;
    contactIdentityService.revoke = originalRevoke;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("admin login endpoint throttles repeated invalid attempts", async () => {
  const originalSharedLimiter = firebaseService.consumeAdminLoginAttemptLimit;
  let sharedLimiterCalls = 0;
  (firebaseService as any).consumeAdminLoginAttemptLimit = async () => {
    sharedLimiterCalls += 1;
    return { allowed: true, retryAfterMs: 0 };
  };

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = {
      save(callback: (error?: Error) => void) {
        callback();
      },
    };
    next();
  });
  app.use(authRouter);

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const { port } = server.address() as AddressInfo;

  try {
    const crossOrigin = await fetch(`http://127.0.0.1:${port}/api/admin/login`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://evil.example",
      },
      body: JSON.stringify({ code: "invalid", password: "invalid" }),
    });
    assert.equal(crossOrigin.status, 403);
    assert.equal(sharedLimiterCalls, 0, "cross-origin attempts must not spend the rate limit");

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await fetch(`http://127.0.0.1:${port}/api/admin/login`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: "invalid", password: "invalid" }),
      });
      assert.equal(response.status, 401);
    }

    const blocked = await fetch(`http://127.0.0.1:${port}/api/admin/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "invalid", password: "invalid" }),
    });
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get("retry-after")) > 0);
    assert.equal(sharedLimiterCalls, 5);
  } finally {
    firebaseService.consumeAdminLoginAttemptLimit = originalSharedLimiter;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
