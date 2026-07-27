import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import cookieParser from "cookie-parser";
import type { AddressInfo } from "node:net";
import trackingRouter, {
  CONTACT_REQUEST_ATTEMPT_WINDOW_MS,
  CONTACT_REQUEST_MAX_ATTEMPTS_PER_WINDOW,
} from "./tracking";
import { analyticsService, notificationService, propertyService } from "../services";
import { firebaseService } from "../firebaseService";
import {
  CONTACT_IDENTITY_COOKIE_NAME,
  ContactIdentityRateLimitError,
  contactIdentityService,
  maskContactPhone,
} from "../services/ContactIdentityService";

const TEST_CONTACT_TOKEN = "t".repeat(43);

test("smart contact requests resolve remembered and owner phones on the server", async (t) => {
  const originals = {
    getByNumber: propertyService.getByNumber,
    createContactRequestWithCooldown: firebaseService.createContactRequestWithCooldown,
    consumeContactRequestAttemptLimit: firebaseService.consumeContactRequestAttemptLimit,
    getOwnerPhone: firebaseService.getOwnerPhone,
    resolveIdentity: contactIdentityService.resolve,
    issueIdentity: contactIdentityService.issue,
    recordContactEvent: analyticsService.recordContactEvent,
    smartRequest: notificationService.smartRequest,
  };

  let identityMode: "none" | "remembered" | "must-not-run" = "none";
  let issueMode: "success" | "failure" | "limited" = "success";
  let ownerPhone = "0512345678";
  let rememberedSessionId = "c".repeat(64);
  const issueArguments: any[][] = [];
  let attemptLimitMode: "allowed" | "blocked" = "allowed";
  const attemptLimitCalls: any[][] = [];
  let forceCooldown = false;
  const acceptedCalls: any[][] = [];
  const standaloneEvents: any[] = [];

  (propertyService as any).getByNumber = async (propertyNumber: string) => {
    if (propertyNumber === "OWNER-1") {
      return { propertyNumber, whatsappNumber: ownerPhone, verificationStatus: "approved" };
    }
    return {
      propertyNumber,
      name: "Target property",
      whatsappNumber: "0555555555",
      verificationStatus: "approved",
    };
  };
  (firebaseService as any).getOwnerPhone = async () => "0599999999";
  (contactIdentityService as any).resolve = async () => {
    if (identityMode === "must-not-run") throw new Error("owner resolution read the client cookie");
    if (identityMode === "remembered") {
      return {
        clientPhone: "598765432",
        sessionId: rememberedSessionId,
        visitorId: "v".repeat(43),
        expiresAt: "2026-10-20T12:00:00.000Z",
      };
    }
    return null;
  };
  (contactIdentityService as any).issue = async (...args: any[]) => {
    issueArguments.push(args);
    if (issueMode === "failure") throw new Error("secret Firestore failure details");
    if (issueMode === "limited") throw new ContactIdentityRateLimitError(45_000);
    return {
      token: TEST_CONTACT_TOKEN,
      clientPhone: args[0],
      sessionId: "d".repeat(64),
      visitorId: "w".repeat(43),
      expiresAt: "2026-10-20T12:00:00.000Z",
    };
  };
  (firebaseService as any).createContactRequestWithCooldown = async (...args: any[]) => {
    acceptedCalls.push(args);
    if (forceCooldown) return { accepted: false, remainingMs: 60_000 };
    return { accepted: true, remainingMs: 0, request: args[3], event: args[5] };
  };
  (firebaseService as any).consumeContactRequestAttemptLimit = async (...args: any[]) => {
    attemptLimitCalls.push(args);
    return attemptLimitMode === "blocked"
      ? { allowed: false, retryAfterMs: 45_000 }
      : { allowed: true, retryAfterMs: 0 };
  };
  (analyticsService as any).recordContactEvent = async (event: any) => {
    standaloneEvents.push(event);
    return event;
  };
  (notificationService as any).smartRequest = async () => undefined;

  const app = express();
  app.set("trust proxy", 1);
  app.use(express.json());
  app.use(cookieParser());
  app.use((req, _res, next) => {
    (req as any).session = {
      ...(req.get("x-owner") ? { propertyNumber: req.get("x-owner") } : {}),
      ...(req.get("x-admin") ? { isAdmin: true } : {}),
    };
    next();
  });
  app.use(trackingRouter);

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    await t.test("a remembered client does not resubmit a phone and keeps a stable visitor identity", async () => {
      identityMode = "remembered";
      const first = await fetch(`${baseUrl}/api/requests/smart`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: baseUrl,
          "x-forwarded-for": "198.51.100.10",
        },
        body: JSON.stringify({ propertyNumber: "TARGET-1" }),
      });
      rememberedSessionId = "e".repeat(64);
      const second = await fetch(`${baseUrl}/api/requests/smart`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: baseUrl,
          "x-forwarded-for": "203.0.113.20",
        },
        body: JSON.stringify({ propertyNumber: "TARGET-1" }),
      });
      rememberedSessionId = "c".repeat(64);

      assert.equal(first.status, 200);
      assert.equal(second.status, 200);
      const firstPayload = await first.json() as Record<string, unknown>;
      const secondPayload = await second.json() as Record<string, unknown>;
      const firstRequest = acceptedCalls.at(-2)?.[3];
      const secondRequest = acceptedCalls.at(-1)?.[3];
      const firstEvent = acceptedCalls.at(-2)?.[5];
      const secondEvent = acceptedCalls.at(-1)?.[5];
      assert.equal(firstRequest.clientPhone, "598765432");
      assert.equal(secondRequest.clientPhone, "598765432");
      assert.equal(firstEvent.visitorKey, secondEvent.visitorKey);
      assert.notEqual(firstEvent.visitorKey, "v".repeat(43));
      assert.equal(firstEvent.actorType, "anonymous");
      assert.equal(acceptedCalls.at(-1)?.[6]?.windowMs, 30 * 60 * 1000);
      assert.equal(acceptedCalls.at(-1)?.[6]?.maxAcceptedRequests, 10);
      assert.match(acceptedCalls.at(-1)?.[6]?.key || "", /^[a-f0-9]{64}$/);
      assert.deepEqual(firstPayload.contactIdentity, {
        kind: "client",
        maskedPhone: maskContactPhone("598765432"),
      });
      assert.deepEqual(secondPayload.contactIdentity, firstPayload.contactIdentity);
    });

    await t.test("an owner always uses the live phone of their own property", async () => {
      identityMode = "must-not-run";
      const response = await fetch(`${baseUrl}/api/requests/smart`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: baseUrl,
          "x-owner": "OWNER-1",
        },
        body: JSON.stringify({
          propertyNumber: "TARGET-2",
          clientPhone: "0599999999",
        }),
      });

      assert.equal(response.status, 200);
      const payload = await response.json() as Record<string, unknown>;
      const request = acceptedCalls.at(-1)?.[3];
      const event = acceptedCalls.at(-1)?.[5];
      assert.equal(request.clientPhone, "512345678");
      assert.equal(event.clientPhone, "512345678");
      assert.equal(event.actorType, "owner");
      assert.equal("contactIdentity" in payload, false);
    });

    await t.test("an owner with no valid live property phone never falls back to client input", async () => {
      identityMode = "must-not-run";
      ownerPhone = "invalid";
      const response = await fetch(`${baseUrl}/api/requests/smart`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: baseUrl,
          "x-owner": "OWNER-1",
        },
        body: JSON.stringify({ propertyNumber: "TARGET-OWNER-MISSING", clientPhone: "0599999999" }),
      });
      ownerPhone = "0512345678";

      assert.equal(response.status, 409);
      assert.equal((await response.json()).code, "OWNER_PHONE_MISSING");
    });

    await t.test("an admin uses the submitted phone and ignores a hidden client cookie", async () => {
      identityMode = "must-not-run";
      const response = await fetch(`${baseUrl}/api/requests/smart`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: baseUrl,
          "x-admin": "1",
          cookie: `${CONTACT_IDENTITY_COOKIE_NAME}=${TEST_CONTACT_TOKEN}`,
        },
        body: JSON.stringify({ propertyNumber: "TARGET-ADMIN", clientPhone: "0598765432" }),
      });

      assert.equal(response.status, 200);
      const payload = await response.json() as Record<string, unknown>;
      assert.equal(acceptedCalls.at(-1)?.[3]?.clientPhone, "598765432");
      assert.equal(acceptedCalls.at(-1)?.[5]?.actorType, "admin");
      assert.equal("contactIdentity" in payload, false);
    });

    await t.test("a first valid client phone issues the remembered cookie", async () => {
      identityMode = "none";
      issueMode = "success";
      const response = await fetch(`${baseUrl}/api/requests/smart`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: baseUrl },
        body: JSON.stringify({ propertyNumber: "TARGET-FIRST", clientPhone: "0512345678" }),
      });

      assert.equal(response.status, 200);
      const responseBody = await response.text();
      const payload = JSON.parse(responseBody) as Record<string, unknown>;
      assert.match(response.headers.get("set-cookie") || "", new RegExp(`^${CONTACT_IDENTITY_COOKIE_NAME}=`));
      assert.equal(acceptedCalls.at(-1)?.[3]?.clientPhone, "512345678");
      assert.match(String(issueArguments.at(-1)?.[2] || ""), /^[a-f0-9]{64}$/);
      assert.deepEqual(payload.contactIdentity, {
        kind: "client",
        maskedPhone: maskContactPhone("512345678"),
      });
      assert.equal(responseBody.includes("512345678"), false);
      assert.equal(responseBody.includes(TEST_CONTACT_TOKEN), false);
    });

    await t.test("identity persistence failures are generic server errors, not invalid-phone errors", async () => {
      identityMode = "none";
      issueMode = "failure";
      const response = await fetch(`${baseUrl}/api/requests/smart`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: baseUrl },
        body: JSON.stringify({ propertyNumber: "TARGET-FAIL", clientPhone: "0512345678" }),
      });
      const text = await response.text();
      issueMode = "success";

      assert.equal(response.status, 500);
      assert.equal(JSON.parse(text).code, "CONTACT_IDENTITY_SAVE_FAILED");
      assert.equal(text.includes("secret Firestore"), false);
    });

    await t.test("identity issuance throttling is returned with Retry-After", async () => {
      identityMode = "none";
      issueMode = "limited";
      const response = await fetch(`${baseUrl}/api/requests/smart`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: baseUrl },
        body: JSON.stringify({ propertyNumber: "TARGET-LIMIT", clientPhone: "0512345678" }),
      });
      issueMode = "success";

      assert.equal(response.status, 429);
      assert.equal(response.headers.get("retry-after"), "45");
      assert.equal((await response.json()).code, "CONTACT_IDENTITY_RATE_LIMIT");
    });

    await t.test("a blocked repeat attempt is not written as another analytics event", async () => {
      identityMode = "remembered";
      forceCooldown = true;
      const eventCountBefore = standaloneEvents.length;
      const response = await fetch(`${baseUrl}/api/requests/smart`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: baseUrl },
        body: JSON.stringify({ propertyNumber: "TARGET-COOLDOWN" }),
      });
      forceCooldown = false;

      assert.equal(response.status, 429);
      assert.equal(standaloneEvents.length, eventCountBefore);
    });

    await t.test("attempt throttling applies without Origin and stops before any tracking write", async () => {
      identityMode = "must-not-run";
      attemptLimitMode = "blocked";
      const eventCountBefore = standaloneEvents.length;
      const acceptedCountBefore = acceptedCalls.length;
      const response = await fetch(`${baseUrl}/api/requests/smart`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "192.0.2.44",
        },
        body: JSON.stringify({ propertyNumber: "TARGET-ATTEMPT-LIMIT" }),
      });
      attemptLimitMode = "allowed";
      identityMode = "none";

      assert.equal(response.status, 429);
      assert.equal(response.headers.get("retry-after"), "45");
      assert.equal((await response.json()).code, "CONTACT_ATTEMPT_RATE_LIMIT");
      assert.equal(standaloneEvents.length, eventCountBefore);
      assert.equal(acceptedCalls.length, acceptedCountBefore);
      assert.match(String(attemptLimitCalls.at(-1)?.[0] || ""), /^[a-f0-9]{64}$/);
      assert.equal(attemptLimitCalls.at(-1)?.[2], CONTACT_REQUEST_ATTEMPT_WINDOW_MS);
      assert.equal(attemptLimitCalls.at(-1)?.[3], CONTACT_REQUEST_MAX_ATTEMPTS_PER_WINDOW);
    });

    await t.test("a client without a remembered identity receives a stable phone-required response", async () => {
      identityMode = "none";
      const response = await fetch(`${baseUrl}/api/requests/smart`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: baseUrl },
        body: JSON.stringify({ propertyNumber: "TARGET-3" }),
      });
      const payload = await response.json();

      assert.equal(response.status, 428);
      assert.equal(payload.code, "CONTACT_PHONE_REQUIRED");
      assert.equal(standaloneEvents.at(-1)?.outcome, "auth_required");
      assert.equal(standaloneEvents.at(-1)?.clientPhone, undefined);
    });

    await t.test("an invalid remembered cookie is expired in the phone-required response", async () => {
      identityMode = "none";
      const response = await fetch(`${baseUrl}/api/requests/smart`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          origin: baseUrl,
          cookie: `${CONTACT_IDENTITY_COOKIE_NAME}=${TEST_CONTACT_TOKEN}`,
        },
        body: JSON.stringify({ propertyNumber: "TARGET-STALE" }),
      });

      assert.equal(response.status, 428);
      assert.match(response.headers.get("set-cookie") || "", new RegExp(`${CONTACT_IDENTITY_COOKIE_NAME}=;`));
    });

    await t.test("cross-origin contact mutations are rejected", async () => {
      const response = await fetch(`${baseUrl}/api/requests/smart`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://evil.example" },
        body: JSON.stringify({ propertyNumber: "TARGET-4" }),
      });
      assert.equal(response.status, 403);
      assert.equal((await response.json()).code, "CROSS_ORIGIN_REQUEST");
    });
  } finally {
    propertyService.getByNumber = originals.getByNumber;
    firebaseService.createContactRequestWithCooldown = originals.createContactRequestWithCooldown;
    firebaseService.consumeContactRequestAttemptLimit = originals.consumeContactRequestAttemptLimit;
    firebaseService.getOwnerPhone = originals.getOwnerPhone;
    contactIdentityService.resolve = originals.resolveIdentity;
    contactIdentityService.issue = originals.issueIdentity;
    analyticsService.recordContactEvent = originals.recordContactEvent;
    notificationService.smartRequest = originals.smartRequest;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
