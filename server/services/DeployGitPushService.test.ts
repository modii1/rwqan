import assert from "node:assert/strict";
import test from "node:test";
import {
  normalizeGitStdout,
  parseStatusChanges,
  runBranchSwitch,
  runBranchSwitchPreview,
  runBranchUpload,
  runBranchUploadPreview,
} from "./DeployGitPushService";
import {
  APPROVED_UPLOAD_BRANCH_TEST,
  APPROVED_UPLOAD_BRANCH_LIVE,
  getApprovedUploadBranch,
  isApprovedUploadBranch,
} from "../../shared/deploySystem";

const LOCAL_SHA = "a".repeat(40);
const REMOTE_SHA = "b".repeat(40);
const NEW_SHA = "c".repeat(40);

interface FakeRepoOptions {
  environment: "TEST" | "LIVE";
  gitAvailable?: boolean;
  currentBranch?: string;
  statusOutput?: string;
  files?: Record<string, string | null>;
  userName?: string;
  userEmail?: string;
  remoteUrl?: string;
  pushImpl?: () => Promise<string>;
  verifyRemoteShaOverride?: string;
  remoteSha?: string;
  aheadBehind?: string;
  targetBranchExists?: boolean;
  commitLog?: string;
}

function makeDeps(options: FakeRepoOptions) {
  const environment = options.environment;
  const approvedBranch =
    environment === "TEST" ? APPROVED_UPLOAD_BRANCH_TEST : APPROVED_UPLOAD_BRANCH_LIVE;
  let headSha = LOCAL_SHA;
  let remoteSha = options.remoteSha ?? REMOTE_SHA;
  let branch = options.currentBranch ?? approvedBranch;
  const calls = {
    run: [] as string[][],
    lsRemote: [] as string[][],
    push: [] as string[][],
    commit: [] as string[][],
    switch: [] as string[][],
  };

  const deps = {
    run: async (args: string[]) => {
      calls.run.push(args);
      if (args[0] === "rev-parse" && args[1] === "--git-dir") {
        if (options.gitAvailable === false) throw new Error("git unavailable");
        return "/repo";
      }
      if (args[0] === "rev-parse" && args[1] === "--abbrev-ref") {
        return branch;
      }
      if (args[0] === "rev-parse" && args[1] === "HEAD") return headSha;
      if (args[0] === "rev-parse" && args[1] === "--verify") {
        if (options.targetBranchExists === false) throw new Error("missing ref");
        return args[2];
      }
      if (args[0] === "status") return options.statusOutput ?? "";
      if (args[0] === "rev-list") return options.aheadBehind ?? "0\t0";
      if (args[0] === "log") return options.commitLog ?? "";
      if (args[0] === "config" && args[1] === "--get" && args[2] === "user.name") {
        return options.userName ?? "";
      }
      if (args[0] === "config" && args[1] === "--get" && args[2] === "user.email") {
        return options.userEmail ?? "";
      }
      if (
        args[0] === "config" &&
        args[1] === "--get" &&
        args[2] === "remote.origin.url"
      ) {
        return options.remoteUrl ?? "https://github.com/modii1/rwqan.git";
      }
      throw new Error(`unexpected git call: ${args.join(" ")}`);
    },
    lsRemote: async (args: string[]) => {
      calls.lsRemote.push(args);
      const ref = args[args.length - 1];
      return `${remoteSha}\t${ref}`;
    },
    push: async (args: string[]) => {
      calls.push.push(args);
      if (options.pushImpl) return options.pushImpl();
      remoteSha = headSha;
      return "";
    },
    commit: async (args: string[]) => {
      calls.commit.push(args);
      if (args.includes("commit")) {
        headSha = NEW_SHA;
      }
      return "";
    },
    switch: async (args: string[]) => {
      calls.switch.push(args);
      branch = args[args.length - 1];
      return "";
    },
    readTextFile: async (absolutePath: string) => {
      const key = Object.keys(options.files ?? {}).find((entry) =>
        absolutePath.replace(/\\/g, "/").endsWith(entry)
      );
      if (!key) return null;
      return options.files?.[key] ?? null;
    },
  };
  return { deps, calls, approvedBranch, getHeadSha: () => headSha, getRemoteSha: () => remoteSha };
}

test("normalizeGitStdout preserves porcelain leading spaces", () => {
  assert.equal(
    normalizeGitStdout(" M apphosting.dev.yaml\n"),
    " M apphosting.dev.yaml"
  );
});

test("parseStatusChanges keeps the full path for a worktree-only modification", () => {
  const changes = parseStatusChanges(" M apphosting.dev.yaml");
  assert.equal(changes.length, 1);
  assert.equal(changes[0].path, "apphosting.dev.yaml");
  assert.equal(changes[0].kind, "modified");
});

test("upload fails closed when the Git repository is unavailable", async () => {
  const { deps, calls } = makeDeps({
    environment: "TEST",
    gitAvailable: false,
  });
  const result = await runBranchUpload({
    environment: "TEST",
    cwd: "/repo",
    approveAll: true,
    includePaths: ["src/a.ts"],
    dependencies: deps,
  });
  assert.equal(result.ok, false);
  assert.equal(result.stage, "connection");
  assert.match(result.detail, /تعذّر فحص الاتصال/);
  assert.equal(calls.commit.length, 0);
  assert.equal(calls.push.length, 0);
});

test("preview reports no changes and cannot commit", async () => {
  const { deps } = makeDeps({ environment: "TEST", statusOutput: "" });
  const preview = await runBranchUploadPreview({
    environment: "TEST",
    cwd: "/repo",
    dependencies: deps,
  });
  assert.equal(preview.canCommit, false);
  assert.equal(preview.counts.total, 0);
  assert.match(preview.blockedReason ?? "", /لا توجد تغييرات جديدة/);
  assert.equal(preview.branchMatches, true);
});

test("preview lists modified, added, deleted, renamed, and untracked changes", async () => {
  const statusOutput = [
    " M src/a.ts",
    "A  src/b.ts",
    " D src/c.ts",
    "?? src/d.ts",
    "R  old.ts -> src/e.ts",
    "?? reports/out.json",
  ].join("\n");
  const { deps } = makeDeps({ environment: "TEST", statusOutput });
  const preview = await runBranchUploadPreview({
    environment: "TEST",
    cwd: "/repo",
    dependencies: deps,
  });

  assert.equal(preview.counts.total, 6);
  assert.equal(preview.counts.modified, 1);
  assert.equal(preview.counts.added, 1);
  assert.equal(preview.counts.deleted, 1);
  assert.equal(preview.counts.renamed, 1);
  assert.equal(preview.counts.untracked, 2);
  assert.equal(preview.canCommit, true);

  const renamed = preview.changes.find((change) => change.path === "src/e.ts");
  assert.equal(renamed?.kind, "renamed");
  const report = preview.changes.find((change) => change.path === "reports/out.json");
  assert.equal(report?.category, "artifacts");
  assert.equal(report?.selectedByDefault, false);
});

test("preview blocks unresolved merge conflicts", async () => {
  const { deps } = makeDeps({
    environment: "TEST",
    statusOutput: "UU src/conflict.ts\n M src/a.ts",
  });
  const preview = await runBranchUploadPreview({
    environment: "TEST",
    cwd: "/repo",
    dependencies: deps,
  });
  assert.equal(preview.canCommit, false);
  assert.match(preview.blockedReason ?? "", /تعارضات/);
});

test("preview blocks a secret-looking file name", async () => {
  const { deps } = makeDeps({
    environment: "TEST",
    statusOutput: "?? .env\n M src/a.ts",
  });
  const preview = await runBranchUploadPreview({
    environment: "TEST",
    cwd: "/repo",
    dependencies: deps,
  });
  assert.equal(preview.canCommit, false);
  assert.match(preview.blockedReason ?? "", /حساسة/);
  assert.equal(preview.counts.sensitive, 1);
});

test("preview blocks a secret-looking file content", async () => {
  const { deps } = makeDeps({
    environment: "TEST",
    statusOutput: " M src/config.ts",
    files: { "src/config.ts": `const token = "ghp_${"a".repeat(36)}";` },
  });
  const preview = await runBranchUploadPreview({
    environment: "TEST",
    cwd: "/repo",
    dependencies: deps,
  });
  assert.equal(preview.canCommit, false);
  assert.match(preview.blockedReason ?? "", /حساسة/);
});

test("preview blocks a branch that is behind GitHub", async () => {
  const { deps } = makeDeps({
    environment: "TEST",
    statusOutput: " M src/a.ts",
    aheadBehind: "0\t1",
  });
  const preview = await runBranchUploadPreview({
    environment: "TEST",
    cwd: "/repo",
    dependencies: deps,
  });
  assert.equal(preview.canCommit, false);
  assert.equal(preview.behindCount, 1);
  assert.match(preview.blockedReason ?? "", /خلف GitHub/);
});

test("preview fails closed on a branch mismatch with a dirty tree", async () => {
  const { deps } = makeDeps({
    environment: "TEST",
    currentBranch: "main",
    statusOutput: " M src/a.ts",
  });
  const preview = await runBranchUploadPreview({
    environment: "TEST",
    cwd: "/repo",
    dependencies: deps,
  });
  assert.equal(preview.branchMatches, false);
  assert.equal(preview.canCommit, false);
  assert.equal(preview.branchSwitch?.canSwitch, false);
  assert.match(preview.blockedReason ?? "", /تغييرات غير محفوظة/);
});

test("preview offers a safe branch switch when the tree is clean", async () => {
  const { deps } = makeDeps({
    environment: "TEST",
    currentBranch: "main",
    statusOutput: "",
  });
  const preview = await runBranchUploadPreview({
    environment: "TEST",
    cwd: "/repo",
    dependencies: deps,
  });
  assert.equal(preview.branchMatches, false);
  assert.equal(preview.canCommit, false);
  assert.equal(preview.branchSwitch?.canSwitch, true);
  assert.match(preview.blockedReason ?? "", /لا يطابق/);
});

test("upload without explicit approval performs no write", async () => {
  const { deps, calls } = makeDeps({
    environment: "TEST",
    statusOutput: " M src/a.ts",
  });
  const result = await runBranchUpload({
    environment: "TEST",
    cwd: "/repo",
    dependencies: deps,
  });
  assert.equal(result.ok, false);
  assert.equal(calls.commit.length, 0);
  assert.equal(calls.push.length, 0);
  assert.match(result.detail, /لم يتم تأكيد/);
});

test("upload with no changes skips commit and push", async () => {
  const { deps, calls } = makeDeps({ environment: "TEST", statusOutput: "" });
  const result = await runBranchUpload({
    environment: "TEST",
    cwd: "/repo",
    approveAll: true,
    includePaths: [],
    dependencies: deps,
  });
  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(result.pushed, false);
  assert.equal(result.commitSha, null);
  assert.equal(calls.commit.length, 0);
  assert.equal(calls.push.length, 0);
  assert.match(result.detail, /لا توجد تغييرات جديدة/);
});

test("upload creates a new commit, pushes it, and verifies the remote SHA", async () => {
  const { deps, calls, approvedBranch } = makeDeps({
    environment: "TEST",
    statusOutput: " M src/a.ts\n M src/b.ts",
    remoteUrl: "https://github.com/modii1/rwqan.git",
  });
  const result = await runBranchUpload({
    environment: "TEST",
    cwd: "/repo",
    approveAll: true,
    includePaths: ["src/a.ts", "src/b.ts"],
    commitMessage: "إصلاح زر الرفع",
    dependencies: deps,
  });

  assert.equal(result.ok, true);
  assert.equal(result.pushed, true);
  assert.equal(result.skipped, false);
  assert.equal(result.commitSha, NEW_SHA);
  assert.equal(result.pushedSha, NEW_SHA);
  assert.equal(result.commitMessage, "إصلاح زر الرفع");
  assert.equal(result.changeCount, 2);
  assert.equal(
    result.commitUrl,
    `https://github.com/modii1/rwqan/commit/${NEW_SHA}`
  );

  const commitCall = calls.commit.find((args) => args.includes("commit"));
  assert.ok(commitCall);
  assert.ok(commitCall!.includes("src/a.ts"));
  assert.ok(commitCall!.includes("src/b.ts"));
  assert.deepEqual(calls.push, [["push", "origin", approvedBranch]]);
  assert.equal(
    calls.push.some((args) => args.includes("--force") || args.includes("-f")),
    false
  );
  const verify = result.stages.find((stage) => stage.stage === "verify");
  assert.equal(verify?.status, "ok");
});

test("upload commits only the explicitly approved paths", async () => {
  const { deps, calls } = makeDeps({
    environment: "TEST",
    statusOutput: " M src/a.ts\n M src/b.ts",
  });
  const result = await runBranchUpload({
    environment: "TEST",
    cwd: "/repo",
    approveAll: true,
    includePaths: ["src/a.ts"],
    dependencies: deps,
  });
  assert.equal(result.ok, true);
  const addCall = calls.commit.find((args) => args[0] === "add");
  assert.ok(addCall);
  assert.deepEqual(addCall!.slice(3), ["src/a.ts"]);
  const commitCall = calls.commit.find((args) => args.includes("commit"));
  assert.ok(commitCall);
  assert.ok(commitCall!.includes("src/a.ts"));
  assert.equal(commitCall!.includes("src/b.ts"), false);
});

test("upload refuses paths that are not part of the current changes", async () => {
  const { deps, calls } = makeDeps({
    environment: "TEST",
    statusOutput: " M src/a.ts",
  });
  const result = await runBranchUpload({
    environment: "TEST",
    cwd: "/repo",
    approveAll: true,
    includePaths: ["src/does-not-exist.ts"],
    dependencies: deps,
  });
  assert.equal(result.ok, false);
  assert.equal(calls.commit.length, 0);
  assert.match(result.detail, /غير موجودة/);
});

test("upload refuses a branch that is behind GitHub without committing", async () => {
  const { deps, calls } = makeDeps({
    environment: "TEST",
    statusOutput: " M src/a.ts",
    aheadBehind: "0\t1",
  });
  const result = await runBranchUpload({
    environment: "TEST",
    cwd: "/repo",
    approveAll: true,
    includePaths: ["src/a.ts"],
    dependencies: deps,
  });
  assert.equal(result.ok, false);
  assert.equal(calls.commit.length, 0);
  assert.equal(calls.push.length, 0);
  assert.match(result.detail, /خلف GitHub/);
});

test("upload fails closed when a selected file is sensitive", async () => {
  const { deps, calls } = makeDeps({
    environment: "TEST",
    statusOutput: "?? .env",
  });
  const result = await runBranchUpload({
    environment: "TEST",
    cwd: "/repo",
    approveAll: true,
    includePaths: [".env"],
    dependencies: deps,
  });
  assert.equal(result.ok, false);
  assert.equal(calls.commit.length, 0);
  assert.match(result.detail, /حساسة/);
});

test("upload reports a push failure and never claims success", async () => {
  const { deps } = makeDeps({
    environment: "TEST",
    statusOutput: " M src/a.ts",
    pushImpl: () => Promise.reject(new Error("git push denied")),
  });
  const result = await runBranchUpload({
    environment: "TEST",
    cwd: "/repo",
    approveAll: true,
    includePaths: ["src/a.ts"],
    dependencies: deps,
  });
  assert.equal(result.ok, false);
  assert.equal(result.pushed, false);
  assert.equal(result.stage, "push");
  assert.match(result.detail, /git push denied/);
});

test("upload fails verification when GitHub does not report the new SHA", async () => {
  const { deps } = makeDeps({
    environment: "TEST",
    statusOutput: " M src/a.ts",
    verifyRemoteShaOverride: "d".repeat(40),
  });
  // Override lsRemote so the verify read returns a different SHA.
  const originalLsRemote = deps.lsRemote;
  let lsRemoteCalls = 0;
  deps.lsRemote = async (args: string[]) => {
    lsRemoteCalls += 1;
    if (lsRemoteCalls >= 2) return `${"d".repeat(40)}\t${args[args.length - 1]}`;
    return originalLsRemote(args);
  };
  const result = await runBranchUpload({
    environment: "TEST",
    cwd: "/repo",
    approveAll: true,
    includePaths: ["src/a.ts"],
    dependencies: deps,
  });
  assert.equal(result.ok, false);
  assert.equal(result.stage, "verify");
  assert.equal(result.pushed, false);
});

test("upload fails on branch mismatch without committing", async () => {
  const { deps, calls } = makeDeps({
    environment: "TEST",
    currentBranch: "main",
    statusOutput: " M src/a.ts",
  });
  const result = await runBranchUpload({
    environment: "TEST",
    cwd: "/repo",
    approveAll: true,
    includePaths: ["src/a.ts"],
    dependencies: deps,
  });
  assert.equal(result.ok, false);
  assert.equal(result.stage, "branch");
  assert.equal(calls.commit.length, 0);
  assert.equal(calls.push.length, 0);
});

test("upload pushes the LIVE branch (main) with its own commit", async () => {
  const { deps, calls, approvedBranch } = makeDeps({
    environment: "LIVE",
    statusOutput: " M src/a.ts",
  });
  const result = await runBranchUpload({
    environment: "LIVE",
    cwd: "/repo",
    approveAll: true,
    includePaths: ["src/a.ts"],
    dependencies: deps,
  });
  assert.equal(result.ok, true);
  assert.equal(result.branch, APPROVED_UPLOAD_BRANCH_LIVE);
  assert.deepEqual(calls.push, [["push", "origin", APPROVED_UPLOAD_BRANCH_LIVE]]);
});

test("branch-switch preview refuses a dirty working tree", async () => {
  const { deps } = makeDeps({
    environment: "TEST",
    currentBranch: "main",
    statusOutput: " M src/a.ts\n?? src/new.ts",
  });
  const assessment = await runBranchSwitchPreview({
    environment: "TEST",
    cwd: "/repo",
    dependencies: deps,
  });
  assert.equal(assessment.branchMatches, false);
  assert.equal(assessment.canSwitch, false);
  assert.equal(assessment.workingTreeCounts.total, 2);
  assert.match(assessment.blockedReason ?? "", /تغييرات غير محفوظة/);
});

test("branch-switch preview allows a clean switch but surfaces unpushed commits", async () => {
  const sha = "e".repeat(40);
  const { deps } = makeDeps({
    environment: "TEST",
    currentBranch: "main",
    statusOutput: "",
    commitLog: `${sha}\tcommit on the current branch`,
  });
  const assessment = await runBranchSwitchPreview({
    environment: "TEST",
    cwd: "/repo",
    dependencies: deps,
  });
  assert.equal(assessment.canSwitch, true);
  assert.equal(assessment.requiresUnpushedAck, true);
  assert.equal(assessment.unpushedCurrentCommits.length, 1);
  assert.equal(assessment.unpushedCurrentCommits[0].sha, sha);
});

test("branch switch requires an explicit confirmation", async () => {
  const { deps, calls } = makeDeps({
    environment: "TEST",
    currentBranch: "main",
    statusOutput: "",
  });
  const result = await runBranchSwitch({
    environment: "TEST",
    cwd: "/repo",
    dependencies: deps,
  });
  assert.equal(result.ok, false);
  assert.equal(result.switched, false);
  assert.equal(result.needsConfirm, true);
  assert.equal(calls.switch.length, 0);
});

test("branch switch requires acknowledgment when unpushed commits exist", async () => {
  const { deps, calls } = makeDeps({
    environment: "TEST",
    currentBranch: "main",
    statusOutput: "",
    commitLog: `${"e".repeat(40)}\tunpushed commit`,
  });
  const result = await runBranchSwitch({
    environment: "TEST",
    cwd: "/repo",
    confirm: true,
    acknowledgeUnpushed: false,
    dependencies: deps,
  });
  assert.equal(result.ok, false);
  assert.equal(result.requiresAck, true);
  assert.equal(calls.switch.length, 0);
});

test("branch switch moves to the approved branch ONLY after confirmation and acknowledgment", async () => {
  const { deps, calls, approvedBranch } = makeDeps({
    environment: "TEST",
    currentBranch: "main",
    statusOutput: "",
    commitLog: `${"e".repeat(40)}\tunpushed commit`,
  });
  const result = await runBranchSwitch({
    environment: "TEST",
    cwd: "/repo",
    confirm: true,
    acknowledgeUnpushed: true,
    dependencies: deps,
  });
  assert.equal(result.ok, true);
  assert.equal(result.switched, true);
  assert.equal(result.currentBranch, approvedBranch);
  assert.deepEqual(calls.switch, [["switch", "--no-guess", approvedBranch]]);

  // No destructive/stash/merge command is ever issued.
  const forbidden = calls.run.filter((args) =>
    ["reset", "clean", "stash", "merge", "rebase", "checkout", "-f", "--force"].some(
      (token) => args.includes(token)
    )
  );
  assert.deepEqual(forbidden, []);
});

test("branch switch refuses a dirty working tree without touching it", async () => {
  const { deps, calls } = makeDeps({
    environment: "TEST",
    currentBranch: "main",
    statusOutput: " M src/a.ts",
  });
  const result = await runBranchSwitch({
    environment: "TEST",
    cwd: "/repo",
    confirm: true,
    acknowledgeUnpushed: true,
    dependencies: deps,
  });
  assert.equal(result.ok, false);
  assert.equal(result.switched, false);
  assert.equal(calls.switch.length, 0);
  assert.match(result.detail, /تغييرات غير محفوظة/);
});

test("branch switch refuses a missing target branch", async () => {
  const { deps, calls } = makeDeps({
    environment: "TEST",
    currentBranch: "main",
    statusOutput: "",
    targetBranchExists: false,
  });
  const result = await runBranchSwitch({
    environment: "TEST",
    cwd: "/repo",
    confirm: true,
    acknowledgeUnpushed: true,
    dependencies: deps,
  });
  assert.equal(result.ok, false);
  assert.equal(result.switched, false);
  assert.equal(calls.switch.length, 0);
  assert.match(result.detail, /غير موجود محليًا/);
});

test("upload pushes existing local commits when the working tree is clean", async () => {
  const { deps, calls } = makeDeps({
    environment: "TEST",
    statusOutput: "",
    aheadBehind: "2\t0",
  });
  const result = await runBranchUpload({
    environment: "TEST",
    cwd: "/repo",
    approveAll: true,
    includePaths: [],
    dependencies: deps,
  });
  assert.equal(result.ok, true);
  assert.equal(result.pushed, true);
  assert.equal(result.commitSha, LOCAL_SHA);
  assert.equal(result.changeCount, 0);
  assert.equal(calls.commit.length, 0);
  assert.deepEqual(calls.push, [["push", "origin", APPROVED_UPLOAD_BRANCH_TEST]]);
  const commitStage = result.stages.find((stage) => stage.stage === "commit");
  assert.equal(commitStage?.status, "skipped");
});

test("upload pipeline helper resolves approved branch per environment", () => {
  assert.equal(getApprovedUploadBranch("TEST"), APPROVED_UPLOAD_BRANCH_TEST);
  assert.equal(getApprovedUploadBranch("LIVE"), APPROVED_UPLOAD_BRANCH_LIVE);
  assert.equal(getApprovedUploadBranch("LOCAL"), null);
});

test("upload pipeline helper validates branch per environment", () => {
  assert.equal(isApprovedUploadBranch("TEST", APPROVED_UPLOAD_BRANCH_TEST), true);
  assert.equal(isApprovedUploadBranch("LIVE", APPROVED_UPLOAD_BRANCH_LIVE), true);
  assert.equal(isApprovedUploadBranch("TEST", APPROVED_UPLOAD_BRANCH_LIVE), false);
  assert.equal(isApprovedUploadBranch("LIVE", APPROVED_UPLOAD_BRANCH_TEST), false);
  assert.equal(isApprovedUploadBranch("TEST", null), false);
  assert.equal(isApprovedUploadBranch("TEST", undefined), false);
});
