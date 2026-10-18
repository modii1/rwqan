import { test } from "node:test";
import assert from "node:assert";
import { assertE2ETargetIsDevelopment } from "../src/guards";

test("assertE2ETargetIsDevelopment validates dev env", () => {
  const env = {
    NODE_ENV: "development",
    PUBLIC_BASE_URL: "http://localhost:5001",
    FIREBASE_DEV_PROJECT_ID: "rwqan-sa-dev",
    ALLOW_EXTERNAL_SERVICES_IN_DEVELOPMENT: "false",
    R2_BUCKET_NAME: "rwqan-sa-dev",
    R2_PUBLIC_URL: "https://example-dev.r2.dev",
    SESSION_SECRET: "a".repeat(32),
    ADMIN_CODE: "test",
    ADMIN_PASSWORD: "test",
  } as NodeJS.ProcessEnv;
  const result = assertE2ETargetIsDevelopment(env);
  assert.strictEqual(result.ok, true);
});
