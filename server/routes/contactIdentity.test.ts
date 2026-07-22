import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import cookieParser from "cookie-parser";
import type { AddressInfo } from "node:net";
import contactIdentityRouter from "./contactIdentity";
import { propertyService } from "../services";
import {
  CONTACT_IDENTITY_COOKIE_NAME,
  ContactIdentityRateLimitError,
  contactIdentityService,
} from "../services/ContactIdentityService";

const EXISTING_TOKEN = "x".repeat(43);
const NEW_TOKEN = "y".repeat(43);

test("contact identity API returns only masked state and manages its own protected cookie", async (t) => {
  const originals = {
    getByNumber: propertyService.getByNumber,
    resolve: contactIdentityService.resolve,
    issue: contactIdentityService.issue,
    revoke: contactIdentityService.revoke,
  };
  const revoked: unknown[] = [];
  const issueLimitKeys: unknown[] = [];
  let revokeShouldFail = false;

  (propertyService as any).getByNumber = async (propertyNumber: string) => ({
    propertyNumber,
    whatsappNumber: "0512345678",
  });
  (contactIdentityService as any).resolve = async (token: unknown) => token === EXISTING_TOKEN
    ? {
        clientPhone: "598765432",
        sessionId: "a".repeat(64),
        visitorId: "v".repeat(43),
        expiresAt: "2026-10-20T12:00:00.000Z",
      }
    : null;
  (contactIdentityService as any).issue = async (
    phone: unknown,
    _previousToken: unknown,
    issueLimitKey: unknown,
  ) => {
    issueLimitKeys.push(issueLimitKey);
    if (phone === "invalid") throw new RangeError("رقم الجوال غير صحيح");
    if (phone === "limited") throw new ContactIdentityRateLimitError(30_000);
    return {
      token: NEW_TOKEN,
      clientPhone: "512345678",
      sessionId: "b".repeat(64),
      visitorId: "w".repeat(43),
      expiresAt: "2026-10-20T12:00:00.000Z",
    };
  };
  (contactIdentityService as any).revoke = async (token: unknown) => {
    if (revokeShouldFail) throw new Error("Firebase unavailable");
    revoked.push(token);
  };

  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use((req, _res, next) => {
    (req as any).session = {
      ...(req.get("x-owner") ? { propertyNumber: req.get("x-owner") } : {}),
      ...(req.get("x-admin") ? { isAdmin: true } : {}),
    };
    next();
  });
  app.use(contactIdentityRouter);

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await t.test("remembered client status contains a mask but no phone or token", async () => {
      const response = await fetch(`${baseUrl}/api/contact-identity`, {
        headers: { cookie: `${CONTACT_IDENTITY_COOKIE_NAME}=${EXISTING_TOKEN}` },
      });
      const text = await response.text();
      const payload = JSON.parse(text);

      assert.equal(response.status, 200);
      assert.deepEqual(payload, { kind: "client", maskedPhone: "05•• ••5432" });
      assert.equal(text.includes("598765432"), false);
      assert.equal(text.includes(EXISTING_TOKEN), false);
      assert.match(response.headers.get("cache-control") || "", /no-store/);
    });

    await t.test("saving a number sets an HttpOnly persistent cookie", async () => {
      const response = await fetch(`${baseUrl}/api/contact-identity`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: baseUrl },
        body: JSON.stringify({ clientPhone: "0512345678" }),
      });
      const payload = await response.json();
      const setCookie = response.headers.get("set-cookie") || "";

      assert.deepEqual(payload, { kind: "client", maskedPhone: "05•• ••5678" });
      assert.match(setCookie, new RegExp(`^${CONTACT_IDENTITY_COOKIE_NAME}=`));
      assert.match(setCookie, /HttpOnly/i);
      assert.match(setCookie, /SameSite=Lax/i);
      assert.match(setCookie, /Max-Age=7776000/i);
      assert.equal(JSON.stringify(payload).includes(NEW_TOKEN), false);
      assert.match(String(issueLimitKeys.at(-1) || ""), /^[a-f0-9]{64}$/);
    });

    await t.test("forgetting the number revokes only the contact cookie", async () => {
      const response = await fetch(`${baseUrl}/api/contact-identity`, {
        method: "DELETE",
        headers: {
          origin: baseUrl,
          cookie: `${CONTACT_IDENTITY_COOKIE_NAME}=${EXISTING_TOKEN}; connect.sid=owner-session`,
        },
      });
      const setCookie = response.headers.get("set-cookie") || "";

      assert.equal(response.status, 200);
      assert.deepEqual(revoked, [EXISTING_TOKEN]);
      assert.match(setCookie, new RegExp(`${CONTACT_IDENTITY_COOKIE_NAME}=;`));
      assert.equal(setCookie.includes("connect.sid"), false);
    });

    await t.test("the browser cookie is cleared even when server-side revocation fails", async () => {
      revokeShouldFail = true;
      const response = await fetch(`${baseUrl}/api/contact-identity`, {
        method: "DELETE",
        headers: {
          origin: baseUrl,
          cookie: `${CONTACT_IDENTITY_COOKIE_NAME}=${EXISTING_TOKEN}`,
        },
      });
      revokeShouldFail = false;

      assert.equal(response.status, 200);
      assert.match(response.headers.get("set-cookie") || "", new RegExp(`${CONTACT_IDENTITY_COOKIE_NAME}=;`));
    });

    await t.test("owner state wins over a remembered-client cookie and cannot be changed here", async () => {
      const status = await fetch(`${baseUrl}/api/contact-identity`, {
        headers: {
          "x-owner": "OWNER-1",
          cookie: `${CONTACT_IDENTITY_COOKIE_NAME}=${EXISTING_TOKEN}`,
        },
      });
      assert.deepEqual(await status.json(), { kind: "owner", maskedPhone: "05•• ••5678" });

      const change = await fetch(`${baseUrl}/api/contact-identity`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: baseUrl,
          "x-owner": "OWNER-1",
        },
        body: JSON.stringify({ clientPhone: "0598765432" }),
      });
      assert.equal(change.status, 403);
      assert.equal((await change.json()).code, "OWNER_CONTACT_MANAGED");
    });

    await t.test("admin state does not create or reuse a public-client profile", async () => {
      const response = await fetch(`${baseUrl}/api/contact-identity`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: baseUrl,
          "x-admin": "1",
        },
        body: JSON.stringify({ clientPhone: "0512345678" }),
      });
      assert.equal(response.status, 403);
      assert.equal((await response.json()).code, "ADMIN_CONTACT_NOT_REMEMBERED");
    });

    await t.test("invalid and cross-origin mutations are rejected", async () => {
      const invalid = await fetch(`${baseUrl}/api/contact-identity`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: baseUrl },
        body: JSON.stringify({ clientPhone: "invalid" }),
      });
      assert.equal(invalid.status, 400);

      const crossOrigin = await fetch(`${baseUrl}/api/contact-identity`, {
        method: "DELETE",
        headers: { origin: "https://evil.example" },
      });
      assert.equal(crossOrigin.status, 403);
      assert.equal((await crossOrigin.json()).code, "CROSS_ORIGIN_REQUEST");

      const limited = await fetch(`${baseUrl}/api/contact-identity`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: baseUrl },
        body: JSON.stringify({ clientPhone: "limited" }),
      });
      assert.equal(limited.status, 429);
      assert.equal(limited.headers.get("retry-after"), "30");
      assert.equal((await limited.json()).code, "CONTACT_IDENTITY_RATE_LIMIT");
    });

    await t.test("the configured App Hosting origin is accepted without trusting spoofed hosts", async () => {
      const previousBaseUrl = process.env.NEXT_PUBLIC_BASE_URL;
      process.env.NEXT_PUBLIC_BASE_URL = "https://rwqan.example";
      try {
        const response = await fetch(`${baseUrl}/api/contact-identity`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "https://rwqan.example",
            "x-forwarded-host": "evil.example",
            "x-forwarded-proto": "https",
          },
          body: JSON.stringify({ clientPhone: "0512345678" }),
        });
        assert.equal(response.status, 200);
      } finally {
        if (previousBaseUrl === undefined) delete process.env.NEXT_PUBLIC_BASE_URL;
        else process.env.NEXT_PUBLIC_BASE_URL = previousBaseUrl;
      }
    });
  } finally {
    propertyService.getByNumber = originals.getByNumber;
    contactIdentityService.resolve = originals.resolve;
    contactIdentityService.issue = originals.issue;
    contactIdentityService.revoke = originals.revoke;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
