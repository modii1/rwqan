import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("operations inbox exposes persistent workflow controls with mobile-safe layout", () => {
  const source = readFileSync(
    new URL("./operations-inbox.tsx", import.meta.url),
    "utf8",
  );

  assert.match(source, /\/api\/admin\/operations\/metadata/);
  assert.match(source, /encodeURIComponent\(operationId\)/);
  assert.match(source, /"PUT",\n\s+\{ \.\.\.patch, snapshot \}/);
  assert.match(source, /"POST",\n\s+\{ body, snapshot \}/);
  assert.match(source, /operation-assignee-/);
  assert.match(source, /operation-note-/);
  assert.match(source, /operation-state-action-/);
  assert.match(source, /إعادة فتح/);
  assert.match(source, /سجل الإجراءات/);
  assert.match(source, /flex min-w-0 flex-col gap-2 sm:flex-row/);
  assert.match(source, /grid min-w-0 gap-4/);
  assert.match(source, /w-full shrink-0 sm:w-auto/);
});
