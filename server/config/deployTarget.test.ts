import assert from "node:assert/strict";
import test from "node:test";
import {
  DEPLOY_ALLOW_PRODUCTION_ENV_KEY,
  DEPLOY_APP_HOSTING_LOCATION_ENV_KEY,
  DEPLOY_DEV_BACKEND_ID,
  DEPLOY_DEV_BASE_URL,
  DEPLOY_DEV_BASE_URL_ENV_KEY,
  DEPLOY_DEV_PROJECT_ID,
  DEPLOY_LOCAL_BACKEND_ID,
  DEPLOY_LOCAL_PROJECT_ID,
  DEPLOY_PROD_BACKEND_ID,
  DEPLOY_PROD_BASE_URL,
  DEPLOY_PROD_PROJECT_ID,
  DEPLOY_REAL_DEPLOY_ENV_KEY,
  deployTargetBlockers,
  isProductionHost,
  isProductionProjectId,
  productionDeployEnabled,
  realDeployEnabled,
  resolveAppHostingHost,
  resolveDeployTarget,
  type DeployTarget,
} from "./deployTarget";

function target(overrides: Partial<DeployTarget> = {}): DeployTarget {
  return {
    projectId: DEPLOY_DEV_PROJECT_ID,
    backendId: DEPLOY_DEV_BACKEND_ID,
    baseUrl: DEPLOY_DEV_BASE_URL,
    location: "europe-west4",
    ...overrides,
  };
}

function env(overrides: Record<string, string> = {}): NodeJS.ProcessEnv {
  return { NODE_ENV: "development", ...overrides } as unknown as NodeJS.ProcessEnv;
}

test("resolveDeployTarget defaults to the approved TEST target", () => {
  const resolved = resolveDeployTarget("TEST", env());
  assert.equal(resolved.projectId, DEPLOY_DEV_PROJECT_ID);
  assert.equal(resolved.backendId, DEPLOY_DEV_BACKEND_ID);
  assert.equal(resolved.baseUrl, DEPLOY_DEV_BASE_URL);
  assert.equal(resolved.location, "europe-west4");
});

test("resolveDeployTarget resolves the production target for LIVE", () => {
  const resolved = resolveDeployTarget("LIVE", env());
  assert.equal(resolved.projectId, DEPLOY_PROD_PROJECT_ID);
  assert.equal(resolved.backendId, DEPLOY_PROD_BACKEND_ID);
  assert.equal(resolved.baseUrl, DEPLOY_PROD_BASE_URL);
  assert.equal(resolved.location, "europe-west4");
});

test("resolveDeployTarget reads the App Hosting location from env", () => {
  const withLocation = resolveDeployTarget(
    "TEST",
    env({ [DEPLOY_APP_HOSTING_LOCATION_ENV_KEY]: "us-central1" }),
  );
  assert.equal(withLocation.location, "us-central1");
  assert.equal(resolveDeployTarget("TEST", env()).location, "europe-west4");
});

test("TEST target has no blockers when project/backend/baseUrl all match", () => {
  assert.deepEqual(deployTargetBlockers(target()), []);
});

test("TEST refuses production project id rwqan-757", () => {
  // TEST project IS rwqan-757, so this is actually the correct TEST project.
  // But TEST must NOT target production backend rwqan or URL https://rwqan.sa.
  assert.ok(
    deployTargetBlockers(target({ backendId: DEPLOY_PROD_BACKEND_ID })).some(
      (reason) => reason.includes("rwqan-backend") || reason.includes("rwqan"),
    ),
  );
  assert.ok(
    deployTargetBlockers(target({ baseUrl: DEPLOY_PROD_BASE_URL })).some(
      (reason) => reason.includes("https://rwqan.sa") || reason.includes("الإنتاج"),
    ),
  );
});

test("TEST refuses unknown project id", () => {
  assert.ok(
    deployTargetBlockers(target({ projectId: "some-other-project" })).length > 0,
  );
  assert.ok(deployTargetBlockers(target({ projectId: "" })).length > 0);
});

test("TEST refuses production backend id rwqan", () => {
  assert.ok(
    deployTargetBlockers(target({ backendId: DEPLOY_PROD_BACKEND_ID })).some(
      (reason) => reason.includes("rwqan") || reason.includes("الإنتاج"),
    ),
  );
});

test("an empty backend id is refused", () => {
  assert.ok(deployTargetBlockers(target({ backendId: "   " })).length > 0);
});

test("an empty baseUrl is refused for TEST", () => {
  assert.ok(
    deployTargetBlockers(target({ baseUrl: "" })).length > 0,
  );
  assert.ok(
    deployTargetBlockers(target({ baseUrl: "   " })).length > 0,
  );
});

test("TEST refuses production host https://rwqan.sa", () => {
  assert.ok(isProductionHost("https://rwqan.sa"));
  assert.ok(isProductionHost("https://www.rwqan.sa/some/path"));
  assert.ok(
    deployTargetBlockers(target({ baseUrl: DEPLOY_PROD_BASE_URL })).length > 0,
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

test("a LIVE target requires the production project, backend, and host", () => {
  assert.deepEqual(
    deployTargetBlockers(
      target({
        projectId: DEPLOY_PROD_PROJECT_ID,
        backendId: DEPLOY_PROD_BACKEND_ID,
        baseUrl: DEPLOY_PROD_BASE_URL,
      }),
      "LIVE",
    ),
    [],
  );
  assert.ok(deployTargetBlockers(target(), "LIVE").length > 0);
});

test("productionDeployEnabled requires BOTH the real-deploy and production opt-ins", () => {
  assert.equal(
    productionDeployEnabled(
      env({
        [DEPLOY_REAL_DEPLOY_ENV_KEY]: "enabled",
        [DEPLOY_ALLOW_PRODUCTION_ENV_KEY]: "enabled",
      }),
    ),
    true,
  );
  assert.equal(
    productionDeployEnabled(env({ [DEPLOY_REAL_DEPLOY_ENV_KEY]: "enabled" })),
    false,
  );
  assert.equal(
    productionDeployEnabled(env({ [DEPLOY_ALLOW_PRODUCTION_ENV_KEY]: "enabled" })),
    false,
  );
});

test("resolveAppHostingHost derives the App Hosting host from the external convention", () => {
  // The production shape was read from the real App Hosting control plane
  // (read-only, 2026-10-26): https://rwqan-backend--rwqan-757.europe-west4.hosted.app
  assert.equal(
    resolveAppHostingHost({
      projectId: "rwqan-757",
      backendId: "rwqan-backend",
      baseUrl: "https://rwqan.sa",
      location: "europe-west4",
    }),
    "https://rwqan-backend--rwqan-757.europe-west4.hosted.app",
  );
  assert.equal(
    resolveAppHostingHost({
      projectId: DEPLOY_DEV_PROJECT_ID,
      backendId: DEPLOY_DEV_BACKEND_ID,
      baseUrl: null,
      location: "us-central1",
    }),
    "https://rwqan-backend--rwqan-757.us-central1.hosted.app",
  );
});

test("resolveDeployTarget resolves the LOCAL target", () => {
  const resolved = resolveDeployTarget(
    "LOCAL",
    env({ [DEPLOY_DEV_BASE_URL_ENV_KEY]: "http://localhost:3000" }),
  );
  assert.equal(resolved.projectId, DEPLOY_LOCAL_PROJECT_ID);
  assert.equal(resolved.backendId, DEPLOY_LOCAL_BACKEND_ID);
  assert.equal(resolved.baseUrl, "http://localhost:3000");

  const withoutUrl = resolveDeployTarget("LOCAL", env());
  assert.equal(withoutUrl.baseUrl, null);
});

test("LOCAL target refuses production project id", () => {
  // LOCAL environment requires rwqan-local; targeting rwqan-757 (TEST/LIVE project) is refused.
  const blockers = deployTargetBlockers(target({ projectId: DEPLOY_PROD_PROJECT_ID }), "LOCAL");
  assert.ok(blockers.length > 0);
  assert.ok(blockers.some((reason) => reason.includes("محلي") || reason.includes("غير معروف")));
});

test("LOCAL target accepts LOCAL project id", () => {
  assert.deepEqual(
    deployTargetBlockers(
      target({ projectId: DEPLOY_LOCAL_PROJECT_ID, backendId: DEPLOY_LOCAL_BACKEND_ID }),
      "LOCAL",
    ),
    [],
  );
});

test("LOCAL target refuses unknown project", () => {
  assert.ok(
    deployTargetBlockers(target({ projectId: "unknown-project" }), "LOCAL").length > 0,
  );
});

test("resolveAppHostingHost fails closed without a verified location", () => {
  // No location is KNOWN → no host is invented (the UI must show غير متحقق).
  assert.equal(
    resolveAppHostingHost({
      projectId: DEPLOY_DEV_PROJECT_ID,
      backendId: DEPLOY_DEV_BACKEND_ID,
      baseUrl: null,
      location: null,
    }),
    null,
  );
  assert.equal(
    resolveAppHostingHost({
      projectId: "",
      backendId: DEPLOY_DEV_BACKEND_ID,
      baseUrl: null,
      location: "us-central1",
    }),
    null,
  );
  assert.equal(
    resolveAppHostingHost({
      projectId: DEPLOY_DEV_PROJECT_ID,
      backendId: "   ",
      baseUrl: null,
      location: "us-central1",
    }),
    null,
  );
});
