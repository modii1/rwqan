/**
 * 🔬 AI Receipt Scanner - فحص الإيصالات بالذكاء الاصطناعي
 *
 * The LLM only extracts values. Whether a receipt may be auto-activated is
 * decided by `evaluateReceiptVerification` on the server using the approved
 * RWQAN bank accounts. A model-reported "auto activate" is never trusted.
 *
 * يدعم: PNG, JPG, JPEG, PDF
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import type { BankAccount } from "../../shared/schema";
import { firebaseService } from "../firebaseService";
import { externalServicesEnabled } from "../config/runtimeEnvironment";
import {
  detectReceiptMimeType,
  evaluateReceiptVerification,
  manualReviewReason,
  recommendationForVerification,
  type ExtractedReceiptData,
  type ReceiptAuthenticityAnalysis,
  type ReceiptImageQuality,
  type ReceiptMimeType,
  type ReceiptVerificationResult,
} from "../utils/receiptMatching";

export const GEMINI_MODEL = "gemini-2.5-flash";
export const DEFAULT_IMAGE_FETCH_TIMEOUT_MS = 20_000;
export const DEFAULT_GEMINI_TIMEOUT_MS = 45_000;

const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;

export interface AIScanResult {
  paymentId: string;
  scanDate: string;

  // البيانات المستخرجة
  extractedData: {
    amount: number | null;
    currency: string | null;
    date: string | null;
    time: string | null;
    senderName: string | null;
    senderBank: string | null;
    senderIban: string | null;
    senderAccountNumber: string | null;
    receiverName: string | null;
    receiverBank: string | null;
    receiverIban: string | null;
    receiverAccountNumber: string | null;
    referenceNumber: string | null;
    transactionId: string | null;
    paymentReference: string | null; // RWQN-XXXXXX
  };

  // تحليل الأصالة
  authenticityAnalysis: {
    overallScore: number; // 0-100
    isLikelyAuthentic: boolean;
    concerns: string[];
    positiveIndicators: string[];
  };

  // تحليل جودة الصورة
  imageQuality: {
    clarity: "ممتازة" | "جيدة" | "متوسطة" | "ضعيفة";
    isComplete: boolean;
    hasWatermarks: boolean;
    isScreenshot: boolean;
  };

  // التطابق مع متطلباتنا (محسوب في الخادم، وليس من النموذج)
  matchAnalysis: {
    amountMatch: boolean;
    currencyMatch: boolean;
    referenceMatch: boolean;
    ibanMatch: boolean;
    beneficiaryMatch: boolean;
    dateMatch: boolean;
    matchScore: number;
    matchDetails: string;
  };

  // ملخص الفحص
  summary: string;
  /**
   * Explicit document-type classification produced by the analysis. It is kept
   * separate from the verification result so a non-receipt can never be
   * mistaken for an incomplete receipt (manual review).
   */
  documentType: "bank_transfer_receipt" | "not_a_receipt" | "uncertain";
  recommendation: "تفعيل_تلقائي" | "مراجعة_يدوية" | "رفض" | "مستند_غير_إيصال";

  // نتيجة التحقق الصارمة وأسباب القرار
  verification: ReceiptVerificationResult & {
    decisionSource: "ai";
    failureReason?: string;
    manualReviewReason?: string;
  };

  receiptHash?: string;
  receiptObjectKey?: string;
  model: string;
  failureReason?: string;

  // البيانات الخام
  rawAnalysis: string;
  confidence: number;
}

export interface ScanReceiptOptions {
  /** Raw receipt bytes already in memory (preferred: avoids a network fetch). */
  imageBuffer?: Buffer;
  mimeType?: string;
  receiptHash?: string;
  receiptObjectKey?: string;
  expectedCurrency?: string;
  approvedAccounts?: BankAccount[];
  referenceDate?: Date;
  imageFetchTimeoutMs?: number;
  geminiTimeoutMs?: number;
  /**
   * Real, user-visible scan progress. Called only when a stage actually starts
   * or finishes. A throwing callback must never break the scan.
   */
  onProgress?: (
    stage: import("../services/ReceiptScanProgressStore").ReceiptScanStageKey,
    status: "active" | "done" | "failed"
  ) => void;
}

type FailureCode =
  | "GEMINI_NOT_CONFIGURED"
  | "GEMINI_TIMEOUT"
  | "GEMINI_ERROR"
  | "IMAGE_FETCH_FAILED"
  | "IMAGE_FETCH_TIMEOUT"
  | "INVALID_AI_RESPONSE"
  | "NO_APPROVED_ACCOUNTS";

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number(value.replace(/,/g, "").trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toTextOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toScore(value: unknown): number {
  const parsed = toNumberOrNull(value);
  if (parsed === null) return 0;
  // Floor (not round) so a score just below the threshold cannot become 80.
  return Math.max(0, Math.min(100, Math.floor(parsed)));
}

type DocumentType = "bank_transfer_receipt" | "not_a_receipt" | "uncertain";

/**
 * Normalise the model's document-type classification. Anything missing or
 * unexpected becomes "uncertain" so a real receipt is never rejected by a
 * parsing glitch; uncertainty is handled as a manual review.
 */
function normalizeDocumentType(value: unknown): DocumentType {
  if (typeof value !== "string") return "uncertain";
  const normalized = value.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized === "not_a_receipt" || normalized === "non_receipt") {
    return "not_a_receipt";
  }
  if (
    normalized === "bank_transfer_receipt" ||
    normalized === "bank_receipt" ||
    normalized === "receipt"
  ) {
    return "bank_transfer_receipt";
  }
  return "uncertain";
}

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item) => item.length > 0)
    .slice(0, 50);
}

function normalizeClarity(value: unknown): "ممتازة" | "جيدة" | "متوسطة" | "ضعيفة" {
  return value === "ممتازة" || value === "جيدة" || value === "متوسطة" || value === "ضعيفة"
    ? value
    : "ضعيفة";
}

type LoadedImage = {
  base64: string;
  mimeType: ReceiptMimeType;
  isPdf: boolean;
  sizeBytes: number;
};

async function loadReceiptImage(
  imageUrl: string,
  options: ScanReceiptOptions,
  timeoutMs: number,
): Promise<LoadedImage | { error: FailureCode }> {
  if (options.imageBuffer && options.imageBuffer.length > 0) {
    if (options.imageBuffer.length > MAX_RECEIPT_BYTES) {
      return { error: "INVALID_AI_RESPONSE" };
    }
    const detected =
      detectReceiptMimeType(options.imageBuffer) ??
      (options.mimeType as ReceiptMimeType | undefined) ??
      "image/jpeg";
    return {
      base64: options.imageBuffer.toString("base64"),
      mimeType: detected,
      isPdf: detected === "application/pdf",
      sizeBytes: options.imageBuffer.length,
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(imageUrl, { signal: controller.signal });
    if (!response.ok) {
      console.error(`❌ [AI Scanner] فشل تحميل الملف: ${response.status}`);
      return { error: "IMAGE_FETCH_FAILED" };
    }
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    if (buffer.length === 0 || buffer.length > MAX_RECEIPT_BYTES) {
      return { error: "INVALID_AI_RESPONSE" };
    }
    const headerType = (response.headers.get("content-type") || "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    const detected =
      detectReceiptMimeType(buffer) ??
      (["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(headerType)
        ? (headerType as ReceiptMimeType)
        : "image/jpeg");
    return {
      base64: buffer.toString("base64"),
      mimeType: detected,
      isPdf: detected === "application/pdf",
      sizeBytes: buffer.length,
    };
  } catch (error: any) {
    const aborted = error?.name === "AbortError" || /abort/i.test(String(error?.message));
    console.error(`❌ [AI Scanner] خطأ في تحميل الملف:`, error?.message ?? error);
    return { error: aborted ? "IMAGE_FETCH_TIMEOUT" : "IMAGE_FETCH_FAILED" };
  } finally {
    clearTimeout(timer);
  }
}

function reportProgress(
  options: ScanReceiptOptions,
  stage: import("../services/ReceiptScanProgressStore").ReceiptScanStageKey,
  status: "active" | "done" | "failed"
): void {
  try {
    options.onProgress?.(stage, status);
  } catch {
    // Progress must never break the receipt scan.
  }
}

function failureMessage(code: FailureCode): string {
  switch (code) {
    case "GEMINI_NOT_CONFIGURED":
      return "مفتاح Gemini غير مربوط في بيئة التشغيل؛ تم تحويل الإيصال إلى المراجعة اليدوية.";
    case "GEMINI_TIMEOUT":
      return "انتهت مهلة استدعاء Gemini؛ تم تحويل الإيصال إلى المراجعة اليدوية.";
    case "GEMINI_ERROR":
      return "تعذر الاتصال بخدمة Gemini؛ تم تحويل الإيصال إلى المراجعة اليدوية.";
    case "IMAGE_FETCH_FAILED":
      return "تعذر جلب صورة الإيصال للفحص؛ تم تحويله إلى المراجعة اليدوية.";
    case "IMAGE_FETCH_TIMEOUT":
      return "انتهت مهلة جلب صورة الإيصال؛ تم تحويله إلى المراجعة اليدوية.";
    case "INVALID_AI_RESPONSE":
      return "تعذر قراءة الإيصال أو أن الرد غير صالح؛ تم تحويله إلى المراجعة اليدوية.";
    case "NO_APPROVED_ACCOUNTS":
      return "لا توجد حسابات بنكية معتمدة في النظام للمطابقة؛ تم تحويل الإيصال إلى المراجعة اليدوية.";
  }
}

function buildEmptyExtractedData(): ExtractedReceiptData {
  return {
    amount: null,
    currency: null,
    date: null,
    time: null,
    senderName: null,
    senderBank: null,
    senderIban: null,
    senderAccountNumber: null,
    receiverName: null,
    receiverBank: null,
    receiverIban: null,
    receiverAccountNumber: null,
    referenceNumber: null,
    transactionId: null,
    paymentReference: null,
  };
}

function buildFailureResult(params: {
  paymentId: string;
  code: FailureCode;
  expectedAmount?: number;
  expectedReference?: string;
  approvedAccounts: BankAccount[];
  referenceDate?: Date;
  receiptHash?: string;
  receiptObjectKey?: string;
  rawAnalysis?: string;
}): AIScanResult {
  const verification = evaluateReceiptVerification({
    extracted: buildEmptyExtractedData(),
    authenticity: { overallScore: 0, isLikelyAuthentic: false },
    imageQuality: { clarity: "ضعيفة" },
    confidence: 0,
    expectedAmount: params.expectedAmount ?? null,
    expectedReference: params.expectedReference ?? null,
    approvedAccounts: params.approvedAccounts,
    referenceDate: params.referenceDate,
  });
  verification.blockers.unshift(failureMessage(params.code));
  const summary = failureMessage(params.code);
  const result: AIScanResult = {
    paymentId: params.paymentId,
    scanDate: new Date().toISOString(),
    extractedData: {
      amount: null,
      currency: null,
      date: null,
      time: null,
      senderName: null,
      senderBank: null,
      senderIban: null,
      senderAccountNumber: null,
      receiverName: null,
      receiverBank: null,
      receiverIban: null,
      receiverAccountNumber: null,
      referenceNumber: null,
      transactionId: null,
      paymentReference: null,
    },
    authenticityAnalysis: {
      overallScore: 0,
      isLikelyAuthentic: false,
      concerns: [summary],
      positiveIndicators: [],
    },
    imageQuality: {
      clarity: "ضعيفة",
      isComplete: false,
      hasWatermarks: false,
      isScreenshot: false,
    },
    matchAnalysis: {
      amountMatch: false,
      currencyMatch: false,
      referenceMatch: false,
      ibanMatch: false,
      beneficiaryMatch: false,
      dateMatch: false,
      matchScore: 0,
      matchDetails: summary,
    },
    summary,
    documentType: "uncertain",
    recommendation: "مراجعة_يدوية",
    verification: {
      ...verification,
      decisionSource: "ai",
      failureReason: params.code,
      manualReviewReason: summary,
    },
    receiptHash: params.receiptHash,
    receiptObjectKey: params.receiptObjectKey,
    model: GEMINI_MODEL,
    failureReason: params.code,
    rawAnalysis: params.rawAnalysis ?? "",
    confidence: 0,
  };
  return result;
}

/**
 * فحص الإيصال بالذكاء الاصطناعي.
 *
 * Returns `null` only when external services are disabled (DEV guard), which
 * preserves the existing isolation contract. In an enabled runtime any failure
 * returns a manual-review result so the payment is never auto-approved and the
 * reason is visible to administrators.
 */
export async function scanReceiptWithAI(
  imageUrl: string,
  paymentId: string,
  expectedAmount?: number,
  expectedReference?: string,
  expectedIban?: string,
  expectedBeneficiary?: string,
  options: ScanReceiptOptions = {},
): Promise<AIScanResult | null> {
  if (!externalServicesEnabled()) {
    console.warn(
      "🔬 [AI Scanner] Gemini is disabled in development (DEV → OFF by default).",
    );
    return null;
  }

  reportProgress(options, "received", "active");

  const referenceDate = options.referenceDate ?? new Date();
  const imageTimeout =
    options.imageFetchTimeoutMs ?? DEFAULT_IMAGE_FETCH_TIMEOUT_MS;
  const geminiTimeout = options.geminiTimeoutMs ?? DEFAULT_GEMINI_TIMEOUT_MS;

  let approvedAccounts: BankAccount[] = [];
  try {
    approvedAccounts =
      options.approvedAccounts ?? (await firebaseService.getActiveBankAccounts());
  } catch (error: any) {
    console.error(
      "🔬 [AI Scanner] تعذر تحميل الحسابات البنكية المعتمدة:",
      error?.message ?? error,
    );
    approvedAccounts = [];
  }

  if (approvedAccounts.length === 0) {
    reportProgress(options, "received", "done");
    reportProgress(options, "reading", "failed");
    reportProgress(options, "finalizing", "done");
    const failure = buildFailureResult({
      paymentId,
      code: "NO_APPROVED_ACCOUNTS",
      expectedAmount,
      expectedReference,
      approvedAccounts,
      referenceDate,
      receiptHash: options.receiptHash,
      receiptObjectKey: options.receiptObjectKey,
    });
    await saveAIScanResult(failure);
    return failure;
  }

  console.log(`🔬 [AI Scanner] بدء فحص الإيصال: ${paymentId}`);

  const loaded = await loadReceiptImage(imageUrl, options, imageTimeout);
  if ("error" in loaded) {
    reportProgress(options, "received", "failed");
    reportProgress(options, "finalizing", "done");
    const failure = buildFailureResult({
      paymentId,
      code: loaded.error,
      expectedAmount,
      expectedReference,
      approvedAccounts,
      referenceDate,
      receiptHash: options.receiptHash,
      receiptObjectKey: options.receiptObjectKey,
    });
    await saveAIScanResult(failure);
    return failure;
  }

  reportProgress(options, "received", "done");

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    console.error(
      "🔬 [AI Scanner] GEMINI_API_KEY غير موجود في بيئة التشغيل — لن يتم استدعاء Gemini.",
    );
    reportProgress(options, "reading", "failed");
    reportProgress(options, "finalizing", "done");
    const failure = buildFailureResult({
      paymentId,
      code: "GEMINI_NOT_CONFIGURED",
      expectedAmount,
      expectedReference,
      approvedAccounts,
      referenceDate,
      receiptHash: options.receiptHash,
      receiptObjectKey: options.receiptObjectKey,
    });
    await saveAIScanResult(failure);
    return failure;
  }

  const todaySaudi = referenceDate.toLocaleDateString("en-CA", {
    timeZone: "Asia/Riyadh",
  });
  const approvedBeneficiaries = approvedAccounts
    .map((account) => account.beneficiaryName?.trim() || "")
    .filter(Boolean);
  const approvedIbans = approvedAccounts
    .map((account) => account.iban?.trim() || "")
    .filter(Boolean);
  const expectedIbanValue =
    expectedIban?.trim() ||
    approvedAccounts.find((account) => account.isDefault)?.iban?.trim() ||
    approvedIbans[0] ||
    "غير محدد";
  const expectedBeneficiaryValue =
    expectedBeneficiary?.trim() ||
    approvedAccounts.find((account) => account.isDefault)?.beneficiaryName?.trim() ||
    approvedBeneficiaries[0] ||
    "غير محدد";

  const systemPrompt = `أنت خبير في تحليل الإيصالات البنكية السعودية. مهمتك استخراج البيانات فقط، ولا تقرر تفعيل الدفع.

تاريخ اليوم الحالي: ${todaySaudi} (بتوقيت السعودية)

يجب عليك:
1. استخراج كل البيانات المرئية في الإيصال بدقة.
2. تقييم أصالة الإيصال (هل يبدو حقيقيًا أم معدلًا).
3. تقييم جودة الصورة.

البيانات المتوقعة (للمقارنة فقط):
- المبلغ المتوقع: ${expectedAmount ?? "غير محدد"} ريال
- العملة المتوقعة: SAR
- الرمز المرجعي المتوقع: ${expectedReference || "غير محدد"}
- IBAN المستفيد المتوقع: ${expectedIbanValue}
- اسم المستفيد المتوقع: ${expectedBeneficiaryValue}
- أسماء المستفيدين المعتمدين: ${approvedBeneficiaries.join("، ") || "غير محدد"}
- أرقام IBAN المعتمدة: ${approvedIbans.join("، ") || "غير محدد"}

أجب بصيغة JSON فقط بالهيكل التالي:
{
  "documentType": "bank_transfer_receipt" | "not_a_receipt" | "uncertain",
  "extractedData": {
    "amount": رقم أو null,
    "currency": "SAR" أو "ريال" أو null,
    "date": "YYYY-MM-DD" أو null,
    "time": "HH:MM" أو null,
    "senderName": "اسم المرسل" أو null,
    "senderBank": "اسم بنك المرسل" أو null,
    "senderIban": "IBAN المرسل" أو null,
    "senderAccountNumber": "رقم حساب المرسل" أو null,
    "receiverName": "اسم المستفيد" أو null,
    "receiverBank": "اسم بنك المستفيد" أو null,
    "receiverIban": "IBAN المستفيد" أو null,
    "receiverAccountNumber": "رقم حساب المستفيد" أو null,
    "referenceNumber": "رقم مرجعي البنك" أو null,
    "transactionId": "رقم العملية" أو null,
    "paymentReference": "RWQN-XXXXXX إذا وجد" أو null
  },
  "authenticityAnalysis": {
    "overallScore": رقم من 0 إلى 100,
    "isLikelyAuthentic": true أو false,
    "concerns": ["قائمة المخاوف إن وجدت"],
    "positiveIndicators": ["مؤشرات إيجابية"]
  },
  "imageQuality": {
    "clarity": "ممتازة" أو "جيدة" أو "متوسطة" أو "ضعيفة",
    "isComplete": true أو false,
    "hasWatermarks": true أو false,
    "isScreenshot": true أو false
  },
  "summary": "ملخص شامل للفحص",
  "confidence": رقم من 0 إلى 100
}

ملاحظات:
- documentType must be exactly one of: "bank_transfer_receipt", "not_a_receipt", "uncertain".
  Use "not_a_receipt" ONLY when you are certain the document is not a bank transfer receipt
  (for example a programming guide, article, non-bank invoice, ID card, or unrelated screenshot).
  Use "uncertain" when the document type cannot be confirmed or the image is unclear.
- لا تخترع أي قيمة غير ظاهرة في الصورة.
- إن لم تظهر قيمة فاجعلها null.
- القرار النهائي للتفعيل تتخذه الخادم وليس أنت.`;

  let rawAnalysis = "";
  reportProgress(options, "reading", "active");
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });
    console.log(
      `[AI Scanner] Sending to Gemini. MimeType: ${loaded.mimeType}, Base64 length: ${loaded.base64.length}`,
    );
    const result = await model.generateContent(
      [
        systemPrompt,
        {
          inlineData: {
            mimeType: loaded.mimeType,
            data: loaded.base64,
          },
        },
        "قم بفحص هذا الإيصال البنكي واستخرج كل البيانات المرئية فقط.",
      ],
      { timeout: geminiTimeout },
    );
    rawAnalysis = result.response.text();
    reportProgress(options, "reading", "done");
    console.log(
      `[AI Scanner] Gemini response received, length: ${rawAnalysis.length} chars`,
    );
  } catch (error: any) {
    const message = String(error?.message ?? error);
    const timedOut =
      /timeout|timed out|abort/i.test(message) ||
      error?.name === "GoogleGenerativeAIAbortError";
    const code: FailureCode = timedOut ? "GEMINI_TIMEOUT" : "GEMINI_ERROR";
    reportProgress(options, "reading", "failed");
    reportProgress(options, "finalizing", "done");
    console.error(`🔬 [AI Scanner] خطأ في Gemini: ${message}`);
    const failure = buildFailureResult({
      paymentId,
      code,
      expectedAmount,
      expectedReference,
      approvedAccounts,
      referenceDate,
      receiptHash: options.receiptHash,
      receiptObjectKey: options.receiptObjectKey,
      rawAnalysis,
    });
    await saveAIScanResult(failure);
    return failure;
  }

  let analysisData: any;
  try {
    const jsonMatch = rawAnalysis.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("لم يتم العثور على JSON في الرد");
    analysisData = JSON.parse(jsonMatch[0]);
  } catch (parseError: any) {
    console.error("🔬 [AI Scanner] خطأ في تحليل JSON:", parseError?.message ?? parseError);
    reportProgress(options, "reading", "failed");
    reportProgress(options, "finalizing", "done");
    const failure = buildFailureResult({
      paymentId,
      code: "INVALID_AI_RESPONSE",
      expectedAmount,
      expectedReference,
      approvedAccounts,
      referenceDate,
      receiptHash: options.receiptHash,
      receiptObjectKey: options.receiptObjectKey,
      rawAnalysis,
    });
    await saveAIScanResult(failure);
    return failure;
  }

  const extractedData: ExtractedReceiptData = {
    amount: toNumberOrNull(analysisData?.extractedData?.amount),
    currency: toTextOrNull(analysisData?.extractedData?.currency),
    date: toTextOrNull(analysisData?.extractedData?.date),
    time: toTextOrNull(analysisData?.extractedData?.time),
    senderName: toTextOrNull(analysisData?.extractedData?.senderName),
    senderBank: toTextOrNull(analysisData?.extractedData?.senderBank),
    senderIban: toTextOrNull(analysisData?.extractedData?.senderIban),
    senderAccountNumber: toTextOrNull(
      analysisData?.extractedData?.senderAccountNumber,
    ),
    receiverName: toTextOrNull(analysisData?.extractedData?.receiverName),
    receiverBank: toTextOrNull(analysisData?.extractedData?.receiverBank),
    receiverIban: toTextOrNull(analysisData?.extractedData?.receiverIban),
    receiverAccountNumber: toTextOrNull(
      analysisData?.extractedData?.receiverAccountNumber,
    ),
    referenceNumber: toTextOrNull(analysisData?.extractedData?.referenceNumber),
    transactionId: toTextOrNull(analysisData?.extractedData?.transactionId),
    paymentReference: toTextOrNull(analysisData?.extractedData?.paymentReference),
  };

  const authenticityAnalysis: ReceiptAuthenticityAnalysis = {
    overallScore: toScore(analysisData?.authenticityAnalysis?.overallScore),
    isLikelyAuthentic: analysisData?.authenticityAnalysis?.isLikelyAuthentic === true,
    concerns: toStringList(analysisData?.authenticityAnalysis?.concerns),
    positiveIndicators: toStringList(
      analysisData?.authenticityAnalysis?.positiveIndicators,
    ),
  };

  const imageQuality: ReceiptImageQuality = {
    clarity: normalizeClarity(analysisData?.imageQuality?.clarity),
    isComplete: analysisData?.imageQuality?.isComplete === true,
    hasWatermarks: analysisData?.imageQuality?.hasWatermarks === true,
    isScreenshot: analysisData?.imageQuality?.isScreenshot === true,
  };

  const confidence = toScore(analysisData?.confidence);
  const documentType = normalizeDocumentType(analysisData?.documentType);
  const looksLikeReceipt =
    extractedData.amount !== null &&
    Boolean(
      extractedData.receiverIban ||
        extractedData.referenceNumber ||
        extractedData.paymentReference ||
        extractedData.transactionId
    );
  const confirmedNotReceipt =
    documentType === "not_a_receipt" && !looksLikeReceipt;
  const verification = evaluateReceiptVerification({
    extracted: extractedData,
    authenticity: authenticityAnalysis,
    imageQuality,
    confidence,
    expectedAmount: expectedAmount ?? null,
    expectedReference: expectedReference ?? null,
    approvedAccounts,
    referenceDate,
  });
  const recommendation: AIScanResult["recommendation"] = confirmedNotReceipt
    ? "مستند_غير_إيصال"
    : documentType === "bank_transfer_receipt"
      ? recommendationForVerification(verification)
      : "مراجعة_يدوية";
  const reviewReason = manualReviewReason(verification);
  const typeReviewReason =
    documentType === "uncertain"
      ? "تعذّر تأكيد نوع المستند؛ يتطلب مراجعة."
      : documentType === "not_a_receipt" && looksLikeReceipt
        ? "نوع المستند غير مؤكد؛ يتطلب مراجعة."
        : null;

  reportProgress(
    options,
    "amount",
    verification.amountMatch && verification.currencyMatch ? "done" : "failed"
  );
  reportProgress(
    options,
    "beneficiary",
    verification.beneficiaryMatch && verification.ibanMatch ? "done" : "failed"
  );
  reportProgress(options, "date", verification.dateMatch ? "done" : "failed");
  reportProgress(
    options,
    "authenticity",
    verification.authenticityOk &&
      verification.qualityOk &&
      verification.confidenceOk
      ? "done"
      : "failed"
  );
  reportProgress(options, "finalizing", "active");

  const scanResult: AIScanResult = {
    paymentId,
    scanDate: new Date().toISOString(),
    extractedData: {
      amount: extractedData.amount,
      currency: extractedData.currency,
      date: extractedData.date,
      time: extractedData.time ?? null,
      senderName: extractedData.senderName ?? null,
      senderBank: extractedData.senderBank ?? null,
      senderIban: extractedData.senderIban ?? null,
      senderAccountNumber: extractedData.senderAccountNumber ?? null,
      receiverName: extractedData.receiverName ?? null,
      receiverBank: extractedData.receiverBank ?? null,
      receiverIban: extractedData.receiverIban ?? null,
      receiverAccountNumber: extractedData.receiverAccountNumber ?? null,
      referenceNumber: extractedData.referenceNumber ?? null,
      transactionId: extractedData.transactionId ?? null,
      paymentReference: extractedData.paymentReference ?? null,
    },
    authenticityAnalysis: {
      overallScore: authenticityAnalysis.overallScore,
      isLikelyAuthentic: authenticityAnalysis.isLikelyAuthentic,
      concerns: authenticityAnalysis.concerns ?? [],
      positiveIndicators: authenticityAnalysis.positiveIndicators ?? [],
    },
    imageQuality: {
      clarity: normalizeClarity(imageQuality.clarity),
      isComplete: imageQuality.isComplete === true,
      hasWatermarks: imageQuality.hasWatermarks === true,
      isScreenshot: imageQuality.isScreenshot === true,
    },
    matchAnalysis: {
      amountMatch: verification.amountMatch,
      currencyMatch: verification.currencyMatch,
      referenceMatch: verification.referenceMatch,
      ibanMatch: verification.ibanMatch,
      beneficiaryMatch: verification.beneficiaryMatch,
      dateMatch: verification.dateMatch,
      matchScore: verification.matchScore,
      matchDetails: verification.reasons.join("؛ "),
    },
    summary:
      toTextOrNull(analysisData?.summary) ||
      (recommendation === "تفعيل_تلقائي"
        ? "الإيصال مطابق لشروط التفعيل التلقائي."
        : confirmedNotReceipt
          ? "المستند ليس إيصال تحويل بنكي."
          : [typeReviewReason, reviewReason].filter(Boolean).join(" ") ||
            reviewReason),
    documentType,
    recommendation,
    verification: {
      ...verification,
      autoActivationAllowed:
        recommendation === "تفعيل_تلقائي"
          ? verification.autoActivationAllowed
          : false,
      decisionSource: "ai",
      manualReviewReason:
        recommendation === "مراجعة_يدوية"
          ? [typeReviewReason, reviewReason].filter(Boolean).join(" ")
          : confirmedNotReceipt
            ? "المستند ليس إيصال تحويل بنكي."
            : undefined,
    },
    receiptHash: options.receiptHash,
    receiptObjectKey: options.receiptObjectKey,
    model: GEMINI_MODEL,
    rawAnalysis,
    confidence,
  };

  await saveAIScanResult(scanResult);
  reportProgress(options, "finalizing", "done");
  console.log(
    `🔬 [AI Scanner] اكتمل الفحص - التوصية: ${scanResult.recommendation}, الثقة: ${scanResult.confidence}%`,
  );
  return scanResult;
}

/**
 * حفظ نتيجة الفحص الكاملة في Firestore (بدون أي مفاتيح أو أسرار).
 */
async function saveAIScanResult(scanResult: AIScanResult): Promise<void> {
  try {
    await (firebaseService as any).saveReceiptVerification({
      paymentId: scanResult.paymentId,
      receiptHash: scanResult.receiptHash,
      receiptObjectKey: scanResult.receiptObjectKey,
      recommendation: scanResult.recommendation,
      documentType: scanResult.documentType,
      decisionSource: "ai",
      manualReviewReason:
        scanResult.recommendation === "مراجعة_يدوية"
          ? scanResult.verification.manualReviewReason ||
            manualReviewReason(scanResult.verification)
          : undefined,
      summary: scanResult.summary,
      failureReason: scanResult.failureReason,
      model: scanResult.model,
      scannedAt: scanResult.scanDate,
      extractedAmount: scanResult.extractedData.amount ?? undefined,
      extractedCurrency: scanResult.extractedData.currency ?? undefined,
      extractedDate: scanResult.extractedData.date ?? undefined,
      extractedIban: scanResult.extractedData.receiverIban ?? undefined,
      extractedReference:
        scanResult.extractedData.paymentReference ??
        scanResult.extractedData.referenceNumber ??
        undefined,
      extractedBankName: scanResult.extractedData.receiverBank ?? undefined,
      extractedBeneficiaryName:
        scanResult.extractedData.receiverName ?? undefined,
      extractedAccountNumber:
        scanResult.extractedData.receiverAccountNumber ?? undefined,
      extractedSenderName: scanResult.extractedData.senderName ?? undefined,
      extractedTransactionId:
        scanResult.extractedData.transactionId ?? undefined,
      extractedPaymentReference:
        scanResult.extractedData.paymentReference ?? undefined,
      confidence: scanResult.confidence,
      rawText: scanResult.summary,
      rawAnalysis: scanResult.rawAnalysis
        ? scanResult.rawAnalysis.slice(0, 20_000)
        : undefined,
      extractedData: scanResult.extractedData,
      authenticityAnalysis: scanResult.authenticityAnalysis,
      imageQuality: scanResult.imageQuality,
      matchAnalysis: scanResult.matchAnalysis,
      amountMatch: scanResult.verification.amountMatch,
      currencyMatch: scanResult.verification.currencyMatch,
      beneficiaryMatch: scanResult.verification.beneficiaryMatch,
      ibanMatch: scanResult.verification.ibanMatch,
      referenceMatch: scanResult.verification.referenceMatch,
      dateMatch: scanResult.verification.dateMatch,
      autoActivationAllowed: scanResult.verification.autoActivationAllowed,
      blockers: scanResult.verification.blockers,
      reasons: scanResult.verification.reasons,
    });
    console.log(
      `🔬 [AI Scanner] تم حفظ نتيجة الفحص للدفعة: ${scanResult.paymentId}`,
    );
  } catch (error) {
    console.error("🔬 [AI Scanner] خطأ في حفظ النتيجة:", error);
  }
}

/**
 * Persist a scan result again after a post-processing change (for example a
 * duplicate bank reference detected by the route). Keeps one write path so the
 * admin record always matches the final decision.
 */
export async function persistAIScanResult(
  scanResult: AIScanResult,
): Promise<void> {
  await saveAIScanResult(scanResult);
}

/**
 * تصدير الدالة للاستخدام في routes
 */
export { scanReceiptWithAI as analyzeReceiptWithAI };
