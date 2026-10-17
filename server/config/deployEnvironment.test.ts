import assert from "node:assert/strict";
import test from "node:test";
import {
  deployPersistenceProjectConfirmed,
  deploySystemEnabled,
} from "./deployEnvironment";

function env(overrides: Record<string, string | undefined>): NodeJS.ProcessEnv {
  return { ...overrides } as NodeJS.ProcessEnv;
}

function serviceAccount(projectId: string): string {
  return JSON.stringify({ project_id: projectId });
}

test("the deploy system is enabled only in development", () => {
  assert.equal(deploySystemEnabled(env({ NODE_ENV: "development" })), true);
  assert.equal(deploySystemEnabled(env({ NODE_ENV: "production" })), false);
  assert.equal(deploySystemEnabled(env({})), false);
});

test("persistence is confirmed only for the isolated DEV project", () => {
  assert.equal(
    deployPersistenceProjectConfirmed(
      env({ FIREBASE_SERVICE_ACCOUNT: serviceAccount("rwqan-sa-dev") }),
    ),
    true,
  );
  // Production-like / unknown projects fail closed.
  assert.equal(
    deployPersistenceProjectConfirmed(
      env({ FIREBASE_SERVICE_ACCOUNT: serviceAccount("rwqan-757") }),
    ),
    false,
  );
  assert.equal(deployPersistenceProjectConfirmed(env({})), false);
  assert.equal(
    deployPersistenceProjectConfirmed(
      env({ FIREBASE_SERVICE_ACCOUNT: "not-json" }),
    ),
    false,
  );
});
