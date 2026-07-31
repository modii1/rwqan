import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("owner dashboard keeps payment history visible", () => {
  const source = readFileSync(
    new URL("./owner-dashboard.tsx", import.meta.url),
    "utf8",
  );
  const sectionStart = source.indexOf('id="payments-section"');

  assert.notEqual(sectionStart, -1, "payment history section must exist");
  const paymentSectionOpening = source.slice(sectionStart, sectionStart + 300);
  assert.doesNotMatch(
    paymentSectionOpening,
    /className=\{`hidden\b/,
    "payment history section must not be hidden",
  );
  assert.match(source, /queryKey:\s*\["\/api\/owner\/payments"\]/);
  assert.match(source, /سجل المدفوعات/);
});
