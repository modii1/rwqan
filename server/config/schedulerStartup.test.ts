import assert from "node:assert/strict";
import test from "node:test";
import { shouldStartScheduledBackgroundWork } from "./schedulerStartup";

test("scheduled background work starts automatically in production", () => {
  assert.equal(
    shouldStartScheduledBackgroundWork({ NODE_ENV: "production" }),
    true,
  );
  assert.equal(
    shouldStartScheduledBackgroundWork({
      NODE_ENV: "production",
      ENABLE_SCHEDULERS_IN_DEVELOPMENT: "false",
    }),
    true,
  );
});

test("live Firebase configuration cannot auto-start schedulers outside production", () => {
  const liveFirebaseEnvironment = {
    FIREBASE_SERVICE_ACCOUNT: JSON.stringify({
      project_id: "live-project",
    }),
  };

  assert.equal(
    shouldStartScheduledBackgroundWork({
      ...liveFirebaseEnvironment,
      NODE_ENV: "development",
    }),
    false,
  );
  assert.equal(
    shouldStartScheduledBackgroundWork({
      ...liveFirebaseEnvironment,
      NODE_ENV: "test",
      ENABLE_SCHEDULERS_IN_DEVELOPMENT: "true",
    }),
    false,
  );
});

test("development requires an exact explicit non-secret opt-in", () => {
  assert.equal(
    shouldStartScheduledBackgroundWork({
      NODE_ENV: "development",
      ENABLE_SCHEDULERS_IN_DEVELOPMENT: "true",
    }),
    true,
  );
  assert.equal(
    shouldStartScheduledBackgroundWork({
      NODE_ENV: "development",
      ENABLE_SCHEDULERS_IN_DEVELOPMENT: "TRUE",
    }),
    false,
  );
});

test("a worker-specific legacy opt-in can be harmonized without enabling tests", () => {
  const legacyOptIn = ["ENABLE_BOOKING_WORKER_IN_DEVELOPMENT"];

  assert.equal(
    shouldStartScheduledBackgroundWork({
      NODE_ENV: "development",
      ENABLE_BOOKING_WORKER_IN_DEVELOPMENT: "true",
    }, legacyOptIn),
    true,
  );
  assert.equal(
    shouldStartScheduledBackgroundWork({
      NODE_ENV: "test",
      ENABLE_BOOKING_WORKER_IN_DEVELOPMENT: "true",
    }, legacyOptIn),
    false,
  );
});
