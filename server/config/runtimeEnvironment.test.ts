import assert from "node:assert/strict";
import test from "node:test";
import { assertProductionSecurityEnvironment } from "./runtimeEnvironment";

test("production requires credentials, a session secret, and Paymob HMAC", () => {
  assert.throws(
    () => assertProductionSecurityEnvironment({ NODE_ENV: "production" }),
    /ADMIN_CODE, ADMIN_PASSWORD, SESSION_SECRET, PAYMOB_HMAC_SECRET/,
  );
});

test("production accepts complete security configuration", () => {
  assert.doesNotThrow(() =>
    assertProductionSecurityEnvironment({
      NODE_ENV: "production",
      ADMIN_CODE: "configured-code",
      ADMIN_PASSWORD: "configured-password",
      SESSION_SECRET: "configured-session-secret-value-123456789",
      PAYMOB_HMAC_SECRET: "configured-paymob-hmac",
    }),
  );
});

test("production rejects a session secret shorter than customer workflows require", () => {
  assert.throws(
    () => assertProductionSecurityEnvironment({
      NODE_ENV: "production",
      ADMIN_CODE: "configured-code",
      ADMIN_PASSWORD: "configured-password",
      SESSION_SECRET: "too-short",
      PAYMOB_HMAC_SECRET: "configured-paymob-hmac",
    }),
    /SESSION_SECRET must be at least 32 bytes/,
  );
});

test("development does not require deployment credentials", () => {
  assert.doesNotThrow(() =>
    assertProductionSecurityEnvironment({ NODE_ENV: "development" }),
  );
});
