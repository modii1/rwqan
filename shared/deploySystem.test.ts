import assert from "node:assert/strict";
import test from "node:test";
import { evaluateRestoreEnvironment } from "./deploySystem";

test("a release is restorable into the isolated TEST target regardless of source", () => {
  assert.deepEqual(evaluateRestoreEnvironment("TEST", "TEST"), { ok: true });
  assert.deepEqual(evaluateRestoreEnvironment("LIVE", "TEST"), { ok: true });
});

test("a LIVE target is refused without explicit approval", () => {
  const decision = evaluateRestoreEnvironment("LIVE", "LIVE");
  assert.equal(decision.ok, false);
  assert.equal(decision.code, "LIVE_RESTORE_DISABLED");
  assert.ok((decision.reason ?? "").length > 0);
});

test("a LIVE target with approval still refuses a TEST-source release", () => {
  const decision = evaluateRestoreEnvironment("TEST", "LIVE", {
    liveRestoreApproved: true,
  });
  assert.equal(decision.ok, false);
  assert.equal(decision.code, "RESTORE_TARGET_SOURCE_MISMATCH");
});

test("a LIVE target with approval allows a LIVE-source release", () => {
  assert.deepEqual(evaluateRestoreEnvironment("LIVE", "LIVE", { liveRestoreApproved: true }), {
    ok: true,
  });
});
