import assert from "node:assert/strict";
import test from "node:test";
import {
  createAppHostingBuildSourceClient,
  createAppHostingVerifyDependency,
  verifyAppHostingBuildSource,
  resolveAppHostingVerifyConfig,
  DEPLOY_APP_HOSTING_LOCATION_ENV_KEY,
  DEPLOY_BUILD_SOURCE_VERIFY_ENV_KEY,
  type AppHostingApiLike,
  type AppHostingBackendRef,
  type AppHostingBuildSource,
  type AppHostingBuildSourceClient,
  type AppHostingSourceKind,
  type AppHostingTrafficState,
} from "./DeployBuildSourceService";

const SHA = "a".repeat(40);
const OTHER = "b".repeat(40);
const BACKEND: AppHostingBackendRef = {
  projectId: "rwqan-sa-dev",
  backendId: "rwqan-dev-backend",
  location: "us-central1",
};
const NOW = () => "2026-01-01T00:00:00.000Z";

function sourceClient(input: {
  commitSha?: string | null;
  sourceKind?: AppHostingSourceKind;
  state?: AppHostingTrafficState;
  buildName?: string | null;
}): AppHostingBuildSourceClient {
  return {
    async getServingBuildSource(): Promise<AppHostingBuildSource> {
      return {
        commitSha: input.commitSha ?? null,
        sourceKind: input.sourceKind ?? "unknown",
        buildName: input.buildName ?? null,
        state: input.state ?? "ready",
      };
    },
  };
}

test("a ready codebase source whose hash matches the expected commit verifies", async () => {
  const result = await verifyAppHostingBuildSource(
    { expectedCommit: SHA, backend: BACKEND },
    sourceClient({ commitSha: SHA, sourceKind: "codebase", state: "ready" }),
    NOW,
  );
  assert.equal(result.ok, true);
  assert.equal(result.attempted, true);
  assert.equal(result.reportedCommit, SHA);
  assert.equal(result.sourceKind, "codebase");
});

test("a mismatch between the serving build source and expected commit fails closed", async () => {
  const result = await verifyAppHostingBuildSource(
    { expectedCommit: SHA, backend: BACKEND },
    sourceClient({ commitSha: OTHER, sourceKind: "codebase", state: "ready" }),
    NOW,
  );
  assert.equal(result.ok, false);
  assert.ok(result.reason?.includes("لا يطابق"));
});

test("a reconciling traffic state fails closed and never uses a guessed build", async () => {
  const result = await verifyAppHostingBuildSource(
    { expectedCommit: SHA, backend: BACKEND },
    sourceClient({ commitSha: SHA, sourceKind: "codebase", state: "reconciling" }),
    NOW,
  );
  assert.equal(result.ok, false);
  assert.equal(result.attempted, true);
  assert.ok(result.reason?.includes("المزامنة"));
});

test("a no-traffic state fails closed", async () => {
  const result = await verifyAppHostingBuildSource(
    { expectedCommit: SHA, backend: BACKEND },
    sourceClient({ state: "no-traffic", sourceKind: "unknown" }),
    NOW,
  );
  assert.equal(result.ok, false);
  assert.ok(result.reason?.includes("100%"));
});

test("an ambiguous (multiple 100%) traffic state fails closed", async () => {
  const result = await verifyAppHostingBuildSource(
    { expectedCommit: SHA, backend: BACKEND },
    sourceClient({ state: "ambiguous", sourceKind: "unknown" }),
    NOW,
  );
  assert.equal(result.ok, false);
  assert.ok(result.reason?.includes("ملتبسة"));
});

test("an archive (local source) build carries no commit and never verifies", async () => {
  const result = await verifyAppHostingBuildSource(
    { expectedCommit: SHA, backend: BACKEND },
    sourceClient({ commitSha: null, sourceKind: "archive", state: "ready" }),
    NOW,
  );
  assert.equal(result.ok, false);
  assert.equal(result.sourceKind, "archive");
  assert.ok(result.reason?.includes("archive"));
});

test("a non-full reported hash is not accepted as proof", async () => {
  const result = await verifyAppHostingBuildSource(
    { expectedCommit: SHA, backend: BACKEND },
    sourceClient({ commitSha: SHA.slice(0, 7), sourceKind: "codebase", state: "ready" }),
    NOW,
  );
  assert.equal(result.ok, false);
  assert.ok(result.reason?.includes("SHA"));
});

test("a malformed expected commit is refused before any read", async () => {
  let called = false;
  const result = await verifyAppHostingBuildSource(
    { expectedCommit: "deadbeef", backend: BACKEND },
    {
      getServingBuildSource: async () => {
        called = true;
        return { commitSha: SHA, sourceKind: "codebase", buildName: null, state: "ready" };
      },
    },
    NOW,
  );
  assert.equal(result.attempted, false);
  assert.equal(result.ok, false);
  assert.equal(called, false);
});

test("a control-plane read error fails closed", async () => {
  const result = await verifyAppHostingBuildSource(
    { expectedCommit: SHA, backend: BACKEND },
    {
      getServingBuildSource: async () => {
        throw new Error("permission denied");
      },
    },
    NOW,
  );
  assert.equal(result.ok, false);
  assert.equal(result.attempted, true);
  assert.ok(result.reason);
});

test("verification is disabled unless explicitly enabled with a location", () => {
  assert.equal(resolveAppHostingVerifyConfig({}).enabled, false);
  assert.equal(
    resolveAppHostingVerifyConfig({ [DEPLOY_BUILD_SOURCE_VERIFY_ENV_KEY]: "enabled" })
      .enabled,
    false,
  );
  const enabled = resolveAppHostingVerifyConfig({
    [DEPLOY_BUILD_SOURCE_VERIFY_ENV_KEY]: "enabled",
    [DEPLOY_APP_HOSTING_LOCATION_ENV_KEY]: "us-central1",
  });
  assert.equal(enabled.enabled, true);
  assert.equal(enabled.location, "us-central1");
});

test("the dependency is undefined when disabled and wired when enabled", async () => {
  assert.equal(createAppHostingVerifyDependency({}), undefined);

  let seenLocation = "";
  const dep = createAppHostingVerifyDependency(
    {
      [DEPLOY_BUILD_SOURCE_VERIFY_ENV_KEY]: "enabled",
      [DEPLOY_APP_HOSTING_LOCATION_ENV_KEY]: "us-central1",
    },
    {
      getServingBuildSource: async (backend) => {
        seenLocation = backend.location;
        return { commitSha: SHA, sourceKind: "codebase", buildName: "b", state: "ready" };
      },
    },
  );
  assert.ok(dep);
  const result = await dep!({
    expectedCommit: SHA,
    projectId: BACKEND.projectId,
    backendId: BACKEND.backendId,
  });
  assert.equal(result.ok, true);
  assert.equal(seenLocation, "us-central1");
});

function apiWith(traffic: unknown, buildSource: unknown): AppHostingApiLike {
  return {
    projects: {
      locations: {
        backends: {
          traffic: {
            get: async () => ({ data: traffic as never }),
          },
          builds: {
            get: async () => ({ data: { source: buildSource as never } }),
          },
        },
      },
    },
  };
}

test("the real client verifies only when a single 100% split serves the commit", async () => {
  const api = apiWith(
    { reconciling: false, current: { splits: [{ build: "builds/b1", percent: 100 }] } },
    { codebase: { hash: SHA } },
  );
  const client = createAppHostingBuildSourceClient({ api });
  const source = await client.getServingBuildSource(BACKEND);
  assert.equal(source.state, "ready");
  assert.equal(source.sourceKind, "codebase");
  assert.equal(source.commitSha, SHA);
  assert.equal(source.buildName, "builds/b1");
});

test("the real client ignores rollouts and fails closed while reconciling", async () => {
  const api = apiWith(
    { reconciling: true, current: { splits: [{ build: "builds/b1", percent: 100 }] } },
    { codebase: { hash: SHA } },
  );
  const client = createAppHostingBuildSourceClient({ api });
  const source = await client.getServingBuildSource(BACKEND);
  assert.equal(source.state, "reconciling");
  assert.equal(source.commitSha, null);
});

test("the real client reports no-traffic when no split is at 100%", async () => {
  const api = apiWith(
    { reconciling: false, current: { splits: [{ build: "builds/b1", percent: 50 }] } },
    { codebase: { hash: SHA } },
  );
  const client = createAppHostingBuildSourceClient({ api });
  const source = await client.getServingBuildSource(BACKEND);
  assert.equal(source.state, "no-traffic");
});

test("the real client reports ambiguous when multiple splits are at 100%", async () => {
  const api = apiWith(
    {
      reconciling: false,
      current: {
        splits: [
          { build: "builds/b1", percent: 100 },
          { build: "builds/b2", percent: 100 },
        ],
      },
    },
    { codebase: { hash: SHA } },
  );
  const client = createAppHostingBuildSourceClient({ api });
  const source = await client.getServingBuildSource(BACKEND);
  assert.equal(source.state, "ambiguous");
});

test("the real client reports an archive serving build with no commit", async () => {
  const api = apiWith(
    { reconciling: false, current: { splits: [{ build: "builds/b1", percent: 100 }] } },
    { archive: {} },
  );
  const client = createAppHostingBuildSourceClient({ api });
  const source = await client.getServingBuildSource(BACKEND);
  assert.equal(source.state, "ready");
  assert.equal(source.sourceKind, "archive");
  assert.equal(source.commitSha, null);
});
