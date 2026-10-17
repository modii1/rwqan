import assert from "node:assert/strict";
import test from "node:test";
import { DEPLOY_PROTOTYPE_VERSION } from "../../shared/deploySystem";
import {
  DEPLOY_VERSION_APP_VERSION_ENV,
  DEPLOY_VERSION_COMMIT_ENV,
  resolveDeployVersionInfo,
} from "./DeployVersionService";

const SHA = "a".repeat(40);
const OTHER = "b".repeat(40);

function env(values: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return values as unknown as NodeJS.ProcessEnv;
}

test("uses the build-injected commit env var when it is a full SHA", async () => {
  const info = await resolveDeployVersionInfo({
    environment: env({ [DEPLOY_VERSION_COMMIT_ENV]: SHA.toUpperCase() }),
    readGitCommit: async () => {
      throw new Error("local git must not be consulted when env is trusted");
    },
  });
  assert.equal(info.commit, SHA);
  assert.equal(info.commitSource, "env");
});

test("falls back to the read-only local Git HEAD only in local development", async () => {
  const info = await resolveDeployVersionInfo({
    environment: env({ NODE_ENV: "development" }),
    readGitCommit: async () => OTHER,
  });
  assert.equal(info.commit, OTHER);
  assert.equal(info.commitSource, "git");
});

test("in a production runtime the local Git HEAD is never used as a version proof", async () => {
  const info = await resolveDeployVersionInfo({
    environment: env({ NODE_ENV: "production" }),
    readGitCommit: async () => {
      throw new Error("local git must not be consulted in a production runtime");
    },
  });
  assert.equal(info.commit, null);
  assert.equal(info.commitSource, "unknown");
});

test("rejects a non-SHA commit env value instead of trusting it", async () => {
  const info = await resolveDeployVersionInfo({
    environment: env({ [DEPLOY_VERSION_COMMIT_ENV]: "deadbeef" }),
    readGitCommit: async () => null,
  });
  assert.equal(info.commit, null);
  assert.equal(info.commitSource, "unknown");
});

test("never invents a commit and defaults the version to the prototype id", async () => {
  const info = await resolveDeployVersionInfo({
    environment: env({ NODE_ENV: "development" }),
    readGitCommit: async () => null,
  });
  assert.equal(info.commit, null);
  assert.equal(info.commitSource, "unknown");
  assert.equal(info.version, DEPLOY_PROTOTYPE_VERSION);
  assert.equal(info.versionSource, "default");
});

test("uses an explicit app version env var when present", async () => {
  const info = await resolveDeployVersionInfo({
    environment: env({ [DEPLOY_VERSION_APP_VERSION_ENV]: "1.2.3" }),
    readGitCommit: async () => null,
  });
  assert.equal(info.version, "1.2.3");
  assert.equal(info.versionSource, "env");
});

test("fails closed when reading the local Git HEAD throws", async () => {
  const info = await resolveDeployVersionInfo({
    environment: env({ NODE_ENV: "development" }),
    readGitCommit: async () => {
      throw new Error("no git repository");
    },
  });
  assert.equal(info.commit, null);
  assert.equal(info.commitSource, "unknown");
});
