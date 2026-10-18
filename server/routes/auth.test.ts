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
import { ownerLoginRateLimiter } from "../services/OwnerLoginRateLimiter";

test("successful owner login clears and revokes dormant customer access", async () => {
  const originalValidateOwnerPin = authService.validateOwnerPin;
  const originalRevoke = contactIdentityService.revoke;
  const originalConsumeOwnerLimit = ownerLoginRateLimiter.consume;
  const originalClearOwnerLimit = ownerLoginRateLimiter.clear;
  const contactToken = "a".repeat(43);
  const revokedTokens: unknown[] = [];
  let regenerateCalls = 0;
  const session: Record<string, unknown> = {
    isAdmin: true,
    regenerate(callback: (error?: Error) => void) {
      regenerateCalls += 1;
      delete session.isAdmin;
      delete session.propertyNumber;
      callback();
      return session;
    },
    save(callback: (error?: Error) => void) {
      callback();
    },
  };

  (authService as any).validateOwnerPin = async () => true;
  (ownerLoginRateLimiter as any).consume = async () => ({
    allowed: true,
    retryAfterMs: 0,
  });
  (ownerLoginRateLimiter as any).clear = async () => {};
  (contactIdentityService as any).revoke = async (token: unknown) => {
    revokedTokens.push(token);
  };

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use((req, _res, next) => {
    (req as any).session = session;
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
    assert.equal(session.propertyNumber, "12345");
    assert.equal("isAdmin" in session, false);
    assert.equal(regenerateCalls, 1);
  } finally {
    authService.validateOwnerPin = originalValidateOwnerPin;
    ownerLoginRateLimiter.consume = originalConsumeOwnerLimit;
    ownerLoginRateLimiter.clear = originalClearOwnerLimit;
    contactIdentityService.revoke = originalRevoke;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("successful admin login clears an existing owner session", async () => {
  const originalValidateAdminCredentials = authService.validateAdminCredentials;
  const originalSharedLimiter = firebaseService.consumeAdminLoginAttemptLimit;
  const originalDeleteSharedLimit = firebaseService.deleteAdminLoginAttemptLimit;
  const originalRevoke = contactIdentityService.revoke;
  let regenerateCalls = 0;
  const session: Record<string, unknown> = {
    propertyNumber: "12345",
    regenerate(callback: (error?: Error) => void) {
      regenerateCalls += 1;
      delete session.isAdmin;
      delete session.propertyNumber;
      callback();
      return session;
    },
    save(callback: (error?: Error) => void) {
      callback();
    },
  };

  (authService as any).validateAdminCredentials = () => true;
  (firebaseService as any).consumeAdminLoginAttemptLimit = async () => ({
    allowed: true,
    retryAfterMs: 0,
  });
  (firebaseService as any).deleteAdminLoginAttemptLimit = async () => {};
  (contactIdentityService as any).revoke = async () => {};

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use((req, _res, next) => {
    (req as any).session = session;
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
    const response = await fetch(`http://127.0.0.1:${port}/api/admin/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "valid-admin", password: "valid-password" }),
    });

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true });
    assert.equal(session.isAdmin, true);
    assert.equal("propertyNumber" in session, false);
    assert.equal(regenerateCalls, 1);
  } finally {
    authService.validateAdminCredentials = originalValidateAdminCredentials;
    firebaseService.consumeAdminLoginAttemptLimit = originalSharedLimiter;
    firebaseService.deleteAdminLoginAttemptLimit = originalDeleteSharedLimit;
    contactIdentityService.revoke = originalRevoke;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("legacy owner login returns a bounded 429 before PIN verification", async () => {
  const originalConsume = ownerLoginRateLimiter.consume;
  const originalValidate = authService.validateOwnerPin;
  let validationCalls = 0;
  (ownerLoginRateLimiter as any).consume = async () => ({
    allowed: false,
    retryAfterMs: 61_000,
  });
  (authService as any).validateOwnerPin = async () => {
    validationCalls += 1;
    return false;
  };
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = {};
    next();
  });
  app.use(authRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  try {
    const { port } = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${port}/api/owner/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ propertyNumber: "12345", pin: "wrong" }),
    });
    assert.equal(response.status, 429);
    assert.equal(response.headers.get("retry-after"), "61");
    assert.equal(validationCalls, 0);
  } finally {
    ownerLoginRateLimiter.consume = originalConsume;
    authService.validateOwnerPin = originalValidate;
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

test("owner password reset rejects cross-origin and rate-limited attempts before auth work", async () => {
  const originals = {
    consume: ownerLoginRateLimiter.consume,
    sendResetCode: authService.sendResetCode,
    setNewPassword: authService.setNewPassword,
  };
  let limiterCalls = 0;
  let sendCalls = 0;
  let passwordCalls = 0;
  (ownerLoginRateLimiter as any).consume = async () => {
    limiterCalls += 1;
    return { allowed: false, retryAfterMs: 31_000 };
  };
  (authService as any).sendResetCode = async () => {
    sendCalls += 1;
    return { maskedPhone: "*******1234", expiresIn: 10 };
  };
  (authService as any).setNewPassword = async () => {
    passwordCalls += 1;
  };

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = {};
    next();
  });
  app.use(authRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  try {
    for (const [path, body] of [
      ["/api/auth/send-reset-code", { ownerId: "12345" }],
      ["/api/auth/set-new-password", {
        ownerId: "12345",
        resetCode: "123456",
        newPassword: "5678",
      }],
    ] as const) {
      const crossOrigin = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://evil.example",
        },
        body: JSON.stringify(body),
      });
      assert.equal(crossOrigin.status, 403);

      const throttled = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      assert.equal(throttled.status, 429);
      assert.equal(throttled.headers.get("retry-after"), "31");
    }

    assert.equal(limiterCalls, 2);
    assert.equal(sendCalls, 0);
    assert.equal(passwordCalls, 0);
  } finally {
    ownerLoginRateLimiter.consume = originals.consume;
    authService.sendResetCode = originals.sendResetCode;
    authService.setNewPassword = originals.setNewPassword;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("successful password reset clears the property limiter after consuming the code", async () => {
  const originals = {
    consume: ownerLoginRateLimiter.consume,
    clear: ownerLoginRateLimiter.clear,
    setNewPassword: authService.setNewPassword,
  };
  const cleared: Array<{ ipAddress: unknown; propertyNumber: unknown }> = [];
  (ownerLoginRateLimiter as any).consume = async () => ({
    allowed: true,
    retryAfterMs: 0,
  });
  (ownerLoginRateLimiter as any).clear = async (input: any) => {
    cleared.push(input);
  };
  (authService as any).setNewPassword = async () => {};

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = {};
    next();
  });
  app.use(authRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  try {
    const { port } = server.address() as AddressInfo;
    const response = await fetch(
      `http://127.0.0.1:${port}/api/auth/set-new-password`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ownerId: "12345",
          resetCode: "123456",
          newPassword: "5678",
        }),
      },
    );
    assert.equal(response.status, 200);
    assert.equal(cleared.length, 1);
    assert.equal(cleared[0].propertyNumber, "12345");
  } finally {
    ownerLoginRateLimiter.consume = originals.consume;
    ownerLoginRateLimiter.clear = originals.clear;
    authService.setNewPassword = originals.setNewPassword;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
