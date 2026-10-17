import assert from "node:assert/strict";
import test from "node:test";
import {
  DEPLOY_APP_HOSTING_LOCATION_ENV_KEY,
  DEPLOY_DEV_BACKEND_ID,
  DEPLOY_DEV_BASE_URL_ENV_KEY,
  DEPLOY_DEV_PROJECT_ID,
  DEPLOY_REAL_DEPLOY_ENV_KEY,
  deployTargetBlockers,
  isProductionHost,
  isProductionProjectId,
  realDeployEnabled,
  resolveDeployTarget,
  type DeployTarget,
} from "./deployTarget";

function target(overrides: Partial<DeployTarget> = {}): DeployTarget {
  return {
    projectId: DEPLOY_DEV_PROJECT_ID,
    backendId: DEPLOY_DEV_BACKEND_ID,
    baseUrl: null,
    location: "us-central1",
    ...overrides,
  };
}

function env(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { NODE_ENV: "development", ...overrides } as unknown as NodeJS.ProcessEnv;
}

test("resolveDeployTarget always returns the fixed isolated DEV target", () => {
  const resolved = resolveDeployTarget(
    env({ [DEPLOY_DEV_BASE_URL_ENV_KEY]: "https://rwqan-sa-dev.web.app" }),
  );
  assert.equal(resolved.projectId, DEPLOY_DEV_PROJECT_ID);
  assert.equal(resolved.backendId, DEPLOY_DEV_BACKEND_ID);
  assert.equal(resolved.baseUrl, "https://rwqan-sa-dev.web.app");

  const withoutUrl = resolveDeployTarget(env());
  assert.equal(withoutUrl.baseUrl, null);
});

test("resolveDeployTarget reads the App Hosting location and defaults it to null", () => {
  const withLocation = resolveDeployTarget(
    env({ [DEPLOY_APP_HOSTING_LOCATION_ENV_KEY]: "europe-west1" }),
  );
  assert.equal(withLocation.location, "europe-west1");
  assert.equal(resolveDeployTarget(env()).location, null);
});

test("the isolated DEV target has no blockers", () => {
  assert.deepEqual(deployTargetBlockers(target()), []);
});

test("a production or unknown project is refused", () => {
  assert.ok(
    deployTargetBlockers(target({ projectId: "rwqan-757" })).some((reason) =>
      reason.includes("الإنتاج"),
    ),
  );
  assert.ok(
    deployTargetBlockers(target({ projectId: "some-other-project" })).length > 0,
  );
  assert.ok(deployTargetBlockers(target({ projectId: "" })).length > 0);
});

test("an empty backend id is refused", () => {
  assert.ok(deployTargetBlockers(target({ backendId: "   " })).length > 0);
});

test("a production verification host is refused", () => {
  assert.ok(isProductionHost("https://rwqan.sa"));
  assert.ok(isProductionHost("https://www.rwqan.sa/some/path"));
  assert.equal(isProductionHost("https://rwqan-sa-dev.web.app"), false);
  assert.ok(
    deployTargetBlockers(target({ baseUrl: "https://rwqan.sa" })).length > 0,
  );
});

test("isProductionProjectId only matches the known production project", () => {
  assert.equal(isProductionProjectId("rwqan-757"), true);
  assert.equal(isProductionProjectId("rwqan-sa-dev"), false);
  assert.equal(isProductionProjectId("unknown"), false);
});

test("realDeployEnabled requires development AND the explicit opt-in", () => {
  assert.equal(
    realDeployEnabled(env({ [DEPLOY_REAL_DEPLOY_ENV_KEY]: "enabled" })),
    true,
  );
  assert.equal(realDeployEnabled(env()), false);
  assert.equal(
    realDeployEnabled(
      env({ NODE_ENV: "production", [DEPLOY_REAL_DEPLOY_ENV_KEY]: "enabled" }),
    ),
    false,
  );
  assert.equal(
    realDeployEnabled(env({ [DEPLOY_REAL_DEPLOY_ENV_KEY]: "true" })),
    false,
  );
});
