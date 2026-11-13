import assert from "node:assert/strict";
import test from "node:test";

import { firebaseService } from "../firebaseService";
import { scanReceiptWithAI } from "./aiReceiptScanner";

const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const APPROVED = [
  {
    id: "bank-1",
    bankName: "بنك الرياض",
    beneficiaryName: "مؤسسة روقان العقارية",
    iban: "SA0000000000000000000002",
    isActive: true,
    isDefault: true,
  },
];

function todayRiyadh() {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" });
}

function geminiPayload(overrides: Record<string, any> = {}) {
  return {
    documentType: "bank_transfer_receipt",
    extractedData: {
      amount: 150,
      currency: "SAR",
      date: todayRiyadh(),
      time: "10:30",
      senderName: "محمد أحمد",
      senderBank: "بنك الراجحي",
      senderIban: "SA0000000000000000000001",
      senderAccountNumber: null,
      receiverName: "مؤسسة روقان العقارية",
      receiverBank: "بنك الرياض",
      receiverIban: "SA0000000000000000000002",
      receiverAccountNumber: null,
      referenceNumber: "TX-REF-0001",
      transactionId: "TX-0001",
      paymentReference: "RWQN-ABC123",
      ...(overrides.extractedData ?? {}),
    },
    authenticityAnalysis: {
      overallScore: 95,
      isLikelyAuthentic: true,
      concerns: [],
      positiveIndicators: ["بنية إيصال سليمة"],
      ...(overrides.authenticityAnalysis ?? {}),
    },
    imageQuality: {
      clarity: "جيدة",
      isComplete: true,
      hasWatermarks: false,
      isScreenshot: false,
      ...(overrides.imageQuality ?? {}),
    },
    summary: "إيصال بنكي واضح",
    confidence: 92,
    ...overrides,
  };
}

function geminiResponse(payload: any) {
  return {
    candidates: [
      {
        content: {
          parts: [{ text: JSON.stringify(payload) }],
          role: "model",
        },
        finishReason: "STOP",
        index: 0,
      },
    ],
    usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 },
  };
}

type Behavior = "success" | "error" | "hang" | "invalid-json";

async function runScan(options: {
  payload?: any;
  behavior?: Behavior;
  geminiTimeoutMs?: number;
  key?: string | null;
  accounts?: any[];
  fetchUrlBehavior?: "success" | "fail";
  progress?: Array<{ stage: string; status: string }>;
}) {
  const originalNodeEnv = (process.env as any).NODE_ENV;
  const originalKey = process.env.GEMINI_API_KEY;
  const originalGetAccounts = firebaseService.getActiveBankAccounts;
  const originalSave = (firebaseService as any).saveReceiptVerification;
  const realFetch = globalThis.fetch;
  const saved: any[] = [];
  let geminiCalls = 0;
  let lastRequestBody: any = null;

  (process.env as any).NODE_ENV = "production";
  if (options.key === null) delete (process.env as any).GEMINI_API_KEY;
  else (process.env as any).GEMINI_API_KEY = options.key ?? "synthetic-test-key";

  (firebaseService as any).getActiveBankAccounts = async () =>
    options.accounts ?? APPROVED;
  (firebaseService as any).saveReceiptVerification = async (data: any) => {
    saved.push(data);
  };

  const behavior = options.behavior ?? "success";
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = typeof input === "string" ? input : String(input?.url ?? input);
    if (url.startsWith("data:")) {
      if (options.fetchUrlBehavior === "fail") {
        return new Response("not found", { status: 404 });
      }
      return realFetch(input, init);
    }
    if (url.includes("generativelanguage.googleapis.com")) {
      geminiCalls += 1;
      try {
        lastRequestBody = JSON.parse(String(init?.body ?? "{}"));
      } catch {
        lastRequestBody = null;
      }
      if (behavior === "error") {
        throw new Error("simulated Gemini outage");
      }
      if (behavior === "hang") {
        return await new Promise((_resolve, reject) => {
          let settled = false;
          const fail = () => {
            if (settled) return;
            settled = true;
            reject(Object.assign(new Error("Request aborted due to timeout"), {
              name: "AbortError",
            }));
          };
          const signal: AbortSignal | undefined = init?.signal;
          if (signal?.aborted) fail();
          else signal?.addEventListener("abort", fail);
          // Safety net so a test can never hang if a transport ignores signals.
          setTimeout(fail, 500);
        });
      }
      if (behavior === "invalid-json") {
        return new Response(
          JSON.stringify({
            candidates: [
              {
                content: { parts: [{ text: "this is not json at all" }], role: "model" },
                finishReason: "STOP",
                index: 0,
              },
            ],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify(geminiResponse(options.payload ?? geminiPayload())), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`unexpected external fetch: ${url}`);
  }) as typeof fetch;

  try {
    const result = await scanReceiptWithAI(
      TINY_PNG,
      "PAY-TEST-RECEIPT",
      150,
      "RWQN-ABC123",
      undefined,
      undefined,
      {
        imageBuffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
          "base64",
        ),
        mimeType: "image/png",
        geminiTimeoutMs: options.geminiTimeoutMs ?? 2_000,
        onProgress: options.progress
          ? (stage, status) => options.progress!.push({ stage, status })
          : undefined,
      },
    );
    return { result, saved, geminiCalls, lastRequestBody };
  } finally {
    globalThis.fetch = realFetch;
    (firebaseService as any).getActiveBankAccounts = originalGetAccounts;
    (firebaseService as any).saveReceiptVerification = originalSave;
    if (originalNodeEnv === undefined) delete (process.env as any).NODE_ENV;
    else (process.env as any).NODE_ENV = originalNodeEnv;
    if (originalKey === undefined) delete (process.env as any).GEMINI_API_KEY;
    else (process.env as any).GEMINI_API_KEY = originalKey;
  }
}

test("a fully matching receipt is auto-activation eligible and sends inline image data", async () => {
  const { result, saved, geminiCalls, lastRequestBody } = await runScan({
    payload: geminiPayload(),
  });

  assert.ok(result);
  assert.equal(result?.recommendation, "تفعيل_تلقائي");
  assert.equal(result?.verification.autoActivationAllowed, true);
  assert.equal(result?.matchAnalysis.amountMatch, true);
  assert.equal(result?.matchAnalysis.beneficiaryMatch, true);
  assert.equal(result?.matchAnalysis.ibanMatch, true);
  assert.equal(result?.matchAnalysis.referenceMatch, true);
  assert.equal(geminiCalls, 1);

  const parts = lastRequestBody?.contents?.[0]?.parts ?? [];
  const inline = parts.find((part: any) => part.inlineData);
  assert.ok(inline);
  assert.equal(inline.inlineData.mimeType, "image/png");

  assert.equal(saved.length, 1);
  assert.equal(saved[0].autoActivationAllowed, true);
  assert.equal(saved[0].recommendation, "تفعيل_تلقائي");
  assert.equal(saved[0].amountMatch, true);
  assert.ok(!JSON.stringify(saved[0]).includes("synthetic-test-key"));
});

test("a different amount is manual review and model-reported flags are ignored", async () => {
  const { result } = await runScan({
    payload: geminiPayload({
      extractedData: { amount: 149 },
      matchAnalysis: { amountMatch: true, beneficiaryMatch: true, ibanMatch: true },
    }),
  });
  assert.ok(result);
  assert.equal(result?.recommendation, "مراجعة_يدوية");
  assert.equal(result?.matchAnalysis.amountMatch, false);
  assert.equal(result?.verification.autoActivationAllowed, false);
  assert.ok(result?.verification.blockers.some((item) => item.includes("المبلغ")));
});

test("a different beneficiary is manual review", async () => {
  const { result } = await runScan({
    payload: geminiPayload({ extractedData: { receiverName: "شخص آخر" } }),
  });
  assert.equal(result?.recommendation, "مراجعة_يدوية");
  assert.equal(result?.matchAnalysis.beneficiaryMatch, false);
});

test("a different IBAN is manual review", async () => {
  const { result } = await runScan({
    payload: geminiPayload({
      extractedData: { receiverIban: "SA0000000000000000000099" },
    }),
  });
  assert.equal(result?.recommendation, "مراجعة_يدوية");
  assert.equal(result?.matchAnalysis.ibanMatch, false);
});

test("a different payment reference is manual review", async () => {
  const { result } = await runScan({
    payload: geminiPayload({ extractedData: { paymentReference: "RWQN-OTHER1" } }),
  });
  assert.equal(result?.recommendation, "مراجعة_يدوية");
  assert.equal(result?.matchAnalysis.referenceMatch, false);
});

test("a non-SAR currency is manual review", async () => {
  const { result } = await runScan({
    payload: geminiPayload({ extractedData: { currency: "USD" } }),
  });
  assert.equal(result?.recommendation, "مراجعة_يدوية");
  assert.equal(result?.matchAnalysis.currencyMatch, false);
});

test("an old date is manual review", async () => {
  const { result } = await runScan({
    payload: geminiPayload({ extractedData: { date: "2020-01-01" } }),
  });
  assert.equal(result?.recommendation, "مراجعة_يدوية");
  assert.equal(result?.matchAnalysis.dateMatch, false);
});

test("an unclear image is manual review", async () => {
  const { result } = await runScan({
    payload: geminiPayload({
      extractedData: { amount: null, date: null },
      imageQuality: { clarity: "ضعيفة", isComplete: false },
      authenticityAnalysis: { overallScore: 10, isLikelyAuthentic: false },
      confidence: 12,
    }),
  });
  assert.equal(result?.recommendation, "مراجعة_يدوية");
  assert.equal(result?.verification.autoActivationAllowed, false);
});

test("a non-receipt image is manual review", async () => {
  const { result } = await runScan({
    payload: geminiPayload({
      extractedData: {
        amount: null,
        currency: null,
        date: null,
        receiverName: null,
        receiverIban: null,
        paymentReference: null,
      },
      imageQuality: { clarity: "ضعيفة", isComplete: false },
      authenticityAnalysis: { overallScore: 0, isLikelyAuthentic: false },
      confidence: 0,
      summary: "الصورة لا تحتوي إيصالاً",
    }),
  });
  assert.equal(result?.recommendation, "مراجعة_يدوية");
  assert.equal(result?.verification.autoActivationAllowed, false);
});

test("a confirmed non-receipt document gets its own classification", async () => {
  const { result, saved } = await runScan({
    payload: geminiPayload({
      documentType: "not_a_receipt",
      extractedData: {
        amount: null,
        currency: null,
        date: null,
        receiverName: null,
        receiverIban: null,
        referenceNumber: null,
        paymentReference: null,
      },
      imageQuality: { clarity: "واضحة", isComplete: true },
      authenticityAnalysis: { overallScore: 0, isLikelyAuthentic: false },
      confidence: 88,
      summary: "دليل برمجي وليس إيصال تحويل",
    }),
  });
  assert.equal(result?.documentType, "not_a_receipt");
  assert.equal(result?.recommendation, "مستند_غير_إيصال");
  assert.equal(result?.verification.autoActivationAllowed, false);
  assert.equal(result?.verification.manualReviewReason, "المستند ليس إيصال تحويل بنكي.");
  assert.equal(saved[0].documentType, "not_a_receipt");
});

test("a non-receipt invoice with an amount but no bank identifiers is still a non-receipt", async () => {
  const { result } = await runScan({
    payload: geminiPayload({
      documentType: "not_a_receipt",
      extractedData: {
        amount: 250,
        currency: null,
        date: null,
        receiverName: "شركة تجارية",
        receiverIban: null,
        referenceNumber: null,
        transactionId: null,
        paymentReference: null,
      },
      confidence: 90,
    }),
  });
  assert.equal(result?.documentType, "not_a_receipt");
  assert.equal(result?.recommendation, "مستند_غير_إيصال");
  assert.equal(result?.verification.autoActivationAllowed, false);
});

test("a non-receipt label is not trusted when receipt data is present", async () => {
  const { result } = await runScan({
    payload: geminiPayload({ documentType: "not_a_receipt" }),
  });
  // The model contradicts itself: real receipt fields exist, so never reject.
  assert.notEqual(result?.recommendation, "مستند_غير_إيصال");
  assert.equal(result?.verification.autoActivationAllowed, false);
  assert.equal(result?.recommendation, "مراجعة_يدوية");
});

test("an uncertain document type goes to manual review, never rejection", async () => {
  const { result } = await runScan({
    payload: geminiPayload({
      documentType: "uncertain",
      extractedData: { amount: null, receiverIban: null, receiverName: null },
      confidence: 20,
    }),
  });
  assert.equal(result?.documentType, "uncertain");
  assert.equal(result?.recommendation, "مراجعة_يدوية");
  assert.equal(result?.verification.autoActivationAllowed, false);
  assert.match(
    String(result?.verification.manualReviewReason ?? ""),
    /تعذّر تأكيد نوع المستند/,
  );
});

test("a recognised bank receipt with a different amount stays manual review", async () => {
  const { result } = await runScan({
    payload: geminiPayload({
      documentType: "bank_transfer_receipt",
      extractedData: { amount: 149 },
    }),
  });
  assert.equal(result?.documentType, "bank_transfer_receipt");
  assert.equal(result?.recommendation, "مراجعة_يدوية");
  assert.equal(result?.verification.autoActivationAllowed, false);
});

test("a recognised bank receipt keeps the existing auto-activation rules", async () => {
  const { result } = await runScan({
    payload: geminiPayload({ documentType: "bank_transfer_receipt" }),
  });
  assert.equal(result?.documentType, "bank_transfer_receipt");
  assert.equal(result?.recommendation, "تفعيل_تلقائي");
  assert.equal(result?.verification.autoActivationAllowed, true);
});

test("an unrecognised document-type value is treated as uncertain", async () => {
  const { result } = await runScan({
    payload: geminiPayload({ documentType: "some_new_label" }),
  });
  assert.equal(result?.documentType, "uncertain");
  assert.equal(result?.verification.autoActivationAllowed, false);
});

test("a missing document type is uncertain, never a rejection", async () => {
  const payload: any = geminiPayload();
  delete payload.documentType;
  const { result } = await runScan({ payload });
  assert.equal(result?.documentType, "uncertain");
  assert.notEqual(result?.recommendation, "مستند_غير_إيصال");
  assert.equal(result?.verification.autoActivationAllowed, false);
});

test("the analysis request asks the model for an explicit document type", async () => {
  const { lastRequestBody } = await runScan({ payload: geminiPayload() });
  const prompt = JSON.stringify(lastRequestBody);
  assert.match(prompt, /documentType/);
  assert.match(prompt, /not_a_receipt/);
  assert.match(prompt, /uncertain/);
});

test("a missing Gemini key returns a persisted manual-review result without calling Gemini", async () => {
  const { result, saved, geminiCalls } = await runScan({ key: null });
  assert.ok(result);
  assert.equal(result?.recommendation, "مراجعة_يدوية");
  assert.equal(result?.failureReason, "GEMINI_NOT_CONFIGURED");
  assert.equal(geminiCalls, 0);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].failureReason, "GEMINI_NOT_CONFIGURED");
});

test("a Gemini outage returns a persisted manual-review result", async () => {
  const { result, saved } = await runScan({ behavior: "error" });
  assert.equal(result?.failureReason, "GEMINI_ERROR");
  assert.equal(result?.recommendation, "مراجعة_يدوية");
  assert.equal(saved[0].failureReason, "GEMINI_ERROR");
});

test("a Gemini timeout returns a persisted manual-review result", async () => {
  const { result } = await runScan({ behavior: "hang", geminiTimeoutMs: 100 });
  assert.equal(result?.failureReason, "GEMINI_TIMEOUT");
  assert.equal(result?.recommendation, "مراجعة_يدوية");
});

test("an unreadable AI response is manual review", async () => {
  const { result } = await runScan({ behavior: "invalid-json" });
  assert.equal(result?.failureReason, "INVALID_AI_RESPONSE");
  assert.equal(result?.recommendation, "مراجعة_يدوية");
});

test("no approved bank accounts means manual review (fail closed)", async () => {
  const { result, geminiCalls } = await runScan({ accounts: [] });
  assert.equal(result?.recommendation, "مراجعة_يدوية");
  assert.equal(result?.failureReason, "NO_APPROVED_ACCOUNTS");
  assert.equal(geminiCalls, 0);
});

test("an image fetch failure is manual review", async () => {
  const originalNodeEnv = (process.env as any).NODE_ENV;
  const originalKey = process.env.GEMINI_API_KEY;
  const originalGetAccounts = firebaseService.getActiveBankAccounts;
  const originalSave = (firebaseService as any).saveReceiptVerification;
  const realFetch = globalThis.fetch;
  (process.env as any).NODE_ENV = "production";
  (process.env as any).GEMINI_API_KEY = "synthetic-test-key";
  (firebaseService as any).getActiveBankAccounts = async () => APPROVED;
  (firebaseService as any).saveReceiptVerification = async () => undefined;
  globalThis.fetch = (async () => new Response("not found", { status: 404 })) as typeof fetch;
  try {
    const result = await scanReceiptWithAI("https://example.invalid/receipt.jpg", "PAY-1", 150);
    assert.equal(result?.failureReason, "IMAGE_FETCH_FAILED");
    assert.equal(result?.recommendation, "مراجعة_يدوية");
  } finally {
    globalThis.fetch = realFetch;
    (firebaseService as any).getActiveBankAccounts = originalGetAccounts;
    (firebaseService as any).saveReceiptVerification = originalSave;
    if (originalNodeEnv === undefined) delete (process.env as any).NODE_ENV;
    else (process.env as any).NODE_ENV = originalNodeEnv;
    if (originalKey === undefined) delete (process.env as any).GEMINI_API_KEY;
    else (process.env as any).GEMINI_API_KEY = originalKey;
  }
});

test("scan progress reports real stages for a matching receipt", async () => {
  const progress: Array<{ stage: string; status: string }> = [];
  const { result } = await runScan({ payload: geminiPayload(), progress });

  assert.equal(result?.recommendation, "تفعيل_تلقائي");
  const seen = (stage: string, status: string) =>
    progress.some((entry) => entry.stage === stage && entry.status === status);

  assert.ok(seen("received", "active"));
  assert.ok(seen("received", "done"));
  assert.ok(seen("reading", "active"));
  assert.ok(seen("reading", "done"));
  assert.ok(seen("amount", "done"));
  assert.ok(seen("beneficiary", "done"));
  assert.ok(seen("date", "done"));
  assert.ok(seen("authenticity", "done"));
  assert.ok(seen("finalizing", "active"));
  assert.ok(seen("finalizing", "done"));
});

test("scan progress marks reading as failed on an outage", async () => {
  const progress: Array<{ stage: string; status: string }> = [];
  const { result } = await runScan({ behavior: "error", progress });

  assert.equal(result?.failureReason, "GEMINI_ERROR");
  assert.ok(
    progress.some((entry) => entry.stage === "reading" && entry.status === "failed"),
  );
  assert.ok(
    progress.some((entry) => entry.stage === "finalizing" && entry.status === "done"),
  );
});

test("scan progress marks verification stages as failed for a non-receipt", async () => {
  const progress: Array<{ stage: string; status: string }> = [];
  const { result } = await runScan({
    progress,
    payload: {
      extractedData: {
        amount: null,
        currency: null,
        date: null,
        receiverName: null,
        receiverIban: null,
        paymentReference: null,
      },
      authenticityAnalysis: {
        overallScore: 5,
        isLikelyAuthentic: false,
        concerns: ["ليس إيصالًا بنكيًا"],
        positiveIndicators: [],
      },
      imageQuality: {
        clarity: "ممتازة",
        isComplete: true,
        hasWatermarks: false,
        isScreenshot: false,
      },
      summary: "المستند ليس إيصالًا بنكيًا",
      confidence: 100,
    },
  });

  assert.equal(result?.recommendation, "مراجعة_يدوية");
  const failed = ["amount", "beneficiary", "date", "authenticity"];
  for (const stage of failed) {
    assert.ok(
      progress.some((entry) => entry.stage === stage && entry.status === "failed"),
      `expected ${stage} to be reported as failed`,
    );
  }
});
