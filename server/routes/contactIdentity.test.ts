import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import cookieParser from "cookie-parser";
import type { AddressInfo } from "node:net";
import contactIdentityRouter from "./contactIdentity";
import { propertyService } from "../services";
import {
  CONTACT_IDENTITY_COOKIE_NAME,
  contactIdentityService,
} from "../services/ContactIdentityService";
import {
  CustomerPhoneOtpError,
  customerPhoneOtpService,
} from "../services/CustomerPhoneOtpService";
import { BOOKING_CUSTOMER_SESSION_COOKIE } from "../services/BookingCommissionService";
import { customerAccountService } from "../services/CustomerAccountService";

const EXISTING_TOKEN = "x".repeat(43);
const NEW_TOKEN = "y".repeat(43);
const CHALLENGE_ID = "c".repeat(43);

test("contact identity API returns only masked state and manages its own protected cookie", async (t) => {
  const originals = {
    getByNumber: propertyService.getByNumber,
    resolve: contactIdentityService.resolve,
    issueVerified: contactIdentityService.issueVerified,
    revoke: contactIdentityService.revoke,
    issueOtp: customerPhoneOtpService.issue,
    verifyOtp: customerPhoneOtpService.verify,
    ensureCustomerAccount: customerAccountService.ensureForVerifiedPhone,
  };
  const revoked: unknown[] = [];
  const issuedChallenges: any[] = [];
  const verifiedChallenges: any[] = [];
  const issuedIdentities: any[] = [];
  const ensuredAccounts: any[] = [];
  let otpIssueMode: "success" | "limited" = "success";
  let otpVerifyMode: "success" | "invalid" = "success";
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
        verifiedAt: "2026-08-20T12:00:00.000Z",
        expiresAt: "2026-10-20T12:00:00.000Z",
      }
    : null;
  (contactIdentityService as any).issueVerified = async (
    phone: unknown,
    previousToken: unknown,
  ) => {
    issuedIdentities.push({ phone, previousToken });
    return {
      token: NEW_TOKEN,
      clientPhone: "512345678",
      sessionId: "b".repeat(64),
      visitorId: "w".repeat(43),
      verifiedAt: "2026-08-20T12:00:00.000Z",
      expiresAt: "2026-10-20T12:00:00.000Z",
    };
  };
  (customerPhoneOtpService as any).issue = async (input: unknown) => {
    issuedChallenges.push(input);
    if (otpIssueMode === "limited") {
      throw new CustomerPhoneOtpError(
        "RATE_LIMITED",
        429,
        "تم طلب رموز تحقق كثيرة. حاول مرة أخرى لاحقاً.",
        { retryAfterMs: 30_000, scope: "phone" },
      );
    }
    return {
      challengeId: CHALLENGE_ID,
      maskedPhone: "05••••5678",
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    };
  };
  (customerPhoneOtpService as any).verify = async (input: unknown) => {
    verifiedChallenges.push(input);
    if (otpVerifyMode === "invalid") {
      throw new CustomerPhoneOtpError(
        "CODE_INVALID",
        401,
        "رمز التحقق غير صحيح.",
        { remainingAttempts: 4 },
      );
    }
    return {
      verified: true,
      challengeId: CHALLENGE_ID,
      verifiedAt: "2026-08-20T12:00:00.000Z",
    };
  };
  (contactIdentityService as any).revoke = async (token: unknown) => {
    if (revokeShouldFail) throw new Error("Firebase unavailable");
    revoked.push(token);
  };
  (customerAccountService as any).ensureForVerifiedPhone = async (...args: any[]) => {
    ensuredAccounts.push(args);
    return {
      id: "a".repeat(64),
    };
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
      assert.deepEqual(payload, {
        kind: "client",
        maskedPhone: "05•• ••5432",
        sessionRevision: "a".repeat(64),
      });
      assert.equal(text.includes("598765432"), false);
      assert.equal(text.includes(EXISTING_TOKEN), false);
      assert.match(response.headers.get("cache-control") || "", /no-store/);
    });

    await t.test("an invalid remembered identity clears both public customer cookies", async () => {
      const response = await fetch(`${baseUrl}/api/contact-identity`, {
        headers: {
          cookie: `${CONTACT_IDENTITY_COOKIE_NAME}=${"z".repeat(43)}; ${BOOKING_CUSTOMER_SESSION_COOKIE}=stale-booking-token`,
        },
      });
      const setCookie = response.headers.get("set-cookie") || "";

      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { kind: "none", maskedPhone: null });
      assert.match(setCookie, new RegExp(`${CONTACT_IDENTITY_COOKIE_NAME}=;`));
      assert.match(setCookie, new RegExp(`${BOOKING_CUSTOMER_SESSION_COOKIE}=;`));
    });

    await t.test("requesting a code returns an opaque challenge without authenticating the phone", async () => {
      const response = await fetch(`${baseUrl}/api/contact-identity/challenge`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: baseUrl },
        body: JSON.stringify({ clientPhone: "0512345678" }),
      });
      const payload = await response.json();
      const setCookie = response.headers.get("set-cookie") || "";

      assert.equal(response.status, 200);
      assert.equal(payload.alreadyVerified, false);
      assert.equal(payload.challengeId, CHALLENGE_ID);
      assert.equal(payload.maskedPhone, "05••••5678");
      assert.equal(typeof payload.expiresInSeconds, "number");
      assert.equal(setCookie.includes(CONTACT_IDENTITY_COOKIE_NAME), false);
      assert.equal(JSON.stringify(payload).includes("512345678"), false);
      assert.equal(JSON.stringify(payload).includes(NEW_TOKEN), false);
      assert.equal(issuedChallenges.at(-1)?.phone, "512345678");
      assert.equal(typeof issuedChallenges.at(-1)?.ipAddress, "string");
    });

    await t.test("an already verified phone returns its opaque session revision", async () => {
      const response = await fetch(`${baseUrl}/api/contact-identity/challenge`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: baseUrl,
          cookie: `${CONTACT_IDENTITY_COOKIE_NAME}=${EXISTING_TOKEN}`,
        },
        body: JSON.stringify({ clientPhone: "0598765432" }),
      });

      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), {
        alreadyVerified: true,
        maskedPhone: "05•• ••5432",
        identity: {
          kind: "client",
          maskedPhone: "05•• ••5432",
          sessionRevision: "a".repeat(64),
        },
      });
    });

    await t.test("requesting a code cannot preserve invalid legacy customer cookies", async () => {
      const response = await fetch(`${baseUrl}/api/contact-identity/challenge`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: baseUrl,
          cookie: `${CONTACT_IDENTITY_COOKIE_NAME}=${"z".repeat(43)}; ${BOOKING_CUSTOMER_SESSION_COOKIE}=stale-booking-token`,
        },
        body: JSON.stringify({ clientPhone: "0512345678" }),
      });
      const setCookie = response.headers.get("set-cookie") || "";

      assert.equal(response.status, 200);
      assert.match(setCookie, new RegExp(`${CONTACT_IDENTITY_COOKIE_NAME}=;`));
      assert.match(setCookie, new RegExp(`${BOOKING_CUSTOMER_SESSION_COOKIE}=;`));
    });

    await t.test("only a verified code sets the protected identity cookie", async () => {
      const response = await fetch(`${baseUrl}/api/contact-identity/verify`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: baseUrl,
          cookie: `${CONTACT_IDENTITY_COOKIE_NAME}=${EXISTING_TOKEN}`,
        },
        body: JSON.stringify({
          challengeId: CHALLENGE_ID,
          clientPhone: "0512345678",
          code: "123456",
        }),
      });
      const payload = await response.json();
      const setCookie = response.headers.get("set-cookie") || "";

      assert.equal(response.status, 200);
      assert.deepEqual(payload, {
        kind: "client",
        maskedPhone: "05•• ••5678",
        sessionRevision: "b".repeat(64),
      });
      assert.match(setCookie, new RegExp(`^${CONTACT_IDENTITY_COOKIE_NAME}=`));
      assert.match(setCookie, /HttpOnly/i);
      assert.match(setCookie, /SameSite=Lax/i);
      assert.match(setCookie, /Max-Age=7776000/i);
      assert.match(setCookie, new RegExp(`${BOOKING_CUSTOMER_SESSION_COOKIE}=;`));
      assert.deepEqual(verifiedChallenges.at(-1), {
        challengeId: CHALLENGE_ID,
        phone: "0512345678",
        code: "123456",
      });
      assert.deepEqual(issuedIdentities.at(-1), {
        phone: "0512345678",
        previousToken: EXISTING_TOKEN,
      });
      assert.deepEqual(ensuredAccounts.at(-1), [
        "0512345678",
        { touchLastLogin: true },
      ]);
      assert.equal(JSON.stringify(payload).includes(NEW_TOKEN), false);
    });

    await t.test("the legacy direct-save endpoint cannot authenticate an unverified number", async () => {
      const response = await fetch(`${baseUrl}/api/contact-identity`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: baseUrl },
        body: JSON.stringify({ clientPhone: "0512345678" }),
      });

      assert.equal(response.status, 428);
      assert.equal((await response.json()).code, "CONTACT_PHONE_VERIFICATION_REQUIRED");
      assert.equal((response.headers.get("set-cookie") || "").includes(CONTACT_IDENTITY_COOKIE_NAME), false);
    });

    await t.test("forgetting the number revokes customer identity cookies but preserves app login", async () => {
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
      assert.match(setCookie, new RegExp(`${BOOKING_CUSTOMER_SESSION_COOKIE}=;`));
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
      const crossOriginRead = await fetch(`${baseUrl}/api/contact-identity`, {
        headers: {
          origin: "https://evil.example",
          cookie: `${CONTACT_IDENTITY_COOKIE_NAME}=${EXISTING_TOKEN}`,
        },
      });
      assert.equal(crossOriginRead.status, 403);
      assert.equal((await crossOriginRead.json()).code, "CROSS_ORIGIN_REQUEST");

      const invalid = await fetch(`${baseUrl}/api/contact-identity/challenge`, {
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

      otpIssueMode = "limited";
      const limited = await fetch(`${baseUrl}/api/contact-identity/challenge`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: baseUrl },
        body: JSON.stringify({ clientPhone: "0512345678" }),
      });
      otpIssueMode = "success";
      assert.equal(limited.status, 429);
      assert.equal(limited.headers.get("retry-after"), "30");
      assert.equal((await limited.json()).code, "RATE_LIMITED");

      otpVerifyMode = "invalid";
      const wrongCode = await fetch(`${baseUrl}/api/contact-identity/verify`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: baseUrl },
        body: JSON.stringify({
          challengeId: CHALLENGE_ID,
          clientPhone: "0512345678",
          code: "000000",
        }),
      });
      otpVerifyMode = "success";
      assert.equal(wrongCode.status, 401);
      assert.deepEqual(await wrongCode.json(), {
        code: "CODE_INVALID",
        error: "رمز التحقق غير صحيح.",
        remainingAttempts: 4,
      });
      assert.equal(issuedIdentities.length, 1, "wrong codes must never issue another identity");
    });

    await t.test("the configured App Hosting origin is accepted without trusting spoofed hosts", async () => {
      const previousBaseUrl = process.env.NEXT_PUBLIC_BASE_URL;
      process.env.NEXT_PUBLIC_BASE_URL = "https://rwqan.example";
      try {
        const response = await fetch(`${baseUrl}/api/contact-identity/challenge`, {
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

    await t.test("same-origin browser metadata is accepted behind an internal App Hosting host", async () => {
      const response = await fetch(`${baseUrl}/api/contact-identity/challenge`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: "https://rwqan.sa",
          "sec-fetch-site": "same-origin",
        },
        body: JSON.stringify({ clientPhone: "0512345678" }),
      });
      assert.equal(response.status, 200);
    });
  } finally {
    propertyService.getByNumber = originals.getByNumber;
    contactIdentityService.resolve = originals.resolve;
    contactIdentityService.issueVerified = originals.issueVerified;
    contactIdentityService.revoke = originals.revoke;
    customerPhoneOtpService.issue = originals.issueOtp;
    customerPhoneOtpService.verify = originals.verifyOtp;
    customerAccountService.ensureForVerifiedPhone = originals.ensureCustomerAccount;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
