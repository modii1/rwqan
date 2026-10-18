import { test } from "node:test";
import assert from "node:assert";
import { runSuite } from "../src/runner";

test("runSuite executes tests", async () => {
  const suite = {
    name: "dummy",
    cases: [
      {
        id: "T1",
        feature: "x",
        flow: "y",
        expected: "ok",
        status: "PASS" as const,
        severity: "LOW" as const,
        run: async () => ({ actual: "ok", status: "PASS" as const }),
      },
    ],
  };
  const result = await runSuite(suite);
  assert.strictEqual(result.summary.pass, 1);
});
