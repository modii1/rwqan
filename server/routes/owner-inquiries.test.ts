import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";

import express from "express";
import session from "express-session";

import { analyticsService, propertyService, subscriptionService } from "../services";
import { bookingCommissionStore } from "../services/BookingCommissionStore";
import { firebaseService } from "../firebaseService";
import ownerRouter from "./owner";
import { ownerInquiryNoteService } from "../services/OwnerInquiryNoteService";
import { ownerInquiryVisibilityService } from "../services/OwnerInquiryVisibilityService";
import { ownerAccountStore } from "../services/OwnerAccountStore";

test("owner analytics stay property-scoped and do not expose platform-wide analytics", async () => {
  const originals = {
    requests: analyticsService.getAllRequests,
    analytics: analyticsService.getAnalytics,
    properties: propertyService.getAll,
  };
  (analyticsService as any).getAllRequests = async () => [
    {
      id: "REQ-OWNER-1",
      propertyNumber: "PROP-1",
      requestCode: "REQ-OWNER-1",
      timestamp: new Date().toISOString(),
      ipAddress: "127.0.0.1",
      deviceType: "mobile",
      dayOfWeek: "الجمعة",
      hourOfDay: 13,
    },
    {
      id: "REQ-OTHER-1",
      propertyNumber: "PROP-2",
      requestCode: "REQ-OTHER-1",
      timestamp: new Date().toISOString(),
      ipAddress: "127.0.0.2",
      deviceType: "desktop",
      dayOfWeek: "السبت",
      hourOfDay: 14,
    },
    {
      id: "REQ-OTHER-2",
      propertyNumber: "PROP-2",
      requestCode: "REQ-OTHER-2",
      timestamp: new Date().toISOString(),
      ipAddress: "127.0.0.3",
      deviceType: "desktop",
      dayOfWeek: "السبت",
      hourOfDay: 15,
    },
  ];
  (analyticsService as any).getAnalytics = async () => {
    throw new Error("platform analytics must not be read by the owner endpoint");
  };
  (propertyService as any).getAll = async () => [
    { propertyNumber: "PROP-1" },
    { propertyNumber: "PROP-2" },
    { propertyNumber: "PROP-3" },
  ];

  const app = express();
  app.use(express.json());
  app.use(session({
    secret: "owner-analytics-test-secret",
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false },
  }));
  app.use((req, _res, next) => {
    req.session.propertyNumber = "PROP-1";
    next();
  });
  app.use(ownerRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const { port } = server.address() as AddressInfo;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/owner/analytics`);
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.totalRequests, 1);
    assert.equal(payload.rank, 2);
    assert.equal(payload.totalProperties, 3);
    assert.equal("visitors" in payload, false);
    assert.equal("mobile" in payload, false);
    assert.equal("cities" in payload, false);
  } finally {
    analyticsService.getAllRequests = originals.requests;
    analyticsService.getAnalytics = originals.analytics;
    propertyService.getAll = originals.properties;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});

test("owner requests endpoint returns the dashboard DTO envelope and masks customer phone", async () => {
  const originalRequests = analyticsService.getAllRequests;
  const originalBookings = bookingCommissionStore.listBookingsForProperty;
  const originalNotes = ownerInquiryNoteService.listForProperty;
  const originalHidden = ownerInquiryVisibilityService.listHiddenForProperty;
  (analyticsService as any).getAllRequests = async () => [{
    id: "REQ-1",
    propertyNumber: "PROP-1",
    requestCode: "REQ-CODE",
    timestamp: "2026-09-25T10:00:00.000Z",
    clientPhone: "0551234567",
    ipAddress: "127.0.0.1",
    deviceType: "mobile",
    dayOfWeek: "الجمعة",
    hourOfDay: 13,
  }];
  (bookingCommissionStore as any).listBookingsForProperty = async () => [];
  (ownerInquiryNoteService as any).listForProperty = async () => [];
  (ownerInquiryVisibilityService as any).listHiddenForProperty = async () => [];

  const app = express();
  app.use(express.json());
  app.use(session({
    secret: "owner-inquiries-test-secret",
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false },
  }));
  app.use((req, _res, next) => {
    req.session.propertyNumber = "PROP-1";
    next();
  });
  app.use(ownerRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const { port } = server.address() as AddressInfo;

  try {
    const response = await fetch(`http://127.0.0.1:${port}/api/owner/requests`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("cache-control") || "", /no-store/);
    const payload = await response.json();
    assert.equal(Array.isArray(payload.requests), true);
    assert.equal(payload.summary.total, 1);
    assert.equal(payload.requests[0].clientPhoneMasked, "05•• ••4567");
    assert.equal(payload.requests[0].canDelete, true);
    assert.equal(payload.requests[0].contactRequestId, "REQ-1");
    assert.doesNotMatch(JSON.stringify(payload), /0551234567|127\.0\.0\.1/);
  } finally {
    analyticsService.getAllRequests = originalRequests;
    bookingCommissionStore.listBookingsForProperty = originalBookings;
    ownerInquiryNoteService.listForProperty = originalNotes;
    ownerInquiryVisibilityService.listHiddenForProperty = originalHidden;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});

test("owner deletion rejects booking-only rows and hides a joined inquiry without deleting source data", async () => {
  const originals = {
    requests: analyticsService.getAllRequests,
    deleteRequest: analyticsService.deleteRequest,
    bookings: bookingCommissionStore.listBookingsForProperty,
    hide: ownerInquiryVisibilityService.hide,
  };
  (analyticsService as any).getAllRequests = async () => [{
    id: "REQ-OWNED",
    requestCode: "PUBLIC-CODE",
    propertyNumber: "PROP-1",
    timestamp: "2026-09-26T10:00:00.000Z",
  }];
  const deleted: Array<{ propertyNumber: string; requestId: string }> = [];
  (analyticsService as any).deleteRequest = async (
    propertyNumber: string,
    requestId: string,
  ) => {
    deleted.push({ propertyNumber, requestId });
  };
  (bookingCommissionStore as any).listBookingsForProperty = async () => [{
    id: "BOOK-OWNED",
    contactRequestId: "REQ-OWNED",
    requestCode: "PUBLIC-CODE",
    propertyNumber: "PROP-1",
  }];
  const hidden: Array<Record<string, unknown>> = [];
  (ownerInquiryVisibilityService as any).hide = async (
    value: Record<string, unknown>,
  ) => {
    hidden.push(value);
    return value;
  };

  const app = express();
  app.use(express.json());
  app.use(session({
    secret: "owner-delete-route-test-secret",
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false },
  }));
  app.use((req, _res, next) => {
    req.session.propertyNumber = "PROP-1";
    next();
  });
  app.use(ownerRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const bookingOnly = await fetch(
      `${baseUrl}/api/owner/requests/BOOKING-ONLY`,
      { method: "DELETE" },
    );
    assert.equal(bookingOnly.status, 404);
    assert.equal((await bookingOnly.json()).code, "REQUEST_NOT_DELETABLE");
    assert.deepEqual(deleted, []);

    const realRequest = await fetch(
      `${baseUrl}/api/owner/requests/PUBLIC-CODE`,
      { method: "DELETE" },
    );
    assert.equal(realRequest.status, 200);
    assert.deepEqual(deleted, []);
    assert.deepEqual(hidden, [{
      propertyNumber: "PROP-1",
      inquiryId: "REQ-OWNED",
      contactRequestId: "REQ-OWNED",
      bookingId: "BOOK-OWNED",
    }]);

    const crossOrigin = await fetch(
      `${baseUrl}/api/owner/requests/REQ-OWNED`,
      {
        method: "DELETE",
        headers: { origin: "https://evil.example" },
      },
    );
    assert.equal(crossOrigin.status, 403);
    assert.equal(deleted.length, 0);
    assert.equal(hidden.length, 1);
  } finally {
    analyticsService.getAllRequests = originals.requests;
    analyticsService.deleteRequest = originals.deleteRequest;
    bookingCommissionStore.listBookingsForProperty = originals.bookings;
    ownerInquiryVisibilityService.hide = originals.hide;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});

test("owner property switcher exposes only verified linked members", async () => {
  const originals = {
    property: firebaseService.getPropertyByNumber,
    subscription: firebaseService.getSubscriptionByPropertyNumber,
    linked: firebaseService.getSubscriptionsLinkedToProperty,
    multi: firebaseService.getMultiPropertySubscriptions,
  };
  const properties: Record<string, any> = {
    "PROP-1": { propertyNumber: "PROP-1", name: "العقار الأول", city: "الرياض", pin: "1234" },
    "PROP-2": { propertyNumber: "PROP-2", name: "العقار الثاني", city: "جدة", pin: "1234" },
    "PROP-3": { propertyNumber: "PROP-3", name: "العقار الثالث", city: "الدمام", pin: "1234" },
    "PROP-OTHER": { propertyNumber: "PROP-OTHER", name: "عقار آخر", city: "جدة", pin: "9999" },
  };
  (firebaseService as any).getPropertyByNumber = async (propertyNumber: string) =>
    properties[propertyNumber] || null;
  (firebaseService as any).getSubscriptionByPropertyNumber = async (propertyNumber: string) =>
    propertyNumber === "PROP-1"
      ? { propertyNumber, linkedProperties: ["PROP-2"] }
      : propertyNumber === "PROP-2"
        ? { propertyNumber, linkedProperty: "PROP-1" }
        : null;
  (firebaseService as any).getSubscriptionsLinkedToProperty = async () => [{
    propertyNumber: "PROP-2",
    linkedProperty: "PROP-1",
  }];
  (firebaseService as any).getMultiPropertySubscriptions = async () => [{
    id: "MULTI-1",
    packageId: "PKG-1",
    propertyNumber1: "PROP-1",
    propertyNumber2: "PROP-2",
    linkedProperties: ["PROP-1", "PROP-2", "PROP-3"],
    startDate: "2026-01-01T00:00:00.000Z",
    endDate: "2099-01-01T00:00:00.000Z",
    status: "نشط",
  }];

  const app = express();
  app.use(express.json());
  app.use(session({
    secret: "owner-switch-test-secret",
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false },
  }));
  app.use((req, _res, next) => {
    req.session.propertyNumber = "PROP-1";
    next();
  });
  app.use(ownerRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const listResponse = await fetch(`${baseUrl}/api/owner/properties`);
    assert.equal(listResponse.status, 200);
    const list = await listResponse.json();
    assert.deepEqual(
      list.properties.map((property: any) => property.propertyNumber),
      ["PROP-1", "PROP-2", "PROP-3"],
    );
    assert.doesNotMatch(JSON.stringify(list), /1234|9999|PROP-OTHER/);
    const initialCookie = (listResponse.headers.get("set-cookie") || "").split(";", 1)[0];
    assert.match(initialCookie, /^connect\.sid=/);

    const switchResponse = await fetch(`${baseUrl}/api/owner/switch-property`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: initialCookie,
      },
      body: JSON.stringify({ propertyNumber: "PROP-2" }),
    });
    assert.equal(switchResponse.status, 200);
    assert.equal((await switchResponse.json()).propertyNumber, "PROP-2");
    const switchedCookie = (switchResponse.headers.get("set-cookie") || "").split(";", 1)[0];
    assert.match(switchedCookie, /^connect\.sid=/);
    assert.notEqual(switchedCookie, initialCookie);

    const multiOnlySwitchResponse = await fetch(`${baseUrl}/api/owner/switch-property`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: initialCookie,
      },
      body: JSON.stringify({ propertyNumber: "PROP-3" }),
    });
    assert.equal(multiOnlySwitchResponse.status, 200);
    assert.equal((await multiOnlySwitchResponse.json()).propertyNumber, "PROP-3");

    const forbiddenResponse = await fetch(`${baseUrl}/api/owner/switch-property`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ propertyNumber: "PROP-OTHER" }),
    });
    assert.equal(forbiddenResponse.status, 403);

    const crossOriginResponse = await fetch(`${baseUrl}/api/owner/switch-property`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "https://evil.example",
      },
      body: JSON.stringify({ propertyNumber: "PROP-2" }),
    });
    assert.equal(crossOriginResponse.status, 403);
  } finally {
    firebaseService.getPropertyByNumber = originals.property;
    firebaseService.getSubscriptionByPropertyNumber = originals.subscription;
    firebaseService.getSubscriptionsLinkedToProperty = originals.linked;
    firebaseService.getMultiPropertySubscriptions = originals.multi;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});

test("owner account property switcher uses permanent memberships and preserves account identity", async () => {
  const originals = {
    property: firebaseService.getPropertyByNumber,
    list: ownerAccountStore.listActiveMemberships,
    validate: ownerAccountStore.validateActiveMembership,
  };
  const accountId = "A".repeat(43);
  const memberships = [
    {
      schemaVersion: 1 as const,
      ownerAccountId: accountId,
      propertyNumber: "PROP-1",
      status: "active" as const,
      isPrimary: true,
      createdAt: "2026-09-26T00:00:00.000Z",
      updatedAt: "2026-09-26T00:00:00.000Z",
      revokedAt: null,
    },
    {
      schemaVersion: 1 as const,
      ownerAccountId: accountId,
      propertyNumber: "PROP-2",
      status: "active" as const,
      isPrimary: false,
      createdAt: "2026-09-26T00:00:00.000Z",
      updatedAt: "2026-09-26T00:00:00.000Z",
      revokedAt: null,
    },
  ];
  (ownerAccountStore as any).listActiveMemberships = async () => memberships;
  (ownerAccountStore as any).validateActiveMembership = async (input: any) =>
    input.ownerAccountId === accountId &&
    input.authVersion === 3 &&
    ["PROP-1", "PROP-2"].includes(input.propertyNumber);
  (firebaseService as any).getPropertyByNumber = async (propertyNumber: string) =>
    ["PROP-1", "PROP-2"].includes(propertyNumber)
      ? { propertyNumber, name: propertyNumber, city: "بريدة", pin: propertyNumber }
      : null;

  const app = express();
  app.use(express.json());
  app.use(session({
    secret: "owner-account-switch-test-secret",
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false },
  }));
  app.use((req, _res, next) => {
    if (!req.session.propertyNumber) {
      req.session.propertyNumber = "PROP-1";
      req.session.ownerAccountId = accountId;
      req.session.authVersion = 3;
    }
    next();
  });
  app.use(ownerRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const listed = await fetch(`${baseUrl}/api/owner/properties`);
    assert.equal(listed.status, 200);
    const firstCookie = (listed.headers.get("set-cookie") || "").split(";", 1)[0];
    const listPayload = await listed.json();
    assert.deepEqual(
      listPayload.properties.map((property: any) => ({
        propertyNumber: property.propertyNumber,
        isMain: property.isMain,
      })),
      [
        { propertyNumber: "PROP-1", isMain: true },
        { propertyNumber: "PROP-2", isMain: false },
      ],
    );
    assert.doesNotMatch(JSON.stringify(listPayload), /pin/);

    const switched = await fetch(`${baseUrl}/api/owner/switch-property`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: firstCookie },
      body: JSON.stringify({ propertyNumber: "PROP-2" }),
    });
    assert.equal(switched.status, 200);
    const switchedCookie = (switched.headers.get("set-cookie") || "").split(";", 1)[0];
    assert.notEqual(switchedCookie, firstCookie);

    const afterSwitch = await fetch(`${baseUrl}/api/owner/properties`, {
      headers: { cookie: switchedCookie },
    });
    assert.equal(afterSwitch.status, 200);
    const afterPayload = await afterSwitch.json();
    assert.equal(
      afterPayload.properties.find((property: any) => property.isCurrent)?.propertyNumber,
      "PROP-2",
    );

    const forbidden = await fetch(`${baseUrl}/api/owner/switch-property`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: switchedCookie },
      body: JSON.stringify({ propertyNumber: "PROP-OTHER" }),
    });
    assert.equal(forbidden.status, 403);
  } finally {
    firebaseService.getPropertyByNumber = originals.property;
    ownerAccountStore.listActiveMemberships = originals.list;
    ownerAccountStore.validateActiveMembership = originals.validate;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("owner account subscription lookup rejects a property outside permanent memberships", async () => {
  const originalValidate = ownerAccountStore.validateActiveMembership;
  const originalSubscription = firebaseService.getSubscriptionByPropertyNumber;
  let subscriptionReads = 0;
  (ownerAccountStore as any).validateActiveMembership = async (input: any) =>
    input.propertyNumber === "11111";
  (firebaseService as any).getSubscriptionByPropertyNumber = async () => {
    subscriptionReads += 1;
    return null;
  };
  const app = express();
  app.use((req, _res, next) => {
    (req as any).session = {
      propertyNumber: "11111",
      ownerAccountId: "A".repeat(43),
      authVersion: 1,
    };
    next();
  });
  app.use(ownerRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  try {
    const { port } = server.address() as AddressInfo;
    const response = await fetch(
      `http://127.0.0.1:${port}/api/owner/subscription/99999`,
    );
    assert.equal(response.status, 403);
    assert.equal(subscriptionReads, 0);
  } finally {
    ownerAccountStore.validateActiveMembership = originalValidate;
    firebaseService.getSubscriptionByPropertyNumber = originalSubscription;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("owner account cannot add a same-PIN property without permanent membership", async () => {
  const originals = {
    validate: ownerAccountStore.validateActiveMembership,
    property: firebaseService.getPropertyByNumber,
    subscription: firebaseService.getSubscriptionByPropertyNumber,
  };
  const accountId = "A".repeat(43);
  (ownerAccountStore as any).validateActiveMembership = async (input: any) =>
    input.ownerAccountId === accountId && input.propertyNumber === "11111";
  (firebaseService as any).getPropertyByNumber = async (propertyNumber: string) => ({
    propertyNumber,
    name: propertyNumber,
    whatsappNumber: "0551234567",
    city: "بريدة",
    direction: "شمال",
    type: "قسم",
    facilities: ["مسبح"],
    prices: {
      weekday: "100",
      weekend: "150",
      overnight: "200",
      holidays: "250",
    },
    pin: "shared-pin",
  });
  (firebaseService as any).getSubscriptionByPropertyNumber = async () => null;
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = {
      propertyNumber: "11111",
      ownerAccountId: accountId,
      authVersion: 1,
    };
    next();
  });
  app.use(ownerRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    for (const [path, body] of [
      ["/api/owner/verify-second-property", { secondPropertyNumber: "22222" }],
      ["/api/owner/request-additional-property", { additionalPropertyNumber: "22222" }],
    ] as const) {
      const response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      assert.equal(response.status, 403);
      assert.deepEqual(await response.json(), { error: "هذا العقار يخص مالك آخر" });
    }
  } finally {
    ownerAccountStore.validateActiveMembership = originals.validate;
    firebaseService.getPropertyByNumber = originals.property;
    firebaseService.getSubscriptionByPropertyNumber = originals.subscription;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("owner-account subscription metadata hides stale legacy-linked properties", async () => {
  const originals = {
    validate: ownerAccountStore.validateActiveMembership,
    list: ownerAccountStore.listActiveMemberships,
    current: subscriptionService.getByProperty,
    property: firebaseService.getPropertyByNumber,
    subscription: firebaseService.getSubscriptionByPropertyNumber,
    linked: firebaseService.getSubscriptionsLinkedToProperty,
    multi: firebaseService.getMultiPropertySubscriptions,
  };
  const accountId = "A".repeat(43);
  const currentSubscription = {
    id: "SUB-11111",
    propertyNumber: "11111",
    packageId: "pkg",
    startDate: "2026-01-01T00:00:00.000Z",
    endDate: "2027-01-01T00:00:00.000Z",
    status: "نشط",
    linkedProperty: "22222",
    linkedProperties: ["22222"],
  };
  (ownerAccountStore as any).validateActiveMembership = async (input: any) =>
    input.propertyNumber === "11111";
  (ownerAccountStore as any).listActiveMemberships = async () => [{
    ownerAccountId: accountId,
    propertyNumber: "11111",
    status: "active",
    isPrimary: true,
  }];
  (subscriptionService as any).getByProperty = async () => currentSubscription;
  (firebaseService as any).getPropertyByNumber = async (propertyNumber: string) => ({
    propertyNumber,
    name: propertyNumber,
    pin: "same-legacy-pin",
  });
  (firebaseService as any).getSubscriptionByPropertyNumber = async (
    propertyNumber: string,
  ) => propertyNumber === "11111"
    ? currentSubscription
    : { ...currentSubscription, propertyNumber, linkedProperty: undefined };
  (firebaseService as any).getSubscriptionsLinkedToProperty = async () => [{
    ...currentSubscription,
    propertyNumber: "11111",
  }];
  (firebaseService as any).getMultiPropertySubscriptions = async () => [];

  const app = express();
  app.use((req, _res, next) => {
    (req as any).session = {
      propertyNumber: "11111",
      ownerAccountId: accountId,
      authVersion: 1,
    };
    next();
  });
  app.use(ownerRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  try {
    const { port } = server.address() as AddressInfo;
    const response = await fetch(
      `http://127.0.0.1:${port}/api/owner/current-subscription`,
    );
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.equal(payload.linkedToMain, null);
    assert.deepEqual(payload.linkedProperties, []);
    assert.deepEqual(payload.linkedGroup.propertyNumbers, ["11111"]);
    assert.doesNotMatch(JSON.stringify(payload), /22222/);
  } finally {
    ownerAccountStore.validateActiveMembership = originals.validate;
    ownerAccountStore.listActiveMemberships = originals.list;
    subscriptionService.getByProperty = originals.current;
    firebaseService.getPropertyByNumber = originals.property;
    firebaseService.getSubscriptionByPropertyNumber = originals.subscription;
    firebaseService.getSubscriptionsLinkedToProperty = originals.linked;
    firebaseService.getMultiPropertySubscriptions = originals.multi;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("owner-account additional-property metadata is restricted to active memberships", async () => {
  const originals = {
    validate: ownerAccountStore.validateActiveMembership,
    list: ownerAccountStore.listActiveMemberships,
    properties: firebaseService.getProperties,
    subscriptions: firebaseService.getSubscriptions,
    multi: firebaseService.getMultiPropertySubscriptions,
  };
  const accountId = "A".repeat(43);
  (ownerAccountStore as any).validateActiveMembership = async (input: any) =>
    input.propertyNumber === "11111";
  (ownerAccountStore as any).listActiveMemberships = async () => [{
    ownerAccountId: accountId,
    propertyNumber: "11111",
    status: "active",
    isPrimary: true,
  }];
  (firebaseService as any).getProperties = async () => [
    { propertyNumber: "11111", name: "Current" },
    {
      propertyNumber: "22222",
      name: "Foreign",
      city: "جدة",
      pendingApprovalFrom: "11111",
    },
  ];
  (firebaseService as any).getSubscriptions = async () => [{
    propertyNumber: "22222",
    linkedProperty: "11111",
    status: "نشط",
  }];
  (firebaseService as any).getMultiPropertySubscriptions = async () => [];

  const app = express();
  app.use((req, _res, next) => {
    (req as any).session = {
      propertyNumber: "11111",
      ownerAccountId: accountId,
      authVersion: 1,
    };
    next();
  });
  app.use(ownerRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  try {
    const { port } = server.address() as AddressInfo;
    const response = await fetch(
      `http://127.0.0.1:${port}/api/owner/additional-property-requests`,
    );
    assert.equal(response.status, 200);
    const payload = await response.json();
    assert.deepEqual(payload.pendingRequests, []);
    assert.deepEqual(payload.approvedRequests, []);
    assert.doesNotMatch(JSON.stringify(payload), /22222|Foreign/);
  } finally {
    ownerAccountStore.validateActiveMembership = originals.validate;
    ownerAccountStore.listActiveMemberships = originals.list;
    firebaseService.getProperties = originals.properties;
    firebaseService.getSubscriptions = originals.subscriptions;
    firebaseService.getMultiPropertySubscriptions = originals.multi;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("owner notes can only be saved for an inquiry belonging to the active property", async () => {
  const originals = {
    requests: analyticsService.getAllRequests,
    bookings: bookingCommissionStore.listBookingsForProperty,
    saveNote: ownerInquiryNoteService.save,
  };
  (analyticsService as any).getAllRequests = async () => [
    { id: "REQ-OWNED", propertyNumber: "PROP-1", timestamp: "2026-09-26T10:00:00.000Z" },
    { id: "REQ-OTHER", propertyNumber: "PROP-2", timestamp: "2026-09-26T10:00:00.000Z" },
  ];
  (bookingCommissionStore as any).listBookingsForProperty = async () => [];
  const saved: Array<Record<string, string>> = [];
  (ownerInquiryNoteService as any).save = async (value: Record<string, string>) => {
    saved.push(value);
    return { ...value, updatedAt: "2026-09-26T12:00:00.000Z" };
  };

  const app = express();
  app.use(express.json());
  app.use(session({
    secret: "owner-note-route-test-secret",
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false },
  }));
  app.use((req, _res, next) => {
    req.session.propertyNumber = "PROP-1";
    next();
  });
  app.use(ownerRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;

  try {
    const owned = await fetch(`${baseUrl}/api/owner/requests/REQ-OWNED/note`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note: "اتصل مساءً" }),
    });
    assert.equal(owned.status, 200);
    assert.equal(saved.length, 1);
    assert.equal(saved[0].propertyNumber, "PROP-1");
    assert.equal(saved[0].inquiryId, "REQ-OWNED");

    const other = await fetch(`${baseUrl}/api/owner/requests/REQ-OTHER/note`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ note: "غير مسموح" }),
    });
    assert.equal(other.status, 404);
    assert.equal(saved.length, 1);

    const crossOrigin = await fetch(`${baseUrl}/api/owner/requests/REQ-OWNED/note`, {
      method: "PUT",
      headers: {
        "content-type": "application/json",
        origin: "https://evil.example",
      },
      body: JSON.stringify({ note: "غير مسموح" }),
    });
    assert.equal(crossOrigin.status, 403);
    assert.equal(saved.length, 1);
  } finally {
    analyticsService.getAllRequests = originals.requests;
    bookingCommissionStore.listBookingsForProperty = originals.bookings;
    ownerInquiryNoteService.save = originals.saveNote;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});
