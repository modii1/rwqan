import assert from "node:assert/strict";
import test from "node:test";
import { assertProductionSecurityEnvironment } from "./runtimeEnvironment";

test("production requires admin credentials and a session secret", () => {
  assert.throws(
    () => assertProductionSecurityEnvironment({ NODE_ENV: "production" }),
    /ADMIN_CODE, ADMIN_PASSWORD, SESSION_SECRET/,
  );
});

test("production accepts complete security configuration", () => {
  assert.doesNotThrow(() =>
    assertProductionSecurityEnvironment({
      NODE_ENV: "production",
      ADMIN_CODE: "configured-code",
      ADMIN_PASSWORD: "configured-password",
      SESSION_SECRET: "configured-session-secret",
    }),
  );
});

test("development does not require deployment credentials", () => {
  assert.doesNotThrow(() =>
    assertProductionSecurityEnvironment({ NODE_ENV: "development" }),
  );
});
