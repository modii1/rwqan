import assert from "node:assert/strict";
import test from "node:test";
import {
  LIVE_DATA_ACK_KEY,
  LIVE_DATA_ACK_VALUE,
  LIVE_FIREBASE_PROJECT_ID_KEY,
  LIVE_FIREBASE_SERVICE_ACCOUNT_KEY,
  LIVE_R2_ACCESS_KEY_ID_KEY,
  LIVE_R2_BUCKET_NAME_KEY,
  LIVE_R2_ENDPOINT_KEY,
  LIVE_R2_PUBLIC_URL_KEY,
  LIVE_R2_SECRET_ACCESS_KEY_KEY,
  liveDataConfigAvailable,
  liveDataToolEnabled,
  readLiveDataConfig,
} from "./liveDataEnvironment";

function serviceAccount(projectId: string): string {
  return JSON.stringify({ type: "service_account", project_id: projectId });
}

function validEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "development",
    [LIVE_DATA_ACK_KEY]: LIVE_DATA_ACK_VALUE,
    [LIVE_FIREBASE_PROJECT_ID_KEY]: "rwqan-sa",
    [LIVE_FIREBASE_SERVICE_ACCOUNT_KEY]: serviceAccount("rwqan-sa"),
    FIREBASE_SERVICE_ACCOUNT: serviceAccount("rwqan-sa-dev"),
    ...overrides,
  } as NodeJS.ProcessEnv;
}

test("the LIVE data tool is enabled only in development", () => {
  assert.equal(liveDataToolEnabled({ NODE_ENV: "development" } as NodeJS.ProcessEnv), true);
  assert.equal(liveDataToolEnabled({ NODE_ENV: "production" } as NodeJS.ProcessEnv), false);
  assert.equal(liveDataToolEnabled({} as NodeJS.ProcessEnv), false);
});

test("a complete read-only configuration is accepted without R2", () => {
  const { config, reason } = readLiveDataConfig(validEnv());
  assert.ok(config, reason);
  assert.equal(config!.firebase.projectId, "rwqan-sa");
  assert.equal(config!.r2, null);
  assert.equal(liveDataConfigAvailable(validEnv()), true);
});

test("a complete read-only configuration is accepted with R2", () => {
  const { config, reason } = readLiveDataConfig(
    validEnv({
      [LIVE_R2_ENDPOINT_KEY]: "https://acct.r2.cloudflarestorage.com",
      [LIVE_R2_ACCESS_KEY_ID_KEY]: "key-id",
      [LIVE_R2_SECRET_ACCESS_KEY_KEY]: "secret",
      [LIVE_R2_BUCKET_NAME_KEY]: "rwqan-prod-images",
      [LIVE_R2_PUBLIC_URL_KEY]: "https://pub-prod.r2.dev",
    }),
  );
  assert.ok(config, reason);
  assert.equal(config!.r2?.bucketName, "rwqan-prod-images");
  assert.equal(config!.r2?.publicUrl, "https://pub-prod.r2.dev");
});

test("every ambiguous or unsafe configuration fails closed", () => {
  const cases: Array<[string, NodeJS.ProcessEnv]> = [
    ["missing explicit read-only acknowledgement", validEnv({ [LIVE_DATA_ACK_KEY]: undefined })],
    ["wrong acknowledgement value", validEnv({ [LIVE_DATA_ACK_KEY]: "yes" })],
    ["missing production project id", validEnv({ [LIVE_FIREBASE_PROJECT_ID_KEY]: undefined })],
    ["production project equals DEV project", validEnv({ [LIVE_FIREBASE_PROJECT_ID_KEY]: "rwqan-sa-dev" })],
    ["missing dedicated read-only service account", validEnv({ [LIVE_FIREBASE_SERVICE_ACCOUNT_KEY]: undefined })],
    ["service account is not valid JSON", validEnv({ [LIVE_FIREBASE_SERVICE_ACCOUNT_KEY]: "not-json" })],
    ["service account project id mismatch", validEnv({ [LIVE_FIREBASE_SERVICE_ACCOUNT_KEY]: serviceAccount("other-project") })],
    ["service account reuses the broad primary account", validEnv({ FIREBASE_SERVICE_ACCOUNT: serviceAccount("rwqan-sa") })],
  ];

  for (const [label, environment] of cases) {
    const { config, reason } = readLiveDataConfig(environment);
    assert.equal(config, null, `expected ${label} to be refused`);
    assert.ok(reason.length > 0, `expected ${label} to carry a reason`);
    assert.equal(liveDataConfigAvailable(environment), false, label);
  }
});

test("an incomplete R2 block is reported as no image store, not an unsafe config", () => {
  const { config } = readLiveDataConfig(
    validEnv({ [LIVE_R2_ENDPOINT_KEY]: "https://acct.r2.cloudflarestorage.com" }),
  );
  assert.ok(config);
  assert.equal(config!.r2, null);
});
