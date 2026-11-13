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
  applyCheckFails?: boolean;
  applyCheckConflicts?: string[];
  applyCheckOutput?: string;
  pushFails?: boolean;
  verifyMismatch?: boolean;
  ahead?: string;
  nodeModules?: boolean;
  files?: Record<string, string>;
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
  const calls = {
    run: [] as string[][],
    commit: [] as string[][],
    push: [] as string[][],
    apply: [] as string[],
    reverse: [] as string[],
    checks: [] as string[],
  };

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
      if (
        args[0] === "rev-parse" &&
        args[1] === APPROVED_UPLOAD_BRANCH_TEST
      ) {
        return TEST_SHA;
      }
      if (args[0] === "merge-base") return BASE_SHA;
      if (args[0] === "status") {
        return inTest ? options.testStatus ?? "" : options.liveStatus ?? "";
      }
      if (args[0] === "diff" && args[1] === "--name-status") {
        return options.nameStatus ?? "";
      }
      if (args[0] === "diff" && args[1] === "--binary") {
        return `PATCH:${args.slice(4).join(",")}`;
      }
      if (args[0] === "rev-list") return options.ahead ?? "0\t0";
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
        if (inTest) testHead = TEST_NEW_SHA;
        else liveHead = LIVE_NEW_SHA;
        return "";
      }
      throw new Error(`unexpected git call: ${args.join(" ")}`);
    },
    runWithInput: async (args: string[], _cwd: string, input: string) => {
      if (args[0] === "apply" && args.includes("--check")) {
        if (options.applyCheckFails) throw new Error("conflict in file");
        if (options.applyCheckConflicts?.length) {
          return options.applyCheckConflicts
            .map((file) => `Applied patch to '${file}' with conflicts.`)
            .join("\n");
        }
        return options.applyCheckOutput ?? "";
      }
      if (args[0] === "apply" && args.includes("-R")) {
        calls.reverse.push(input);
        return "";
      }
      if (args[0] === "apply") {
        calls.apply.push(input);
        return "";
      }
      return "";
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
      const normalized = absolutePath.replace(/\\/g, "/");
      const key = Object.keys(options.files ?? {}).find((entry) =>
        normalized.endsWith(entry)
      );
      return key ? options.files?.[key] ?? null : null;
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

  return { root, testPath, livePath, testWorkspace, liveWorkspace, deps, calls };
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

test("LIVE preflight blocks real 3-way conflicts and applies nothing", async () => {
  const env = makeSyncEnv({
    nameStatus: "M\tserver/services/app.ts\nM\tshared/deploySystem.ts",
    applyCheckConflicts: ["shared/deploySystem.ts"],
  });
  try {
    const preflight = await runLiveSyncPreflight({
      testWorkspace: env.testWorkspace,
      liveWorkspace: env.liveWorkspace,
      dependencies: env.deps,
    });
    assert.equal(preflight.canSync, false);
    assert.match(preflight.blockedReason ?? "", /تعارض حقيقي/);
    assert.match(preflight.blockedReason ?? "", /shared\/deploySystem\.ts/);
    assert.equal(preflight.token, "");
    assert.equal(env.calls.apply.length, 0);
  } finally {
    rmSync(env.root, { recursive: true, force: true });
  }
});

test("LIVE preflight does not treat whitespace warnings as a conflict", async () => {
  const env = makeSyncEnv({
    nameStatus: "M\tserver/services/app.ts",
    applyCheckOutput: "<stdin>:4: trailing whitespace.\nimport x from 'y';",
  });
  try {
    const preflight = await runLiveSyncPreflight({
      testWorkspace: env.testWorkspace,
      liveWorkspace: env.liveWorkspace,
      dependencies: env.deps,
    });
    assert.equal(preflight.canSync, true);
    assert.ok(preflight.token.length > 0);
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
    assert.equal(env.calls.apply.length, 0);
  } finally {
    rmSync(env.root, { recursive: true, force: true });
  }
});

test("LIVE preflight counts only approved code paths and hides files", async () => {
  const env = makeSyncEnv({
    nameStatus: [
      "M\tserver/services/app.ts",
      "A\tsrc/new-feature.ts",
      "M\tserver/config/dataEnvironment.ts",
      "M\tdocs/GUIDE.md",
      "M\treports/data.json",
    ].join("\n"),
  });
  try {
    const preflight = await runLiveSyncPreflight({
      testWorkspace: env.testWorkspace,
      liveWorkspace: env.liveWorkspace,
      dependencies: env.deps,
    });
    assert.equal(preflight.canSync, true);
    assert.equal(preflight.approvedCount, 2);
    assert.equal(preflight.counts.total, 2);
    assert.match(preflight.detail, /استُثني 3/);
    assert.ok(preflight.token.length > 0);
    const binaryCall = env.calls.run.find(
      (args) => args[0] === "diff" && args[1] === "--binary"
    );
    assert.ok(binaryCall);
    assert.ok(binaryCall!.includes("server/services/app.ts"));
    assert.ok(binaryCall!.includes("src/new-feature.ts"));
    assert.equal(binaryCall!.includes("server/config/dataEnvironment.ts"), false);
    assert.equal(binaryCall!.includes("docs/GUIDE.md"), false);
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

test("LIVE preflight blocks a patch conflict", async () => {
  const env = makeSyncEnv({
    nameStatus: "M\tserver/services/app.ts",
    applyCheckFails: true,
  });
  try {
    const preflight = await runLiveSyncPreflight({
      testWorkspace: env.testWorkspace,
      liveWorkspace: env.liveWorkspace,
      dependencies: env.deps,
    });
    assert.equal(preflight.canSync, false);
    assert.match(preflight.blockedReason ?? "", /تعارض/);
  } finally {
    rmSync(env.root, { recursive: true, force: true });
  }
});

test("LIVE sync applies only approved code, checks, commits and pushes", async () => {
  const env = makeSyncEnv({
    nameStatus: [
      "M\tserver/services/app.ts",
      "A\tsrc/new-feature.ts",
      "M\tserver/config/dataEnvironment.ts",
      "M\tdocs/GUIDE.md",
    ].join("\n"),
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
    assert.equal(env.calls.apply.length, 1);
    assert.ok(env.calls.apply[0].includes("server/services/app.ts"));
    assert.equal(env.calls.apply[0].includes("server/config/dataEnvironment.ts"), false);
    assert.equal(env.calls.apply[0].includes("docs/GUIDE.md"), false);
    assert.deepEqual(
      env.calls.checks.filter((entry) => entry.startsWith("typecheck:")),
      [`typecheck:${env.livePath}`]
    );
    assert.deepEqual(env.calls.push, [["push", "origin", "main"]]);
    assert.equal(noForbiddenCommands(env.calls), true);
  } finally {
    rmSync(env.root, { recursive: true, force: true });
  }
});

test("LIVE sync reverses its patch when the build fails", async () => {
  const env = makeSyncEnv({
    nameStatus: "M\tserver/services/app.ts",
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
    assert.equal(env.calls.apply.length, 1);
    assert.equal(env.calls.reverse.length, 1);
    assert.equal(env.calls.commit.length, 0);
    assert.equal(env.calls.push.length, 0);
  } finally {
    rmSync(env.root, { recursive: true, force: true });
  }
});

test("LIVE sync refuses a token from a changed Git state", async () => {
  const env = makeSyncEnv({
    nameStatus: "M\tserver/services/app.ts",
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
    assert.equal(env.calls.apply.length, 0);
    assert.equal(env.calls.commit.length, 0);
  } finally {
    rmSync(env.root, { recursive: true, force: true });
  }
});
