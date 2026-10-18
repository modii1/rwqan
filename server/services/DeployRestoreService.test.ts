import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {
  buildRestorePreview,
  isFullCommitSha,
  resolveRestoreTarget,
  runRestore,
  sanitizeReleaseId,
  type DeployRestoreDependencies,
} from "./DeployRestoreService";
import type { DeployRelease } from "../../shared/deploySystem";

const FULL_SHA = "a".repeat(40);
const SOURCE = "https://github.com/iheeb1/rwqan-sa.git";

function release(overrides: Partial<DeployRelease> = {}): DeployRelease {
  return {
    releaseId: "rel-restore-0001",
    version: "1.0.0",
    environment: "TEST",
    gitCommit: FULL_SHA,
    gitTag: null,
    gitBranch: "main",
    sourceRepoUrl: SOURCE,
    createdAt: "2026-01-01T00:00:00.000Z",
    createdBy: "admin",
    changeSummary: "إصدار اختبار",
    status: "simulated",
    checks: {
      typescript: "NOT_RUN",
      tests: "NOT_RUN",
      build: "NOT_RUN",
      secretScan: "PASS",
      postDeployHealth: "NOT_RUN",
    },
    gitShortSha: FULL_SHA.slice(0, 7),
    worktree: "clean",
    checkRunAt: null,
    savedToGit: false,
    deployed: false,
    simulated: true,
    deployTarget: "rwqan-sa-dev",
    error: null,
    ...overrides,
  };
}

interface FakeOptions {
  commitExists?: boolean;
  tree?: Array<{ path: string; blobSha: string }>;
  hashMismatch?: Set<string>;
  archiveThrows?: boolean;
  hashThrows?: boolean;
  targetExists?: boolean;
}

function createFakeDependencies(options: FakeOptions = {}) {
  const files = new Map<string, string>();
  for (const entry of options.tree ?? []) files.set(entry.path, entry.blobSha);

  const calls = {
    archive: [] as string[],
    extract: 0,
    makeDirectory: 0,
    removed: [] as string[],
  };

  const deps: DeployRestoreDependencies = {
    async commitExists() {
      return options.commitExists ?? true;
    },
    async listTree() {
      return (options.tree ?? []).map((entry) => ({ ...entry }));
    },
    async archive(sha) {
      if (options.archiveThrows) throw new Error("archive failed");
      calls.archive.push(sha);
    },
    async extract() {
      if (options.archiveThrows) throw new Error("extract failed");
      calls.extract += 1;
    },
    async hashFiles(_dir, relativePaths) {
      if (options.hashThrows) throw new Error("hash failed");
      const map = new Map<string, string>();
      for (const relative of relativePaths) {
        const posix = relative.split(path.sep).join("/");
        const base = files.get(posix) ?? "missing";
        map.set(
          relative,
          options.hashMismatch?.has(posix) ? "different-hash" : base,
        );
      }
      return map;
    },
    async listFiles() {
      return [...files.keys()];
    },
    async makeDirectory() {
      calls.makeDirectory += 1;
    },
    async remove(target) {
      calls.removed.push(target);
    },
    async pathExists() {
      return options.targetExists ?? false;
    },
  };

  return { deps, calls };
}

const DEFAULT_TREE = [
  { path: "src/index.ts", blobSha: "hash-index" },
  { path: "package.json", blobSha: "hash-package" },
];

test("sanitizeReleaseId only accepts a single safe path segment", () => {
  assert.equal(sanitizeReleaseId("rel-1"), "rel-1");
  assert.equal(sanitizeReleaseId(" rel_1 "), "rel_1");
  assert.equal(sanitizeReleaseId("../evil"), null);
  assert.equal(sanitizeReleaseId("a/b"), null);
  assert.equal(sanitizeReleaseId(""), null);
  assert.equal(sanitizeReleaseId("."), null);
});

test("resolveRestoreTarget refuses traversal and absolute escapes", () => {
  const devRoot = path.resolve("C:/dev/project");
  const ok = resolveRestoreTarget(devRoot, "rel-1");
  assert.ok(ok && ok.endsWith(path.join(".deploy-restore", "rel-1")));
  assert.equal(resolveRestoreTarget(devRoot, "../outside"), null);
  assert.equal(resolveRestoreTarget(devRoot, ".."), null);
});

test("isFullCommitSha accepts only a full 40-hex SHA", () => {
  assert.equal(isFullCommitSha(FULL_SHA), true);
  assert.equal(isFullCommitSha("abc1234"), false);
  assert.equal(isFullCommitSha("unknown"), false);
  assert.equal(isFullCommitSha(null), false);
});

test("preview is read-only and reports a restorable release", async () => {
  const { deps, calls } = createFakeDependencies({ tree: DEFAULT_TREE });
  const preview = await buildRestorePreview({
    release: release(),
    devRoot: path.resolve("C:/dev/project"),
    worktree: "clean",
    dependencies: deps,
  });
  assert.equal(preview.canRestore, true);
  assert.equal(preview.shaFormatValid, true);
  assert.equal(preview.commitExists, true);
  assert.deepEqual(preview.blockers, []);
  assert.ok(preview.targetPath?.endsWith("rel-restore-0001"));
  // Nothing was executed to build the preview.
  assert.deepEqual(calls.archive, []);
  assert.equal(calls.extract, 0);
});

test("a successful restore materializes, prunes secrets, and verifies", async () => {
  const { deps, calls } = createFakeDependencies({
    tree: [
      ...DEFAULT_TREE,
      { path: ".env", blobSha: "secret-env-blob" },
      { path: ".env.production", blobSha: "secret-prod-blob" },
    ],
  });
  const result = await runRestore({
    release: release(),
    devRoot: path.resolve("C:/dev/project"),
    worktree: "clean",
    dependencies: deps,
  });

  assert.equal(result.status, "success");
  assert.equal(result.real, true);
  assert.equal(result.verified, true);
  assert.equal(result.fileCount, 2);
  assert.equal(result.verification.checked, 2);
  assert.deepEqual(result.verification.mismatches, []);
  assert.deepEqual(
    [...result.verification.prunedSecrets].sort(),
    [".env", ".env.production"],
  );
  // Only the read-only archive was requested, for the exact SHA; the tar removed.
  assert.deepEqual(calls.archive, [FULL_SHA]);
  assert.equal(calls.extract, 1);
  assert.ok(calls.removed.some((target) => target.endsWith(".tar")));
});

test("a short or unknown commit SHA blocks the restore before any extraction", async () => {
  for (const bad of ["seed00003", "abc1234", "unknown", ""]) {
    const { deps, calls } = createFakeDependencies({ tree: DEFAULT_TREE });
    const result = await runRestore({
      release: release({ gitCommit: bad }),
      devRoot: path.resolve("C:/dev/project"),
      worktree: "clean",
      dependencies: deps,
    });
    assert.equal(result.status, "blocked", `bad sha ${bad} must be blocked`);
    assert.equal(result.real, true);
    assert.equal(result.executedAt, null);
    assert.deepEqual(calls.archive, []);
    assert.equal(calls.extract, 0);
  }
});

test("a SHA that is not present locally is blocked", async () => {
  const { deps, calls } = createFakeDependencies({
    commitExists: false,
    tree: DEFAULT_TREE,
  });
  const result = await runRestore({
    release: release(),
    devRoot: path.resolve("C:/dev/project"),
    worktree: "clean",
    dependencies: deps,
  });
  assert.equal(result.status, "blocked");
  assert.deepEqual(calls.archive, []);
});

test("a release without a trustworthy source is blocked", async () => {
  const { deps } = createFakeDependencies({ tree: DEFAULT_TREE });
  const result = await runRestore({
    release: release({ sourceRepoUrl: "" }),
    devRoot: path.resolve("C:/dev/project"),
    worktree: "clean",
    dependencies: deps,
  });
  assert.equal(result.status, "blocked");
  assert.match(result.error ?? "", /مصدر/);
});

test("a LIVE-source release is restorable into the isolated TEST target", async () => {
  const { deps } = createFakeDependencies({ tree: DEFAULT_TREE });
  const preview = await buildRestorePreview({
    release: release({ environment: "LIVE" }),
    devRoot: path.resolve("C:/dev/project"),
    worktree: "clean",
    targetEnvironment: "TEST",
    dependencies: deps,
  });
  // Source env is LIVE (shown), but the target is the isolated TEST, so the
  // stable release is previewable/restorable without touching production.
  assert.equal(preview.environment, "LIVE");
  assert.equal(preview.targetEnvironment, "TEST");
  assert.equal(preview.canRestore, true);

  const result = await runRestore({
    release: release({ environment: "LIVE" }),
    devRoot: path.resolve("C:/dev/project"),
    worktree: "clean",
    targetEnvironment: "TEST",
    dependencies: deps,
  });
  assert.equal(result.status, "success");
});

test("a LIVE target is refused without approval, and a TEST source is refused for LIVE", async () => {
  const { deps } = createFakeDependencies({ tree: DEFAULT_TREE });

  const liveTarget = await runRestore({
    release: release({ environment: "LIVE" }),
    devRoot: path.resolve("C:/dev/project"),
    worktree: "clean",
    targetEnvironment: "LIVE",
    dependencies: deps,
  });
  assert.equal(liveTarget.status, "blocked");
  assert.match(liveTarget.error ?? "", /الإنتاج/);

  const mismatch = await runRestore({
    release: release({ environment: "TEST" }),
    devRoot: path.resolve("C:/dev/project"),
    worktree: "clean",
    targetEnvironment: "LIVE",
    liveRestoreApproved: true,
    dependencies: deps,
  });
  assert.equal(mismatch.status, "blocked");
  assert.match(mismatch.error ?? "", /بيئة الاختبار إلى الإنتاج/);
});

test("an incomplete release is blocked", async () => {
  const { deps } = createFakeDependencies({ tree: DEFAULT_TREE });
  for (const status of ["validation_failed", "failed"] as const) {
    const incomplete = await runRestore({
      release: release({ status }),
      devRoot: path.resolve("C:/dev/project"),
      worktree: "clean",
      dependencies: deps,
    });
    assert.equal(incomplete.status, "blocked");
  }
});

test("a dirty working tree does not block a commit-based restore", async () => {
  const { deps, calls } = createFakeDependencies({ tree: DEFAULT_TREE });
  const result = await runRestore({
    release: release(),
    devRoot: path.resolve("C:/dev/project"),
    worktree: "dirty",
    dependencies: deps,
  });
  // The restore is built from an immutable commit, so local edits are irrelevant:
  // it proceeds normally (the worktree is reported but never a blocker).
  assert.equal(result.status, "success");
  assert.equal(result.verified, true);
  assert.notEqual(calls.archive.length, 0);
  assert.equal(calls.extract, 1);
});

test("an unsafe release id blocks the restore (no path escape)", async () => {
  const { deps } = createFakeDependencies({ tree: DEFAULT_TREE });
  const result = await runRestore({
    release: release({ releaseId: "../../evil" }),
    devRoot: path.resolve("C:/dev/project"),
    worktree: "clean",
    dependencies: deps,
  });
  assert.equal(result.status, "blocked");
  assert.equal(result.targetPath, null);
});

test("an already-present isolated target directory blocks re-execution", async () => {
  const { deps, calls } = createFakeDependencies({
    tree: DEFAULT_TREE,
    targetExists: true,
  });
  const result = await runRestore({
    release: release(),
    devRoot: path.resolve("C:/dev/project"),
    worktree: "clean",
    dependencies: deps,
  });
  assert.equal(result.status, "blocked");
  assert.deepEqual(calls.archive, []);
  assert.equal(calls.extract, 0);
});

test("a content mismatch fails verification and is never reported as success", async () => {
  const { deps } = createFakeDependencies({
    tree: DEFAULT_TREE,
    hashMismatch: new Set(["src/index.ts"]),
  });
  const result = await runRestore({
    release: release(),
    devRoot: path.resolve("C:/dev/project"),
    worktree: "clean",
    dependencies: deps,
  });
  assert.equal(result.status, "failed");
  assert.equal(result.verified, false);
  assert.match(result.error ?? "", /فشل التحقق/);
});

test("an archive failure and a hashing failure both fail safely", async () => {
  const archiveFail = createFakeDependencies({
    tree: DEFAULT_TREE,
    archiveThrows: true,
  });
  const a = await runRestore({
    release: release(),
    devRoot: path.resolve("C:/dev/project"),
    worktree: "clean",
    dependencies: archiveFail.deps,
  });
  assert.equal(a.status, "failed");

  const hashFail = createFakeDependencies({ tree: DEFAULT_TREE, hashThrows: true });
  const b = await runRestore({
    release: release(),
    devRoot: path.resolve("C:/dev/project"),
    worktree: "clean",
    dependencies: hashFail.deps,
  });
  assert.equal(b.status, "failed");
  assert.match(b.error ?? "", /بصمات/);
});

test("a legacy release without the new optional fields still restores", async () => {
  const { deps } = createFakeDependencies({ tree: DEFAULT_TREE });
  const legacy = release();
  delete (legacy as Partial<DeployRelease>).gitShortSha;
  delete (legacy as Partial<DeployRelease>).worktree;
  delete (legacy as Partial<DeployRelease>).checkRunAt;
  const result = await runRestore({
    release: legacy,
    devRoot: path.resolve("C:/dev/project"),
    dependencies: deps,
  });
  assert.equal(result.status, "success");
  assert.equal(result.verified, true);
});

test("verification matches by content hash, so duplicated file contents are accepted", async () => {
  const { deps } = createFakeDependencies({
    tree: [
      { path: "a.txt", blobSha: "same-hash" },
      { path: "b.txt", blobSha: "same-hash" },
    ],
  });
  const result = await runRestore({
    release: release(),
    devRoot: path.resolve("C:/dev/project"),
    worktree: "clean",
    dependencies: deps,
  });
  assert.equal(result.status, "success");
  assert.equal(result.verification.checked, 2);
});

test("an extracted file whose content is not in the commit tree fails verification", async () => {
  const { deps } = createFakeDependencies({
    tree: [{ path: "a.txt", blobSha: "tree-hash" }],
    hashMismatch: new Set(["extra.txt"]),
  });
  // The fake emits an unrelated extra file (its hash will not match the tree).
  (deps as unknown as { listFiles: () => Promise<string[]> }).listFiles = async () => [
    "a.txt",
    "extra.txt",
  ];
  const result = await runRestore({
    release: release(),
    devRoot: path.resolve("C:/dev/project"),
    worktree: "clean",
    dependencies: deps,
  });
  assert.equal(result.status, "failed");
  assert.match(result.error ?? "", /فشل التحقق/);
});

test("running twice in a row never reuses an existing target silently", async () => {  const { deps } = createFakeDependencies({ tree: DEFAULT_TREE });
  const first = await runRestore({
    release: release(),
    devRoot: path.resolve("C:/dev/project"),
    worktree: "clean",
    dependencies: deps,
  });
  assert.equal(first.status, "success");

  // A second run whose target already exists (observed via pathExists) is blocked.
  const second = createFakeDependencies({ tree: DEFAULT_TREE, targetExists: true });
  const secondResult = await runRestore({
    release: release(),
    devRoot: path.resolve("C:/dev/project"),
    worktree: "clean",
    dependencies: second.deps,
  });
  assert.equal(secondResult.status, "blocked");
  assert.match(secondResult.error ?? "", /موجود مسبقًا/);
});
