import assert from "node:assert/strict";
import test from "node:test";

import {
  applyReceiptScanProgress,
  classifyReceiptError,
  classifyReceiptResponse,
  classifyReceiptScan,
  friendlyReviewReasons,
  initialReceiptScanStages,
  RECEIPT_SCAN_STAGES,
  settleReceiptScanStages,
} from "./receipt-scan";

const FORBIDDEN = [
  "Gemini",
  "API",
  "JSON",
  "OCR",
  "الخادم",
  "قاعدة البيانات",
  "نموذج",
  "AI",
];

function assertUserSafe(texts: string[]) {
  for (const text of texts) {
    for (const term of FORBIDDEN) {
      assert.equal(
        text.includes(term),
        false,
        `user-facing text must not contain "${term}": ${text}`
      );
    }
  }
}

test("seven user-facing stages with the approved wording", () => {
  assert.equal(RECEIPT_SCAN_STAGES.length, 7);
  assert.deepEqual(
    RECEIPT_SCAN_STAGES.map((stage) => stage.label),
    [
      "جارٍ استلام الإيصال...",
      "جارٍ قراءة بيانات الإيصال...",
      "جارٍ التحقق من مبلغ التحويل...",
      "جارٍ مطابقة بيانات المستفيد...",
      "جارٍ التحقق من تاريخ التحويل...",
      "جارٍ التأكد من صحة الإيصال...",
      "جارٍ استكمال التحقق...",
    ]
  );
  assert.ok(initialReceiptScanStages().every((stage) => stage.status === "pending"));
});

test("a server snapshot marks only the stages the server confirmed", () => {
  const stages = initialReceiptScanStages();
  const next = applyReceiptScanProgress(stages, {
    scanId: "scan-1",
    status: "running",
    stages: [
      { key: "received", status: "done" },
      { key: "reading", status: "active" },
      { key: "unknown", status: "done" },
    ],
  });
  assert.equal(next[0].status, "done");
  assert.equal(next[1].status, "active");
  assert.equal(next[2].status, "pending");
  assert.equal(next[6].status, "pending");
});

test("a missing snapshot keeps the honest waiting state", () => {
  const stages = initialReceiptScanStages();
  assert.deepEqual(applyReceiptScanProgress(stages, null), stages);
});

test("a fully matching receipt is shown as verified", () => {
  const view = classifyReceiptScan({
    recommendation: "تفعيل_تلقائي",
    verification: { autoActivationAllowed: true, blockers: [] },
  });
  assert.equal(view.outcome, "success");
  assert.equal(view.title, "تم التحقق بنجاح");
  assert.equal(view.message, "تم التحقق من بيانات الإيصال بنجاح.");
  assert.deepEqual(view.reasons, []);
});

test("a technical failure is shown as unable to complete", () => {
  for (const failureReason of [
    "GEMINI_TIMEOUT",
    "GEMINI_ERROR",
    "GEMINI_NOT_CONFIGURED",
    "IMAGE_FETCH_FAILED",
    "INVALID_AI_RESPONSE",
  ]) {
    const view = classifyReceiptScan({ failureReason });
    assert.equal(view.outcome, "error");
    assert.equal(view.title, "تعذر إكمال التحقق");
    assert.match(view.message, /لم نتمكن من إكمال التحقق الآن/);
    assert.deepEqual(view.reasons, []);
  }
});

test("manual review translates blockers without technical details", () => {
  const view = classifyReceiptScan({
    recommendation: "مراجعة_يدوية",
    verification: {
      autoActivationAllowed: false,
      blockers: [
        "المبلغ غير مطابق (المستخرج: 90، المطلوب: 100)",
        "لم يتم استخراج IBAN المستفيد من الإيصال",
        "تاريخ الإيصال غير مقبول",
        "لم يتم التأكد من أصالة الإيصال (الدرجة: 5%)",
      ],
    },
  });
  assert.equal(view.outcome, "review");
  assert.equal(view.title, "الإيصال قيد المراجعة");
  assert.equal(view.message, "نحتاج إلى مراجعة الإيصال قبل إكمال الطلب.");
  assert.equal(view.reasons.length, 4);
  assertUserSafe([view.title, view.message, ...view.reasons]);
});

test("add-on receipts stay in review even when the scan looks successful", () => {
  const view = classifyReceiptScan(
    {
      recommendation: "تفعيل_تلقائي",
      verification: { autoActivationAllowed: true, blockers: [] },
    },
    { forceReview: true }
  );
  assert.equal(view.outcome, "review");
});

test("no user-facing string leaks internal terminology", () => {
  const texts = RECEIPT_SCAN_STAGES.map((stage) => stage.label);
  const samples = [
    classifyReceiptScan({ failureReason: "GEMINI_ERROR" }),
    classifyReceiptScan({
      recommendation: "مراجعة_يدوية",
      verification: { blockers: ["المبلغ غير مطابق", "IBAN غير مطابق"] },
    }),
  ];
  for (const sample of samples) {
    texts.push(sample.title, sample.message, ...sample.reasons);
  }
  texts.push(...friendlyReviewReasons(["رمز الدفع في الإيصال لا يطابق الدفعة"]));
  assertUserSafe(texts);
});

test("a confirmed non-receipt is its own outcome, not a manual review", () => {
  const view = classifyReceiptScan({
    documentType: "not_a_receipt",
    recommendation: "مستند_غير_إيصال",
    verification: { autoActivationAllowed: false, blockers: [] },
  });
  assert.equal(view.outcome, "not_receipt");
  assert.equal(view.title, "المستند ليس إيصال تحويل بنكي");
  assert.equal(view.message, "يرجى رفع إيصال تحويل بنكي صحيح.");
  assert.deepEqual(view.reasons, []);
  assertUserSafe([view.title, view.message]);
});

test("an uncertain document type stays in manual review", () => {
  const view = classifyReceiptScan({
    documentType: "uncertain",
    recommendation: "مراجعة_يدوية",
    verification: { autoActivationAllowed: false, blockers: [] },
  });
  assert.equal(view.outcome, "review");
  assert.equal(view.title, "الإيصال قيد المراجعة");
});

test("a bank receipt with missing data stays in manual review", () => {
  const view = classifyReceiptScan({
    documentType: "bank_transfer_receipt",
    recommendation: "مراجعة_يدوية",
    verification: {
      autoActivationAllowed: false,
      blockers: ["لم يتم استخراج IBAN المستفيد من الإيصال"],
    },
  });
  assert.equal(view.outcome, "review");
  assert.equal(view.reasons.length, 1);
});

test("server blockers sent at the top level are still shown", () => {
  const view = classifyReceiptScan({
    recommendation: "مراجعة_يدوية",
    blockers: ["المبلغ غير مطابق (المستخرج: 90، المطلوب: 100)"],
    verification: { autoActivationAllowed: false },
  });
  assert.equal(view.outcome, "review");
  assert.equal(view.reasons.length, 1);
  assert.match(view.reasons[0], /المبلغ/);
});

test("an unknown scan payload never reports success", () => {
  const view = classifyReceiptScan({});
  assert.equal(view.outcome, "review");
  assert.notEqual(view.outcome, "success");
});

test("the whole response drives the dialog for a completed review", () => {
  const view = classifyReceiptResponse({
    aiScan: {
      recommendation: "مراجعة_يدوية",
      documentType: "bank_transfer_receipt",
      verification: { autoActivationAllowed: false, blockers: ["المبلغ غير مطابق"] },
    },
    pendingManualReview: true,
  });
  assert.equal(view.outcome, "review");
});

test("a server-confirmed activation is shown as verified", () => {
  const view = classifyReceiptResponse({
    autoActivated: true,
    aiScan: {
      recommendation: "تفعيل_تلقائي",
      documentType: "bank_transfer_receipt",
      verification: { autoActivationAllowed: true, blockers: [] },
    },
  });
  assert.equal(view.outcome, "success");
});

test("a successful upload without scan data waits for review", () => {
  const view = classifyReceiptResponse({
    success: true,
    message: "تم رفع الإيصال بنجاح، سيتم مراجعته وتفعيل الإضافة",
  });
  assert.equal(view.outcome, "review");
});

test("a duplicate receipt has its own outcome", () => {
  const view = classifyReceiptError({
    status: 409,
    code: "DUPLICATE_RECEIPT",
    message: "تم استخدام صورة الإيصال هذه في عملية دفع أخرى.",
  });
  assert.equal(view.outcome, "duplicate");
  assert.equal(view.title, "الإيصال مستخدم مسبقًا");
  assert.match(view.message, /سبق استخدامه/);
  assertUserSafe([view.title, view.message]);
});

test("a timeout and a network failure are real technical failures", () => {
  const timeout = classifyReceiptError({ status: 408, message: "" });
  assert.equal(timeout.outcome, "error");
  assert.match(timeout.message, /انتهت مهلة الاتصال/);

  const offline = classifyReceiptError({
    message: "Failed to fetch",
  });
  assert.equal(offline.outcome, "error");
  assert.match(offline.message, /تعذر الاتصال بالخدمة/);

  const aborted = classifyReceiptError({
    code: "TIMEOUT",
    status: 408,
    message: "انتهت مهلة الاتصال",
  });
  assert.equal(aborted.outcome, "error");
});

test("an unknown error keeps the honest fallback and hides internals", () => {
  const view = classifyReceiptError(
    new Error("TypeError: Cannot read properties of undefined (reading 'Body')")
  );
  assert.equal(view.outcome, "error");
  assert.match(view.message, /لم نتمكن من إكمال التحقق الآن/);
  assert.doesNotMatch(view.message, /TypeError|undefined|Body/);
  assertUserSafe([view.title, view.message]);
});

test("finishing a scan freezes the active stage", () => {
  const stages = initialReceiptScanStages().map((stage, index) =>
    index === 0 ? { ...stage, status: "active" as const } : stage
  );
  const done = settleReceiptScanStages(stages, "review");
  assert.equal(done[0].status, "done");

  const failed = settleReceiptScanStages(stages, "duplicate");
  assert.equal(failed[0].status, "failed");
});
