import assert from "node:assert/strict";
import test from "node:test";

import {
  canAutoActivateReceipt,
  getRiyadhDateKey,
  isReceiptAmountExact,
  isReceiptDateToday,
} from "./receiptAutoActivation";

const REFERENCE_DATE = new Date("2026-08-04T12:00:00.000Z");

test("receipt date must exactly match the current Riyadh date", () => {
  assert.equal(getRiyadhDateKey(REFERENCE_DATE), "2026-08-04");
  assert.equal(isReceiptDateToday("2026-08-04", REFERENCE_DATE), true);
  assert.equal(isReceiptDateToday("2026-08-02", REFERENCE_DATE), false);
  assert.equal(isReceiptDateToday("2026-08-03", REFERENCE_DATE), false);
  assert.equal(isReceiptDateToday("2026-08-04T12:00:00Z", REFERENCE_DATE), false);
  assert.equal(isReceiptDateToday(null, REFERENCE_DATE), false);
});

test("automatic activation requires today's date and a matching amount", () => {
  assert.equal(isReceiptAmountExact(75, 75), true);
  assert.equal(isReceiptAmountExact(74.99, 75), false);
  assert.equal(isReceiptAmountExact(undefined, 75), false);

  const validReceipt = {
    amountMatch: true,
    extractedDate: "2026-08-04",
    confidence: 90,
    clarity: "جيدة" as const,
    referenceDate: REFERENCE_DATE,
  };

  assert.equal(canAutoActivateReceipt(validReceipt), true);
  assert.equal(canAutoActivateReceipt({
    ...validReceipt,
    amountMatch: false,
  }), false);
  assert.equal(canAutoActivateReceipt({
    ...validReceipt,
    extractedDate: "2026-08-02",
  }), false);
  assert.equal(canAutoActivateReceipt({
    ...validReceipt,
    extractedDate: null,
  }), false);
});

test("automatic activation retains confidence and image-quality safeguards", () => {
  const validReceipt = {
    amountMatch: true,
    extractedDate: "2026-08-04",
    confidence: 90,
    clarity: "ممتازة" as const,
    referenceDate: REFERENCE_DATE,
  };

  assert.equal(canAutoActivateReceipt({
    ...validReceipt,
    confidence: 79,
  }), false);
  assert.equal(canAutoActivateReceipt({
    ...validReceipt,
    clarity: "متوسطة",
  }), false);
});
