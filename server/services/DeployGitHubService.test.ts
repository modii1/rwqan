import assert from "node:assert/strict";
import test from "node:test";
import {
  githubLsRemoteEnabled,
  readDeployGitHubInfo,
  type DeployGitHubDependencies,
} from "./DeployGitHubService";

const LOCAL = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const REMOTE = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function deps(
  handlers: Record<string, string | (() => never)>,
): DeployGitHubDependencies {
  return {
    run: async (args) => {
      const key = args.join(" ");
      const value = handlers[key];
      if (value === undefined) throw new Error(`unexpected git args: ${key}`);
      if (typeof value === "function") value();
      return value as string;
    },
    lsRemote: async (args) => {
      const key = `ls-remote ${args.join(" ")}`;
      const value = handlers[key];
      if (value === undefined) throw new Error(`unexpected ls-remote args: ${key}`);
      if (typeof value === "function") value();
      return value as string;
    },
  };
}

const REMOTE_URL = "https://github.com/iheeb1/rwqan-sa.git";

test("githubLsRemoteEnabled is off unless explicitly enabled", () => {
  assert.equal(githubLsRemoteEnabled({}), false);
  assert.equal(githubLsRemoteEnabled({ DEPLOY_GITHUB_LS_REMOTE: "yes" }), false);
  assert.equal(githubLsRemoteEnabled({ DEPLOY_GITHUB_LS_REMOTE: "enabled" }), true);
});

test("readDeployGitHubInfo matches the local HEAD against the local tracking ref", async () => {
  const info = await readDeployGitHubInfo({
    cwd: "/repo",
    localSha: LOCAL,
    branch: "main",
    dependencies: deps({
      "config --get remote.origin.url": REMOTE_URL,
      "rev-parse refs/remotes/origin/main": LOCAL,
    }),
  });

  assert.equal(info.available, true);
  assert.equal(info.match, "match");
  assert.equal(info.source, "local_ref");
  assert.equal(info.remoteUrl, REMOTE_URL);
  assert.equal(info.remoteSha, LOCAL);
});

test("readDeployGitHubInfo reports a mismatch against the local tracking ref", async () => {
  const info = await readDeployGitHubInfo({
    cwd: "/repo",
    localSha: LOCAL,
    branch: "main",
    dependencies: deps({
      "config --get remote.origin.url": REMOTE_URL,
      "rev-parse refs/remotes/origin/main": REMOTE,
    }),
  });

  assert.equal(info.available, true);
  assert.equal(info.match, "mismatch");
  assert.equal(info.source, "local_ref");
});

test("readDeployGitHubInfo sanitizes credentials out of the remote URL", async () => {
  const info = await readDeployGitHubInfo({
    cwd: "/repo",
    localSha: LOCAL,
    branch: "main",
    dependencies: deps({
      "config --get remote.origin.url":
        "https://user:secret-token@github.com/iheeb1/rwqan-sa.git",
      "rev-parse refs/remotes/origin/main": LOCAL,
    }),
  });

  assert.equal(info.remoteUrl, REMOTE_URL);
  assert.ok(!info.remoteUrl?.includes("secret-token"));
});

test("readDeployGitHubInfo fails to unavailable when there is no origin remote", async () => {
  const info = await readDeployGitHubInfo({
    cwd: "/repo",
    localSha: LOCAL,
    branch: "main",
    dependencies: deps({
      "config --get remote.origin.url": () => {
        throw new Error("no remote");
      },
    }),
  });

  assert.equal(info.available, false);
  assert.equal(info.match, "unavailable");
  assert.equal(info.source, "none");
  assert.equal(info.remoteUrl, null);
});

test("readDeployGitHubInfo stays offline when no tracking ref exists and ls-remote is disabled", async () => {
  const info = await readDeployGitHubInfo({
    cwd: "/repo",
    localSha: LOCAL,
    branch: "main",
    dependencies: deps({
      "config --get remote.origin.url": REMOTE_URL,
      "rev-parse refs/remotes/origin/main": () => {
        throw new Error("no tracking ref");
      },
    }),
  });

  assert.equal(info.available, false);
  assert.equal(info.match, "unavailable");
  assert.equal(info.source, "none");
  assert.equal(info.remoteSha, null);
  assert.match(info.reason ?? "", /ls-remote/);
});

test("readDeployGitHubInfo uses read-only ls-remote only when enabled", async () => {
  const info = await readDeployGitHubInfo({
    cwd: "/repo",
    localSha: LOCAL,
    branch: "main",
    allowLsRemote: true,
    dependencies: deps({
      "config --get remote.origin.url": REMOTE_URL,
      "rev-parse refs/remotes/origin/main": () => {
        throw new Error("no tracking ref");
      },
      "ls-remote ls-remote origin refs/heads/main": `${LOCAL}\trefs/heads/main`,
    }),
  });

  assert.equal(info.available, true);
  assert.equal(info.match, "match");
  assert.equal(info.source, "ls_remote");
});

test("readDeployGitHubInfo fails closed when ls-remote fails", async () => {
  const info = await readDeployGitHubInfo({
    cwd: "/repo",
    localSha: LOCAL,
    branch: "main",
    allowLsRemote: true,
    dependencies: deps({
      "config --get remote.origin.url": REMOTE_URL,
      "rev-parse refs/remotes/origin/main": () => {
        throw new Error("no tracking ref");
      },
      "ls-remote ls-remote origin refs/heads/main": () => {
        throw new Error("network down");
      },
    }),
  });

  assert.equal(info.available, false);
  assert.equal(info.match, "unavailable");
  assert.equal(info.source, "none");
});

test("readDeployGitHubInfo reports unavailable with no origin remote", async () => {
  const info = await readDeployGitHubInfo({
    cwd: "/repo",
    localSha: LOCAL,
    branch: "main",
    dependencies: deps({
      "config --get remote.origin.url": () => {
        throw new Error("no remote");
      },
    }),
  });

  assert.equal(info.source, "none");
  assert.match(info.reason ?? "", /remote/);
});
