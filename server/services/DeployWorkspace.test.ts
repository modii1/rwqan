import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  parseWorktreeList,
  resolveDeployWorkspace,
} from "./DeployWorkspace";
import { runBranchUploadPreview } from "./DeployGitPushService";

const GIT_AVAILABLE = (() => {
  try {
    execFileSync("git", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

function initRepo(root: string, onTestBranch: boolean): string {
  const repo = path.join(root, "repo");
  execFileSync("git", ["init", "-q", repo], { encoding: "utf8" });
  git(repo, "config", "user.email", "test@example.com");
  git(repo, "config", "user.name", "Test");
  writeFileSync(path.join(repo, "base.txt"), "base");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "base");
  git(repo, "branch", "-M", "main");
  git(repo, "branch", "test/unified-gateway-ui-only");
  if (onTestBranch) {
    git(repo, "switch", "-q", "test/unified-gateway-ui-only");
  }
  return repo;
}

test("parseWorktreeList parses porcelain path and branch entries", () => {
  const parsed = parseWorktreeList(
    [
      "worktree C:/repo",
      "HEAD aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "branch refs/heads/test/unified-gateway-ui-only",
      "",
      "worktree C:/repo-live",
      "HEAD bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      "branch refs/heads/main",
      "",
    ].join("\n")
  );
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].path, "C:/repo");
  assert.equal(parsed[0].branch, "refs/heads/test/unified-gateway-ui-only");
  assert.equal(parsed[1].path, "C:/repo-live");
  assert.equal(parsed[1].branch, "refs/heads/main");
});

test(
  "LIVE uses a separate main worktree and never sees dirty TEST changes",
  { skip: !GIT_AVAILABLE },
  async () => {
    const root = mkdtempSync(path.join(tmpdir(), "rwqan-worktree-"));
    const livePath = path.join(root, "repo-live");
    try {
      const repo = initRepo(root, true);

      // Dirty TEST worktree (the user's 52 changes live here).
      writeFileSync(path.join(repo, "test-only.txt"), "test work");
      writeFileSync(path.join(repo, "base.txt"), "test modified");

      // Resolve both environments. LIVE must create its own sibling worktree.
      const testWorkspace = await resolveDeployWorkspace({
        environment: "TEST",
        repoRoot: repo,
      });
      const liveWorkspace = await resolveDeployWorkspace({
        environment: "LIVE",
        repoRoot: repo,
        liveWorktreePath: livePath,
        // Explicit approval in this test: creating the isolated worktree.
        createLiveWorktree: true,
      });

      assert.equal(testWorkspace.path, repo);
      assert.equal(testWorkspace.branch, "test/unified-gateway-ui-only");
      assert.equal(liveWorkspace.path, livePath);
      assert.equal(liveWorkspace.branch, "main");
      assert.equal(liveWorkspace.created, true);
      assert.equal(git(livePath, "rev-parse", "--abbrev-ref", "HEAD"), "main");
      assert.equal(
        git(repo, "rev-parse", "--abbrev-ref", "HEAD"),
        "test/unified-gateway-ui-only"
      );

      // LIVE worktree gets its own independent change.
      writeFileSync(path.join(livePath, "live-only.txt"), "live work");
      writeFileSync(path.join(livePath, "base.txt"), "live modified");

      const testPreview = await runBranchUploadPreview({
        environment: "TEST",
        cwd: repo,
      });
      const livePreview = await runBranchUploadPreview({
        environment: "LIVE",
        cwd: livePath,
      });

      const testPaths = testPreview.changes.map((change) => change.path);
      const livePaths = livePreview.changes.map((change) => change.path);

      assert.ok(testPaths.includes("test-only.txt"));
      assert.ok(testPaths.includes("base.txt"));
      assert.equal(testPaths.includes("live-only.txt"), false);

      assert.ok(livePaths.includes("live-only.txt"));
      assert.ok(livePaths.includes("base.txt"));
      assert.equal(livePaths.includes("test-only.txt"), false);

      // The dirty TEST worktree is untouched by the LIVE inspection.
      assert.equal(git(repo, "status", "--porcelain").includes("test-only.txt"), true);
      assert.equal(git(repo, "status", "--porcelain").includes("live-only.txt"), false);
    } finally {
      try {
        execFileSync("git", ["worktree", "remove", "--force", livePath], {
          cwd: path.join(root, "repo"),
          stdio: "ignore",
        });
      } catch {
        // Best-effort cleanup.
      }
      rmSync(root, { recursive: true, force: true });
    }
  }
);

test(
  "LIVE does not create a folder without explicit approval",
  { skip: !GIT_AVAILABLE },
  async () => {
    const root = mkdtempSync(path.join(tmpdir(), "rwqan-worktree-"));
    const livePath = path.join(root, "repo-live");
    try {
      const repo = initRepo(root, true);
      await assert.rejects(
        () =>
          resolveDeployWorkspace({
            environment: "LIVE",
            repoRoot: repo,
            liveWorktreePath: livePath,
          }),
        /لم يُنشأ أي مجلد تلقائيًا/
      );
      assert.equal(existsSync(livePath), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
);

test(
  "TEST is refused when no worktree exists on the TEST branch",
  { skip: !GIT_AVAILABLE },
  async () => {
    const root = mkdtempSync(path.join(tmpdir(), "rwqan-worktree-"));
    try {
      const repo = initRepo(root, false); // current branch is main
      await assert.rejects(
        () => resolveDeployWorkspace({ environment: "TEST", repoRoot: repo }),
        /لا توجد مساحة عمل TEST/
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
);

test(
  "LIVE worktree path inside the TEST repo is refused",
  { skip: !GIT_AVAILABLE },
  async () => {
    const root = mkdtempSync(path.join(tmpdir(), "rwqan-worktree-"));
    try {
      const repo = initRepo(root, true);
      await assert.rejects(
        () =>
          resolveDeployWorkspace({
            environment: "LIVE",
            repoRoot: repo,
            liveWorktreePath: path.join(repo, "live-inside"),
          }),
        /خارج مستودع TEST/
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
);
