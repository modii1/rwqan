import assert from "node:assert/strict";
import test from "node:test";

import { normalizeArabicText } from "./arabicSearch";

test("Arabic normalization treats decomposed hamza city spellings equally", () => {
  assert.equal(normalizeArabicText("الأسياح"), normalizeArabicText("الاسياح"));
  assert.equal(normalizeArabicText("إنترنت"), normalizeArabicText("انترنت"));
});
