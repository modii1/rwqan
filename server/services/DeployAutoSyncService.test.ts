import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  parseApplyConflicts,
  runCheckCommand,
  runLiveSync,
  runLiveSyncPreflight,
  runTestAutoSync,
  isApprovedLiveSyncPath,
} from "./DeployAutoSyncService";
import {
  APPROVED_UPLOAD_BRANCH_TEST,
  type DeployWorkspaceInfo,
} from "../../shared/deploySystem";

const TEST_SHA = "a".repeat(40);
const TEST_NEW_SHA = "b".repeat(40);
const LIVE_SHA = "c".repeat(40);
const LIVE_NEW_SHA = "d".repeat(40);
const BASE_SHA = "e".repeat(40);
const TEST_REMOTE_SHA = "1".repeat(40);

interface SyncEnvOptions {
  testStatus?: string;
  nameStatus?: string;
  liveStatus?: string;
  testTypecheckOk?: boolean;
  testTestsOk?: boolean;
  liveTypecheckOk?: boolean;
  liveTestsOk?: boolean;
  liveBuildOk?: boolean;
  liveBuildLog?: string;
  pushFails?: boolean;
  verifyMismatch?: boolean;
  ahead?: string;
  nodeModules?: boolean;
  /** Exact content at the recorded baseline (per path). */
  base?: Record<string, string>;
  /** Exact content on the TEST branch (per path). */
  test?: Record<string, string>;
  /** Exact content in the LIVE working tree (per path). */
  live?: Record<string, string>;
  /** Simulated `git log` output (used to discover the baseline trailer). */
  log?: string;
  /** Extra SHAs accepted as the recorded baseline. */
  baseShas?: string[];
  /** SHA written in the fake `Sync-Test-SHA:` trailer (defaults to TEST_SHA). */
  trailerSha?: string;
  /** Fail writing this path (simulates a disk error). */
  failWritePath?: string;
  /** Simulate a sync commit that was never pushed to origin/main. */
  syncCommitUnpushed?: boolean;
}

function makeSyncEnv(options: SyncEnvOptions = {}) {
  const root = mkdtempSync(path.join(tmpdir(), "rwqan-sync-"));
  const testPath = path.join(root, "test");
  const livePath = path.join(root, "live");
  mkdirSync(testPath, { recursive: true });
  mkdirSync(livePath, { recursive: true });
  if (options.nodeModules !== false) {
    mkdirSync(path.join(livePath, "node_modules"), { recursive: true });
  }

  const testWorkspace: DeployWorkspaceInfo = {
    environment: "TEST",
    branch: APPROVED_UPLOAD_BRANCH_TEST,
    path: testPath,
    label: "TEST",
    created: false,
  };
  const liveWorkspace: DeployWorkspaceInfo = {
    environment: "LIVE",
    branch: "main",
    path: livePath,
    label: "LIVE",
    created: false,
  };

  let testHead = TEST_SHA;
  let liveHead = LIVE_SHA;
  let testRemote = TEST_REMOTE_SHA;
  let liveRemote = LIVE_SHA;
  const baseShas = new Set([BASE_SHA, ...(options.baseShas ?? [])]);
  const liveFiles: Record<string, string> = { ...(options.live ?? {}) };
  const calls = {
    run: [] as string[][],
    commit: [] as string[][],
    commitMessages: [] as string[],
    push: [] as string[][],
    writes: [] as Array<{ path: string; content: string }>,
    deletes: [] as string[],
    checks: [] as string[],
  };

  const relative = (absolutePath: string) =>
    absolutePath.replace(/\\/g, "/").replace(`${root.replace(/\\/g, "/")}/`, "").replace(/^live\//, "");

  const deps = {
    run: async (args: string[], cwd: string) => {
      calls.run.push(args);
      const inTest = cwd === testPath;
      if (args[0] === "rev-parse" && args[1] === "--abbrev-ref") {
        return inTest ? APPROVED_UPLOAD_BRANCH_TEST : "main";
      }
      if (args[0] === "rev-parse" && args[1] === "HEAD") {
        return inTest ? testHead : liveHead;
      }
      if (args[0] === "rev-parse" && args[1] === "--verify") {
        return liveRemote;
      }
      if (
        args[0] === "rev-parse" &&
        args[1] === APPROVED_UPLOAD_BRANCH_TEST
      ) {
        return TEST_SHA;
      }
      if (args[0] === "log") return options.log ?? "";
      if (args[0] === "cat-file") return "";
      if (args[0] === "merge-base" && args[1] === "--is-ancestor") {
        if (
          options.syncCommitUnpushed &&
          args.includes("origin/main") &&
          args[2] === LIVE_SHA
        ) {
          throw new Error("not an ancestor");
        }
        return "";
      }
      if (args[0] === "merge-base") return BASE_SHA;
      if (args[0] === "status") {
        return inTest ? options.testStatus ?? "" : options.liveStatus ?? "";
      }
      if (args[0] === "diff" && args[1] === "--name-status") {
        return options.nameStatus ?? "";
      }
      if (args[0] === "rev-list") return options.ahead ?? "0\t0";
      if (args[0] === "rm") {
        delete liveFiles[args[args.length - 1]];
        return "";
      }
      if (args[0] === "config" && args[1] === "--get" && args[2] === "user.name") {
        return "";
      }
      if (args[0] === "config" && args[1] === "--get" && args[2] === "user.email") {
        return "";
      }
      if (
        args[0] === "config" &&
        args[1] === "--get" &&
        args[2] === "remote.origin.url"
      ) {
        return "https://github.com/modii1/rwqan.git";
      }
      if (args[0] === "add") return "";
      if (args.includes("commit")) {
        calls.commit.push(args);
        const messageIndex = args.indexOf("-m");
        calls.commitMessages.push(messageIndex >= 0 ? args[messageIndex + 1] : "");
        if (inTest) testHead = TEST_NEW_SHA;
        else liveHead = LIVE_NEW_SHA;
        return "";
      }
      throw new Error(`unexpected git call: ${args.join(" ")}`);
    },
    runWithInput: async (args: string[], _cwd: string, _input: string) => {
      calls.run.push(args);
      return "";
    },
    showFile: async (rev: string, file: string) => {
      const source =
        rev === APPROVED_UPLOAD_BRANCH_TEST || rev === TEST_SHA
          ? options.test
          : baseShas.has(rev)
            ? options.base
            : undefined;
      if (!source || source[file] === undefined) {
        throw new Error(`missing blob ${rev}:${file}`);
      }
      return source[file];
    },
    push: async (args: string[]) => {
      calls.push.push(args);
      if (options.pushFails) throw new Error("push denied");
      if (args.includes("main")) liveRemote = liveHead;
      else testRemote = testHead;
      return "";
    },
    lsRemote: async (args: string[]) => {
      const ref = args[args.length - 1] ?? "";
      const sha = ref.includes("main") ? liveRemote : testRemote;
      return `${options.verifyMismatch ? "9".repeat(40) : sha}\t${ref}`;
    },
    readTextFile: async (absolutePath: string) => {
      const key = relative(absolutePath);
      return key in liveFiles ? liveFiles[key] : null;
    },
    writeTextFile: async (absolutePath: string, content: string) => {
      const key = relative(absolutePath);
      if (options.failWritePath === key) throw new Error("disk full");
      liveFiles[key] = content;
      calls.writes.push({ path: key, content });
    },
    deleteFile: async (absolutePath: string) => {
      const key = relative(absolutePath);
      delete liveFiles[key];
      calls.deletes.push(key);
    },
    checks: {
      typecheck: async (cwd: string) => {
        calls.checks.push(`typecheck:${cwd}`);
        return {
          ok: cwd === livePath ? options.liveTypecheckOk !== false : options.testTypecheckOk !== false,
          detail: "typecheck",
        };
      },
      tests: async (cwd: string) => {
        calls.checks.push(`tests:${cwd}`);
        return {
          ok: cwd === livePath ? options.liveTestsOk !== false : options.testTestsOk !== false,
          detail: "tests",
        };
      },
      build: async (cwd: string) => {
        calls.checks.push(`build:${cwd}`);
        const ok = options.liveBuildOk !== false;
        return {
          ok,
          detail: ok ? "build" : "TypeError: Cannot read properties of null (reading 'useContext')",
          ...(ok ? {} : { log: options.liveBuildLog ?? "full build log" }),
        };
      },
    },
  };

  return {
    root,
    testPath,
    livePath,
    testWorkspace,
    liveWorkspace,
    deps,
    calls,
    liveFiles,
    trailerSha: options.trailerSha ?? TEST_SHA,
  };
}

function noForbiddenCommands(calls: { run: string[][]; push: string[][] }): boolean {
  return calls.run
    .concat(calls.push)
    .every(
      (args) =>
        !["reset", "clean", "stash", "merge", "rebase", "checkout", "--force", "-f"].some(
          (token) => args.includes(token)
        )
    );
}

test(
  "Windows: runCheckCommand executes .cmd binaries without spawn EINVAL",
  { skip: process.platform !== "win32" },
  async () => {
    const npm = await runCheckCommand(
      "npm.cmd",
      ["--version"],
      process.cwd(),
      30_000
    );
    assert.equal(npm.ok, true, npm.detail);
    assert.match(npm.detail, /\d+\.\d+\.\d+/);

    const npx = await runCheckCommand(
      "npx.cmd",
      ["--version"],
      process.cwd(),
      30_000
    );
    assert.equal(npx.ok, true, npx.detail);
  }
);

test(
  "Windows: runCheckCommand handles a cwd and args containing spaces",
  { skip: process.platform !== "win32" },
  async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "rwqan check "));
    try {
      const npm = await runCheckCommand("npm.cmd", ["--version"], dir, 30_000);
      assert.equal(npm.ok, true, npm.detail);

      // process.execPath is normally "C:\\Program Files\\nodejs\\node.exe".
      const spaced = await runCheckCommand(
        process.execPath,
        ["-e", "console.log('hello world')"],
        dir,
        30_000
      );
      assert.equal(spaced.ok, true, spaced.detail);
      assert.match(spaced.detail, /hello world/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
);

test("runCheckCommand applies explicit environment overrides", async () => {
  const result = await runCheckCommand(
    process.execPath,
    ["-e", "console.log(process.env.NODE_ENV)"],
    process.cwd(),
    30_000,
    { NODE_ENV: "production" }
  );
  assert.equal(result.ok, true, result.detail);
  assert.match(result.detail, /production/);
});

test("runCheckCommand reports the real error line and keeps the full log", async () => {
  const script =
    "console.log('Compiled successfully');" +
    "console.error(\"TypeError: Cannot read properties of null (reading 'useContext')\");" +
    "process.exit(1);";
  const result = await runCheckCommand(
    process.execPath,
    ["-e", script],
    process.cwd(),
    30_000
  );
  assert.equal(result.ok, false);
  assert.match(result.detail, /TypeError: Cannot read properties/);
  assert.match(result.log ?? "", /Compiled successfully/);
  assert.match(result.log ?? "", /TypeError: Cannot read properties/);
});

test("runCheckCommand reports a non-zero exit as a failure", async () => {
  const result = await runCheckCommand(
    process.execPath,
    ["-e", "process.exit(2)"],
    process.cwd(),
    30_000
  );
  assert.equal(result.ok, false);
});

test("isApprovedLiveSyncPath excludes settings, docs, reports, secrets", () => {
  assert.equal(isApprovedLiveSyncPath("server/services/app.ts"), true);
  assert.equal(isApprovedLiveSyncPath("src/pages/index.tsx"), true);
  assert.equal(isApprovedLiveSyncPath("server/config/dataEnvironment.ts"), false);
  assert.equal(isApprovedLiveSyncPath("docs/README.md"), false);
  assert.equal(isApprovedLiveSyncPath("reports/x.json"), false);
  assert.equal(isApprovedLiveSyncPath(".env"), false);
  assert.equal(isApprovedLiveSyncPath("apphosting.dev.yaml"), false);
  assert.equal(isApprovedLiveSyncPath(".github/workflows/x.yml"), false);
});

test("parseApplyConflicts ignores whitespace warnings and catches real conflicts", () => {
  assert.deepEqual(
    parseApplyConflicts(
      "<stdin>:10: trailing whitespace.\nimport x from 'y';"
    ),
    []
  );
  assert.deepEqual(
    parseApplyConflicts(
      "Applied patch to 'src/a.ts' with conflicts.\nApplied patch to 'shared/deploySystem.ts' with conflicts."
    ),
    ["src/a.ts", "shared/deploySystem.ts"]
  );
});

test("TEST-only change syncs with zero conflicts and records its baseline", async () => {
  const file = "server/services/app.ts";
  const env = makeSyncEnv({
    nameStatus: `M\t${file}`,
    base: { [file]: "a\nb\nc\n" },
    test: { [file]: "a\nB\nc\n" },
    live: { [file]: "a\nb\nc\n" },
  });
  try {
    const preflight = await runLiveSyncPreflight({
      testWorkspace: env.testWorkspace,
      liveWorkspace: env.liveWorkspace,
      dependencies: env.deps,
    });
    assert.equal(preflight.canSync, true);
    assert.deepEqual(preflight.conflicts, []);
    assert.deepEqual(preflight.files, [file]);
    assert.equal(preflight.partial, false);
    assert.ok(preflight.token.length > 0);

    const result = await runLiveSync({
      testWorkspace: env.testWorkspace,
      liveWorkspace: env.liveWorkspace,
      token: preflight.token,
      confirm: true,
      dependencies: env.deps,
    });
    assert.equal(result.ok, true);
    assert.equal(result.pushed, true);
    assert.deepEqual(env.calls.writes.map((entry) => entry.path), [file]);
    assert.equal(env.calls.writes[0].content, "a\nB\nc\n");
    assert.match(env.calls.commitMessages[0], /Sync-Test-SHA: /);
  } finally {
    rmSync(env.root, { recursive: true, force: true });
  }
});

test("baseline trailer is the three-way base, not the fork point", async () => {
  const file = "server/services/app.ts";
  const recorded = "f".repeat(40);
  const env = makeSyncEnv({
    log: `cccccccccccccccccccccccccccccccccccccccc\u001fsync(LIVE): 3 ملف\n\nSync-Test-SHA: ${recorded}\u001e`,
    baseShas: [recorded],
    nameStatus: "",
    base: { [file]: "a\nb\n" },
    test: { [file]: "a\nb\n" },
    live: { [file]: "a\nb\n" },
  });
  try {
    const preflight = await runLiveSyncPreflight({
      testWorkspace: env.testWorkspace,
      liveWorkspace: env.liveWorkspace,
      dependencies: env.deps,
    });
    assert.equal(preflight.baseSource, "trailer");
    assert.equal(preflight.baseSha, recorded);
    assert.equal(preflight.canSync, false);
    assert.match(preflight.blockedReason ?? "", /منذ آخر مزامنة ناجحة/);
    const diff = env.calls.run.find(
      (args) =>
        args[0] === "diff" &&
        args[1] === "--name-status" &&
        args.includes(`${recorded}..${APPROVED_UPLOAD_BRANCH_TEST}`)
    );
    assert.ok(diff, "git diff must start at the recorded baseline");
    assert.equal(env.calls.writes.length, 0);
    assert.equal(env.calls.commit.length, 0);
  } finally {
    rmSync(env.root, { recursive: true, force: true });
  }
});

test("non-overlapping edits in the same file are merged, keeping both sides", async () => {
  const file = "server/services/app.ts";
  const env = makeSyncEnv({
    nameStatus: `M\t${file}`,
    base: { [file]: "one\ntwo\nthree\nfour\nfive\n" },
    test: { [file]: "ONE\ntwo\nthree\nfour\nfive\n" },
    live: { [file]: "one\ntwo\nthree\nfour\nFIVE\n" },
  });
  try {
    const preflight = await runLiveSyncPreflight({
      testWorkspace: env.testWorkspace,
      liveWorkspace: env.liveWorkspace,
      dependencies: env.deps,
    });
    assert.equal(preflight.canSync, true);
    assert.deepEqual(preflight.conflicts, []);

    const result = await runLiveSync({
      testWorkspace: env.testWorkspace,
      liveWorkspace: env.liveWorkspace,
      token: preflight.token,
      confirm: true,
      dependencies: env.deps,
    });
    assert.equal(result.ok, true);
    const written = env.calls.writes.find((entry) => entry.path === file);
    assert.ok(written);
    assert.match(written!.content, /^ONE\n/);
    assert.match(written!.content, /FIVE\n$/);
    assert.equal(env.liveFiles[file], written!.content);
    assert.equal(written!.content.includes("<<<<<<<"), false);
  } finally {
    rmSync(env.root, { recursive: true, force: true });
  }
});

test("a real same-line overlap is the only conflict; safe files still transfer", async () => {
  const shared = "shared/deploySystem.ts";
  const safe = "server/services/app.ts";
  const env = makeSyncEnv({
    nameStatus: [`M\t${shared}`, `M\t${safe}`].join("\n"),
    base: { [shared]: "x\ny\n", [safe]: "1\n2\n" },
    test: { [shared]: "x\nTEST\n", [safe]: "1\n2\nTEST\n" },
    live: { [shared]: "x\nLIVE\n", [safe]: "1\n2\n" },
  });
  try {
    const preflight = await runLiveSyncPreflight({
      testWorkspace: env.testWorkspace,
      liveWorkspace: env.liveWorkspace,
      dependencies: env.deps,
    });
    assert.equal(preflight.canSync, true);
    assert.equal(preflight.partial, true);
    assert.deepEqual(preflight.conflicts?.map((entry) => entry.path), [shared]);
    assert.deepEqual(preflight.files, [safe]);

    const result = await runLiveSync({
      testWorkspace: env.testWorkspace,
      liveWorkspace: env.liveWorkspace,
      token: preflight.token,
      confirm: true,
      dependencies: env.deps,
    });
    assert.equal(result.ok, true);
    assert.deepEqual(env.calls.writes.map((entry) => entry.path), [safe]);
    assert.equal(env.liveFiles[shared], "x\nLIVE\n");
    assert.equal(env.liveFiles[safe], "1\n2\nTEST\n");
    // A partial sync must NOT advance the baseline.
    assert.equal(env.calls.commitMessages[0].includes("Sync-Test-SHA:"), false);
  } finally {
    rmSync(env.root, { recursive: true, force: true });
  }
});

test("a transfer that would drop a LIVE security invariant becomes a conflict", async () => {
  const file = "server/services/DeployPrepublishGate.ts";
  const env = makeSyncEnv({
    nameStatus: `M\t${file}`,
    base: { [file]: "const gate = 1;\nDEPLOY_ALLOW_PRODUCTION\n" },
    test: { [file]: "const gate = 1;\nconst extra = 2;\n" },
    live: { [file]: "const gate = 1;\nDEPLOY_ALLOW_PRODUCTION\n" },
  });
  try {
    const preflight = await runLiveSyncPreflight({
      testWorkspace: env.testWorkspace,
      liveWorkspace: env.liveWorkspace,
      dependencies: env.deps,
    });
    assert.equal(preflight.canSync, false);
    assert.deepEqual(preflight.conflicts?.map((entry) => entry.path), [file]);
    assert.match(preflight.conflicts?.[0].reason ?? "", /DEPLOY_ALLOW_PRODUCTION/);
    assert.equal(env.calls.writes.length, 0);
  } finally {
    rmSync(env.root, { recursive: true, force: true });
  }
});

test("a new file importing a missing export from an excluded folder is blocked", async () => {
  const feature = "server/services/new-feature.ts";
  const safe = "server/services/safe.ts";
  const gate = "server/config/dataEnvironment.ts";
  const env = makeSyncEnv({
    nameStatus: [`A\t${feature}`, `M\t${safe}`].join("\n"),
    base: { [safe]: "a\n" },
    test: {
      [safe]: "a2\n",
      [feature]: 'import { missing } from "../config/dataEnvironment";\n',
    },
    live: { [safe]: "a\n", [gate]: "export const present = 1;\n" },
  });
  try {
    const preflight = await runLiveSyncPreflight({
      testWorkspace: env.testWorkspace,
      liveWorkspace: env.liveWorkspace,
      dependencies: env.deps,
    });
    assert.equal(preflight.canSync, true);
    assert.equal(preflight.partial, true);
    assert.deepEqual(preflight.files, [safe]);
    assert.deepEqual(preflight.conflicts?.map((entry) => entry.path), [feature]);
    assert.match(preflight.conflicts?.[0].reason ?? "", /missing/);
    assert.match(preflight.conflicts?.[0].reason ?? "", /dataEnvironment/);
  } finally {
    rmSync(env.root, { recursive: true, force: true });
  }
});

test("a dependency that exists in LIVE does not block the transfer", async () => {
  const feature = "server/services/new-feature.ts";
  const gate = "server/config/dataEnvironment.ts";
  const env = makeSyncEnv({
    nameStatus: `A\t${feature}`,
    base: {},
    test: {
      [feature]: 'import { present } from "../config/dataEnvironment";\n',
    },
    live: { [gate]: "export const present = 1;\n" },
  });
  try {
    const preflight = await runLiveSyncPreflight({
      testWorkspace: env.testWorkspace,
      liveWorkspace: env.liveWorkspace,
      dependencies: env.deps,
    });
    assert.deepEqual(preflight.conflicts, []);
    assert.deepEqual(preflight.files, [feature]);
  } finally {
    rmSync(env.root, { recursive: true, force: true });
  }
});

test("a dependency supplied by the same transfer is accepted", async () => {
  const helper = "shared/helper.ts";
  const feature = "server/services/new-feature.ts";
  const env = makeSyncEnv({
    nameStatus: [`A\t${feature}`, `A\t${helper}`].join("\n"),
    base: {},
    test: {
      [feature]: 'import { helper } from "../../shared/helper";\n',
      [helper]: "export const helper = 1;\n",
    },
    live: {},
  });
  try {
    const preflight = await runLiveSyncPreflight({
      testWorkspace: env.testWorkspace,
      liveWorkspace: env.liveWorkspace,
      dependencies: env.deps,
    });
    assert.deepEqual(preflight.conflicts, []);
    assert.deepEqual(preflight.files?.slice().sort(), [feature, helper].sort());
  } finally {
    rmSync(env.root, { recursive: true, force: true });
  }
});

test("a missing relative module blocks only the dependent file", async () => {
  const feature = "server/services/new-feature.ts";
  const safe = "server/services/safe.ts";
  const env = makeSyncEnv({
    nameStatus: [`A\t${feature}`, `M\t${safe}`].join("\n"),
    base: { [safe]: "a\n" },
    test: {
      [safe]: "a2\n",
      [feature]: 'import { x } from "../missing/module";\n',
    },
    live: { [safe]: "a\n" },
  });
  try {
    const preflight = await runLiveSyncPreflight({
      testWorkspace: env.testWorkspace,
      liveWorkspace: env.liveWorkspace,
      dependencies: env.deps,
    });
    assert.deepEqual(preflight.files, [safe]);
    assert.deepEqual(preflight.conflicts?.map((entry) => entry.path), [feature]);
    assert.match(preflight.conflicts?.[0].reason ?? "", /غير موجودة في LIVE/);
  } finally {
    rmSync(env.root, { recursive: true, force: true });
  }
});

test("import-looking text inside a string is not treated as a dependency", async () => {
  const fixture = "server/services/fixtures.test.ts";
  const env = makeSyncEnv({
    nameStatus: `A\t${fixture}`,
    base: {},
    test: {
      [fixture]:
        'const sample = \'import { missing } from "../config/dataEnvironment";\';\nexport const ok = 1;\n',
    },
    live: {},
  });
  try {
    const preflight = await runLiveSyncPreflight({
      testWorkspace: env.testWorkspace,
      liveWorkspace: env.liveWorkspace,
      dependencies: env.deps,
    });
    assert.deepEqual(preflight.conflicts, []);
    assert.deepEqual(preflight.files, [fixture]);
  } finally {
    rmSync(env.root, { recursive: true, force: true });
  }
});

test("an unpushed sync commit is not trusted as the baseline", async () => {
  const recorded = "f".repeat(40);
  const file = "server/services/app.ts";
  const env = makeSyncEnv({
    log: `${LIVE_SHA}\u001fsync(LIVE): 1 ملف\n\nSync-Test-SHA: ${recorded}\u001e`,
    baseShas: [recorded],
    syncCommitUnpushed: true,
    nameStatus: `M\t${file}`,
    base: { [file]: "a\nb\n" },
    test: { [file]: "a\nb2\n" },
    live: { [file]: "a\nb\n" },
  });
  try {
    const preflight = await runLiveSyncPreflight({
      testWorkspace: env.testWorkspace,
      liveWorkspace: env.liveWorkspace,
      dependencies: env.deps,
    });
    assert.notEqual(preflight.baseSource, "trailer");
    assert.notEqual(preflight.baseSha, recorded);
  } finally {
    rmSync(env.root, { recursive: true, force: true });
  }
});

test("without a trailer the last LIVE sync commit is used as the baseline", async () => {
  const file = "server/services/app.ts";
  const env = makeSyncEnv({
    log: `dddddddddddddddddddddddddddddddddddddddd\u001fsync(LIVE): 5 ملف — 3 معدّل\u001e`,
    baseShas: [LIVE_NEW_SHA],
    nameStatus: `M\t${file}`,
    base: { [file]: "a\nb\n" },
    test: { [file]: "a\nb2\n" },
    live: { [file]: "a\nb\n" },
  });
  try {
    const preflight = await runLiveSyncPreflight({
      testWorkspace: env.testWorkspace,
      liveWorkspace: env.liveWorkspace,
      dependencies: env.deps,
    });
    assert.equal(preflight.baseSource, "last-sync");
    assert.equal(preflight.baseSha, LIVE_NEW_SHA);
    assert.match(preflight.baseWarning ?? "", /آخر commit مزامنة/);
    assert.equal(preflight.canSync, true);
  } finally {
    rmSync(env.root, { recursive: true, force: true });
  }
});

test("CRLF and BOM differences are never reported as conflicts", async () => {
  const file = "server/services/app.ts";
  const env = makeSyncEnv({
    nameStatus: `M\t${file}`,
    base: { [file]: "a\nb\n" },
    test: { [file]: "\uFEFFa\r\nb\r\n" },
    live: { [file]: "a\nb\n" },
  });
  try {
    const preflight = await runLiveSyncPreflight({
      testWorkspace: env.testWorkspace,
      liveWorkspace: env.liveWorkspace,
      dependencies: env.deps,
    });
    assert.deepEqual(preflight.conflicts, []);
    assert.equal(preflight.canSync, false);
    assert.match(preflight.blockedReason ?? "", /منذ آخر مزامنة ناجحة/);
    assert.equal(env.calls.writes.length, 0);
    assert.equal(env.calls.commit.length, 0);
  } finally {
    rmSync(env.root, { recursive: true, force: true });
  }
});

test("repeating a sync after success produces no changes or conflicts", async () => {
  const file = "server/services/app.ts";
  const env = makeSyncEnv({
    log: `cccccccccccccccccccccccccccccccccccccccc\u001fsync(LIVE): 1 ملف\n\nSync-Test-SHA: ${TEST_SHA}\u001e`,
    baseShas: [TEST_SHA],
    nameStatus: "",
    base: { [file]: "a\nB\n" },
    test: { [file]: "a\nB\n" },
    live: { [file]: "a\nB\n" },
  });
  try {
    const preflight = await runLiveSyncPreflight({
      testWorkspace: env.testWorkspace,
      liveWorkspace: env.liveWorkspace,
      dependencies: env.deps,
    });
    assert.equal(preflight.canSync, false);
    assert.deepEqual(preflight.conflicts, []);
    assert.equal(env.calls.writes.length, 0);
    assert.equal(env.calls.commit.length, 0);
    assert.equal(env.calls.push.length, 0);
  } finally {
    rmSync(env.root, { recursive: true, force: true });
  }
});

test("TEST sync commits only meaningful changes and verifies the push", async () => {
  const env = makeSyncEnv({
    testStatus: " M src/a.ts\n?? reports/out.json",
  });
  try {
    const result = await runTestAutoSync({
      workspace: env.testWorkspace,
      dependencies: env.deps,
    });
    assert.equal(result.ok, true);
    assert.equal(result.pushed, true);
    assert.equal(result.commitSha, TEST_NEW_SHA);
    assert.equal(result.changeCount, 1);
    const commitCall = env.calls.commit[0];
    assert.ok(commitCall.includes("src/a.ts"));
    assert.equal(commitCall.includes("reports/out.json"), false);
    assert.deepEqual(env.calls.push, [["push", "origin", APPROVED_UPLOAD_BRANCH_TEST]]);
    assert.equal(noForbiddenCommands(env.calls), true);
  } finally {
    rmSync(env.root, { recursive: true, force: true });
  }
});

test("TEST sync reports no updates when nothing changed", async () => {
  const env = makeSyncEnv({ testStatus: "" });
  try {
    const result = await runTestAutoSync({
      workspace: env.testWorkspace,
      dependencies: env.deps,
    });
    assert.equal(result.ok, true);
    assert.equal(result.skipped, true);
    assert.equal(env.calls.commit.length, 0);
    assert.equal(env.calls.push.length, 0);
  } finally {
    rmSync(env.root, { recursive: true, force: true });
  }
});

test("TEST sync refuses secret-looking files", async () => {
  const env = makeSyncEnv({ testStatus: "?? .env" });
  try {
    const result = await runTestAutoSync({
      workspace: env.testWorkspace,
      dependencies: env.deps,
    });
    assert.equal(result.ok, false);
    assert.match(result.detail, /حساسة/);
    assert.equal(env.calls.commit.length, 0);
    assert.equal(env.calls.push.length, 0);
  } finally {
    rmSync(env.root, { recursive: true, force: true });
  }
});

test("TEST sync stops when tests fail", async () => {
  const env = makeSyncEnv({
    testStatus: " M src/a.ts",
    testTestsOk: false,
  });
  try {
    const result = await runTestAutoSync({
      workspace: env.testWorkspace,
      dependencies: env.deps,
    });
    assert.equal(result.ok, false);
    assert.equal(result.stage, "checks");
    assert.match(result.detail, /فشل الفحص/);
    assert.equal(env.calls.commit.length, 0);
    assert.equal(env.calls.push.length, 0);
    assert.equal(env.calls.writes.length, 0);
  } finally {
    rmSync(env.root, { recursive: true, force: true });
  }
});

test("LIVE preflight plans only approved code paths", async () => {
  const env = makeSyncEnv({
    nameStatus: [
      "M\tserver/services/app.ts",
      "A\tsrc/new-feature.ts",
      "M\tserver/config/dataEnvironment.ts",
      "M\tdocs/GUIDE.md",
      "M\treports/data.json",
    ].join("\n"),
    base: {
      "server/services/app.ts": "a\n",
    },
    test: {
      "server/services/app.ts": "a\nb\n",
      "src/new-feature.ts": "new\n",
    },
    live: { "server/services/app.ts": "a\n" },
  });
  try {
    const preflight = await runLiveSyncPreflight({
      testWorkspace: env.testWorkspace,
      liveWorkspace: env.liveWorkspace,
      dependencies: env.deps,
    });
    assert.equal(preflight.canSync, true);
    assert.equal(preflight.counts.total, 2);
    assert.match(preflight.detail, /استُثني 3/);
    assert.ok(preflight.token.length > 0);
    assert.deepEqual(preflight.files, [
      "server/services/app.ts",
      "src/new-feature.ts",
    ]);
    assert.equal(
      preflight.files?.includes("server/config/dataEnvironment.ts"),
      false
    );
    assert.equal(preflight.files?.includes("docs/GUIDE.md"), false);
  } finally {
    rmSync(env.root, { recursive: true, force: true });
  }
});

test("LIVE preflight blocks a dirty live worktree", async () => {
  const env = makeSyncEnv({
    nameStatus: "M\tserver/services/app.ts",
    liveStatus: " M src/live-local.ts",
  });
  try {
    const preflight = await runLiveSyncPreflight({
      testWorkspace: env.testWorkspace,
      liveWorkspace: env.liveWorkspace,
      dependencies: env.deps,
    });
    assert.equal(preflight.canSync, false);
    assert.match(preflight.blockedReason ?? "", /تغييرات محلية/);
  } finally {
    rmSync(env.root, { recursive: true, force: true });
  }
});

test("LIVE preflight blocks missing node_modules", async () => {
  const env = makeSyncEnv({
    nameStatus: "M\tserver/services/app.ts",
    nodeModules: false,
  });
  try {
    const preflight = await runLiveSyncPreflight({
      testWorkspace: env.testWorkspace,
      liveWorkspace: env.liveWorkspace,
      dependencies: env.deps,
    });
    assert.equal(preflight.canSync, false);
    assert.match(preflight.blockedReason ?? "", /node_modules/);
  } finally {
    rmSync(env.root, { recursive: true, force: true });
  }
});

test("LIVE preflight reports the exact conflicting file and writes nothing", async () => {
  const file = "server/services/app.ts";
  const env = makeSyncEnv({
    nameStatus: `M\t${file}`,
    base: { [file]: "x\ny\n" },
    test: { [file]: "x\nTEST\n" },
    live: { [file]: "x\nLIVE\n" },
  });
  try {
    const preflight = await runLiveSyncPreflight({
      testWorkspace: env.testWorkspace,
      liveWorkspace: env.liveWorkspace,
      dependencies: env.deps,
    });
    assert.equal(preflight.canSync, false);
    assert.deepEqual(preflight.conflicts?.map((entry) => entry.path), [file]);
    assert.match(preflight.conflicts?.[0].reason ?? "", /الأسطر نفسها/);
    assert.match(preflight.blockedReason ?? "", /server\/services\/app\.ts/);
    assert.equal(preflight.token, "");
    assert.equal(env.calls.writes.length, 0);
  } finally {
    rmSync(env.root, { recursive: true, force: true });
  }
});

test("LIVE sync transfers only approved code, checks, commits and pushes", async () => {
  const env = makeSyncEnv({
    nameStatus: [
      "M\tserver/services/app.ts",
      "A\tsrc/new-feature.ts",
      "M\tserver/config/dataEnvironment.ts",
      "M\tdocs/GUIDE.md",
    ].join("\n"),
    base: {
      "server/services/app.ts": "a\n",
    },
    test: {
      "server/services/app.ts": "a\nb\n",
      "src/new-feature.ts": "new\n",
    },
    live: { "server/services/app.ts": "a\n" },
  });
  try {
    const preflight = await runLiveSyncPreflight({
      testWorkspace: env.testWorkspace,
      liveWorkspace: env.liveWorkspace,
      dependencies: env.deps,
    });
    assert.equal(preflight.canSync, true);

    const result = await runLiveSync({
      testWorkspace: env.testWorkspace,
      liveWorkspace: env.liveWorkspace,
      token: preflight.token,
      confirm: true,
      dependencies: env.deps,
    });

    assert.equal(result.ok, true);
    assert.equal(result.pushed, true);
    assert.equal(result.commitSha, LIVE_NEW_SHA);
    assert.equal(result.changeCount, 2);
    assert.deepEqual(env.calls.writes.map((entry) => entry.path), [
      "server/services/app.ts",
      "src/new-feature.ts",
    ]);
    assert.equal(
      env.calls.writes.some((entry) => entry.path.includes("dataEnvironment")),
      false
    );
    assert.equal(
      env.calls.writes.some((entry) => entry.path.includes("GUIDE")),
      false
    );
    assert.deepEqual(
      env.calls.checks.filter((entry) => entry.startsWith("typecheck:")),
      [`typecheck:${env.livePath}`]
    );
    assert.deepEqual(env.calls.push, [["push", "origin", "main"]]);
    assert.equal(noForbiddenCommands(env.calls), true);
    assert.match(env.calls.commitMessages[0], /Sync-Test-SHA: /);
  } finally {
    rmSync(env.root, { recursive: true, force: true });
  }
});

test("LIVE sync restores every written file when the build fails", async () => {
  const file = "server/services/app.ts";
  const env = makeSyncEnv({
    nameStatus: `M\t${file}`,
    base: { [file]: "a\nb\n" },
    test: { [file]: "a\nB\n" },
    live: { [file]: "a\nb\n" },
    liveBuildOk: false,
    liveBuildLog:
      "> next build\n✓ Compiled successfully\nError occurred prerendering page \"/_global-error\"\nTypeError: Cannot read properties of null (reading 'useContext')\nBuild failed",
  });
  try {
    const preflight = await runLiveSyncPreflight({
      testWorkspace: env.testWorkspace,
      liveWorkspace: env.liveWorkspace,
      dependencies: env.deps,
    });
    const result = await runLiveSync({
      testWorkspace: env.testWorkspace,
      liveWorkspace: env.liveWorkspace,
      token: preflight.token,
      confirm: true,
      dependencies: env.deps,
    });
    assert.equal(result.ok, false);
    assert.match(result.detail, /فشل البناء/);
    assert.match(result.failureLog ?? "", /Compiled successfully/);
    assert.match(result.failureLog ?? "", /TypeError: Cannot read properties/);
    assert.ok(
      env.calls.writes.some(
        (entry) => entry.path === file && entry.content === "a\nB\n"
      )
    );
    // Byte-for-byte restoration: no reset, no checkout, no stash.
    assert.equal(env.liveFiles[file], "a\nb\n");
    // A pre-existing file must be restored, never deleted.
    assert.deepEqual(env.calls.deletes, []);
    assert.equal(env.calls.commit.length, 0);
    assert.equal(env.calls.push.length, 0);
  } finally {
    rmSync(env.root, { recursive: true, force: true });
  }
});

test("LIVE sync deletes files it created when the build fails", async () => {
  const created = "server/services/new-feature.ts";
  const env = makeSyncEnv({
    nameStatus: `A\t${created}`,
    base: {},
    test: { [created]: "export const x = 1;\n" },
    live: {},
    liveBuildOk: false,
  });
  try {
    const preflight = await runLiveSyncPreflight({
      testWorkspace: env.testWorkspace,
      liveWorkspace: env.liveWorkspace,
      dependencies: env.deps,
    });
    assert.equal(preflight.canSync, true);
    assert.deepEqual(preflight.files, [created]);

    const result = await runLiveSync({
      testWorkspace: env.testWorkspace,
      liveWorkspace: env.liveWorkspace,
      token: preflight.token,
      confirm: true,
      dependencies: env.deps,
    });
    assert.equal(result.ok, false);
    assert.ok(env.calls.writes.some((entry) => entry.path === created));
    // The new file must be gone from the filesystem after the rollback.
    assert.equal(created in env.liveFiles, false);
    assert.deepEqual(env.calls.deletes, [created]);
    assert.equal(env.calls.commit.length, 0);
    assert.equal(env.calls.push.length, 0);
  } finally {
    rmSync(env.root, { recursive: true, force: true });
  }
});

test("LIVE sync restores existing files and deletes only the new ones", async () => {
  const existing = "server/services/app.ts";
  const created = "server/services/new-feature.ts";
  const env = makeSyncEnv({
    nameStatus: [`M\t${existing}`, `A\t${created}`].join("\n"),
    base: { [existing]: "old\n" },
    test: { [existing]: "new\n", [created]: "created\n" },
    live: { [existing]: "old\n" },
    liveBuildOk: false,
  });
  try {
    const preflight = await runLiveSyncPreflight({
      testWorkspace: env.testWorkspace,
      liveWorkspace: env.liveWorkspace,
      dependencies: env.deps,
    });
    const result = await runLiveSync({
      testWorkspace: env.testWorkspace,
      liveWorkspace: env.liveWorkspace,
      token: preflight.token,
      confirm: true,
      dependencies: env.deps,
    });
    assert.equal(result.ok, false);
    assert.equal(env.liveFiles[existing], "old\n");
    assert.equal(created in env.liveFiles, false);
    assert.deepEqual(env.calls.deletes, [created]);
    assert.equal(env.calls.commit.length, 0);
    assert.equal(env.calls.push.length, 0);
  } finally {
    rmSync(env.root, { recursive: true, force: true });
  }
});

test("LIVE sync deletes a created file when a later write fails", async () => {
  const created = "server/services/new-a.ts";
  const failing = "server/services/b.ts";
  const env = makeSyncEnv({
    nameStatus: [`A\t${created}`, `M\t${failing}`].join("\n"),
    base: { [failing]: "b\n" },
    test: { [created]: "a\n", [failing]: "b2\n" },
    live: { [failing]: "b\n" },
    failWritePath: failing,
  });
  try {
    const preflight = await runLiveSyncPreflight({
      testWorkspace: env.testWorkspace,
      liveWorkspace: env.liveWorkspace,
      dependencies: env.deps,
    });
    const result = await runLiveSync({
      testWorkspace: env.testWorkspace,
      liveWorkspace: env.liveWorkspace,
      token: preflight.token,
      confirm: true,
      dependencies: env.deps,
    });
    assert.equal(result.ok, false);
    assert.equal(created in env.liveFiles, false);
    assert.equal(env.liveFiles[failing], "b\n");
    assert.deepEqual(env.calls.deletes, [created]);
    assert.equal(env.calls.commit.length, 0);
  } finally {
    rmSync(env.root, { recursive: true, force: true });
  }
});

test("LIVE sync restores earlier files when a later write fails", async () => {
  const first = "server/services/a.ts";
  const second = "server/services/b.ts";
  const env = makeSyncEnv({
    nameStatus: [`M\t${first}`, `M\t${second}`].join("\n"),
    base: { [first]: "a\n", [second]: "b\n" },
    test: { [first]: "a2\n", [second]: "b2\n" },
    live: { [first]: "a\n", [second]: "b\n" },
    failWritePath: second,
  });
  try {
    const preflight = await runLiveSyncPreflight({
      testWorkspace: env.testWorkspace,
      liveWorkspace: env.liveWorkspace,
      dependencies: env.deps,
    });
    const result = await runLiveSync({
      testWorkspace: env.testWorkspace,
      liveWorkspace: env.liveWorkspace,
      token: preflight.token,
      confirm: true,
      dependencies: env.deps,
    });
    assert.equal(result.ok, false);
    assert.match(result.detail, /تعذّر كتابة/);
    assert.equal(env.liveFiles[first], "a\n");
    assert.equal(env.liveFiles[second], "b\n");
    assert.equal(env.calls.commit.length, 0);
    assert.equal(env.calls.push.length, 0);
  } finally {
    rmSync(env.root, { recursive: true, force: true });
  }
});

test("LIVE sync refuses a token from a changed Git state", async () => {
  const file = "server/services/app.ts";
  const env = makeSyncEnv({
    nameStatus: `M\t${file}`,
    base: { [file]: "a\n" },
    test: { [file]: "a2\n" },
    live: { [file]: "a\n" },
  });
  try {
    const result = await runLiveSync({
      testWorkspace: env.testWorkspace,
      liveWorkspace: env.liveWorkspace,
      token: "stale-token",
      confirm: true,
      dependencies: env.deps,
    });
    assert.equal(result.ok, false);
    assert.match(result.detail, /تغيّرت حالة Git/);
    assert.equal(env.calls.writes.length, 0);
    assert.equal(env.calls.commit.length, 0);
  } finally {
    rmSync(env.root, { recursive: true, force: true });
  }
});
