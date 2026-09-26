import { normalizePhoneDigits, normalizeSaudiMobilePhone } from "@shared/phone";
import { cleanPropertyNumber } from "@/lib/validation";

export type OwnerAccountChallenge = {
  challengeId: string;
  maskedPhone: string;
  expiresInSeconds: number;
};

export type OwnerSession = {
  isLoggedIn: boolean;
  propertyNumber?: string;
  hasOwnerAccount?: boolean;
};

export function validateOwnerAccountPhone(value: string): {
  phone?: string;
  error?: string;
} {
  const phone = normalizeSaudiMobilePhone(value);
  if (phone) return { phone };

  const digits = normalizePhoneDigits(value);
  if (!digits) return { error: "رقم الجوال مطلوب" };
  return { error: "أدخل رقم جوال سعودي صحيح" };
}

export function validateOwnerAccountCode(value: string): {
  code?: string;
  error?: string;
} {
  const code = normalizePhoneDigits(value);
  if (!code) return { error: "رمز التحقق مطلوب" };
  if (code.length !== 6) return { error: "أدخل رمز التحقق المكون من 6 أرقام" };
  return { code };
}

export function validateOwnerAccountPropertyNumber(value: string): {
  propertyNumber?: string;
  error?: string;
} {
  const propertyNumber = cleanPropertyNumber(value);
  if (!propertyNumber) return { error: "رقم العقار مطلوب" };
  if (propertyNumber.length !== 5) return { error: "رقم العقار يجب أن يكون 5 أرقام" };
  return { propertyNumber };
}

export function parseOwnerAccountChallenge(value: unknown): OwnerAccountChallenge | null {
  if (!value || typeof value !== "object") return null;
  const payload = value as Partial<OwnerAccountChallenge>;
  if (
    typeof payload.challengeId !== "string" ||
    !payload.challengeId ||
    typeof payload.maskedPhone !== "string" ||
    !payload.maskedPhone ||
    typeof payload.expiresInSeconds !== "number" ||
    !Number.isFinite(payload.expiresInSeconds) ||
    payload.expiresInSeconds <= 0
  ) {
    return null;
  }

  return {
    challengeId: payload.challengeId,
    maskedPhone: payload.maskedPhone,
    expiresInSeconds: payload.expiresInSeconds,
  };
}

export function ownerAccountApiError(value: unknown, fallback: string): string {
  if (!value || typeof value !== "object") return fallback;
  const payload = value as { error?: unknown; message?: unknown };
  if (typeof payload.error === "string" && payload.error.trim()) return payload.error;
  if (typeof payload.message === "string" && payload.message.trim()) return payload.message;
  return fallback;
}
