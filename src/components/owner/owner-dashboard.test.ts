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

test("owner dashboard exposes inquiry and analytics summaries", () => {
  const source = readFileSync(
    new URL("./owner-dashboard.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /router\.push\("\/owner\/requests"\)/);
  assert.match(source, /requestsData\?\.summary\?\.confirmed/);
  assert.match(source, /ملخص الطلبات/);
  assert.match(source, /فترة الذروة/);

  for (const heading of ["معلومات العقار", "أداء العقار", "تحليلات وملخص"]) {
    const headingIndex = source.indexOf(heading);
    assert.notEqual(headingIndex, -1, `${heading} must exist`);
    const cardStart = source.lastIndexOf("<Card", headingIndex);
    const openingTag = source.slice(cardStart, source.indexOf(">", cardStart) + 1);
    assert.doesNotMatch(openingTag, /\bhidden\b/, `${heading} must be visible`);
  }

  assert.match(source, /value=\{stats\.previousMonthGrowth >= 0/);
  assert.match(source, /label="معدل التفاعل"[\s\S]{0,180}className="hidden"|className="hidden"[\s\S]{0,180}label="معدل التفاعل"/);
});
