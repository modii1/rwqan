import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import cookieParser from "cookie-parser";
import express from "express";

import { CUSTOMER_SESSION_REVISION_HEADER } from "../../shared/customer";
import customerRoutes from "./customer";
import { customerAccountService } from "../services/CustomerAccountService";
import {
  CONTACT_IDENTITY_COOKIE_NAME,
  contactIdentityService,
} from "../services/ContactIdentityService";

const TOKEN = "c".repeat(43);
const PHONE = "512345678";
const SESSION_REVISION = "a".repeat(64);

test("customer account routes enforce identity isolation and return safe contracts", async (t) => {
  const originals = {
    resolve: contactIdentityService.resolve,
    getProfile: customerAccountService.getProfile,
    updateProfile: customerAccountService.updateProfile,
    getHistory: customerAccountService.getHistory,
    getFavorites: customerAccountService.getFavoritePropertyNumbers,
    setFavorite: customerAccountService.setFavorite,
  };
  const favoriteCalls: Array<{ propertyNumber: unknown; selected: boolean }> = [];

  (contactIdentityService as any).resolve = async (token: unknown) => token === TOKEN
    ? {
        clientPhone: PHONE,
        sessionId: SESSION_REVISION,
        visitorId: "visitor",
        verifiedAt: "2026-09-20T10:00:00.000Z",
        expiresAt: "2026-10-20T10:00:00.000Z",
      }
    : null;
  (customerAccountService as any).getProfile = async () => ({
    fullName: "Customer",
    email: null,
    maskedPhone: "05•• ••5678",
    favoritePropertyNumbers: ["10001"],
    createdAt: "2026-09-20T10:00:00.000Z",
    updatedAt: "2026-09-20T10:00:00.000Z",
    lastLoginAt: "2026-09-20T10:00:00.000Z",
  });
  (customerAccountService as any).updateProfile = async (_phone: string, body: unknown) => ({
    ...(await (customerAccountService as any).getProfile()),
    ...(body as object),
  });
  (customerAccountService as any).getHistory = async () => [{
    id: "request-1",
    propertyNumber: "10001",
    propertyName: null,
    requestCode: "REQ-1",
    contactAt: "2026-09-20T10:00:00.000Z",
    bookingStatus: "contact_only",
    listedPriceOptionsHalalas: [],
    questionnaire: null,
    answeredAt: null,
  }];
  (customerAccountService as any).getFavoritePropertyNumbers = async () => ["10001"];
  (customerAccountService as any).setFavorite = async (
    _phone: string,
    propertyNumber: unknown,
    selected: boolean,
  ) => {
    favoriteCalls.push({ propertyNumber, selected });
    return selected ? [String(propertyNumber)] : [];
  };

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use((req, _res, next) => {
    (req as any).session = {
      ...(req.get("x-owner") ? { propertyNumber: "OWNER-1" } : {}),
      ...(req.get("x-admin") ? { isAdmin: true } : {}),
    };
    next();
  });
  app.use(customerRoutes);

  let server: Server | undefined;
  try {
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      server!.once("listening", resolve);
      server!.once("error", reject);
    });
    const { port } = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${port}`;
    const authHeaders = {
      origin: baseUrl,
      cookie: `${CONTACT_IDENTITY_COOKIE_NAME}=${TOKEN}`,
      [CUSTOMER_SESSION_REVISION_HEADER]: SESSION_REVISION,
    };

    await t.test("cross-origin and privileged sessions cannot read a customer account", async () => {
      const crossOrigin = await fetch(`${baseUrl}/api/customer/profile`, {
        headers: {
          origin: "https://evil.example",
          cookie: `${CONTACT_IDENTITY_COOKIE_NAME}=${TOKEN}`,
        },
      });
      assert.equal(crossOrigin.status, 403);

      for (const roleHeader of ["x-owner", "x-admin"] as const) {
        const privileged = await fetch(`${baseUrl}/api/customer/profile`, {
          headers: { ...authHeaders, [roleHeader]: "1" },
        });
        assert.equal(privileged.status, 401);
        assert.equal((await privileged.json()).code, "CUSTOMER_SESSION_REQUIRED");
      }
    });

    await t.test("missing and invalid identities fail closed", async () => {
      const missing = await fetch(`${baseUrl}/api/customer/profile`, {
        headers: { origin: baseUrl },
      });
      assert.equal(missing.status, 401);

      const invalid = await fetch(`${baseUrl}/api/customer/profile`, {
        headers: {
          origin: baseUrl,
          cookie: `${CONTACT_IDENTITY_COOKIE_NAME}=${"z".repeat(43)}`,
        },
      });
      assert.equal(invalid.status, 401);
      assert.match(
        invalid.headers.get("set-cookie") || "",
        new RegExp(`${CONTACT_IDENTITY_COOKIE_NAME}=;`),
      );
    });

    await t.test("customer requests require the current opaque session revision", async () => {
      const missing = await fetch(`${baseUrl}/api/customer/profile`, {
        headers: {
          origin: baseUrl,
          cookie: `${CONTACT_IDENTITY_COOKIE_NAME}=${TOKEN}`,
        },
      });
      const missingText = await missing.text();
      assert.equal(missing.status, 409);
      assert.equal(JSON.parse(missingText).code, "CUSTOMER_SESSION_CHANGED");
      assert.equal(missingText.includes(PHONE), false);
      assert.equal(missingText.includes(SESSION_REVISION), false);

      const malformed = await fetch(`${baseUrl}/api/customer/profile`, {
        headers: {
          origin: baseUrl,
          cookie: `${CONTACT_IDENTITY_COOKIE_NAME}=${TOKEN}`,
          [CUSTOMER_SESSION_REVISION_HEADER]: "not-a-revision",
        },
      });
      const malformedText = await malformed.text();
      assert.equal(malformed.status, 409);
      assert.equal(JSON.parse(malformedText).code, "CUSTOMER_SESSION_CHANGED");
      assert.equal(malformedText.includes(PHONE), false);
      assert.equal(malformedText.includes(SESSION_REVISION), false);

      const mismatchedRevision = "b".repeat(64);
      const mismatched = await fetch(`${baseUrl}/api/customer/profile`, {
        headers: {
          origin: baseUrl,
          cookie: `${CONTACT_IDENTITY_COOKIE_NAME}=${TOKEN}`,
          [CUSTOMER_SESSION_REVISION_HEADER]: mismatchedRevision,
        },
      });
      const mismatchedText = await mismatched.text();
      assert.equal(mismatched.status, 409);
      assert.equal(JSON.parse(mismatchedText).code, "CUSTOMER_SESSION_CHANGED");
      assert.equal(mismatchedText.includes(PHONE), false);
      assert.equal(mismatchedText.includes(SESSION_REVISION), false);
      assert.equal(mismatchedText.includes(mismatchedRevision), false);

      const current = await fetch(`${baseUrl}/api/customer/profile`, {
        headers: authHeaders,
      });
      assert.equal(current.status, 200);
    });

    await t.test("profile and history never expose the canonical phone", async () => {
      const profile = await fetch(`${baseUrl}/api/customer/profile`, {
        headers: authHeaders,
      });
      const profileText = await profile.text();
      assert.equal(profile.status, 200);
      assert.equal(profileText.includes(PHONE), false);
      assert.deepEqual(JSON.parse(profileText).profile.favoritePropertyNumbers, ["10001"]);
      assert.match(profile.headers.get("cache-control") || "", /no-store/);

      const history = await fetch(`${baseUrl}/api/customer/history`, {
        headers: authHeaders,
      });
      const historyText = await history.text();
      assert.equal(history.status, 200);
      assert.equal(historyText.includes(PHONE), false);
      assert.equal(JSON.parse(historyText).history[0].bookingStatus, "contact_only");
    });

    await t.test("profile and favorite mutations use the verified identity", async () => {
      const profile = await fetch(`${baseUrl}/api/customer/profile`, {
        method: "PATCH",
        headers: { ...authHeaders, "content-type": "application/json" },
        body: JSON.stringify({ fullName: "Updated" }),
      });
      assert.equal(profile.status, 200);
      assert.equal((await profile.json()).profile.fullName, "Updated");

      const add = await fetch(`${baseUrl}/api/customer/favorites/20002`, {
        method: "PUT",
        headers: authHeaders,
      });
      assert.deepEqual(await add.json(), { favoritePropertyNumbers: ["20002"] });

      const remove = await fetch(`${baseUrl}/api/customer/favorites/20002`, {
        method: "DELETE",
        headers: authHeaders,
      });
      assert.deepEqual(await remove.json(), { favoritePropertyNumbers: [] });
      assert.deepEqual(favoriteCalls, [
        { propertyNumber: "20002", selected: true },
        { propertyNumber: "20002", selected: false },
      ]);
    });
  } finally {
    contactIdentityService.resolve = originals.resolve;
    customerAccountService.getProfile = originals.getProfile;
    customerAccountService.updateProfile = originals.updateProfile;
    customerAccountService.getHistory = originals.getHistory;
    customerAccountService.getFavoritePropertyNumbers = originals.getFavorites;
    customerAccountService.setFavorite = originals.setFavorite;
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => {
        server!.close((error?: Error) => (error ? reject(error) : resolve()));
      });
    }
  }
});
