/**
 * Receipt matching rules shared by the AI scanner, routes, tests and admin UI.
 *
 * The rules are deliberately deterministic and server-side: the LLM only
 * extracts values. Whether a receipt may be auto-activated is decided here,
 * never by a model-reported boolean sent from the client.
 */
import {
  isReceiptAmountExact,
  isReceiptDateToday,
} from "./receiptAutoActivation";

export const EXPECTED_CURRENCY = "SAR";
export const MIN_AUTO_CONFIDENCE = 80;
export const MIN_AUTHENTICITY_SCORE = 60;

export type ReceiptClarity = "ممتازة" | "جيدة" | "متوسطة" | "ضعيفة" | string;

export interface ApprovedBankAccount {
  id?: string;
  bankName?: string;
  beneficiaryName?: string;
  iban?: string;
  accountNumber?: string;
  isActive?: boolean;
  isDefault?: boolean;
}

export interface ExtractedReceiptData {
  amount: number | null;
  currency: string | null;
  date: string | null;
  time?: string | null;
  senderName?: string | null;
  senderBank?: string | null;
  senderIban?: string | null;
  senderAccountNumber?: string | null;
  receiverName?: string | null;
  receiverBank?: string | null;
  receiverIban?: string | null;
  receiverAccountNumber?: string | null;
  referenceNumber?: string | null;
  transactionId?: string | null;
  paymentReference?: string | null;
}

export interface ReceiptAuthenticityAnalysis {
  overallScore: number;
  isLikelyAuthentic: boolean;
  concerns?: string[];
  positiveIndicators?: string[];
}

export interface ReceiptImageQuality {
  clarity: ReceiptClarity;
  isComplete?: boolean;
  hasWatermarks?: boolean;
  isScreenshot?: boolean;
}

export interface ReceiptVerificationInput {
  extracted: ExtractedReceiptData;
  authenticity: ReceiptAuthenticityAnalysis;
  imageQuality: ReceiptImageQuality;
  confidence: number;
  expectedAmount?: number | null;
  expectedReference?: string | null;
  approvedAccounts: ApprovedBankAccount[];
  referenceDate?: Date;
}

export interface ReceiptVerificationResult {
  amountMatch: boolean;
  currencyMatch: boolean;
  beneficiaryMatch: boolean;
  ibanMatch: boolean;
  referenceMatch: boolean;
  dateMatch: boolean;
  referenceProvided: boolean;
  beneficiaryVerifiable: boolean;
  ibanVerifiable: boolean;
  qualityOk: boolean;
  confidenceOk: boolean;
  authenticityOk: boolean;
  matchScore: number;
  expectedCurrency: string;
  reasons: string[];
  blockers: string[];
  autoActivationAllowed: boolean;
}

/** Normalize Arabic/Latin names before comparison (spaces, diacritics, alef). */
export function normalizePersonName(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}]+/gu, "")
    .trim();
}

export function normalizeIban(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export function normalizeReference(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "");
}

export function normalizeCurrency(value: unknown): string {
  const raw = String(value ?? "")
    .normalize("NFKC")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
  if (!raw) return "";
  if (
    raw === "SAR" ||
    raw === "SR" ||
    raw === "ر.س" ||
    raw === "ر س" ||
    raw === "ريال" ||
    raw === "ريال سعودي" ||
    raw === "سعودي" ||
    raw === "SAUDI RIYAL"
  ) {
    return EXPECTED_CURRENCY;
  }
  return raw;
}

function levenshteinDistance(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp: number[][] = Array.from({ length: rows }, () =>
    Array<number>(cols).fill(0),
  );
  for (let i = 0; i < rows; i += 1) dp[i][0] = i;
  for (let j = 0; j < cols; j += 1) dp[0][j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

export function similarityScore(a: string, b: string): number {
  const longer = a.length >= b.length ? a : b;
  const shorter = a.length >= b.length ? b : a;
  if (!longer.length) return 1;
  return (longer.length - levenshteinDistance(longer, shorter)) / longer.length;
}

export function namesMatch(a: unknown, b: unknown): boolean {
  const left = normalizePersonName(a);
  const right = normalizePersonName(b);
  if (!left || !right) return false;
  if (left === right) return true;
  if (left.includes(right) || right.includes(left)) return true;
  return similarityScore(left, right) >= 0.8;
}

export function activeApprovedAccounts(
  accounts: ApprovedBankAccount[] | null | undefined,
): ApprovedBankAccount[] {
  return (accounts ?? []).filter((account) => account?.isActive !== false);
}

function approvedBeneficiaries(accounts: ApprovedBankAccount[]): string[] {
  return accounts
    .map((account) => normalizePersonName(account.beneficiaryName))
    .filter(Boolean);
}

function approvedIbans(accounts: ApprovedBankAccount[]): string[] {
  return accounts
    .map((account) => normalizeIban(account.iban))
    .filter(Boolean);
}

/**
 * Evaluate a receipt against the approved RWQAN bank accounts and payment.
 * Any missing essential fact is a blocker, so the result can only be
 * auto-activated when every required check passes.
 */
export function evaluateReceiptVerification(
  input: ReceiptVerificationInput,
): ReceiptVerificationResult {
  const accounts = activeApprovedAccounts(input.approvedAccounts);
  const beneficiaries = approvedBeneficiaries(accounts);
  const ibans = approvedIbans(accounts);
  const reasons: string[] = [];
  const blockers: string[] = [];

  const expectedAmount =
    typeof input.expectedAmount === "number" && Number.isFinite(input.expectedAmount)
      ? input.expectedAmount
      : null;

  const amountMatch = isReceiptAmountExact(
    input.extracted.amount,
    expectedAmount ?? undefined,
  );
  if (expectedAmount === null) {
    blockers.push("المبلغ المطلوب غير محدد في الدفعة");
  } else if (amountMatch) {
    reasons.push(`المبلغ مطابق (${expectedAmount} ر.س)`);
  } else {
    blockers.push(
      `المبلغ غير مطابق (المستخرج: ${
        input.extracted.amount ?? "غير مقروء"
      }، المطلوب: ${expectedAmount})`,
    );
  }

  const expectedCurrency = EXPECTED_CURRENCY;
  const currencyMatch =
    normalizeCurrency(input.extracted.currency) === expectedCurrency;
  if (!normalizeCurrency(input.extracted.currency)) {
    blockers.push("لم يتم استخراج عملة الإيصال");
  } else if (currencyMatch) {
    reasons.push("العملة مطابقة (SAR)");
  } else {
    blockers.push(
      `العملة غير مطابقة (المستخرج: ${input.extracted.currency}، المطلوب: SAR)`,
    );
  }

  const extractedBeneficiary = input.extracted.receiverName;
  const beneficiaryVerifiable = beneficiaries.length > 0;
  const beneficiaryMatch =
    beneficiaryVerifiable &&
    beneficiaries.some((approved) => namesMatch(extractedBeneficiary, approved));
  if (!beneficiaryVerifiable) {
    blockers.push("لا توجد أسماء مستفيدين معتمدة في حسابات روقان للمطابقة");
  } else if (!normalizePersonName(extractedBeneficiary)) {
    blockers.push("لم يتم استخراج اسم المستفيد من الإيصال");
  } else if (beneficiaryMatch) {
    reasons.push("اسم المستفيد مطابق لحساب روقان معتمد");
  } else {
    blockers.push(
      `اسم المستفيد غير مطابق (المستخرج: ${String(extractedBeneficiary)})`,
    );
  }

  const extractedIban = normalizeIban(input.extracted.receiverIban);
  const ibanVerifiable = ibans.length > 0;
  const ibanMatch = ibanVerifiable && Boolean(extractedIban) && ibans.includes(extractedIban);
  if (!ibanVerifiable) {
    blockers.push("لا توجد أرقام IBAN معتمدة في حسابات روقان للمطابقة");
  } else if (!extractedIban) {
    blockers.push("لم يتم استخراج IBAN المستفيد من الإيصال");
  } else if (ibanMatch) {
    reasons.push("IBAN المستفيد مطابق لحساب روقان معتمد");
  } else {
    blockers.push("IBAN المستفيد غير مطابق لحسابات روقان المعتمدة");
  }

  const extractedReference = normalizeReference(input.extracted.paymentReference);
  const expectedReference = normalizeReference(input.expectedReference);
  const referenceProvided = Boolean(extractedReference);
  const referenceMatch =
    referenceProvided && Boolean(expectedReference) && extractedReference === expectedReference;
  if (referenceProvided) {
    if (!expectedReference) {
      blockers.push("رمز الدفع المتوقع غير محدد في الدفعة");
    } else if (referenceMatch) {
      reasons.push("رمز الدفع RWQN مطابق");
    } else {
      blockers.push(
        `رمز الدفع في الإيصال لا يطابق الدفعة (المستخرج: ${String(
          input.extracted.paymentReference,
        )})`,
      );
    }
  } else {
    reasons.push("لم يظهر رمز الدفع RWQN في الإيصال (مؤشر إضافي غير إلزامي)");
  }

  const dateMatch = isReceiptDateToday(input.extracted.date, input.referenceDate);
  if (dateMatch) {
    reasons.push("تاريخ الإيصال هو تاريخ اليوم بتوقيت الرياض");
  } else {
    blockers.push(
      `تاريخ الإيصال غير مقبول (المستخرج: ${
        input.extracted.date ?? "غير مقروء"
      }). القاعدة المعتمدة: تاريخ اليوم بتوقيت الرياض`,
    );
  }

  const clarity = String(input.imageQuality?.clarity ?? "");
  const qualityOk = clarity === "ممتازة" || clarity === "جيدة";
  if (!qualityOk) {
    blockers.push(`جودة الصورة غير كافية (${clarity || "غير معروفة"})`);
  } else {
    reasons.push(`جودة الصورة ${clarity}`);
  }

  const confidence = Number(input.confidence);
  const confidenceOk = Number.isFinite(confidence) && confidence >= MIN_AUTO_CONFIDENCE;
  if (!confidenceOk) {
    blockers.push(
      `درجة الثقة أقل من الحد المطلوب (${MIN_AUTO_CONFIDENCE}%). الحالية: ${
        Number.isFinite(confidence) ? Math.round(confidence) : 0
      }%`,
    );
  } else {
    reasons.push(`درجة الثقة ${Math.round(confidence)}%`);
  }

  const authenticityScore = Number(input.authenticity?.overallScore);
  const authenticityOk =
    input.authenticity?.isLikelyAuthentic === true &&
    Number.isFinite(authenticityScore) &&
    authenticityScore >= MIN_AUTHENTICITY_SCORE;
  if (!authenticityOk) {
    blockers.push(
      `لم يتم التأكد من أصالة الإيصال (الدرجة: ${
        Number.isFinite(authenticityScore) ? Math.round(authenticityScore) : 0
      }%)`,
    );
  } else {
    reasons.push("تحليل الأصالة إيجابي");
  }

  const matchScore = Math.max(
    0,
    Math.min(
      100,
      (amountMatch ? 30 : 0) +
        (currencyMatch ? 10 : 0) +
        (beneficiaryMatch ? 20 : 0) +
        (ibanMatch ? 20 : 0) +
        (referenceMatch ? 10 : 0) +
        (dateMatch ? 10 : 0),
    ),
  );

  return {
    amountMatch,
    currencyMatch,
    beneficiaryMatch,
    ibanMatch,
    referenceMatch,
    dateMatch,
    referenceProvided,
    beneficiaryVerifiable,
    ibanVerifiable,
    qualityOk,
    confidenceOk,
    authenticityOk,
    matchScore,
    expectedCurrency,
    reasons,
    blockers,
    autoActivationAllowed: blockers.length === 0,
  };
}

export function recommendationForVerification(
  result: ReceiptVerificationResult,
): "تفعيل_تلقائي" | "مراجعة_يدوية" {
  return result.autoActivationAllowed ? "تفعيل_تلقائي" : "مراجعة_يدوية";
}

export function manualReviewReason(result: ReceiptVerificationResult): string {
  return result.blockers.length > 0
    ? result.blockers.join("؛ ")
    : "لم يستوف الإيصال شروط التفعيل التلقائي";
}

export type ReceiptMimeType =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "application/pdf";

/** Detect the real content type from magic bytes (never from the filename). */
export function detectReceiptMimeType(buffer: Buffer): ReceiptMimeType | null {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    )
  ) {
    return "image/png";
  }
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  if (buffer.length >= 5 && buffer.subarray(0, 5).toString("ascii") === "%PDF-") {
    return "application/pdf";
  }
  return null;
}
