import assert from "node:assert/strict";
import test from "node:test";
import { runBranchUpload } from "./DeployGitPushService";
import {
  APPROVED_UPLOAD_BRANCH_TEST,
  APPROVED_UPLOAD_BRANCH_LIVE,
  getApprovedUploadBranch,
  isApprovedUploadBranch,
} from "../../shared/deploySystem";

const LOCAL_SHA = "a".repeat(40);
const REMOTE_SHA = "b".repeat(40);

function makeDeps(options: {
  environment: "TEST" | "LIVE";
  gitAvailable?: boolean;
  lsRemoteResults?: string[];
  pushImpl?: () => Promise<string>;
}) {
  const environment = options.environment;
  const approvedBranch =
    environment === "TEST" ? APPROVED_UPLOAD_BRANCH_TEST : APPROVED_UPLOAD_BRANCH_LIVE;
  const branchRef = `refs/heads/${approvedBranch}`;
  const lsRemoteResults = options.lsRemoteResults ?? [
    `${REMOTE_SHA}\t${branchRef}`,
  ];
  const calls = { lsRemote: 0, push: 0 };
  const deps = {
    run: async (args: string[]) => {
      if (args[0] === "rev-parse") {
        if (args[1] === "--git-dir") {
          if (options.gitAvailable === false) throw new Error("git unavailable");
          return "/repo";
        }
        if (args[1] === approvedBranch) return LOCAL_SHA;
        throw new Error(`unexpected rev-parse arg: ${args.join(" ")}`);
      }
      if (args[0] === "status") return "";
      throw new Error(`unexpected git call: ${args.join(" ")}`);
    },
    lsRemote: async () => {
      const index = calls.lsRemote;
      calls.lsRemote += 1;
      const value = lsRemoteResults[index];
      if (value === undefined) return `${LOCAL_SHA}\t${branchRef}`;
      return value;
    },
    push: async () => {
      calls.push += 1;
      if (options.pushImpl) return options.pushImpl();
      return "";
    },
  };
  return { deps, calls, approvedBranch };
}

test("upload pipeline pushes TEST branch and verifies the SHA", async () => {
  const { deps } = makeDeps({
    environment: "TEST",
    // lsRemote #1: remote has REMOTE_SHA (different from local) -> will push
    // lsRemote #2: remote still REMOTE_SHA (finalRemoteSha != localSha) -> push
    // PUSH happens
    // lsRemote #3: after push, verify reads LOCAL_SHA -> match -> ok
    lsRemoteResults: [
      `${REMOTE_SHA}\trefs/heads/${APPROVED_UPLOAD_BRANCH_TEST}`,
      `${REMOTE_SHA}\trefs/heads/${APPROVED_UPLOAD_BRANCH_TEST}`,
      `${LOCAL_SHA}\trefs/heads/${APPROVED_UPLOAD_BRANCH_TEST}`,
    ],
  });
  const result = await runBranchUpload({
    environment: "TEST",
    cwd: "/repo",
    dependencies: deps,
  });
  assert.equal(result.ok, true);
  assert.equal(result.environment, "TEST");
  assert.equal(result.branch, APPROVED_UPLOAD_BRANCH_TEST);
  assert.equal(result.pushed, true);
  assert.equal(result.skipped, false);
  assert.equal(result.stage, "final");
  const verify = result.stages.find((entry) => entry.stage === "verify");
  assert.equal(verify?.status, "ok");
  const push = result.stages.find((entry) => entry.stage === "push");
  assert.equal(push?.status, "ok");
});

test("upload pipeline pushes LIVE branch (main) and verifies the SHA", async () => {
  const { deps } = makeDeps({
    environment: "LIVE",
    lsRemoteResults: [
      `${REMOTE_SHA}\trefs/heads/${APPROVED_UPLOAD_BRANCH_LIVE}`,
      `${REMOTE_SHA}\trefs/heads/${APPROVED_UPLOAD_BRANCH_LIVE}`,
      `${LOCAL_SHA}\trefs/heads/${APPROVED_UPLOAD_BRANCH_LIVE}`,
    ],
  });
  const result = await runBranchUpload({
    environment: "LIVE",
    cwd: "/repo",
    dependencies: deps,
  });
  assert.equal(result.ok, true);
  assert.equal(result.environment, "LIVE");
  assert.equal(result.branch, APPROVED_UPLOAD_BRANCH_LIVE);
  assert.equal(result.pushed, true);
  assert.equal(result.stage, "final");
});

test("upload pipeline skips push when TEST branch already up-to-date", async () => {
  const { deps } = makeDeps({
    environment: "TEST",
    // lsRemote #1: remote already equals local -> skip push
    // lsRemote #2: finalRemoteSha re-read (still equal) -> skip path already taken
    lsRemoteResults: [
      `${LOCAL_SHA}\trefs/heads/${APPROVED_UPLOAD_BRANCH_TEST}`,
      `${LOCAL_SHA}\trefs/heads/${APPROVED_UPLOAD_BRANCH_TEST}`,
      `${LOCAL_SHA}\trefs/heads/${APPROVED_UPLOAD_BRANCH_TEST}`,
    ],
  });
  const result = await runBranchUpload({
    environment: "TEST",
    cwd: "/repo",
    dependencies: deps,
  });
  assert.equal(result.ok, true);
  assert.equal(result.skipped, true);
  assert.equal(result.pushed, false);
  const push = result.stages.find((entry) => entry.stage === "push");
  assert.equal(push?.status, "skipped");
});

test("upload pipeline rejects TEST when environment not TEST/LIVE", async () => {
  // LOCAL has no approved branch -> fail closed.
  const result = await runBranchUpload({
    environment: "LOCAL",
    cwd: "/repo",
    dependencies: makeDeps({ environment: "TEST" }).deps,
  });
  assert.equal(result.ok, false);
  assert.equal(result.stage, "branch");
  assert.equal(result.pushed, false);
});

test("upload pipeline fails closed when git is unavailable", async () => {
  const { deps } = makeDeps({ environment: "TEST", gitAvailable: false });
  const result = await runBranchUpload({
    environment: "TEST",
    cwd: "/repo",
    dependencies: deps,
  });
  assert.equal(result.ok, false);
  assert.equal(result.stage, "connection");
});

test("upload pipeline fails at push and skips verification", async () => {
  const { deps } = makeDeps({
    environment: "TEST",
    lsRemoteResults: [
      `${REMOTE_SHA}\trefs/heads/${APPROVED_UPLOAD_BRANCH_TEST}`,
      `${REMOTE_SHA}\trefs/heads/${APPROVED_UPLOAD_BRANCH_TEST}`,
      `${REMOTE_SHA}\trefs/heads/${APPROVED_UPLOAD_BRANCH_TEST}`,
    ],
    pushImpl: () => Promise.reject(new Error("git push denied")),
  });
  const result = await runBranchUpload({
    environment: "TEST",
    cwd: "/repo",
    dependencies: deps,
  });
  assert.equal(result.ok, false);
  assert.equal(result.stage, "push");
  const verify = result.stages.find((entry) => entry.stage === "verify");
  assert.equal(verify?.status, "skipped");
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
