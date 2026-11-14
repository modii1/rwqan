import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const LOGIN = new URL("./owner-login.tsx", import.meta.url);

test("the login PIN field sends the exact entered value and keeps leading zeros", async () => {
  const source = await readFile(LOGIN, "utf8");

  // The payload must use the raw string state, never a parsed/trimmed value.
  assert.match(source, /body: JSON\.stringify\(\{ propertyNumber, pin \}\)/);
  assert.doesNotMatch(source, /pin\.trim\(|Number\(pin\)|parseInt\(pin/);
  assert.doesNotMatch(source, /maxLength=\{4\}/);
});

test("the login PIN field matches a four-digit PIN without truncating six-digit PINs", async () => {
  const source = await readFile(LOGIN, "utf8");

  assert.match(source, /inputMode="numeric"/);
  assert.match(source, /pattern="\[0-9\]\*"/);
  assert.match(source, /placeholder="••••"/);
  assert.doesNotMatch(source, /type="number"/);
});
