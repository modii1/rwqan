import assert from "node:assert/strict";
import test from "node:test";
import {
  parseFirebaseCliVersion,
  readDeployToolsInfo,
  resetDeployToolsCache,
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
