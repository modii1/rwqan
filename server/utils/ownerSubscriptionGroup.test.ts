import assert from "node:assert/strict";
import test from "node:test";

import { resolveOwnerSubscriptionGroup } from "./ownerSubscriptionGroup";

function reader(params: {
  properties: Record<string, any>;
  subscriptions: Record<string, any>;
  linked?: any[];
}) {
  return {
    getPropertyByNumber: async (propertyNumber: string) =>
      params.properties[propertyNumber] || null,
    getSubscriptionByPropertyNumber: async (propertyNumber: string) =>
      params.subscriptions[propertyNumber] || null,
    getSubscriptionsLinkedToProperty: async () => params.linked || [],
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
