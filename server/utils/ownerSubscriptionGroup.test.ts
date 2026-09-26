import assert from "node:assert/strict";
import test from "node:test";

import { resolveOwnerSubscriptionGroup } from "./ownerSubscriptionGroup";

function reader(params: {
  properties: Record<string, any>;
  subscriptions: Record<string, any>;
  linked?: any[];
  multi?: any[];
}) {
  return {
    getPropertyByNumber: async (propertyNumber: string) =>
      params.properties[propertyNumber] || null,
    getSubscriptionByPropertyNumber: async (propertyNumber: string) =>
      params.subscriptions[propertyNumber] || null,
    getSubscriptionsLinkedToProperty: async () => params.linked || [],
    getMultiPropertySubscriptions: async () => params.multi || [],
  } as any;
}

test("a child-initiated extension resolves to the existing main group", async () => {
  const group = await resolveOwnerSubscriptionGroup("99651", reader({
    properties: {
      "99651": { propertyNumber: "99651", pin: "1234", linkedProperty: "99655" },
      "99655": { propertyNumber: "99655", pin: "1234" },
    },
    subscriptions: {
      "99651": { propertyNumber: "99651", linkedProperty: "99655" },
      "99655": { propertyNumber: "99655", linkedProperties: ["99651", "99657"] },
    },
    linked: [
      { propertyNumber: "99651", linkedProperty: "99655" },
      { propertyNumber: "99657", linkedProperty: "99655" },
    ],
  }));

  assert.equal(group.mainPropertyNumber, "99655");
  assert.deepEqual(group.propertyNumbers, ["99655", "99651", "99657"]);
  assert.deepEqual(group.linkedPropertyNumbers, ["99651", "99657"]);
});

test("a solo property remains its own canonical group", async () => {
  const group = await resolveOwnerSubscriptionGroup("10000", reader({
    properties: { "10000": { propertyNumber: "10000", pin: "1234" } },
    subscriptions: { "10000": { propertyNumber: "10000" } },
  }));

  assert.equal(group.mainPropertyNumber, "10000");
  assert.deepEqual(group.propertyNumbers, ["10000"]);
});

test("a forged cross-owner parent link fails closed", async () => {
  await assert.rejects(
    () => resolveOwnerSubscriptionGroup("10000", reader({
      properties: {
        "10000": { propertyNumber: "10000", pin: "1111", linkedProperty: "20000" },
        "20000": { propertyNumber: "20000", pin: "2222" },
      },
      subscriptions: {
        "10000": { propertyNumber: "10000", linkedProperty: "20000" },
        "20000": { propertyNumber: "20000", linkedProperties: ["10000"] },
      },
    })),
    /لا تتطابق/,
  );
});

test("an active multi-property membership supplies a missing legacy pointer", async () => {
  const group = await resolveOwnerSubscriptionGroup("10002", reader({
    properties: {
      "10001": { propertyNumber: "10001", pin: "1234" },
      "10002": { propertyNumber: "10002", pin: "1234" },
      "10003": { propertyNumber: "10003", pin: "1234" },
    },
    subscriptions: {
      "10001": { propertyNumber: "10001" },
      "10002": { propertyNumber: "10002" },
      "10003": { propertyNumber: "10003" },
    },
    multi: [{
      id: "MULTI-1",
      packageId: "PKG-1",
      propertyNumber1: "10001",
      propertyNumber2: "10002",
      linkedProperties: ["10001", "10002", "10003"],
      startDate: "2026-01-01T00:00:00.000Z",
      endDate: "2099-01-01T00:00:00.000Z",
      status: "نشط",
    }],
  }));

  assert.equal(group.mainPropertyNumber, "10001");
  assert.deepEqual(group.propertyNumbers, ["10001", "10002", "10003"]);
});

test("expired multi-property membership does not grant owner access", async () => {
  const group = await resolveOwnerSubscriptionGroup("10002", reader({
    properties: {
      "10001": { propertyNumber: "10001", pin: "1234" },
      "10002": { propertyNumber: "10002", pin: "1234" },
    },
    subscriptions: {
      "10002": { propertyNumber: "10002" },
    },
    multi: [{
      id: "MULTI-OLD",
      packageId: "PKG-1",
      propertyNumber1: "10001",
      propertyNumber2: "10002",
      startDate: "2025-01-01T00:00:00.000Z",
      endDate: "2025-02-01T00:00:00.000Z",
      status: "نشط",
    }],
  }));

  assert.equal(group.mainPropertyNumber, "10002");
  assert.deepEqual(group.propertyNumbers, ["10002"]);
});

test("a forged cross-owner multi-property membership fails closed", async () => {
  await assert.rejects(
    () => resolveOwnerSubscriptionGroup("10002", reader({
      properties: {
        "10001": { propertyNumber: "10001", pin: "9999" },
        "10002": { propertyNumber: "10002", pin: "1234" },
      },
      subscriptions: {
        "10002": { propertyNumber: "10002" },
      },
      multi: [{
        id: "MULTI-FORGED",
        packageId: "PKG-1",
        propertyNumber1: "10001",
        propertyNumber2: "10002",
        startDate: "2026-01-01T00:00:00.000Z",
        endDate: "2099-01-01T00:00:00.000Z",
        status: "نشط",
      }],
    })),
    /لا تتطابق/,
  );
});
