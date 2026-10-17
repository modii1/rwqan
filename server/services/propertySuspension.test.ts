import assert from "node:assert/strict";
import test from "node:test";
import { firebaseService } from "../firebaseService";
import {
  assertPropertyNotSuspended,
  isPropertySuspended,
  PropertySuspendedError,
} from "./propertySuspension";

const originalGetSubscriptionByPropertyNumber =
  firebaseService.getSubscriptionByPropertyNumber;

test.afterEach(() => {
  firebaseService.getSubscriptionByPropertyNumber =
    originalGetSubscriptionByPropertyNumber;
});

test("isPropertySuspended recognizes current and legacy suspended records", async () => {
  for (const status of ["موقوف مؤقتاً", "suspended"]) {
    let requestedPropertyNumber = "";
    (firebaseService as any).getSubscriptionByPropertyNumber = async (
      propertyNumber: string,
    ) => {
      requestedPropertyNumber = propertyNumber;
      return { status };
    };

    assert.equal(await isPropertySuspended(" 10001 "), true);
    assert.equal(requestedPropertyNumber, "10001");
  }
});

test("isPropertySuspended allows properties without a suspended subscription", async () => {
  for (const subscription of [null, { status: "ساري" }, { status: "active" }]) {
    (firebaseService as any).getSubscriptionByPropertyNumber = async () =>
      subscription;
    assert.equal(await isPropertySuspended("10001"), false);
  }
});

test("assertPropertyNotSuspended exposes a structured locked-property error", async () => {
  (firebaseService as any).getSubscriptionByPropertyNumber = async () => ({
    status: "موقوف مؤقتاً",
  });

  await assert.rejects(
    () => assertPropertyNotSuspended("10001"),
    (error: unknown) => {
      assert.ok(error instanceof PropertySuspendedError);
      assert.equal(error.code, "PROPERTY_SUSPENDED");
      assert.equal(error.status, 423);
      assert.match(error.message, /موقوف مؤقتاً/);
      return true;
    },
  );
});

test("suspension lookup errors are propagated so callers can fail closed", async () => {
  const lookupError = new Error("firebase unavailable");
  (firebaseService as any).getSubscriptionByPropertyNumber = async () => {
    throw lookupError;
  };

  await assert.rejects(() => isPropertySuspended("10001"), lookupError);
  await assert.rejects(() => isPropertySuspended("   "), /Property number is required/);
});
