import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import cookieParser from "cookie-parser";
import type { AddressInfo } from "node:net";
import trackingRouter, {
  CONTACT_REQUEST_ATTEMPT_WINDOW_MS,
  CONTACT_REQUEST_MAX_ATTEMPTS_PER_WINDOW,
  FREE_PROPERTY_DAILY_CONTACT_LIMIT,
} from "./tracking";
import { analyticsService, notificationService, propertyService, subscriptionService } from "../services";
import { firebaseService } from "../firebaseService";
import {
  CONTACT_IDENTITY_COOKIE_NAME,
  ContactIdentityRateLimitError,
  contactIdentityService,
  maskContactPhone,
} from "../services/ContactIdentityService";
import { bookingCommissionService } from "../services/BookingCommissionService";

const TEST_CONTACT_TOKEN = "t".repeat(43);

test("smart contact requests resolve remembered and owner phones on the server", async (t) => {
  const originals = {
    getByNumber: propertyService.getByNumber,
    getSubscriptionByProperty: subscriptionService.getByProperty,
    createContactRequestWithCooldown: firebaseService.createContactRequestWithCooldown,
    consumeContactRequestAttemptLimit: firebaseService.consumeContactRequestAttemptLimit,
    getOwnerPhone: firebaseService.getOwnerPhone,
    resolveIdentity: contactIdentityService.resolve,
    issueIdentity: contactIdentityService.issue,
    recordContactEvent: analyticsService.recordContactEvent,
    smartRequest: notificationService.smartRequest,
    sendAdmin: notificationService.sendAdmin,
    ownerFreeContactLimitReached: notificationService.ownerFreeContactLimitReached,
    isFollowUpEnabled: bookingCommissionService.isFollowUpEnabled,
    getFreeWorkflowSettings: bookingCommissionService.getFreeWorkflowSettings,
    buildContactWorkflow: bookingCommissionService.buildContactWorkflow,
  };

  let identityMode: "none" | "remembered" | "must-not-run" = "none";
  let issueMode: "success" | "failure" | "limited" = "success";
  let ownerPhone = "0512345678";
  let rememberedSessionId = "c".repeat(64);
  const issueArguments: any[][] = [];
  let attemptLimitMode: "allowed" | "blocked" = "allowed";
  const attemptLimitCalls: any[][] = [];
  let forceCooldown = false;
  let forceDailyLimit = false;
  let forcePropertyUnavailable = false;
  let markDailyLimitReached = false;
  let forceContactWriteFailure = false;
  const premiumPropertyNumbers = new Set<string>();
  const acceptedCalls: any[][] = [];
  const standaloneEvents: any[] = [];
  const ownerLimitNotifications: any[] = [];
  const smartRequestNotifications: any[] = [];
  const adminNotifications: string[] = [];
  const workflowBuildOptions: any[] = [];
  let followUpMode: "off" | "scheduled" | "flag_failure" | "workflow_failure" = "off";
  let configuredFreePropertyContactDailyLimit = FREE_PROPERTY_DAILY_CONTACT_LIMIT;
  let configuredCustomerFollowUpDelayMinutes = 1_440;
  let freeWorkflowSettingsLookups = 0;

  (propertyService as any).getByNumber = async (propertyNumber: string) => {
    if (propertyNumber === "OWNER-1") {
      return { propertyNumber, whatsappNumber: ownerPhone, verificationStatus: "approved" };
    }
    return {
      propertyNumber,
      name: "Target property",
      whatsappNumber: "0555555555",
      verificationStatus: "approved",
      prices: { weekday: "750", weekend: "١٬٢٥٠٫٥٠" },
    };
  };
  (firebaseService as any).getOwnerPhone = async () => "0599999999";
  (subscriptionService as any).getByProperty = async (propertyNumber: string) =>
    premiumPropertyNumbers.has(propertyNumber)
      ? {
          propertyNumber,
          subscriptionType: "مميز",
          packageType: "مميز",
          status: "ساري",
          endDate: "2026-12-31T23:59:59.999Z",
        }
      : null;
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
    if (forceContactWriteFailure) throw new Error("simulated contact write failure");
    if (forceDailyLimit) {
      return { accepted: false, remainingMs: 60_000, reason: "daily_property_limit" };
    }
    if (forcePropertyUnavailable) {
      return { accepted: false, remainingMs: 0, reason: "property_unavailable" };
    }
    if (forceCooldown) return { accepted: false, remainingMs: 60_000, reason: "cooldown" };
    return {
      accepted: true,
      remainingMs: 0,
      request: args[3],
      event: args[5],
      dailyPropertyLimitReached: markDailyLimitReached,
      bookingFollowUpCreated: Boolean(args[8]),
    };
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
  (notificationService as any).smartRequest = async (data: any) => {
    smartRequestNotifications.push(data);
  };
  (notificationService as any).sendAdmin = async (message: string) => {
    adminNotifications.push(message);
  };
  (notificationService as any).ownerFreeContactLimitReached = async (data: any) => {
    ownerLimitNotifications.push(data);
    return { success: true };
  };
  (bookingCommissionService as any).isFollowUpEnabled = async () => {
    if (followUpMode === "flag_failure") {
      throw new Error("sensitive feature flag lookup details");
    }
    return followUpMode !== "off";
  };
  (bookingCommissionService as any).getFreeWorkflowSettings = async () => {
    freeWorkflowSettingsLookups++;
    return {
      customerDailyLimit: 3,
      freeOwnerDailyLimit: 3,
      freePropertyContactDailyLimit: configuredFreePropertyContactDailyLimit,
      customerFollowUpDelayMinutes: configuredCustomerFollowUpDelayMinutes,
      updatedAt: "2026-08-18T10:00:00.000Z",
      updatedBy: "admin",
      source: "firestore",
    };
  };
  (bookingCommissionService as any).buildContactWorkflow = (options: any) => {
    workflowBuildOptions.push(options);
    if (followUpMode === "workflow_failure") {
      throw new Error("sensitive workflow setup details");
    }
    return {
      followUp: { id: `BOOK-${options.requestCode}` },
      customerNotification: { id: `BOOK-${options.requestCode}--customer_followup` },
    };
  };

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
      assert.equal("bookingFollowUpStatus" in firstEvent, false);
      assert.equal("bookingFollowUpFailureCode" in firstEvent, false);
      assert.equal(acceptedCalls.at(-1)?.[6]?.windowMs, 30 * 60 * 1000);
      assert.equal(acceptedCalls.at(-1)?.[6]?.maxAcceptedRequests, 10);
      assert.match(acceptedCalls.at(-1)?.[6]?.key || "", /^[a-f0-9]{64}$/);
      assert.equal(
        acceptedCalls.at(-1)?.[7]?.maxAcceptedRequests,
        FREE_PROPERTY_DAILY_CONTACT_LIMIT,
      );
      assert.equal(
        acceptedCalls.at(-1)?.[7]?.windowEndsAt - acceptedCalls.at(-1)?.[7]?.windowStartedAt,
        24 * 60 * 60 * 1000,
      );
      assert.match(acceptedCalls.at(-1)?.[7]?.key || "", /^[a-f0-9]{64}$/);
      assert.deepEqual(firstPayload.contactIdentity, {
        kind: "client",
        maskedPhone: maskContactPhone("598765432"),
      });
      assert.deepEqual(secondPayload.contactIdentity, firstPayload.contactIdentity);
    });

    await t.test("an enabled follow-up is marked scheduled on the atomically accepted contact event", async () => {
      identityMode = "remembered";
      followUpMode = "scheduled";
      configuredCustomerFollowUpDelayMinutes = 2_160;
      const alertCountBefore = adminNotifications.length;
      const settingsLookupsBefore = freeWorkflowSettingsLookups;
      const response = await fetch(`${baseUrl}/api/requests/smart`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: baseUrl },
        body: JSON.stringify({ propertyNumber: "TARGET-FOLLOWUP-SCHEDULED" }),
      });
      followUpMode = "off";
      configuredCustomerFollowUpDelayMinutes = 1_440;

      assert.equal(response.status, 200);
      const acceptedEvent = acceptedCalls.at(-1)?.[5];
      assert.equal(acceptedEvent.bookingFollowUpStatus, "scheduled");
      assert.equal("bookingFollowUpFailureCode" in acceptedEvent, false);
      assert.equal(acceptedCalls.at(-1)?.[8]?.followUp?.id, `BOOK-${acceptedEvent.requestCode}`);
      assert.equal(
        (await response.json() as Record<string, unknown>).bookingCustomerPhone,
        "+966598765432",
      );
      assert.deepEqual(workflowBuildOptions.at(-1)?.propertyPrices, {
        weekday: "750",
        weekend: "١٬٢٥٠٫٥٠",
      });
      assert.equal(
        workflowBuildOptions.at(-1)?.customerFollowUpDelayMinutes,
        2_160,
      );
      assert.equal(
        workflowBuildOptions.at(-1)?.customerFollowUpMessageLimit,
        3,
      );
      assert.equal(
        freeWorkflowSettingsLookups - settingsLookupsBefore,
        1,
        "the route uses one settings snapshot for scheduling and the daily limit",
      );
      assert.equal(adminNotifications.length, alertCountBefore);
    });

    await t.test("a setup failure is persisted as a non-sensitive code and alerts admin only after acceptance", async () => {
      identityMode = "remembered";
      followUpMode = "workflow_failure";
      const alertCountBefore = adminNotifications.length;
      const response = await fetch(`${baseUrl}/api/requests/smart`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: baseUrl },
        body: JSON.stringify({ propertyNumber: "TARGET-FOLLOWUP-FAILED" }),
      });
      followUpMode = "off";

      assert.equal(response.status, 200);
      const acceptedEvent = acceptedCalls.at(-1)?.[5];
      assert.equal(acceptedEvent.bookingFollowUpStatus, "setup_failed");
      assert.equal(acceptedEvent.bookingFollowUpFailureCode, "workflow_setup_failed");
      assert.equal(acceptedCalls.at(-1)?.[8], undefined);
      assert.equal(adminNotifications.length, alertCountBefore + 1);
      assert.match(adminNotifications.at(-1) || "", /TARGET-FOLLOWUP-FAILED/);
      assert.match(adminNotifications.at(-1) || "", /workflow_setup_failed/);
      assert.equal((adminNotifications.at(-1) || "").includes("sensitive workflow"), false);
    });

    await t.test("a rejected contact never sends the follow-up setup failure alert", async () => {
      identityMode = "remembered";
      followUpMode = "flag_failure";
      forceCooldown = true;
      const alertCountBefore = adminNotifications.length;
      const response = await fetch(`${baseUrl}/api/requests/smart`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: baseUrl },
        body: JSON.stringify({ propertyNumber: "TARGET-FOLLOWUP-REJECTED" }),
      });
      forceCooldown = false;
      followUpMode = "off";

      assert.equal(response.status, 429);
      assert.equal(acceptedCalls.at(-1)?.[5]?.bookingFollowUpFailureCode, "flag_lookup_failed");
      assert.equal(adminNotifications.length, alertCountBefore);
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
      assert.equal(
        acceptedCalls.at(-1)?.[7]?.maxAcceptedRequests,
        FREE_PROPERTY_DAILY_CONTACT_LIMIT,
      );
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
      assert.equal(
        acceptedCalls.at(-1)?.[7]?.maxAcceptedRequests,
        FREE_PROPERTY_DAILY_CONTACT_LIMIT,
      );
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

    await t.test("a property paused during contact setup is rejected before notification", async () => {
      identityMode = "remembered";
      forcePropertyUnavailable = true;
      const notificationCountBefore = smartRequestNotifications.length;
      const response = await fetch(`${baseUrl}/api/requests/smart`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: baseUrl },
        body: JSON.stringify({ propertyNumber: "TARGET-PAUSED-RACE" }),
      });
      forcePropertyUnavailable = false;

      assert.equal(response.status, 423);
      assert.deepEqual(await response.json(), { error: "هذا العقار غير متاح حالياً" });
      assert.equal(smartRequestNotifications.length, notificationCountBefore);
    });

    await t.test("a free property reports its three-contact daily limit", async () => {
      identityMode = "remembered";
      forceDailyLimit = true;
      const notificationCountBefore = ownerLimitNotifications.length;
      const response = await fetch(`${baseUrl}/api/requests/smart`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: baseUrl },
        body: JSON.stringify({ propertyNumber: "TARGET-FREE-DAILY-LIMIT" }),
      });
      forceDailyLimit = false;

      assert.equal(response.status, 429);
      const payload = await response.json() as Record<string, unknown>;
      assert.equal(payload.code, "FREE_PROPERTY_DAILY_CONTACT_LIMIT");
      assert.equal(payload.dailyLimit, FREE_PROPERTY_DAILY_CONTACT_LIMIT);
      assert.match(String(payload.error), /الثلاث/);
      assert.equal(ownerLimitNotifications.length, notificationCountBefore);
    });

    await t.test("a configured non-default free-property contact limit reaches the atomic write and response", async () => {
      identityMode = "remembered";
      forceDailyLimit = true;
      configuredFreePropertyContactDailyLimit = 7;
      let response: Response;
      try {
        response = await fetch(`${baseUrl}/api/requests/smart`, {
          method: "POST",
          headers: { "content-type": "application/json", origin: baseUrl },
          body: JSON.stringify({ propertyNumber: "TARGET-CONFIGURED-DAILY-LIMIT" }),
        });
      } finally {
        forceDailyLimit = false;
        configuredFreePropertyContactDailyLimit = FREE_PROPERTY_DAILY_CONTACT_LIMIT;
      }

      assert.equal(response.status, 429);
      assert.equal(acceptedCalls.at(-1)?.[7]?.maxAcceptedRequests, 7);
      const payload = await response.json() as Record<string, unknown>;
      assert.equal(payload.code, "FREE_PROPERTY_DAILY_CONTACT_LIMIT");
      assert.equal(payload.dailyLimit, 7);
      assert.match(String(payload.error), /\(7\)/);
    });

    await t.test("the accepted request that reaches three contacts notifies the property owner", async () => {
      identityMode = "remembered";
      markDailyLimitReached = true;
      const response = await fetch(`${baseUrl}/api/requests/smart`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: baseUrl },
        body: JSON.stringify({ propertyNumber: "TARGET-LIMIT-NOTIFY" }),
      });
      markDailyLimitReached = false;

      assert.equal(response.status, 200);
      assert.deepEqual(ownerLimitNotifications.at(-1), {
        ownerPhone: "0555555555",
        propertyNumber: "TARGET-LIMIT-NOTIFY",
        dailyLimit: FREE_PROPERTY_DAILY_CONTACT_LIMIT,
      });
    });

    await t.test("a premium property has no client contact quota, cooldown, or booking follow-up", async () => {
      identityMode = "remembered";
      followUpMode = "scheduled";
      const workflowBuildCountBefore = workflowBuildOptions.length;
      premiumPropertyNumbers.add("TARGET-PREMIUM");
      const response = await fetch(`${baseUrl}/api/requests/smart`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: baseUrl },
        body: JSON.stringify({ propertyNumber: "TARGET-PREMIUM" }),
      });
      premiumPropertyNumbers.delete("TARGET-PREMIUM");
      followUpMode = "off";

      assert.equal(response.status, 200);
      assert.equal(
        "bookingCustomerPhone" in (await response.json() as Record<string, unknown>),
        false,
      );
      assert.equal(acceptedCalls.at(-1)?.[2], 0);
      assert.equal(acceptedCalls.at(-1)?.[6], undefined);
      assert.equal(acceptedCalls.at(-1)?.[7], undefined);
      assert.equal(acceptedCalls.at(-1)?.[8], undefined);
      assert.equal(workflowBuildOptions.length, workflowBuildCountBefore);
      assert.equal("bookingFollowUpStatus" in acceptedCalls.at(-1)?.[5], false);
      assert.equal("bookingFollowUpFailureCode" in acceptedCalls.at(-1)?.[5], false);
    });

    await t.test("a first phone remains authenticated when the contact hits cooldown", async () => {
      identityMode = "none";
      issueMode = "success";
      forceCooldown = true;
      const response = await fetch(`${baseUrl}/api/requests/smart`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: baseUrl },
        body: JSON.stringify({ propertyNumber: "TARGET-FIRST-COOLDOWN", clientPhone: "0512345678" }),
      });
      forceCooldown = false;

      assert.equal(response.status, 429);
      assert.match(response.headers.get("set-cookie") || "", new RegExp(`^${CONTACT_IDENTITY_COOKIE_NAME}=`));
      assert.deepEqual((await response.json()).contactIdentity, {
        kind: "client",
        maskedPhone: maskContactPhone("512345678"),
      });
    });

    await t.test("a first phone remains authenticated after a later contact write error", async () => {
      identityMode = "none";
      issueMode = "success";
      forceContactWriteFailure = true;
      const response = await fetch(`${baseUrl}/api/requests/smart`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: baseUrl },
        body: JSON.stringify({ propertyNumber: "TARGET-FIRST-ERROR", clientPhone: "0512345678" }),
      });
      forceContactWriteFailure = false;

      assert.equal(response.status, 500);
      assert.match(response.headers.get("set-cookie") || "", new RegExp(`^${CONTACT_IDENTITY_COOKIE_NAME}=`));
      assert.deepEqual((await response.json()).contactIdentity, {
        kind: "client",
        maskedPhone: maskContactPhone("512345678"),
      });
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
    subscriptionService.getByProperty = originals.getSubscriptionByProperty;
    firebaseService.createContactRequestWithCooldown = originals.createContactRequestWithCooldown;
    firebaseService.consumeContactRequestAttemptLimit = originals.consumeContactRequestAttemptLimit;
    firebaseService.getOwnerPhone = originals.getOwnerPhone;
    contactIdentityService.resolve = originals.resolveIdentity;
    contactIdentityService.issue = originals.issueIdentity;
    analyticsService.recordContactEvent = originals.recordContactEvent;
    notificationService.smartRequest = originals.smartRequest;
    notificationService.sendAdmin = originals.sendAdmin;
    notificationService.ownerFreeContactLimitReached =
      originals.ownerFreeContactLimitReached;
    bookingCommissionService.isFollowUpEnabled = originals.isFollowUpEnabled;
    bookingCommissionService.getFreeWorkflowSettings = originals.getFreeWorkflowSettings;
    bookingCommissionService.buildContactWorkflow = originals.buildContactWorkflow;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
