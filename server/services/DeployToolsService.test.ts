import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  parseFirebaseCliVersion,
  readDeployToolsInfo,
  resetDeployToolsCache,
  resolveFirebaseCommand,
  type DeployToolsDependencies,
} from "./DeployToolsService";

function runner(stdout: string | null): DeployToolsDependencies {
  return { async readFirebaseVersion() { return stdout; } };
}

test("parseFirebaseCliVersion extracts a plain semver from the raw output", () => {
  // Real `firebase --version` prints lines of tools with versions.
  const output = "15.34.0\nFirestore Emulator: 4.x.y\nStorage Emulator: 5.2.1";
  assert.equal(parseFirebaseCliVersion(output), "15.34.0");
  assert.equal(parseFirebaseCliVersion("9.23.0"), "9.23.0");
});

test("parseFirebaseCliVersion fails closed (null) on unparsable output", () => {
  assert.equal(parseFirebaseCliVersion(""), null);
  assert.equal(parseFirebaseCliVersion("not-a-version"), null);
});

test("readDeployToolsInfo is available with a version, without any network call", async () => {
  resetDeployToolsCache();
  let callCount = 0;
  const info = await readDeployToolsInfo({
    async readFirebaseVersion() {
      callCount += 1;
      return "15.34.0";
    },
  });
  assert.equal(info.firebaseCliAvailable, true);
  assert.equal(info.firebaseCliVersion, "15.34.0");
  assert.equal(typeof info.readAt, "string");
  assert.equal(callCount, 1);
});

test("readDeployToolsInfo fails closed when the CLI is missing or crashes", async () => {
  resetDeployToolsCache();
  for (const stdout of [null, ""] as const) {
    resetDeployToolsCache();
    const info = await readDeployToolsInfo(runner(stdout));
    assert.equal(info.firebaseCliAvailable, false);
    assert.equal(info.firebaseCliVersion, null);
  }
  // An unexpected runner crash is also contained — never thrown.
  resetDeployToolsCache();
  const info = await readDeployToolsInfo({
    async readFirebaseVersion(): Promise<string | null> {
      throw new Error("boom");
    },
  });
  assert.equal(info.firebaseCliAvailable, false);
});

test("readDeployToolsInfo caches the result for the TTL window", async () => {
  resetDeployToolsCache();
  let callCount = 0;
  const first = await readDeployToolsInfo({
    async readFirebaseVersion() {
      callCount += 1;
      return "15.34.0";
    },
  });
  const second = await readDeployToolsInfo({
    async readFirebaseVersion() {
      callCount += 1;
      return "99.0.0";
    },
  });
  assert.equal(callCount, 1, "the second read must be served from the cache");
  assert.deepEqual(second, first);
  // A reset forgets the cache and re-probes.
  resetDeployToolsCache();
  const third = await readDeployToolsInfo(runner("9.0.0"));
  assert.equal(third.firebaseCliVersion, "9.0.0");
});

/**
 * Build an isolated PATH fixture containing a `firebase.cmd` shim and a
 * firebase-tools package with a JS entry, in either npm layout:
 *  - "prefix": <prefix>/firebase.cmd + <prefix>/node_modules/firebase-tools
 *  - "bin":    <root>/node_modules/.bin/firebase.cmd + <root>/node_modules/...
 */
function makeFirebaseFixture(layout: "prefix" | "bin"): {
  shimDir: string;
  entry: string;
  dispose(): void;
} {
  const root = mkdtempSync(path.join(os.tmpdir(), "rwqan-firebase-fixture-"));
  const pkgDir = path.join(root, "node_modules", "firebase-tools");
  const shimDir =
    layout === "prefix" ? root : path.join(root, "node_modules", ".bin");
  mkdirSync(pkgDir, { recursive: true });
  mkdirSync(shimDir, { recursive: true });
  writeFileSync(path.join(shimDir, "firebase.cmd"), "@ECHO off\r\n");
  writeFileSync(
    path.join(pkgDir, "package.json"),
    JSON.stringify({
      name: "firebase-tools",
      version: "0.0.0-fixture",
      bin: { firebase: "./lib/bin/firebase.js" },
    }),
  );
  const entry = path.join(pkgDir, "lib", "bin", "firebase.js");
  mkdirSync(path.dirname(entry), { recursive: true });
  writeFileSync(entry, "");
  return {
    shimDir,
    entry,
    dispose: () => rmSync(root, { recursive: true, force: true }),
  };
}

test("resolveFirebaseCommand keeps the plain spawn on non-windows platforms", () => {
  assert.deepEqual(resolveFirebaseCommand({ PATH: "/usr/bin" }, "linux"), {
    file: "firebase",
    prefixArgs: [],
  });
  assert.deepEqual(resolveFirebaseCommand({ PATH: "/usr/bin" }, "darwin"), {
    file: "firebase",
    prefixArgs: [],
  });
});

test("resolveFirebaseCommand runs the package JS entry via process.execPath (global prefix layout)", () => {
  const fixture = makeFirebaseFixture("prefix");
  try {
    const resolved = resolveFirebaseCommand({ PATH: fixture.shimDir }, "win32");
    assert.equal(resolved.file, process.execPath);
    assert.deepEqual(resolved.prefixArgs, [fixture.entry]);
  } finally {
    fixture.dispose();
  }
});

test("resolveFirebaseCommand also resolves the node_modules/.bin layout", () => {
  const fixture = makeFirebaseFixture("bin");
  try {
    const resolved = resolveFirebaseCommand({ PATH: fixture.shimDir }, "win32");
    assert.equal(resolved.file, process.execPath);
    assert.deepEqual(resolved.prefixArgs, [fixture.entry]);
  } finally {
    fixture.dispose();
  }
});

test("resolveFirebaseCommand fails closed to the plain spawn when the package is missing", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "rwqan-firebase-shim-only-"));
  try {
    writeFileSync(path.join(root, "firebase.cmd"), "@ECHO off\r\n");
    const resolved = resolveFirebaseCommand({ PATH: root }, "win32");
    assert.deepEqual(resolved, { file: "firebase", prefixArgs: [] });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("resolveFirebaseCommand fails closed when package.json is unreadable", () => {
  const fixture = makeFirebaseFixture("prefix");
  try {
    writeFileSync(
      path.join(fixture.shimDir, "node_modules", "firebase-tools", "package.json"),
      "{ not json",
    );
    const resolved = resolveFirebaseCommand({ PATH: fixture.shimDir }, "win32");
    assert.deepEqual(resolved, { file: "firebase", prefixArgs: [] });
  } finally {
    fixture.dispose();
  }
});

test("resolveFirebaseCommand fails closed when PATH contains no firebase shim", () => {
  assert.deepEqual(resolveFirebaseCommand({ PATH: "" }, "win32"), {
    file: "firebase",
    prefixArgs: [],
  });
  assert.deepEqual(resolveFirebaseCommand({}, "win32"), {
    file: "firebase",
    prefixArgs: [],
  });
});

// Real end-to-end proof on a machine where the entry resolves: the probe must
// report the genuinely installed CLI (no network, no deploy — just --version).
const REAL_RESOLVED = resolveFirebaseCommand();
const REAL_ENTRY_RESOLVED =
  process.platform === "win32" && REAL_RESOLVED.prefixArgs.length > 0;

test(
  "real machine probe reports the installed firebase CLI through the resolved entry",
  {
    skip: REAL_ENTRY_RESOLVED
      ? false
      : "firebase-tools entry not resolvable on this machine",
  },
  async () => {
    resetDeployToolsCache();
    try {
      const info = await readDeployToolsInfo();
      assert.equal(info.firebaseCliAvailable, true);
      assert.ok(
        info.firebaseCliVersion,
        "a parseable version is expected on this machine",
      );
    } finally {
      resetDeployToolsCache();
    }
  },
);
