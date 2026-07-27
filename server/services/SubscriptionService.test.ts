import assert from "node:assert/strict";
import { test } from "node:test";

import type { Subscription } from "../../shared/schema";
import { firebaseService } from "../firebaseService";
import { SubscriptionService } from "./SubscriptionService";
import { SubscriptionLifecycleError } from "./subscriptionLifecycle";

test("suspend and resume preserve a linked group's remaining duration", async () => {
  const subscriptions: Subscription[] = [
    {
      id: "SUB-10001",
      propertyNumber: "10001",
      packageId: "pkg-premium",
      startDate: "2026-07-01T12:00:00.000Z",
      endDate: "2026-07-20T12:00:00.000Z",
      status: "ساري",
      subscriptionType: "مميز",
      linkedProperties: ["10002"],
      propertyCount: 2,
    },
    {
      id: "SUB-10002",
      propertyNumber: "10002",
      packageId: "pkg-premium",
      startDate: "2026-07-01T12:00:00.000Z",
      endDate: "2026-07-20T12:00:00.000Z",
      status: "ساري",
      subscriptionType: "مميز",
      linkedProperty: "10001",
      propertyCount: 1,
    },
  ];
  const lifecycleBatches: any[][] = [];
  const originalGetSubscriptions = firebaseService.getSubscriptions;
  const originalUpdateGroup = firebaseService.updateSubscriptionLifecycleGroup;

  (firebaseService as any).getSubscriptions = async () => subscriptions;
  (firebaseService as any).updateSubscriptionLifecycleGroup = async (updates: any[]) => {
    lifecycleBatches.push(updates);
    for (const update of updates) {
      const subscription = subscriptions.find(({ id }) => id === update.subscriptionId);
      if (subscription) Object.assign(subscription, update.subscriptionUpdates);
    }
  };

  try {
    const service = new SubscriptionService();
    const suspendedAt = new Date("2026-07-10T12:00:00.000Z");
    const resumedAt = new Date("2026-07-15T12:00:00.000Z");

    const suspended = await service.suspend("SUB-10001", suspendedAt);

    assert.deepEqual(suspended.updatedProperties.sort(), ["10001", "10002"]);
    assert.equal(suspended.remainingDays, 10);
    assert.equal(lifecycleBatches[0].length, 2);
    assert.ok(lifecycleBatches[0].every((update) => update.propertySubscriptionType === "عادي"));
    assert.ok(subscriptions.every(({ status }) => status === "موقوف مؤقتاً"));

    const resumed = await service.resume("10002", resumedAt);

    assert.equal(resumed.subscription.endDate, "2026-07-25T12:00:00.000Z");
    assert.equal(lifecycleBatches[1].length, 2);
    assert.ok(lifecycleBatches[1].every((update) => update.propertySubscriptionType === "مميز"));
    assert.ok(subscriptions.every(({ status }) => status === "ساري"));
  } finally {
    (firebaseService as any).getSubscriptions = originalGetSubscriptions;
    (firebaseService as any).updateSubscriptionLifecycleGroup = originalUpdateGroup;
  }
});

test("an expired subscription cannot be moved into temporary suspension", async () => {
  const originalGetSubscriptions = firebaseService.getSubscriptions;
  const originalUpdateGroup = firebaseService.updateSubscriptionLifecycleGroup;
  let writes = 0;
  (firebaseService as any).getSubscriptions = async () => [{
    id: "SUB-EXPIRED",
    propertyNumber: "EXPIRED",
    packageId: "pkg-premium",
    startDate: "2026-07-01T00:00:00.000Z",
    endDate: "2026-07-10T00:00:00.000Z",
    status: "ساري",
    subscriptionType: "مميز",
  }];
  (firebaseService as any).updateSubscriptionLifecycleGroup = async () => {
    writes += 1;
  };

  try {
    const service = new SubscriptionService();
    await assert.rejects(
      () => service.suspend("SUB-EXPIRED", new Date("2026-07-11T00:00:00.000Z")),
      (error: unknown) => {
        assert.ok(error instanceof SubscriptionLifecycleError);
        assert.equal(error.code, "NOT_ACTIVE");
        return true;
      },
    );
    assert.equal(writes, 0);
  } finally {
    firebaseService.getSubscriptions = originalGetSubscriptions;
    firebaseService.updateSubscriptionLifecycleGroup = originalUpdateGroup;
  }
});
