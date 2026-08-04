export type ReceiptImageClarity = "ممتازة" | "جيدة" | "متوسطة" | "ضعيفة";

export function getRiyadhDateKey(referenceDate: Date = new Date()): string {
  return referenceDate.toLocaleDateString("en-CA", {
    timeZone: "Asia/Riyadh",
  });
}

export function isReceiptDateToday(
  extractedDate: string | null | undefined,
  referenceDate: Date = new Date(),
): boolean {
  const normalizedDate = String(extractedDate || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalizedDate)) return false;
  return normalizedDate === getRiyadhDateKey(referenceDate);
}

export function isReceiptAmountExact(
  extractedAmount: number | null | undefined,
  expectedAmount: number | null | undefined,
): boolean {
  if (
    typeof extractedAmount !== "number" ||
    typeof expectedAmount !== "number" ||
    !Number.isFinite(extractedAmount) ||
    !Number.isFinite(expectedAmount)
  ) {
    return false;
  }
  return Math.round(extractedAmount * 100) === Math.round(expectedAmount * 100);
}

export function canAutoActivateReceipt(params: {
  amountMatch: boolean;
  extractedDate?: string | null;
  confidence: number;
  clarity: ReceiptImageClarity;
  referenceDate?: Date;
}): boolean {
  const qualityOk = params.clarity === "ممتازة" || params.clarity === "جيدة";
  return params.amountMatch === true &&
    isReceiptDateToday(params.extractedDate, params.referenceDate) &&
    params.confidence >= 80 &&
    qualityOk;
}
