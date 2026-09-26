import assert from "node:assert/strict";
import test from "node:test";
import {
  assertProductionFirestoreAvailable,
  assertProductionSecurityEnvironment,
} from "./runtimeEnvironment";

const FIREBASE_SERVICE_ACCOUNT = JSON.stringify({
  project_id: "rwqan-production",
  client_email: "server@rwqan-production.iam.gserviceaccount.com",
  private_key: "configured-private-key",
});
const META_WHATSAPP_APP_SECRET = "configured-meta-app-secret-123456789";
const META_WHATSAPP_WEBHOOK_VERIFY_TOKEN =
  "configured-meta-verify-token-123456789";

test("production requires credentials, persistent storage, a session secret, and Paymob HMAC", () => {
  assert.throws(
    () => assertProductionSecurityEnvironment({ NODE_ENV: "production" }),
    /ADMIN_CODE, ADMIN_PASSWORD, SESSION_SECRET, PAYMOB_HMAC_SECRET, FIREBASE_SERVICE_ACCOUNT/,
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
      FIREBASE_SERVICE_ACCOUNT,
      WHATSAPP_DELIVERY_WEBHOOK_SECRET: "configured-whatsapp-webhook-secret-123456",
      META_WHATSAPP_APP_SECRET,
      META_WHATSAPP_WEBHOOK_VERIFY_TOKEN,
    }),
  );
});

test("production accepts relay-only webhook authentication", () => {
  assert.doesNotThrow(() =>
    assertProductionSecurityEnvironment({
      NODE_ENV: "production",
      ADMIN_CODE: "configured-code",
      ADMIN_PASSWORD: "configured-password",
      SESSION_SECRET: "configured-session-secret-value-123456789",
      PAYMOB_HMAC_SECRET: "configured-paymob-hmac",
      FIREBASE_SERVICE_ACCOUNT,
      WHATSAPP_DELIVERY_WEBHOOK_SECRET: "configured-whatsapp-webhook-secret-123456",
    }),
  );
});

test("production accepts Meta-only webhook authentication", () => {
  assert.doesNotThrow(() =>
    assertProductionSecurityEnvironment({
      NODE_ENV: "production",
      ADMIN_CODE: "configured-code",
      ADMIN_PASSWORD: "configured-password",
      SESSION_SECRET: "configured-session-secret-value-123456789",
      PAYMOB_HMAC_SECRET: "configured-paymob-hmac",
      FIREBASE_SERVICE_ACCOUNT,
      META_WHATSAPP_APP_SECRET,
      META_WHATSAPP_WEBHOOK_VERIFY_TOKEN,
    }),
  );
});

test("production requires one webhook authentication mode", () => {
  assert.throws(
    () => assertProductionSecurityEnvironment({
      NODE_ENV: "production",
      ADMIN_CODE: "configured-code",
      ADMIN_PASSWORD: "configured-password",
      SESSION_SECRET: "configured-session-secret-value-123456789",
      PAYMOB_HMAC_SECRET: "configured-paymob-hmac",
      FIREBASE_SERVICE_ACCOUNT,
    }),
    /Configure either WHATSAPP_DELIVERY_WEBHOOK_SECRET or the Meta WhatsApp webhook credentials/,
  );
});

test("production requires paired Meta webhook credentials", () => {
  assert.throws(
    () => assertProductionSecurityEnvironment({
      NODE_ENV: "production",
      ADMIN_CODE: "configured-code",
      ADMIN_PASSWORD: "configured-password",
      SESSION_SECRET: "configured-session-secret-value-123456789",
      PAYMOB_HMAC_SECRET: "configured-paymob-hmac",
      FIREBASE_SERVICE_ACCOUNT,
      WHATSAPP_DELIVERY_WEBHOOK_SECRET: "configured-whatsapp-webhook-secret-123456",
      META_WHATSAPP_APP_SECRET,
    }),
    /META_WHATSAPP_APP_SECRET and META_WHATSAPP_WEBHOOK_VERIFY_TOKEN must be configured together/,
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
      FIREBASE_SERVICE_ACCOUNT,
      WHATSAPP_DELIVERY_WEBHOOK_SECRET: "configured-whatsapp-webhook-secret-123456",
      META_WHATSAPP_APP_SECRET,
      META_WHATSAPP_WEBHOOK_VERIFY_TOKEN,
    }),
    /SESSION_SECRET must be at least 32 bytes/,
  );
});

test("production rejects a configured owner-account HMAC secret shorter than 32 bytes", () => {
  assert.throws(
    () => assertProductionSecurityEnvironment({
      NODE_ENV: "production",
      ADMIN_CODE: "configured-code",
      ADMIN_PASSWORD: "configured-password",
      SESSION_SECRET: "configured-session-secret-value-123456789",
      OWNER_ACCOUNT_HMAC_SECRET: "too-short",
      PAYMOB_HMAC_SECRET: "configured-paymob-hmac",
      FIREBASE_SERVICE_ACCOUNT,
      WHATSAPP_DELIVERY_WEBHOOK_SECRET: "configured-whatsapp-webhook-secret-123456",
    }),
    /OWNER_ACCOUNT_HMAC_SECRET must be at least 32 bytes/,
  );
});

test("production rejects a short WhatsApp delivery webhook secret", () => {
  assert.throws(
    () => assertProductionSecurityEnvironment({
      NODE_ENV: "production",
      ADMIN_CODE: "configured-code",
      ADMIN_PASSWORD: "configured-password",
      SESSION_SECRET: "configured-session-secret-value-123456789",
      PAYMOB_HMAC_SECRET: "configured-paymob-hmac",
      FIREBASE_SERVICE_ACCOUNT,
      WHATSAPP_DELIVERY_WEBHOOK_SECRET: "too-short",
      META_WHATSAPP_APP_SECRET,
      META_WHATSAPP_WEBHOOK_VERIFY_TOKEN,
    }),
    /WHATSAPP_DELIVERY_WEBHOOK_SECRET must be at least 32 bytes/,
  );
});

test("production rejects a short Meta WhatsApp app secret", () => {
  assert.throws(
    () => assertProductionSecurityEnvironment({
      NODE_ENV: "production",
      ADMIN_CODE: "configured-code",
      ADMIN_PASSWORD: "configured-password",
      SESSION_SECRET: "configured-session-secret-value-123456789",
      PAYMOB_HMAC_SECRET: "configured-paymob-hmac",
      FIREBASE_SERVICE_ACCOUNT,
      WHATSAPP_DELIVERY_WEBHOOK_SECRET: "configured-whatsapp-webhook-secret-123456",
      META_WHATSAPP_APP_SECRET: "too-short",
      META_WHATSAPP_WEBHOOK_VERIFY_TOKEN,
    }),
    /META_WHATSAPP_APP_SECRET must be at least 32 bytes/,
  );
});

test("production rejects a short Meta WhatsApp webhook verification token", () => {
  assert.throws(
    () => assertProductionSecurityEnvironment({
      NODE_ENV: "production",
      ADMIN_CODE: "configured-code",
      ADMIN_PASSWORD: "configured-password",
      SESSION_SECRET: "configured-session-secret-value-123456789",
      PAYMOB_HMAC_SECRET: "configured-paymob-hmac",
      FIREBASE_SERVICE_ACCOUNT,
      WHATSAPP_DELIVERY_WEBHOOK_SECRET: "configured-whatsapp-webhook-secret-123456",
      META_WHATSAPP_APP_SECRET,
      META_WHATSAPP_WEBHOOK_VERIFY_TOKEN: "too-short",
    }),
    /META_WHATSAPP_WEBHOOK_VERIFY_TOKEN must be at least 32 bytes/,
  );
});

test("development does not require deployment credentials", () => {
  assert.doesNotThrow(() =>
    assertProductionSecurityEnvironment({ NODE_ENV: "development" }),
  );
});

test("production rejects malformed Firebase service-account JSON", () => {
  assert.throws(
    () => assertProductionSecurityEnvironment({
      NODE_ENV: "production",
      ADMIN_CODE: "configured-code",
      ADMIN_PASSWORD: "configured-password",
      SESSION_SECRET: "configured-session-secret-value-123456789",
      PAYMOB_HMAC_SECRET: "configured-paymob-hmac",
      FIREBASE_SERVICE_ACCOUNT: "{not-json",
      WHATSAPP_DELIVERY_WEBHOOK_SECRET: "configured-whatsapp-webhook-secret-123456",
      META_WHATSAPP_APP_SECRET,
      META_WHATSAPP_WEBHOOK_VERIFY_TOKEN,
    }),
    /FIREBASE_SERVICE_ACCOUNT must contain valid JSON/,
  );
});

test("production rejects an incomplete Firebase service-account object", () => {
  assert.throws(
    () => assertProductionSecurityEnvironment({
      NODE_ENV: "production",
      ADMIN_CODE: "configured-code",
      ADMIN_PASSWORD: "configured-password",
      SESSION_SECRET: "configured-session-secret-value-123456789",
      PAYMOB_HMAC_SECRET: "configured-paymob-hmac",
      FIREBASE_SERVICE_ACCOUNT: JSON.stringify({ project_id: "rwqan" }),
      WHATSAPP_DELIVERY_WEBHOOK_SECRET: "configured-whatsapp-webhook-secret-123456",
      META_WHATSAPP_APP_SECRET,
      META_WHATSAPP_WEBHOOK_VERIFY_TOKEN,
    }),
    /client_email, private_key/,
  );
});

test("production refuses to start when Firestore initialization failed", () => {
  assert.throws(
    () => assertProductionFirestoreAvailable(null, { NODE_ENV: "production" }),
    /Firestore failed to initialize/,
  );
  assert.throws(
    () => assertProductionFirestoreAvailable({}, { NODE_ENV: "production" }),
    /Firestore failed to initialize/,
  );
});

test("Firestore availability check accepts an initialized production client", () => {
  assert.doesNotThrow(() => assertProductionFirestoreAvailable({
    collection() {},
    runTransaction() {},
  }, { NODE_ENV: "production" }));
  assert.doesNotThrow(() =>
    assertProductionFirestoreAvailable(null, { NODE_ENV: "development" }),
  );
});
