import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("owner requests exposes a retry state when the session check fails", () => {
  const source = readFileSync(
    new URL("../../app/owner/requests/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /isError:\s*sessionError/);
  assert.match(source, /sessionError \|\| isError/);
  assert.match(source, /sessionError \? refetchSession\(\) : refetch\(\)/);
  assert.doesNotMatch(source, /!session && !isError/);
});
