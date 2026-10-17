import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("admin verification cards prevent horizontal overflow on mobile", () => {
  const verificationSource = readFileSync(
    new URL("./verification.tsx", import.meta.url),
    "utf8",
  );
  const dashboardSource = readFileSync(
    new URL("../admin-dashboard.tsx", import.meta.url),
    "utf8",
  );

  assert.match(
    dashboardSource,
    /min-w-0 max-w-full flex-1 space-y-4 overflow-x-hidden overflow-y-auto/,
  );
  assert.match(
    verificationSource,
    /max-h-\[520px\] min-w-0 space-y-3 overflow-x-hidden overflow-y-auto/,
  );
  assert.match(
    verificationSource,
    /flex min-w-0 flex-wrap items-center gap-2/,
  );
  assert.match(
    verificationSource,
    /flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto sm:justify-end/,
  );
});
