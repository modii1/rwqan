import assert from "node:assert/strict";
import test from "node:test";
import {
  readDeployGitInfo,
  type DeployGitInfoDependencies,
} from "./DeployGitInfoService";

const COMMIT = "0123456789abcdef0123456789abcdef01234567";

function deps(
  handlers: Record<string, string | (() => never)>,
): DeployGitInfoDependencies {
  return {
    run: async (args) => {
      const key = args.join(" ");
      const value = handlers[key];
      if (value === undefined) throw new Error(`unexpected git args: ${key}`);
      if (typeof value === "function") value();
      return value as string;
    },
  };
}

test("readDeployGitInfo reports a clean checkout with the local HEAD identity", async () => {
  const info = await readDeployGitInfo(
    "/repo",
    deps({
      "rev-parse HEAD": COMMIT,
      "rev-parse --short HEAD": "0123456",
      "rev-parse --abbrev-ref HEAD": "main",
      "status --porcelain --untracked-files=normal": "",
    }),
  );

  assert.equal(info.available, true);
  assert.equal(info.commitSha, COMMIT);
  assert.equal(info.shortSha, "0123456");
  assert.equal(info.branch, "main");
  assert.equal(info.worktree, "clean");
  assert.equal(info.reason, undefined);
});

test("readDeployGitInfo marks a dirty worktree and never treats HEAD as the tree", async () => {
  const info = await readDeployGitInfo(
    "/repo",
    deps({
      "rev-parse HEAD": COMMIT,
      "rev-parse --short HEAD": "0123456",
      "rev-parse --abbrev-ref HEAD": "main",
      "status --porcelain --untracked-files=normal": " M src/app.ts\n?? newfile.txt",
    }),
  );

  assert.equal(info.available, true);
  assert.equal(info.worktree, "dirty");
  assert.ok(info.reason, "a dirty tree must carry an explicit caution");
  assert.match(info.reason ?? "", /شجرة العمل/);
});

test("readDeployGitInfo fails closed when HEAD cannot be read", async () => {
  const info = await readDeployGitInfo(
    "/repo",
    deps({
      "rev-parse HEAD": () => {
        throw new Error("not a git repository");
      },
    }),
  );

  assert.equal(info.available, false);
  assert.equal(info.commitSha, null);
  assert.equal(info.shortSha, null);
  assert.equal(info.branch, null);
  assert.equal(info.worktree, "unknown");
  assert.match(info.reason ?? "", /تعذّرت/);
});

test("readDeployGitInfo reports an empty repository (no commit) without guessing", async () => {
  const info = await readDeployGitInfo(
    "/repo",
    deps({
      "rev-parse HEAD": "",
    }),
  );

  assert.equal(info.available, false);
  assert.equal(info.commitSha, null);
  assert.match(info.reason ?? "", /لا يوجد commit/);
});

test("readDeployGitInfo maps a detached HEAD to a null branch", async () => {
  const info = await readDeployGitInfo(
    "/repo",
    deps({
      "rev-parse HEAD": COMMIT,
      "rev-parse --short HEAD": "0123456",
      "rev-parse --abbrev-ref HEAD": "HEAD",
      "status --porcelain --untracked-files=normal": "",
    }),
  );

  assert.equal(info.available, true);
  assert.equal(info.branch, null);
});

test("readDeployGitInfo falls back to the commit prefix when the short SHA is empty", async () => {
  const info = await readDeployGitInfo(
    "/repo",
    deps({
      "rev-parse HEAD": COMMIT,
      "rev-parse --short HEAD": "",
      "rev-parse --abbrev-ref HEAD": "main",
      "status --porcelain --untracked-files=normal": "",
    }),
  );

  assert.equal(info.shortSha, COMMIT.slice(0, 7));
});

test("readDeployGitInfo reports an unknown worktree when status cannot run", async () => {
  const info = await readDeployGitInfo(
    "/repo",
    deps({
      "rev-parse HEAD": COMMIT,
      "rev-parse --short HEAD": "0123456",
      "rev-parse --abbrev-ref HEAD": "main",
      "status --porcelain --untracked-files=normal": () => {
        throw new Error("status failed");
      },
    }),
  );

  assert.equal(info.available, true);
  assert.equal(info.worktree, "unknown");
});
