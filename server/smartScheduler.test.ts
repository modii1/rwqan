import assert from "node:assert/strict";
import test from "node:test";

import { firebaseService } from "./firebaseService";
import { dispatchExpiredSubscriptionReminders } from "./smartScheduler";
import { DistributedScheduledJobLeaseLostError } from "./services/DistributedScheduledJob";
import { storage } from "./storage";

test("smart reminder dispatch stops before later reads and sends after lease loss", async () => {
  const originals = {
    getNotificationSettings: firebaseService.getNotificationSettings,
    getSubscriptions: storage.getSubscriptions,
    getProperties: storage.getProperties,
  };
  const controller = new AbortController();
  let propertyReads = 0;

  try {
    (firebaseService as any).getNotificationSettings = async () => ({
      smartSchedule: { enabled: true },
    });
    (storage as any).getSubscriptions = async () => {
      controller.abort();
      return [];
    };
    (storage as any).getProperties = async () => {
      propertyReads += 1;
      return [];
    };

    await assert.rejects(
      () => dispatchExpiredSubscriptionReminders({
        signal: controller.signal,
        throwIfLeaseLost: () => {
          if (controller.signal.aborted) {
            throw new DistributedScheduledJobLeaseLostError();
          }
        },
      }),
      DistributedScheduledJobLeaseLostError,
    );
    assert.equal(propertyReads, 0);
  } finally {
    (firebaseService as any).getNotificationSettings =
      originals.getNotificationSettings;
    (storage as any).getSubscriptions = originals.getSubscriptions;
    (storage as any).getProperties = originals.getProperties;
  }
});
