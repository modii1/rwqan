import assert from "node:assert/strict";
import test from "node:test";

import {
  resolvePaymentReceiptStatus,
  type PaymentReceiptStatusInput,
} from "./payment-receipt-status";

const base: PaymentReceiptStatusInput = {
  paymentMethod: "تحويل بنكي",
  status: "قيد المراجعة",
  hasReceiptReference: false,
  receiptAvailability: "none",
  scanStatus: null,
};

test("no receipt shows an explicit missing-receipt state and the upload button", () => {
  const view = resolvePaymentReceiptStatus(base);
  assert.ok(view);
  assert.equal(view.reason, "لم يتم رفع إيصال بعد");
  assert.equal(view.showUpload, true);
});

test("a valid receipt under review shows the admin-review state without upload", () => {
  const view = resolvePaymentReceiptStatus({
    ...base,
    hasReceiptReference: true,
    receiptAvailability: "valid",
    scanStatus: "review",
  });
  assert.ok(view);
  assert.equal(view.reason, "بانتظار مراجعة الإدارة للإيصال");
  assert.equal(view.showUpload, false);
});

test("a receipt whose file is missing is not shown as uploaded", () => {
  const view = resolvePaymentReceiptStatus({
    ...base,
    hasReceiptReference: true,
    receiptAvailability: "invalid",
  });
  assert.ok(view);
  assert.match(view.reason, /غير متاح/);
  assert.equal(view.showUpload, true);
});

test("while the file is being checked no upload button is offered", () => {
  const view = resolvePaymentReceiptStatus({
    ...base,
    hasReceiptReference: true,
    receiptAvailability: "checking",
  });
  assert.ok(view);
  assert.match(view.reason, /جارٍ التحقق/);
  assert.equal(view.showUpload, false);
});

test("a non-receipt scan result asks for a correct receipt", () => {
  const view = resolvePaymentReceiptStatus({
    ...base,
    hasReceiptReference: true,
    receiptAvailability: "valid",
    scanStatus: "not_receipt",
  });
  assert.ok(view);
  assert.match(view.reason, /ليس إيصال تحويل بنكي/);
  assert.equal(view.showUpload, true);
});

test("a technical scan failure asks for a re-upload", () => {
  const view = resolvePaymentReceiptStatus({
    ...base,
    hasReceiptReference: true,
    receiptAvailability: "valid",
    scanStatus: "error",
  });
  assert.ok(view);
  assert.match(view.reason, /تعذر التحقق/);
  assert.equal(view.showUpload, true);
});

test("a pending payment with a valid receipt waits for review", () => {
  const view = resolvePaymentReceiptStatus({
    ...base,
    status: "معلق",
    hasReceiptReference: true,
    receiptAvailability: "valid",
    scanStatus: "review",
  });
  assert.ok(view);
  assert.equal(view.reason, "تم رفع الإيصال وبانتظار المراجعة");
  assert.equal(view.showUpload, false);
});

test("non-bank methods keep the existing status rendering", () => {
  assert.equal(
    resolvePaymentReceiptStatus({ ...base, paymentMethod: "بطاقة" }),
    null,
  );
});

test("completed or failed bank transfers keep the existing status rendering", () => {
  assert.equal(
    resolvePaymentReceiptStatus({ ...base, status: "مكتمل" }),
    null,
  );
  assert.equal(resolvePaymentReceiptStatus({ ...base, status: "فشل" }), null);
});
