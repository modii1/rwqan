import assert from "node:assert/strict";
import test from "node:test";

import {
  detectReceiptMimeType,
  evaluateReceiptVerification,
  manualReviewReason,
  namesMatch,
  normalizeCurrency,
  normalizeIban,
  normalizeReference,
  recommendationForVerification,
  type ReceiptVerificationInput,
} from "./receiptMatching";

const TODAY = new Date("2026-11-11T12:00:00.000Z");
const TODAY_KEY = TODAY.toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" });
const YESTERDAY_KEY = new Date(TODAY.getTime() - 24 * 60 * 60 * 1000)
  .toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" });

const APPROVED = [
  {
    id: "bank-1",
    isActive: true,
    isDefault: true,
    beneficiaryName: "مؤسسة روقان العقارية",
    iban: "SA0000000000000000000002",
  },
];

function input(overrides: Partial<ReceiptVerificationInput> = {}): ReceiptVerificationInput {
  return {
    extracted: {
      amount: 150,
      currency: "SAR",
      date: TODAY_KEY,
      receiverName: "مؤسسة روقان العقارية",
      receiverIban: "SA0000000000000000000002",
      paymentReference: "RWQN-ABC123",
      transactionId: "TX-9001",
      ...(overrides.extracted ?? {}),
    },
    authenticity: {
      overallScore: 95,
      isLikelyAuthentic: true,
      ...(overrides.authenticity ?? {}),
    },
    imageQuality: { clarity: "جيدة", ...(overrides.imageQuality ?? {}) },
    confidence: 92,
    expectedAmount: 150,
    expectedReference: "RWQN-ABC123",
    approvedAccounts: APPROVED,
    referenceDate: TODAY,
    ...overrides,
  };
}

test("a fully matching receipt is the only case allowed to auto-activate", () => {
  const result = evaluateReceiptVerification(input());
  assert.equal(result.autoActivationAllowed, true);
  assert.equal(result.amountMatch, true);
  assert.equal(result.currencyMatch, true);
  assert.equal(result.beneficiaryMatch, true);
  assert.equal(result.ibanMatch, true);
  assert.equal(result.referenceMatch, true);
  assert.equal(result.dateMatch, true);
  assert.equal(result.matchScore, 100);
  assert.equal(recommendationForVerification(result), "تفعيل_تلقائي");
});

test("a different amount blocks auto-activation", () => {
  const result = evaluateReceiptVerification(
    input({ extracted: { ...input().extracted, amount: 149 } }),
  );
  assert.equal(result.amountMatch, false);
  assert.equal(result.autoActivationAllowed, false);
  assert.ok(result.blockers.some((item) => item.includes("المبلغ غير مطابق")));
  assert.equal(recommendationForVerification(result), "مراجعة_يدوية");
});

test("a different beneficiary blocks auto-activation", () => {
  const result = evaluateReceiptVerification(
    input({ extracted: { ...input().extracted, receiverName: "شخص آخر" } }),
  );
  assert.equal(result.beneficiaryMatch, false);
  assert.equal(result.autoActivationAllowed, false);
  assert.ok(result.blockers.some((item) => item.includes("اسم المستفيد غير مطابق")));
});

test("a different IBAN blocks auto-activation", () => {
  const result = evaluateReceiptVerification(
    input({
      extracted: {
        ...input().extracted,
        receiverIban: "SA0000000000000000000099",
      },
    }),
  );
  assert.equal(result.ibanMatch, false);
  assert.equal(result.autoActivationAllowed, false);
  assert.ok(result.blockers.some((item) => item.includes("IBAN")));
});

test("a missing IBAN blocks auto-activation even when other fields match", () => {
  const result = evaluateReceiptVerification(
    input({ extracted: { ...input().extracted, receiverIban: null } }),
  );
  assert.equal(result.ibanMatch, false);
  assert.equal(result.autoActivationAllowed, false);
  assert.ok(result.blockers.some((item) => item.includes("لم يتم استخراج IBAN")));
});

test("a provided but different payment reference blocks auto-activation", () => {
  const result = evaluateReceiptVerification(
    input({
      extracted: { ...input().extracted, paymentReference: "RWQN-OTHER1" },
    }),
  );
  assert.equal(result.referenceMatch, false);
  assert.equal(result.autoActivationAllowed, false);
  assert.ok(result.blockers.some((item) => item.includes("رمز الدفع")));
});

test("an absent payment reference is recorded but does not block by itself", () => {
  const result = evaluateReceiptVerification(
    input({ extracted: { ...input().extracted, paymentReference: null } }),
  );
  assert.equal(result.referenceProvided, false);
  assert.equal(result.referenceMatch, false);
  assert.equal(result.autoActivationAllowed, true);
  assert.ok(result.reasons.some((item) => item.includes("لم يظهر رمز الدفع")));
});

test("a non-SAR or missing currency blocks auto-activation", () => {
  const usd = evaluateReceiptVerification(
    input({ extracted: { ...input().extracted, currency: "USD" } }),
  );
  assert.equal(usd.currencyMatch, false);
  assert.equal(usd.autoActivationAllowed, false);

  const missing = evaluateReceiptVerification(
    input({ extracted: { ...input().extracted, currency: null } }),
  );
  assert.equal(missing.currencyMatch, false);
  assert.equal(missing.autoActivationAllowed, false);
});

test("a date other than today blocks auto-activation", () => {
  const result = evaluateReceiptVerification(
    input({ extracted: { ...input().extracted, date: YESTERDAY_KEY } }),
  );
  assert.equal(result.dateMatch, false);
  assert.equal(result.autoActivationAllowed, false);
});

test("low confidence, poor quality or unauthentic images block auto-activation", () => {
  const lowConfidence = evaluateReceiptVerification(input({ confidence: 79 }));
  assert.equal(lowConfidence.autoActivationAllowed, false);

  const poorQuality = evaluateReceiptVerification(
    input({ imageQuality: { clarity: "ضعيفة" } }),
  );
  assert.equal(poorQuality.autoActivationAllowed, false);

  const unauthentic = evaluateReceiptVerification(
    input({ authenticity: { overallScore: 30, isLikelyAuthentic: false } }),
  );
  assert.equal(unauthentic.autoActivationAllowed, false);
});

test("missing or inactive approved accounts block auto-activation", () => {
  const none = evaluateReceiptVerification(input({ approvedAccounts: [] }));
  assert.equal(none.autoActivationAllowed, false);
  assert.ok(none.blockers.some((item) => item.includes("أسماء مستفيدين معتمدة")));

  const inactive = evaluateReceiptVerification(
    input({
      approvedAccounts: [{ ...APPROVED[0], isActive: false }],
    }),
  );
  assert.equal(inactive.autoActivationAllowed, false);
});

test("name, IBAN, reference and currency normalization are deterministic", () => {
  assert.equal(namesMatch("مؤسسة روقان العقارية", "مؤسسه روقان العقاريه"), true);
  assert.equal(namesMatch("روقان", "مؤسسة روقان العقارية"), true);
  assert.equal(namesMatch("روقان", "شركة أخرى"), false);

  assert.equal(normalizeIban(" sa00 0000-0000 0000 0000 0002 "), "SA0000000000000000000002");
  assert.equal(normalizeReference(" rwqn-abc123 "), "RWQNABC123");
  assert.equal(normalizeCurrency("ريال سعودي"), "SAR");
  assert.equal(normalizeCurrency("ر.س"), "SAR");
  assert.equal(normalizeCurrency("USD"), "USD");
});

test("the manual-review reason is the concatenation of every blocker", () => {
  const result = evaluateReceiptVerification(
    input({
      extracted: { ...input().extracted, amount: 1, receiverName: "آخر" },
      confidence: 10,
    }),
  );
  const reason = manualReviewReason(result);
  assert.match(reason, /المبلغ غير مطابق/);
  assert.match(reason, /اسم المستفيد غير مطابق/);
  assert.match(reason, /درجة الثقة/);
});

test("receipt MIME detection uses magic bytes, not the filename", () => {
  assert.equal(
    detectReceiptMimeType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
    "image/png",
  );
  assert.equal(detectReceiptMimeType(Buffer.from([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(detectReceiptMimeType(Buffer.from("%PDF-1.7")), "application/pdf");
  assert.equal(
    detectReceiptMimeType(Buffer.from("RIFF0000WEBPVP8 ")),
    "image/webp",
  );
  assert.equal(detectReceiptMimeType(Buffer.from("<html>not a receipt</html>")), null);
});
