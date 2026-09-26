import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCustomerBookingSummary,
  customerBookingSummaryFileName,
} from "./customer-booking-summary";

test("booking summary labels reported facts without claiming to be a receipt", () => {
  const summary = buildCustomerBookingSummary({
    propertyLabel: "عقار تجريبي",
    propertyNumber: "12345",
    requestCode: "REQ-8",
    bookingDate: "2026/9/26",
    reportedAmount: "500 ر.س",
  });

  assert.match(summary, /ملخص الحجز/);
  assert.match(summary, /ليس إيصال دفع/);
  assert.match(summary, /المبلغ المبلغ عنه: 500 ر\.س/);
  assert.doesNotMatch(summary, /تم استلام|تم تحصيل|مدفوع إلى روقان/);
});

test("booking summary filename is bounded and filesystem-safe", () => {
  assert.equal(
    customerBookingSummaryFileName(" 12/345 "),
    "rwqan-booking-summary-12-345.txt",
  );
});
