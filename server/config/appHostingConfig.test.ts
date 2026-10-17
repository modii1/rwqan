import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("App Hosting exposes the canonical production origin at build and runtime", () => {
  const config = readFileSync("apphosting.yaml", "utf8");
  const entries = config.split(/\r?\n(?=\s*- variable:)/);
  const baseUrlEntry = entries.find((entry) => entry.includes("variable: NEXT_PUBLIC_BASE_URL"));

  assert.ok(baseUrlEntry, "NEXT_PUBLIC_BASE_URL must be declared in apphosting.yaml");
  assert.match(baseUrlEntry, /value:\s*https:\/\/rwqan\.sa(?:\s|$)/);
  assert.match(baseUrlEntry, /^\s*- BUILD\s*$/m);
  assert.match(baseUrlEntry, /^\s*- RUNTIME\s*$/m);
});
