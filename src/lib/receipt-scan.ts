/**
 * User-facing model for the interactive receipt scan.
 *
 * Everything here is presentation only: the server remains the single source
 * of truth for verification, and this module never approves anything.
 */

export type ReceiptScanStageKey =
  | "received"
  | "reading"
  | "amount"
  | "beneficiary"
  | "date"
  | "authenticity"
  | "finalizing";

export type ReceiptScanStageStatus = "pending" | "active" | "done" | "failed";

export type ReceiptScanOutcome =
  | "scanning"
  | "success"
  | "review"
  | "error"
  | "not_receipt"
  | "duplicate";

export interface ReceiptScanStageState {
  key: ReceiptScanStageKey;
  label: string;
  status: ReceiptScanStageStatus;
}

export interface ReceiptScanProgressSnapshot {
  scanId: string;
  status: "running" | "done" | "error";
  stages: Array<{ key: string; status: string }>;
}

export const RECEIPT_SCAN_STAGES: ReadonlyArray<{
  key: ReceiptScanStageKey;
  label: string;
}> = [
  { key: "received", label: "جارٍ استلام الإيصال..." },
  { key: "reading", label: "جارٍ قراءة بيانات الإيصال..." },
  { key: "amount", label: "جارٍ التحقق من مبلغ التحويل..." },
  { key: "beneficiary", label: "جارٍ مطابقة بيانات المستفيد..." },
  { key: "date", label: "جارٍ التحقق من تاريخ التحويل..." },
  { key: "authenticity", label: "جارٍ التأكد من صحة الإيصال..." },
  { key: "finalizing", label: "جارٍ استكمال التحقق..." },
];

const STAGE_KEYS = new Set<string>(RECEIPT_SCAN_STAGES.map((stage) => stage.key));

export function initialReceiptScanStages(): ReceiptScanStageState[] {
  return RECEIPT_SCAN_STAGES.map((stage) => ({
    ...stage,
    status: "pending" as const,
  }));
}

/**
 * Merge a server snapshot into the local stages. Unknown stages are ignored and
 * a stage is only marked done/failed when the server says so.
 */
export function applyReceiptScanProgress(
  current: ReceiptScanStageState[],
  snapshot: ReceiptScanProgressSnapshot | null | undefined
): ReceiptScanStageState[] {
  if (!snapshot || !Array.isArray(snapshot.stages)) return current;
  const statuses = new Map<string, ReceiptScanStageStatus>();
  for (const stage of snapshot.stages) {
    if (!STAGE_KEYS.has(stage.key)) continue;
    if (
      stage.status === "pending" ||
      stage.status === "active" ||
      stage.status === "done" ||
      stage.status === "failed"
    ) {
      statuses.set(stage.key, stage.status);
    }
  }
  return current.map((stage) => {
    const next = statuses.get(stage.key);
    return next ? { ...stage, status: next } : stage;
  });
}

export function activeReceiptScanStage(
  stages: ReceiptScanStageState[]
): ReceiptScanStageState | null {
  return (
    stages.find((stage) => stage.status === "active") ??
    stages.find((stage) => stage.status === "pending") ??
    null
  );
}

/**
 * Freeze the progress list once a final outcome is known. A stage still marked
 * active is resolved: completed for a finished scan, failed for a scan that
 * never ran (duplicate/technical failure). This is display-only.
 */
export function settleReceiptScanStages(
  stages: ReceiptScanStageState[],
  outcome: Exclude<ReceiptScanOutcome, "scanning">
): ReceiptScanStageState[] {
  const status =
    outcome === "error" || outcome === "duplicate" ? "failed" : "done";
  return stages.map((stage) =>
    stage.status === "active" ? { ...stage, status } : stage
  );
}

const TECHNICAL_FAILURES = new Set([
  "GEMINI_NOT_CONFIGURED",
  "GEMINI_TIMEOUT",
  "GEMINI_ERROR",
  "IMAGE_FETCH_FAILED",
  "IMAGE_FETCH_TIMEOUT",
  "INVALID_AI_RESPONSE",
  "NO_APPROVED_ACCOUNTS",
]);

const BLOCKER_TRANSLATIONS: Array<{ match: RegExp; text: string }> = [
  {
    match: /IBAN|رقم الحساب/i,
    text: "لم نتمكن من مطابقة رقم الحساب البنكي.",
  },
  {
    match: /المستفيد/,
    text: "لم نتمكن من مطابقة اسم المستفيد في الإيصال.",
  },
  {
    match: /مبلغ/,
    text: "مبلغ التحويل في الإيصال لا يطابق المبلغ المطلوب.",
  },
  {
    match: /عملة/,
    text: "عملة التحويل غير واضحة أو غير مطابقة.",
  },
  {
    match: /تاريخ/,
    text: "تاريخ التحويل في الإيصال غير مقبول.",
  },
  {
    match: /جودة/,
    text: "صورة الإيصال غير واضحة بما يكفي.",
  },
  {
    match: /ثقة/,
    text: "لم نتمكن من قراءة الإيصال بوضوح كافٍ.",
  },
  {
    match: /أصالة/,
    text: "لم نتمكن من التأكد من صحة الإيصال.",
  },
  {
    match: /رمز الدفع|مرجع/,
    text: "رمز الدفع في الإيصال لا يطابق الطلب.",
  },
  {
    match: /مستخدم في دفعة|مكرر/,
    text: "يبدو أن هذا الإيصال مستخدم في طلب آخر.",
  },
];

/** Translate internal blockers into short, user-safe Arabic phrases. */
export function friendlyReviewReasons(
  blockers: unknown,
  failureReason?: string | null
): string[] {
  const reasons: string[] = [];
  const seen = new Set<string>();
  const push = (text: string) => {
    if (!text || seen.has(text) || reasons.length >= 4) return;
    seen.add(text);
    reasons.push(text);
  };

  const list = Array.isArray(blockers)
    ? blockers.filter((item): item is string => typeof item === "string")
    : [];
  for (const blocker of list) {
    const translated = BLOCKER_TRANSLATIONS.find((entry) =>
      entry.match.test(blocker)
    );
    push(translated?.text ?? "يحتاج الإيصال إلى مراجعة قبل إكمال الطلب.");
  }

  if (reasons.length === 0) {
    if (typeof failureReason === "string" && failureReason.length > 0) {
      push("لم نتمكن من قراءة بيانات الإيصال بشكل كامل.");
    } else {
      push("يحتاج الإيصال إلى مراجعة قبل إكمال الطلب.");
    }
  }
  return reasons;
}

export interface ReceiptScanResultView {
  outcome: Exclude<ReceiptScanOutcome, "scanning">;
  title: string;
  message: string;
  reasons: string[];
}

/**
 * Classify the server's scan result for display only. `autoActivated` and the
 * payment status are decided by the server; the UI never approves anything.
 */
export function classifyReceiptScan(
  aiScan: any,
  options: { forceReview?: boolean } = {}
): ReceiptScanResultView {
  if (!aiScan) {
    return {
      outcome: "error",
      title: "تعذر إكمال التحقق",
      message:
        "لم نتمكن من إكمال التحقق الآن، يرجى المحاولة لاحقًا أو التواصل مع الدعم.",
      reasons: [],
    };
  }

  // A confirmed non-receipt is a distinct outcome, never a manual review.
  if (
    aiScan.documentType === "not_a_receipt" ||
    aiScan.recommendation === "مستند_غير_إيصال"
  ) {
    return {
      outcome: "not_receipt",
      title: "المستند ليس إيصال تحويل بنكي",
      message: "يرجى رفع إيصال تحويل بنكي صحيح.",
      reasons: [],
    };
  }

  const failureReason = typeof aiScan.failureReason === "string" ? aiScan.failureReason : null;
  if (failureReason && TECHNICAL_FAILURES.has(failureReason)) {
    return {
      outcome: "error",
      title: "تعذر إكمال التحقق",
      message:
        "لم نتمكن من إكمال التحقق الآن، يرجى المحاولة لاحقًا أو التواصل مع الدعم.",
      reasons: [],
    };
  }

  const autoAllowed =
    !options.forceReview &&
    (aiScan.verification?.autoActivationAllowed === true ||
      aiScan.autoActivationAllowed === true ||
      aiScan.recommendation === "تفعيل_تلقائي");

  if (autoAllowed) {
    return {
      outcome: "success",
      title: "تم التحقق بنجاح",
      message: "تم التحقق من بيانات الإيصال بنجاح.",
      reasons: [],
    };
  }

  return {
    outcome: "review",
    title: "الإيصال قيد المراجعة",
    message: "نحتاج إلى مراجعة الإيصال قبل إكمال الطلب.",
    reasons: friendlyReviewReasons(
      aiScan.blockers ?? aiScan.verification?.blockers,
      failureReason
    ),
  };
}

/** Hide raw technical text from user-facing messages. */
function sanitizeUserMessage(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text || text.length > 160) return null;
  if (
    /\bAI\b|Gemini|OCR|JSON|API|Firebase|Firestore|SQL|TypeError|stack|ECONN|timeout|undefined|null/i.test(
      text
    )
  ) {
    return null;
  }
  if (/[A-Za-z]{4,}/.test(text)) return null;
  return text;
}

export interface ReceiptServerResponse {
  aiScan?: any;
  success?: boolean;
  autoActivated?: boolean;
  pendingManualReview?: boolean;
  pendingAdminApproval?: boolean;
  verificationFailed?: boolean;
  paymentRejected?: boolean;
  message?: string;
  missingFields?: string[];
}

/**
 * Classify the whole server response (not just `aiScan`). This is what keeps
 * the dialog tied to the real outcome: a completed scan with manual review is
 * shown as a review, not as a generic failure.
 */
export function classifyReceiptResponse(
  payload: ReceiptServerResponse | null | undefined,
  options: { forceReview?: boolean } = {}
): ReceiptScanResultView {
  if (!payload) return classifyReceiptError(null);

  const message = sanitizeUserMessage(payload.message);

  if (payload.aiScan) {
    const view = classifyReceiptScan(payload.aiScan, options);
    if (payload.autoActivated === true && view.outcome === "review") {
      return {
        outcome: "success",
        title: "تم التحقق بنجاح",
        message: "تم التحقق من بيانات الإيصال بنجاح.",
        reasons: [],
      };
    }
    return view;
  }

  if (payload.autoActivated === true) {
    return {
      outcome: "success",
      title: "تم التحقق بنجاح",
      message: "تم التحقق من بيانات الإيصال بنجاح.",
      reasons: [],
    };
  }

  // A successful upload without a scan payload (e.g. add-ons) is still not an
  // approval: it waits for manual review.
  if (payload.success === true) {
    return {
      outcome: "review",
      title: "الإيصال قيد المراجعة",
      message: message ?? "نحتاج إلى مراجعة الإيصال قبل إكمال الطلب.",
      reasons: [],
    };
  }

  if (
    payload.pendingManualReview ||
    payload.pendingAdminApproval ||
    payload.verificationFailed ||
    payload.paymentRejected
  ) {
    return {
      outcome: "review",
      title: "الإيصال قيد المراجعة",
      message: message ?? "نحتاج إلى مراجعة الإيصال قبل إكمال الطلب.",
      reasons:
        (payload.missingFields?.length ?? 0) > 0
          ? ["بعض بيانات العقار غير مكتملة."]
          : [],
    };
  }

  return classifyReceiptError({ message: payload.message });
}

export interface ReceiptScanErrorLike {
  message?: string;
  code?: string;
  status?: number;
}

/**
 * Classify an HTTP/transport failure. The duplicate case gets its own outcome;
 * a real technical failure keeps a short, honest reason.
 */
export function classifyReceiptError(error: unknown): ReceiptScanResultView {
  const value = (error ?? {}) as ReceiptScanErrorLike;
  const message = typeof value.message === "string" ? value.message.trim() : "";

  if (
    value.code === "DUPLICATE_RECEIPT" ||
    /تم استخدام صورة|عملية دفع أخرى/.test(message)
  ) {
    return {
      outcome: "duplicate",
      title: "الإيصال مستخدم مسبقًا",
      message:
        "هذا الإيصال سبق استخدامه في عملية دفع أخرى. يرجى رفع إيصال مختلف.",
      reasons: [],
    };
  }

  if (
    value.status === 0 ||
    value.status === 408 ||
    value.status === 504 ||
    /timeout|aborted|انتهت مهلة/i.test(message)
  ) {
    return {
      outcome: "error",
      title: "تعذر إكمال التحقق",
      message: "انتهت مهلة الاتصال. يرجى المحاولة مرة أخرى.",
      reasons: [],
    };
  }

  if (
    /failed to fetch|network|اتصال/i.test(message) ||
    (typeof value.status === "number" && value.status >= 500)
  ) {
    return {
      outcome: "error",
      title: "تعذر إكمال التحقق",
      message: "تعذر الاتصال بالخدمة. يرجى المحاولة مرة أخرى.",
      reasons: [],
    };
  }

  return {
    outcome: "error",
    title: "تعذر إكمال التحقق",
    message:
      sanitizeUserMessage(message) ??
      "لم نتمكن من إكمال التحقق الآن، يرجى المحاولة لاحقًا أو التواصل مع الدعم.",
    reasons: [],
  };
}
