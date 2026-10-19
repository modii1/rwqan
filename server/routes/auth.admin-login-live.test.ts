/**
 * Admin login under a read-only LIVE data environment.
 *
 * In LIVE read-only mode every Firestore write is rejected in-process, including
 * the shared `admin_login_attempt_limits` counter. Admin login must still work
 * (so the operator can switch back to TEST) without weakening the brute-force
 * bound: the bounded in-process `AdminLoginRateLimiter` remains the limit.
 * Genuine limiter failures must still fail closed with 503.
 */
import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import express from "express";
import authRouter from "./auth";
import { firebaseService } from "../firebaseService";
import { authService } from "../services";
import { contactIdentityService } from "../services/ContactIdentityService";
import { LiveWriteBlockedError } from "../config/dataEnvironment";

function buildApp() {
  const app = express();
  app.set("trust proxy", true);
  app.use(express.json());
  app.use((req, _res, next) => {
    const session: Record<string, unknown> = {
      isAdmin: false,
      regenerate(callback: (error?: Error) => void) {
        delete session.isAdmin;
        delete session.propertyNumber;
        callback();
        return session;
      },
      save(callback: (error?: Error) => void) {
        callback();
      },
    };
    (req as unknown as { session: Record<string, unknown> }).session = session;
    next();
  });
  app.use(authRouter);
  return app;
}

async function withServer<T>(
  app: express.Express,
  run: (baseUrl: string) => Promise<T>,
): Promise<T> {
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  try {
    const { port } = server.address() as AddressInfo;
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

function login(baseUrl: string, clientIp: string, body: unknown) {
  return fetch(`${baseUrl}/api/admin/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": clientIp,
    },
    body: JSON.stringify(body),
  });
}

test("admin login succeeds in read-only LIVE despite the blocked shared counter", async () => {
  const originalConsume = firebaseService.consumeAdminLoginAttemptLimit;
  const originalDelete = firebaseService.deleteAdminLoginAttemptLimit;
  const originalValidate = authService.validateAdminCredentials;
  const originalRevoke = contactIdentityService.revoke;
  (firebaseService as any).consumeAdminLoginAttemptLimit = async () => {
    throw new LiveWriteBlockedError();
  };
  (firebaseService as any).deleteAdminLoginAttemptLimit = async () => {
    throw new LiveWriteBlockedError();
  };
  (authService as any).validateAdminCredentials = () => true;
  (contactIdentityService as any).revoke = async () => {};

  try {
    await withServer(buildApp(), async (base) => {
      const response = await login(base, "203.0.113.10", {
        code: "valid",
        password: "valid",
      });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { ok: true });
    });
  } finally {
    firebaseService.consumeAdminLoginAttemptLimit = originalConsume;
    firebaseService.deleteAdminLoginAttemptLimit = originalDelete;
    authService.validateAdminCredentials = originalValidate;
    contactIdentityService.revoke = originalRevoke;
  }
});

test("read-only LIVE fallback still throttles repeated invalid attempts", async () => {
  const originalConsume = firebaseService.consumeAdminLoginAttemptLimit;
  const originalValidate = authService.validateAdminCredentials;
  (firebaseService as any).consumeAdminLoginAttemptLimit = async () => {
    throw new LiveWriteBlockedError();
  };
  (authService as any).validateAdminCredentials = () => false;

  try {
    await withServer(buildApp(), async (base) => {
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const response = await login(base, "203.0.113.20", {
          code: "invalid",
          password: "invalid",
        });
        assert.equal(response.status, 401);
      }
      const blocked = await login(base, "203.0.113.20", {
        code: "invalid",
        password: "invalid",
      });
      assert.equal(blocked.status, 429);
      assert.ok(Number(blocked.headers.get("retry-after")) > 0);
    });
  } finally {
    firebaseService.consumeAdminLoginAttemptLimit = originalConsume;
    authService.validateAdminCredentials = originalValidate;
  }
});

test("unexpected limiter failures still fail closed with 503", async () => {
  const originalConsume = firebaseService.consumeAdminLoginAttemptLimit;
  const originalValidate = authService.validateAdminCredentials;
  (firebaseService as any).consumeAdminLoginAttemptLimit = async () => {
    throw new Error("firestore unavailable");
  };
  (authService as any).validateAdminCredentials = () => true;

  try {
    await withServer(buildApp(), async (base) => {
      const response = await login(base, "203.0.113.30", {
        code: "valid",
        password: "valid",
      });
      assert.equal(response.status, 503);
    });
  } finally {
    firebaseService.consumeAdminLoginAttemptLimit = originalConsume;
    authService.validateAdminCredentials = originalValidate;
  }
});
