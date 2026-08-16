export class BookingApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = "BookingApiError";
  }
}

function extractErrorMessage(payload: unknown, fallback: string): string {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const message = record.error || record.message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

const bookingErrorMessages: Record<string, string> = {
  BOOKING_NOT_FOUND: "طلب الحجز غير موجود.",
  BOOKING_ALREADY_DECLINED: "سبق تسجيل أن الحجز لم يتم.",
  BOOKING_ALREADY_CONFIRMED: "سبق تأكيد بيانات هذا الحجز.",
  BOOKING_CONFIRMATION_CONFLICT: "سبق تأكيد الحجز ببيانات مختلفة.",
  BOOKING_YES_REQUIRED: "أكد أن الحجز تم قبل إرسال التفاصيل.",
  BOOKING_RESPONSE_EXPIRED: "انتهت مهلة تأكيد نتيجة الحجز لهذا الطلب.",
  INVALID_BOOKING_PRICE: "المبلغ المدفوع غير صحيح.",
  INVALID_DISPUTE_REASON: "سبب الاعتراض غير صحيح.",
  COMMISSION_NOT_APPLICABLE: "لا توجد عمولة مستحقة لهذا الطلب.",
  COMMISSION_ALREADY_PAID: "تم سداد هذه العمولة مسبقاً.",
  COMMISSION_ALREADY_CLOSED: "تم إغلاق هذه العمولة مسبقاً.",
  COMMISSION_DISPUTED: "العمولة قيد المراجعة حالياً.",
  COMMISSION_DISPUTE_ALREADY_RESOLVED: "تمت معالجة الاعتراض على هذه العمولة مسبقاً.",
  COMMISSION_DISPUTE_NOT_PENDING: "هذا الاعتراض لم يعد بانتظار المراجعة.",
  COMMISSION_PAYMENT_ATTEMPT_EXISTS: "لا يمكن إلغاء العمولة قبل مراجعة محاولة الدفع الموجودة.",
  OWNER_IDENTITY_CHANGED: "تعذر استئناف التحصيل لأن بيانات المالك الحالي لا تطابق المالك المسجل لهذا الحجز.",
  COMMISSION_REVERSAL_NOT_FOUND: "تعذر العثور على سجل عكس الدفعة.",
  COMMISSION_REVERSAL_IDENTITY_MISMATCH: "بيانات عكس الدفعة لا تطابق محاولة الدفع المسجلة.",
  COMMISSION_REVERSAL_ALREADY_RESOLVED: "تمت معالجة عكس الدفعة مسبقاً بإجراء مختلف.",
  COMMISSION_REVERSAL_NOT_CANONICAL: "عكس الدفعة لا يخص محاولة الدفع الأساسية لهذا الحجز.",
  COMMISSION_REVERSAL_RECOLLECTION_UNSAFE: "لا يمكن استئناف التحصيل لهذه العملية قبل مراجعة التسوية المالية يدوياً.",
  PAYMENT_ATTEMPT_IN_PROGRESS: "توجد محاولة دفع قيد المعالجة حالياً.",
  PAYMENT_ATTEMPT_NOT_FOUND: "محاولة الدفع غير موجودة.",
  PAYMENT_ATTEMPT_IDENTITY_CONFLICT: "تعذر مطابقة محاولة الدفع مع هذا الطلب.",
  PAYMENT_ATTEMPT_NOT_CREATABLE: "تعذر إكمال إنشاء محاولة الدفع.",
  PAYMOB_ORDER_CONFLICT: "طلب الدفع مرتبط بمحاولة أخرى.",
};

export async function bookingApiRequest<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    credentials: "include",
    cache: "no-store",
  });
  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json().catch(() => null)
    : null;

  if (!response.ok) {
    const code = payload && typeof payload === "object"
      && typeof (payload as Record<string, unknown>).code === "string"
      ? (payload as Record<string, unknown>).code as string
      : undefined;
    throw new BookingApiError(
      (code && bookingErrorMessages[code])
        || extractErrorMessage(payload, "تعذر إكمال الطلب. حاول مرة أخرى."),
      response.status,
      code,
    );
  }

  return (payload ?? {}) as T;
}
