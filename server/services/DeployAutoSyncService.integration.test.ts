import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync, spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  runCheckCommand,
  runLiveSync,
  runLiveSyncPreflight,
  runTestAutoSync,
} from "./DeployAutoSyncService";
import { resolveDeployWorkspace } from "./DeployWorkspace";
import {
  APPROVED_UPLOAD_BRANCH_TEST,
  type DeployWorkspaceInfo,
} from "../../shared/deploySystem";

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

function gitAllowFail(cwd: string, ...args: string[]): string {
  try {
    return git(cwd, ...args);
  } catch {
    return "";
  }
}

function initRepo(root: string): string {
  const repo = path.join(root, "repo");
  execFileSync("git", ["init", "-q", repo], { encoding: "utf8" });
  git(repo, "config", "user.email", "test@example.com");
  git(repo, "config", "user.name", "Test");
  writeFileSync(path.join(repo, "base.txt"), "base");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "base");
  git(repo, "branch", "-M", "main");
  git(repo, "branch", APPROVED_UPLOAD_BRANCH_TEST);
  git(repo, "switch", "-q", APPROVED_UPLOAD_BRANCH_TEST);
  return repo;
}

function fakeChecks() {
  return {
    typecheck: async () => ({ ok: true, detail: "typecheck ok" }),
    tests: async () => ({ ok: true, detail: "tests ok" }),
    build: async () => ({ ok: true, detail: "build ok" }),
  };
}

function fakeRemote() {
  const pushes: string[][] = [];
  return {
    pushes,
    push: async (args: string[]) => {
      pushes.push(args);
      return "";
    },
    lsRemote: async (args: string[], cwd: string) => {
      const ref = args[args.length - 1] ?? "";
      const sha = git(cwd, "rev-parse", "HEAD");
      return `${sha}\t${ref}`;
    },
  };
}

test(
  "temp repo: LIVE receives only approved code, never uncommitted TEST files",
  { skip: !GIT_AVAILABLE },
  async () => {
    const root = mkdtempSync(path.join(tmpdir(), "rwqan-sync-int-"));
    const livePath = path.join(root, "live");
    try {
      const repo = initRepo(root);

      // Approved committed work on TEST.
      mkdirSync(path.join(repo, "server/services"), { recursive: true });
      mkdirSync(path.join(repo, "src"), { recursive: true });
      mkdirSync(path.join(repo, "server/config"), { recursive: true });
      mkdirSync(path.join(repo, "docs"), { recursive: true });
      writeFileSync(path.join(repo, "server/services/app.ts"), "export const a = 1;\n");
      writeFileSync(path.join(repo, "src/feature.ts"), "export const b = 2;\n");
      writeFileSync(
        path.join(repo, "server/config/dataEnvironment.ts"),
        "export const env = 'test-only';\n"
      );
      writeFileSync(path.join(repo, "docs/GUIDE.md"), "test docs\n");
      git(repo, "add", "-A");
      git(repo, "commit", "-q", "-m", "approved test work");

      // Uncommitted TEST-only file: must never reach LIVE.
      writeFileSync(path.join(repo, "test-only.txt"), "not approved\n");

      const testWorkspace = await resolveDeployWorkspace({
        environment: "TEST",
        repoRoot: repo,
      });
      const liveWorkspace = await resolveDeployWorkspace({
        environment: "LIVE",
        repoRoot: repo,
        liveWorktreePath: livePath,
        createLiveWorktree: true,
      });
      // Simulate the pre-installed dependencies in the existing LIVE worktree.
      mkdirSync(path.join(liveWorkspace.path, "node_modules"), { recursive: true });

      const remote = fakeRemote();
      const dependencies = {
        checks: fakeChecks(),
        push: remote.push,
        lsRemote: remote.lsRemote,
      };

      const preflight = await runLiveSyncPreflight({
        testWorkspace,
        liveWorkspace,
        dependencies,
      });
      assert.equal(preflight.canSync, true);
      assert.equal(preflight.approvedCount, 2);
      assert.equal(preflight.counts.total, 2);

      const result = await runLiveSync({
        testWorkspace,
        liveWorkspace,
        token: preflight.token,
        confirm: true,
        dependencies,
      });
      assert.equal(result.ok, true);
      assert.equal(result.pushed, true);
      assert.equal(result.changeCount, 2);
      assert.deepEqual(remote.pushes, [["push", "origin", "main"]]);

      // Approved code arrived in LIVE.
      assert.equal(
        existsSync(path.join(liveWorkspace.path, "server/services/app.ts")),
        true
      );
      assert.equal(existsSync(path.join(liveWorkspace.path, "src/feature.ts")), true);
      // Excluded config/docs and the uncommitted TEST file did NOT arrive.
      assert.equal(
        existsSync(path.join(liveWorkspace.path, "server/config/dataEnvironment.ts")),
        false
      );
      assert.equal(existsSync(path.join(liveWorkspace.path, "docs/GUIDE.md")), false);
      assert.equal(existsSync(path.join(liveWorkspace.path, "test-only.txt")), false);

      const committedFiles = git(
        liveWorkspace.path,
        "show",
        "--pretty=format:",
        "--name-only",
        "HEAD"
      )
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .sort();
      assert.deepEqual(committedFiles, ["server/services/app.ts", "src/feature.ts"]);

      // The uncommitted TEST change is still present in TEST.
      assert.equal(
        git(repo, "status", "--porcelain").includes("test-only.txt"),
        true
      );
      // LIVE is clean after its commit.
      assert.equal(git(liveWorkspace.path, "status", "--porcelain"), "");
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
  "temp repo: a real failing check stops the sync before Commit/Push",
  { skip: !GIT_AVAILABLE },
  async () => {
    const root = mkdtempSync(path.join(tmpdir(), "rwqan-sync-int-"));
    try {
      const repo = initRepo(root);
      const baseHead = git(repo, "rev-parse", "HEAD");
      mkdirSync(path.join(repo, "src"), { recursive: true });
      writeFileSync(path.join(repo, "src/a.ts"), "export const a = 1;\n");

      const remote = fakeRemote();
      const result = await runTestAutoSync({
        workspace: {
          environment: "TEST",
          branch: APPROVED_UPLOAD_BRANCH_TEST,
          path: repo,
          label: "TEST",
          created: false,
        },
        dependencies: {
          checks: {
            typecheck: () =>
              runCheckCommand(process.execPath, ["-e", "process.exit(0)"], repo, 30_000),
            tests: () =>
              runCheckCommand(process.execPath, ["-e", "process.exit(1)"], repo, 30_000),
            build: () =>
              runCheckCommand(process.execPath, ["-e", "process.exit(0)"], repo, 30_000),
          },
          push: remote.push,
          lsRemote: remote.lsRemote,
        },
      });

      assert.equal(result.ok, false);
      assert.equal(result.stage, "checks");
      assert.match(result.detail, /فشل الفحص/);
      assert.equal(git(repo, "rev-parse", "HEAD"), baseHead);
      assert.equal(remote.pushes.length, 0);
      assert.equal(
        git(repo, "status", "--porcelain", "--untracked-files=all").includes(
          "src/a.ts"
        ),
        true
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
);

test(
  "temp repo: 3-way merge keeps Arabic, CRLF and trailing whitespace, and changes only approved files",
  { skip: !GIT_AVAILABLE },
  async () => {
    const root = mkdtempSync(path.join(tmpdir(), "rwqan-sync-int-"));
    const livePath = path.join(root, "live");
    try {
      const repo = path.join(root, "repo");
      execFileSync("git", ["init", "-q", repo], { encoding: "utf8" });
      git(repo, "config", "user.email", "test@example.com");
      git(repo, "config", "user.name", "Test");
      git(repo, "config", "core.autocrlf", "false");
      mkdirSync(path.join(repo, "server"), { recursive: true });
      writeFileSync(
        path.join(repo, "server/shared.ts"),
        "lineA\nlineB\nlineC\n"
      );
      writeFileSync(
        path.join(repo, "server/conflict.ts"),
        'export const value = "base";\n'
      );
      git(repo, "add", "-A");
      git(repo, "commit", "-q", "-m", "base");
      git(repo, "branch", "-M", "main");
      git(repo, "branch", APPROVED_UPLOAD_BRANCH_TEST);

      // LIVE-specific change on main.
      writeFileSync(
        path.join(repo, "server/shared.ts"),
        "lineA-live\nlineB\nlineC\n"
      );
      git(repo, "add", "-A");
      git(repo, "commit", "-q", "-m", "live lineA");

      // TEST-specific changes on a different line + Arabic/CRLF/trailing ws.
      git(repo, "switch", "-q", APPROVED_UPLOAD_BRANCH_TEST);
      writeFileSync(
        path.join(repo, "server/shared.ts"),
        "lineA\nlineB\nlineC-test\n"
      );
      mkdirSync(path.join(repo, "src"), { recursive: true });
      writeFileSync(
        path.join(repo, "src/arabic.ts"),
        "// نص عربي\nconst x = 1;   \n"
      );
      writeFileSync(
        path.join(repo, "src/crlf.ts"),
        "first\r\nsecond\r\n"
      );
      mkdirSync(path.join(repo, "docs"), { recursive: true });
      writeFileSync(path.join(repo, "docs/GUIDE.md"), "not for LIVE\n");
      git(repo, "add", "-A");
      git(repo, "commit", "-q", "-m", "test changes");

      const testWorkspace = await resolveDeployWorkspace({
        environment: "TEST",
        repoRoot: repo,
      });
      const liveWorkspace = await resolveDeployWorkspace({
        environment: "LIVE",
        repoRoot: repo,
        liveWorktreePath: livePath,
        createLiveWorktree: true,
      });
      mkdirSync(path.join(liveWorkspace.path, "node_modules"), {
        recursive: true,
      });

      const remote = fakeRemote();
      const dependencies = {
        checks: fakeChecks(),
        push: remote.push,
        lsRemote: remote.lsRemote,
      };

      const preflight = await runLiveSyncPreflight({
        testWorkspace,
        liveWorkspace,
        dependencies,
      });
      assert.equal(preflight.canSync, true, preflight.blockedReason ?? "");
      const result = await runLiveSync({
        testWorkspace,
        liveWorkspace,
        token: preflight.token,
        confirm: true,
        dependencies,
      });
      assert.equal(result.ok, true, result.detail);
      assert.equal(result.changeCount, 3);

      const shared = readFileSync(
        path.join(liveWorkspace.path, "server/shared.ts"),
        "utf8"
      );
      assert.match(shared, /lineA-live/);
      assert.match(shared, /lineC-test/);

      const arabic = readFileSync(
        path.join(liveWorkspace.path, "src/arabic.ts"),
        "utf8"
      );
      assert.match(arabic, /نص عربي/);
      assert.match(arabic, /const x = 1;   \n/);

      const crlf = readFileSync(
        path.join(liveWorkspace.path, "src/crlf.ts"),
        "utf8"
      );
      assert.match(crlf, /\r\n/);

      assert.equal(existsSync(path.join(liveWorkspace.path, "docs/GUIDE.md")), false);
      const changed = git(
        liveWorkspace.path,
        "show",
        "--pretty=format:",
        "--name-only",
        "HEAD"
      )
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .sort();
      assert.deepEqual(changed, [
        "server/shared.ts",
        "src/arabic.ts",
        "src/crlf.ts",
      ]);
      assert.equal(git(liveWorkspace.path, "status", "--porcelain"), "");
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
  "temp repo: a real 3-way conflict in LIVE blocks the preflight and changes 0 files",
  { skip: !GIT_AVAILABLE },
  async () => {
    const root = mkdtempSync(path.join(tmpdir(), "rwqan-sync-int-"));
    const livePath = path.join(root, "live");
    try {
      const repo = path.join(root, "repo");
      execFileSync("git", ["init", "-q", repo], { encoding: "utf8" });
      git(repo, "config", "user.email", "test@example.com");
      git(repo, "config", "user.name", "Test");
      mkdirSync(path.join(repo, "server"), { recursive: true });
      writeFileSync(
        path.join(repo, "server/conflict.ts"),
        'export const value = "base";\n'
      );
      git(repo, "add", "-A");
      git(repo, "commit", "-q", "-m", "base");
      git(repo, "branch", "-M", "main");
      git(repo, "branch", APPROVED_UPLOAD_BRANCH_TEST);

      writeFileSync(
        path.join(repo, "server/conflict.ts"),
        'export const value = "live";\n'
      );
      git(repo, "add", "-A");
      git(repo, "commit", "-q", "-m", "live change");

      git(repo, "switch", "-q", APPROVED_UPLOAD_BRANCH_TEST);
      writeFileSync(
        path.join(repo, "server/conflict.ts"),
        'export const value = "test";\n'
      );
      git(repo, "add", "-A");
      git(repo, "commit", "-q", "-m", "test change");

      const testWorkspace = await resolveDeployWorkspace({
        environment: "TEST",
        repoRoot: repo,
      });
      const liveWorkspace = await resolveDeployWorkspace({
        environment: "LIVE",
        repoRoot: repo,
        liveWorktreePath: livePath,
        createLiveWorktree: true,
      });
      mkdirSync(path.join(liveWorkspace.path, "node_modules"), {
        recursive: true,
      });
      const liveHeadBefore = git(liveWorkspace.path, "rev-parse", "HEAD");

      const remote = fakeRemote();
      const preflight = await runLiveSyncPreflight({
        testWorkspace,
        liveWorkspace,
        dependencies: {
          checks: fakeChecks(),
          push: remote.push,
          lsRemote: remote.lsRemote,
        },
      });
      assert.equal(preflight.canSync, false);
      assert.match(preflight.blockedReason ?? "", /تعارض حقيقي/);
      assert.match(preflight.blockedReason ?? "", /server\/conflict\.ts/);
      assert.equal(preflight.token, "");

      // No file changed in LIVE, and no commit was created.
      assert.equal(git(liveWorkspace.path, "rev-parse", "HEAD"), liveHeadBefore);
      assert.equal(git(liveWorkspace.path, "status", "--porcelain"), "");
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
  "temp repo: a previous approved LIVE sync is recognized and resumed without re-applying",
  { skip: !GIT_AVAILABLE },
  async () => {
    const root = mkdtempSync(path.join(tmpdir(), "rwqan-sync-int-"));
    const livePath = path.join(root, "live");
    try {
      const repo = initRepo(root);
      mkdirSync(path.join(repo, "src"), { recursive: true });
      writeFileSync(path.join(repo, "src/new-feature.ts"), "export const a = 1;\n");
      writeFileSync(path.join(repo, "src/other.ts"), "export const b = 2;\n");
      git(repo, "add", "-A");
      git(repo, "commit", "-q", "-m", "approved test feature");

      const testWorkspace = await resolveDeployWorkspace({
        environment: "TEST",
        repoRoot: repo,
      });
      const liveWorkspace = await resolveDeployWorkspace({
        environment: "LIVE",
        repoRoot: repo,
        liveWorktreePath: livePath,
        createLiveWorktree: true,
      });
      mkdirSync(path.join(liveWorkspace.path, "node_modules"), { recursive: true });

      // Simulate the previous sync: apply the approved TEST patch to LIVE but
      // leave it uncommitted (the prepared state).
      const base = git(repo, "merge-base", "main", APPROVED_UPLOAD_BRANCH_TEST);
      const patch = execFileSync(
        "git",
        [
          "diff",
          "--binary",
          "--full-index",
          `${base}..${APPROVED_UPLOAD_BRANCH_TEST}`,
          "--",
          "src/new-feature.ts",
          "src/other.ts",
        ],
        { cwd: repo, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
      );
      const applied = spawnSync(
        "git",
        ["apply", "--3way", "--whitespace=nowarn", "-"],
        { cwd: liveWorkspace.path, input: `${patch}\n`, encoding: "utf8" }
      );
      assert.equal(applied.status, 0, applied.stderr ?? "");

      const remote = fakeRemote();
      const dependencies = {
        checks: fakeChecks(),
        push: remote.push,
        lsRemote: remote.lsRemote,
      };

      const prepared = await runLiveSyncPreflight({
        testWorkspace,
        liveWorkspace,
        dependencies,
      });
      assert.equal(prepared.canSync, true, prepared.blockedReason ?? "");
      assert.equal(prepared.prepared, true);
      assert.equal(prepared.preparedCount, 2);
      assert.ok(prepared.token.length > 0);

      // A new unrelated change in LIVE must block, with no file changed.
      writeFileSync(
        path.join(liveWorkspace.path, "src/unknown.ts"),
        "export const unknown = true;\n"
      );
      const headBefore = git(liveWorkspace.path, "rev-parse", "HEAD");
      const statusBefore = git(liveWorkspace.path, "status", "--porcelain");
      const blocked = await runLiveSyncPreflight({
        testWorkspace,
        liveWorkspace,
        dependencies,
      });
      assert.equal(blocked.canSync, false);
      assert.equal(blocked.prepared, false);
      assert.match(blocked.blockedReason ?? "", /src\/unknown\.ts/);
      assert.equal(git(liveWorkspace.path, "rev-parse", "HEAD"), headBefore);
      assert.equal(git(liveWorkspace.path, "status", "--porcelain"), statusBefore);

      // Remove only the temporary unknown file; the prepared sync stays intact.
      rmSync(path.join(liveWorkspace.path, "src/unknown.ts"), { force: true });

      let applyCalls = 0;
      const result = await runLiveSync({
        testWorkspace,
        liveWorkspace,
        token: prepared.token,
        confirm: true,
        dependencies: {
          ...dependencies,
          runWithInput: async () => {
            applyCalls += 1;
            return "";
          },
        },
      });
      assert.equal(result.ok, true, result.detail);
      assert.equal(result.pushed, true);
      assert.equal(applyCalls, 0, "prepared sync must not re-apply the patch");
      assert.equal(result.changeCount, 2);
      const committed = git(
        liveWorkspace.path,
        "show",
        "--pretty=format:",
        "--name-only",
        "HEAD"
      )
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .sort();
      assert.deepEqual(committed, ["src/new-feature.ts", "src/other.ts"]);
      assert.equal(git(liveWorkspace.path, "status", "--porcelain"), "");
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
  "temp repo: TEST sync commits local changes and pushes the TEST branch",
  { skip: !GIT_AVAILABLE },
  async () => {
    const root = mkdtempSync(path.join(tmpdir(), "rwqan-sync-int-"));
    try {
      const repo = initRepo(root);
      mkdirSync(path.join(repo, "src"), { recursive: true });
      writeFileSync(path.join(repo, "src/a.ts"), "export const a = 1;\n");
      mkdirSync(path.join(repo, "reports"), { recursive: true });
      writeFileSync(path.join(repo, "reports/out.json"), "{}\n");

      const testWorkspace: DeployWorkspaceInfo = {
        environment: "TEST",
        branch: APPROVED_UPLOAD_BRANCH_TEST,
        path: repo,
        label: "TEST",
        created: false,
      };
      const remote = fakeRemote();
      const result = await runTestAutoSync({
        workspace: testWorkspace,
        dependencies: {
          checks: fakeChecks(),
          push: remote.push,
          lsRemote: remote.lsRemote,
        },
      });

      assert.equal(result.ok, true);
      assert.equal(result.pushed, true);
      assert.deepEqual(remote.pushes, [
        ["push", "origin", APPROVED_UPLOAD_BRANCH_TEST],
      ]);
      const committedFiles = git(
        repo,
        "show",
        "--pretty=format:",
        "--name-only",
        "HEAD"
      )
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean);
      assert.deepEqual(committedFiles, ["src/a.ts"]);
      // Reports/artifacts remain uncommitted (Git may collapse the directory).
      const statusAfter = git(repo, "status", "--porcelain", "--untracked-files=all");
      assert.equal(statusAfter.includes("reports/out.json"), true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
);
