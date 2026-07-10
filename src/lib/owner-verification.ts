export interface OwnerManualVerificationResult {
  success: boolean;
  verified: boolean;
  alreadyVerified?: boolean;
  notificationRequired?: boolean;
  subscriptionActivated?: boolean;
  pendingAdminApproval?: boolean;
  completionScore?: number;
  missingFields?: string[];
  warnings?: string[];
  message?: string;
}

export async function runOwnerManualVerification(): Promise<OwnerManualVerificationResult> {
  const response = await fetch("/api/owner/property/run-verification", {
    method: "POST",
    credentials: "include",
  });
  const responseText = await response.text();
  let data: any = null;

  try {
    data = responseText ? JSON.parse(responseText) : null;
  } catch {
    data = null;
  }

  if (data?.code === "InvalidUrl") {
    throw new Error("تم الاتصال بخدمة أخرى بدلاً من روقان. افتح التطبيق من رابط المعاينة الصحيح.");
  }

  if (!response.ok) {
    throw new Error(data?.error || data?.message || "تعذر تشغيل التحقق الذكي.");
  }

  if (!data || typeof data !== "object") {
    throw new Error("استجابة خدمة التحقق غير صالحة.");
  }

  return data as OwnerManualVerificationResult;
}
