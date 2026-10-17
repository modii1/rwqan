import assert from "node:assert/strict";
import test from "node:test";
import {
  assertDevelopmentIsolation,
  assertDevOnlyAdminCredentialsIsolation,
  assertFirebaseDevIsolation,
  assertPaymobKeyEnvironmentMatch,
  assertProductionSecurityEnvironment,
  classifyPaymobKeyMode,
  devCustomerOtpSinkEnabled,
  paymobEnabled,
} from "./runtimeEnvironment";

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

test("development is blocked from external service credentials without opt-in", () => {
  assert.throws(
    () =>
      assertDevelopmentIsolation({
        NODE_ENV: "development",
        PAYMOB_API_KEY: "present-value",
      }),
    /external service credentials present without ALLOW_EXTERNAL_SERVICES_IN_DEVELOPMENT="true"/,
  );
});

test("development with no external credentials starts cleanly", () => {
  assert.doesNotThrow(() =>
    assertDevelopmentIsolation({
      NODE_ENV: "development",
      SESSION_SECRET: "local-only-secret",
    }),
  );
});

test("development explicit opt-in allows external service credentials", () => {
  assert.doesNotThrow(() =>
    assertDevelopmentIsolation({
      NODE_ENV: "development",
      ALLOW_EXTERNAL_SERVICES_IN_DEVELOPMENT: "true",
      PAYMOB_API_KEY: "present-value",
    }),
  );
});

test("production bypasses the development isolation switch", () => {
  assert.doesNotThrow(() =>
    assertDevelopmentIsolation({
      NODE_ENV: "production",
      PAYMOB_API_KEY: "present-value",
    }),
  );
});

const DEV_SERVICE_ACCOUNT = JSON.stringify({
  type: "service_account",
  project_id: "rwqan-dev-project",
  private_key: "not-a-real-key",
});

test("development Firebase is not blocked by the external service switch", () => {
  assert.doesNotThrow(() =>
    assertDevelopmentIsolation({
      NODE_ENV: "development",
      FIREBASE_SERVICE_ACCOUNT: DEV_SERVICE_ACCOUNT,
    }),
  );
});

test("development refuses Firebase until the DEV project id is provided", () => {
  assert.throws(
    () =>
      assertFirebaseDevIsolation({
        NODE_ENV: "development",
        FIREBASE_SERVICE_ACCOUNT: DEV_SERVICE_ACCOUNT,
      }),
    /FIREBASE_DEV_PROJECT_ID is not set/,
  );
});

test("development refuses Firebase when the project id does not match", () => {
  assert.throws(
    () =>
      assertFirebaseDevIsolation({
        NODE_ENV: "development",
        FIREBASE_SERVICE_ACCOUNT: DEV_SERVICE_ACCOUNT,
        FIREBASE_DEV_PROJECT_ID: "another-project",
      }),
    /does not match FIREBASE_DEV_PROJECT_ID/,
  );
});

test("development accepts Firebase when the project id matches", () => {
  assert.doesNotThrow(() =>
    assertFirebaseDevIsolation({
      NODE_ENV: "development",
      FIREBASE_SERVICE_ACCOUNT: DEV_SERVICE_ACCOUNT,
      FIREBASE_DEV_PROJECT_ID: "rwqan-dev-project",
    }),
  );
});

test("development without a service account has no Firebase identity to verify", () => {
  assert.doesNotThrow(() =>
    assertFirebaseDevIsolation({
      NODE_ENV: "development",
      FIREBASE_DEV_PROJECT_ID: "rwqan-dev-project",
    }),
  );
});

test("production bypasses the Firebase dev identity check", () => {
  assert.doesNotThrow(() =>
    assertFirebaseDevIsolation({
      NODE_ENV: "production",
      FIREBASE_SERVICE_ACCOUNT: DEV_SERVICE_ACCOUNT,
      FIREBASE_DEV_PROJECT_ID: "rwqan-dev-project",
    }),
  );
});

const DEV_ONLY_ADMIN_ENV = {
  ADMIN_CODE: "DEV_ONLY_sample_code",
  ADMIN_PASSWORD: "DEV_ONLY_sample_password",
};

const DEV_ADMIN_SERVICE_ACCOUNT = JSON.stringify({
  type: "service_account",
  project_id: "rwqan-sa-dev",
  private_key: "not-a-real-key",
});

const NON_DEV_SERVICE_ACCOUNT = JSON.stringify({
  type: "service_account",
  project_id: "rwqan-sa-production",
  private_key: "not-a-real-key",
});

test("DEV-only admin credentials are refused outside development", () => {
  assert.throws(
    () =>
      assertDevOnlyAdminCredentialsIsolation({
        NODE_ENV: "production",
        ...DEV_ONLY_ADMIN_ENV,
      }),
    /DEV-only admin credentials .* only allowed when NODE_ENV=development/,
  );
});

test("DEV-only admin credentials are refused outside the isolated DEV project", () => {
  assert.throws(
    () =>
      assertDevOnlyAdminCredentialsIsolation({
        NODE_ENV: "development",
        FIREBASE_SERVICE_ACCOUNT: NON_DEV_SERVICE_ACCOUNT,
        ...DEV_ONLY_ADMIN_ENV,
      }),
    /require Firebase project rwqan-sa-dev/,
  );
});

test("DEV-only admin credentials are accepted in the isolated DEV project", () => {
  assert.doesNotThrow(() =>
    assertDevOnlyAdminCredentialsIsolation({
      NODE_ENV: "development",
      FIREBASE_DEV_PROJECT_ID: "rwqan-sa-dev",
      FIREBASE_SERVICE_ACCOUNT: DEV_ADMIN_SERVICE_ACCOUNT,
      ...DEV_ONLY_ADMIN_ENV,
    }),
  );
});

test("production credentials without the DEV-only marker are not affected", () => {
  assert.doesNotThrow(() =>
    assertDevOnlyAdminCredentialsIsolation({
      NODE_ENV: "production",
      ADMIN_CODE: "configured-code",
      ADMIN_PASSWORD: "configured-password",
    }),
  );
});

const DEV_ONLY_MARKER_ENV = {
  DEV_ONLY_ADMIN_CREDENTIALS: "true",
  ADMIN_CODE: "admin",
  ADMIN_PASSWORD: "123",
};

test("marked DEV-only admin credentials are refused outside development", () => {
  assert.throws(
    () =>
      assertDevOnlyAdminCredentialsIsolation({
        NODE_ENV: "production",
        ...DEV_ONLY_MARKER_ENV,
      }),
    /DEV-only admin credentials .* only allowed when NODE_ENV=development/,
  );
});

test("marked DEV-only admin credentials are refused outside the isolated DEV project", () => {
  assert.throws(
    () =>
      assertDevOnlyAdminCredentialsIsolation({
        NODE_ENV: "development",
        FIREBASE_SERVICE_ACCOUNT: NON_DEV_SERVICE_ACCOUNT,
        ...DEV_ONLY_MARKER_ENV,
      }),
    /require Firebase project rwqan-sa-dev/,
  );
});

test("marked plain admin credentials are accepted in the isolated DEV project", () => {
  assert.doesNotThrow(() =>
    assertDevOnlyAdminCredentialsIsolation({
      NODE_ENV: "development",
      FIREBASE_DEV_PROJECT_ID: "rwqan-sa-dev",
      FIREBASE_SERVICE_ACCOUNT: DEV_ADMIN_SERVICE_ACCOUNT,
      ...DEV_ONLY_MARKER_ENV,
    }),
  );
});

test("marker is inactive unless its value is exactly true", () => {
  assert.doesNotThrow(() =>
    assertDevOnlyAdminCredentialsIsolation({
      NODE_ENV: "production",
      DEV_ONLY_ADMIN_CREDENTIALS: "false",
      ADMIN_CODE: "configured-code",
      ADMIN_PASSWORD: "configured-password",
    }),
  );
});

const DEV_OTP_SINK_ENV = {
  DEV_CUSTOMER_OTP_SINK: "console",
  FIREBASE_SERVICE_ACCOUNT: DEV_ADMIN_SERVICE_ACCOUNT,
};

test("DEV customer OTP console sink is enabled only in the isolated DEV target", () => {
  assert.equal(
    devCustomerOtpSinkEnabled({
      NODE_ENV: "development",
      ALLOW_EXTERNAL_SERVICES_IN_DEVELOPMENT: "false",
      ...DEV_OTP_SINK_ENV,
    }),
    true,
  );
});

test("DEV customer OTP console sink stays off in production", () => {
  assert.equal(
    devCustomerOtpSinkEnabled({ NODE_ENV: "production", ...DEV_OTP_SINK_ENV }),
    false,
  );
});

test("DEV customer OTP console sink stays off without the console flag", () => {
  assert.equal(
    devCustomerOtpSinkEnabled({
      NODE_ENV: "development",
      FIREBASE_SERVICE_ACCOUNT: DEV_ADMIN_SERVICE_ACCOUNT,
    }),
    false,
  );
});

test("DEV customer OTP console sink stays off when external services are enabled", () => {
  assert.equal(
    devCustomerOtpSinkEnabled({
      NODE_ENV: "development",
      ALLOW_EXTERNAL_SERVICES_IN_DEVELOPMENT: "true",
      ...DEV_OTP_SINK_ENV,
    }),
    false,
  );
});

test("DEV customer OTP console sink stays off outside the DEV project", () => {
  assert.equal(
    devCustomerOtpSinkEnabled({
      NODE_ENV: "development",
      DEV_CUSTOMER_OTP_SINK: "console",
      FIREBASE_SERVICE_ACCOUNT: NON_DEV_SERVICE_ACCOUNT,
    }),
    false,
  );
});

test("Paymob is enabled in production regardless of the DEV opt-in", () => {
  assert.equal(paymobEnabled({ NODE_ENV: "production" }), true);
  assert.equal(
    paymobEnabled({
      NODE_ENV: "production",
      PAYMOB_ALLOW_IN_DEVELOPMENT: "false",
    }),
    true,
  );
});

test("Paymob is disabled in development by default", () => {
  assert.equal(paymobEnabled({ NODE_ENV: "development" }), false);
  assert.equal(
    paymobEnabled({
      NODE_ENV: "development",
      ALLOW_EXTERNAL_SERVICES_IN_DEVELOPMENT: "true",
    }),
    false,
  );
  assert.equal(
    paymobEnabled({
      NODE_ENV: "development",
      PAYMOB_ALLOW_IN_DEVELOPMENT: "false",
    }),
    false,
  );
});

test("Paymob is disabled when NODE_ENV is missing or unexpected", () => {
  assert.equal(paymobEnabled({} as unknown as NodeJS.ProcessEnv), false);
  assert.equal(
    paymobEnabled({ NODE_ENV: "staging" } as unknown as NodeJS.ProcessEnv),
    false,
  );
  assert.equal(paymobEnabled({ NODE_ENV: "test" }), false);
  assert.equal(
    paymobEnabled({
      NODE_ENV: "staging",
      PAYMOB_ALLOW_IN_DEVELOPMENT: "true",
    } as unknown as NodeJS.ProcessEnv),
    true,
  );
});

test("Paymob is enabled in development only with its dedicated opt-in", () => {
  assert.equal(
    paymobEnabled({
      NODE_ENV: "development",
      PAYMOB_ALLOW_IN_DEVELOPMENT: "true",
    }),
    true,
  );
});

test("development allows Paymob keys at boot with the dedicated opt-in only", () => {
  assert.doesNotThrow(() =>
    assertDevelopmentIsolation({
      NODE_ENV: "development",
      PAYMOB_ALLOW_IN_DEVELOPMENT: "true",
      PAYMOB_API_KEY: "present-value",
      PAYMOB_PUBLIC_KEY: "present-value",
      PAYMOB_HMAC_SECRET: "present-value",
      PAYMOB_LEGACY_API_KEY: "present-value",
    }),
  );
});

test("development still blocks non-Paymob credentials with only the Paymob opt-in", () => {
  assert.throws(
    () =>
      assertDevelopmentIsolation({
        NODE_ENV: "development",
        PAYMOB_ALLOW_IN_DEVELOPMENT: "true",
        PAYMOB_API_KEY: "present-value",
        META_WHATSAPP_TOKEN: "present-value",
      }),
    /META_WHATSAPP_TOKEN/,
  );
});

test("Paymob opt-in never disables the DEV customer OTP console sink", () => {
  assert.equal(
    devCustomerOtpSinkEnabled({
      NODE_ENV: "development",
      PAYMOB_ALLOW_IN_DEVELOPMENT: "true",
      ...DEV_OTP_SINK_ENV,
    }),
    true,
  );
});

test("classifyPaymobKeyMode recognizes test, live, and unknown keys", () => {
  assert.equal(classifyPaymobKeyMode("sau_sk_test_abc123"), "test");
  assert.equal(classifyPaymobKeyMode("sau_sk_live_abc123"), "live");
  assert.equal(classifyPaymobKeyMode("sau_pk_test_abc123"), "test");
  assert.equal(classifyPaymobKeyMode("sau_pk_live_abc123"), "live");
  assert.equal(classifyPaymobKeyMode("sk_test_abc123"), "test");
  assert.equal(classifyPaymobKeyMode("pk_live_abc123"), "live");
  assert.equal(classifyPaymobKeyMode("present-value"), "unknown");
  assert.equal(classifyPaymobKeyMode("sk_test_"), "unknown");
  assert.equal(classifyPaymobKeyMode("sau_sk_staging_abc123"), "unknown");
  assert.equal(classifyPaymobKeyMode(""), "unknown");
});

test("non-production accepts test-mode Paymob keys", () => {
  assert.doesNotThrow(() =>
    assertPaymobKeyEnvironmentMatch({
      NODE_ENV: "development",
      PAYMOB_API_KEY: "sau_sk_test_abc123",
      PAYMOB_PUBLIC_KEY: "sau_pk_test_abc123",
    }),
  );
});

test("non-production refuses live-mode Paymob keys", () => {
  assert.throws(
    () =>
      assertPaymobKeyEnvironmentMatch({
        NODE_ENV: "development",
        PAYMOB_API_KEY: "sau_sk_live_abc123",
      }),
    /PAYMOB_API_KEY is a live key but the runtime requires test keys/,
  );
  assert.throws(
    () =>
      assertPaymobKeyEnvironmentMatch({
        NODE_ENV: "development",
        PAYMOB_PUBLIC_KEY: "sau_pk_live_abc123",
      }),
    /PAYMOB_PUBLIC_KEY is a live key but the runtime requires test keys/,
  );
});

test("production accepts live-mode Paymob keys", () => {
  assert.doesNotThrow(() =>
    assertPaymobKeyEnvironmentMatch({
      NODE_ENV: "production",
      PAYMOB_API_KEY: "sau_sk_live_abc123",
      PAYMOB_PUBLIC_KEY: "sau_pk_live_abc123",
    }),
  );
});

test("production refuses test-mode Paymob keys", () => {
  assert.throws(
    () =>
      assertPaymobKeyEnvironmentMatch({
        NODE_ENV: "production",
        PAYMOB_API_KEY: "sau_sk_test_abc123",
      }),
    /PAYMOB_API_KEY is a test key but the runtime requires live keys/,
  );
});

test("a missing or unexpected NODE_ENV is treated as non-production", () => {
  assert.throws(
    () =>
      assertPaymobKeyEnvironmentMatch({
        PAYMOB_API_KEY: "sau_sk_live_abc123",
      } as unknown as NodeJS.ProcessEnv),
    /requires test keys/,
  );
  assert.doesNotThrow(() =>
    assertPaymobKeyEnvironmentMatch({
      NODE_ENV: "staging",
      PAYMOB_API_KEY: "sau_sk_test_abc123",
    } as unknown as NodeJS.ProcessEnv),
  );
});

test("an unrecognizable Paymob key marker fails closed", () => {
  assert.throws(
    () =>
      assertPaymobKeyEnvironmentMatch({
        NODE_ENV: "development",
        PAYMOB_API_KEY: "present-value",
      }),
    /does not carry a recognizable test\/live mode marker/,
  );
});

test("absent Paymob keys and mode-agnostic keys are not validated", () => {
  assert.doesNotThrow(() =>
    assertPaymobKeyEnvironmentMatch({ NODE_ENV: "development" }),
  );
  assert.doesNotThrow(() =>
    assertPaymobKeyEnvironmentMatch({
      NODE_ENV: "development",
      PAYMOB_LEGACY_API_KEY: "shared-api-key-value",
      PAYMOB_HMAC_SECRET: "sha512-secret-value",
    } as unknown as NodeJS.ProcessEnv),
  );
});

test("guard never echoes key values in its error messages", () => {
  const secret = "sau_sk_live_SUPERSECRETVALUE";
  assert.throws(
    () =>
      assertPaymobKeyEnvironmentMatch({
        NODE_ENV: "development",
        PAYMOB_API_KEY: secret,
      }),
    (error: unknown) =>
      error instanceof Error && !error.message.includes("SUPERSECRETVALUE"),
  );
});
