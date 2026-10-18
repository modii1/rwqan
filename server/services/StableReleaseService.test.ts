import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveStableRelease,
  verifyCommitAccessible,
  type GitRunResult,
  type StableReleaseDependencies,
} from "./StableReleaseService";
import { RWQAN_STABLE_RELEASE, RWQAN_STABLE_RELEASE_SHA } from "../config/stableRelease";

const FULL_SHA = RWQAN_STABLE_RELEASE_SHA;

/** A fake git runner driven by a result map keyed on the first argument. */
function fakeGit(
  handler: (args: string[]) => GitRunResult,
): StableReleaseDependencies {
  return { runGit: async (args) => handler(args) };
}

test("verifyCommitAccessible rejects non full SHAs without touching Git", async () => {
  let called = false;
  const deps = fakeGit(() => {
    called = true;
    return { ok: true, stdout: "" };
  });
  assert.equal(await verifyCommitAccessible("shortsha", "C:/repo", deps), false);
  assert.equal(await verifyCommitAccessible("", "C:/repo", deps), false);
  assert.equal(called, false);
});

test("verifyCommitAccessible is false when the commit object is missing", async () => {
  const deps = fakeGit((args) =>
    args[0] === "cat-file" ? { ok: false, stdout: "" } : { ok: true, stdout: "" },
  );
  assert.equal(await verifyCommitAccessible(FULL_SHA, "C:/repo", deps), false);
});

test("verifyCommitAccessible is true when a local ref contains the commit", async () => {
  const deps = fakeGit((args) => {
    if (args[0] === "cat-file") return { ok: true, stdout: "" };
    if (args[0] === "branch") return { ok: true, stdout: "  main\n" };
    return { ok: false, stdout: "" };
  });
  assert.equal(await verifyCommitAccessible(FULL_SHA, "C:/repo", deps), true);
});

test("verifyCommitAccessible is true when the commit is an ancestor of HEAD", async () => {
  const deps = fakeGit((args) => {
    if (args[0] === "cat-file") return { ok: true, stdout: "" };
    if (args[0] === "branch") return { ok: true, stdout: "   \n" };
    if (args[0] === "merge-base") return { ok: true, stdout: "" };
    return { ok: false, stdout: "" };
  });
  assert.equal(await verifyCommitAccessible(FULL_SHA, "C:/repo", deps), true);
});

test("verifyCommitAccessible is false when the commit exists but is unreachable", async () => {
  const deps = fakeGit((args) => {
    if (args[0] === "cat-file") return { ok: true, stdout: "" };
    return { ok: false, stdout: "" };
  });
  assert.equal(await verifyCommitAccessible(FULL_SHA, "C:/repo", deps), false);
});

test("resolveStableRelease returns the config record only when verified", async () => {
  const verified = await resolveStableRelease({
    cwd: "C:/repo",
    dependencies: fakeGit((args) =>
      args[0] === "cat-file"
        ? { ok: true, stdout: "" }
        : { ok: true, stdout: "  origin/main\n" },
    ),
  });
  assert.ok(verified);
  assert.equal(verified?.releaseId, RWQAN_STABLE_RELEASE.releaseId);
  assert.equal(verified?.gitCommit, FULL_SHA);
  assert.equal(verified?.stableBaseline, true);
  assert.equal(verified?.deployed, true);
  assert.equal(verified?.version, "النسخة المستقرة");
  assert.equal(verified?.gitShortSha, FULL_SHA.slice(0, 7));

  const unverified = await resolveStableRelease({
    cwd: "C:/repo",
    dependencies: fakeGit(() => ({ ok: false, stdout: "" })),
  });
  assert.equal(unverified, null);
});

test("resolveStableRelease honors an injected config record", async () => {
  const custom = { ...RWQAN_STABLE_RELEASE, releaseId: "rel-custom" };
  const resolved = await resolveStableRelease({
    cwd: "C:/repo",
    config: custom,
    dependencies: fakeGit((args) =>
      args[0] === "cat-file"
        ? { ok: true, stdout: "" }
        : { ok: true, stdout: "main\n" },
    ),
  });
  assert.equal(resolved?.releaseId, "rel-custom");
});
