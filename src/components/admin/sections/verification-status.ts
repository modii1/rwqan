import { normalizeWhatsAppDestination } from "@shared/phone";
import type { Property } from "@shared/schema";
import { isPremiumSubscriptionType } from "@shared/subscriptionType";
import {
  getForwardTrackedPublicRegistration,
  hasValidFreeCommissionConsent,
} from "@shared/freeCommissionConsent";

export type VerificationLevel = "ok" | "warning" | "danger";

export type VerificationStatus = {
  level: VerificationLevel;
  label: string;
  issues: string[];
  blockers: string[];
  warnings: string[];
};

export type FreeCommissionConsentAdminStatus = "accepted" | "missing" | null;

export function getFreeCommissionConsentAdminStatus(
  property: Property,
): FreeCommissionConsentAdminStatus {
  const registrationPlan = getForwardTrackedPublicRegistration(property);
  if (!registrationPlan?.isFree) return null;
  return hasValidFreeCommissionConsent(property) ? "accepted" : "missing";
}

export function getVerificationStatus(
  property: Property,
  imageCount: number | null,
  now = new Date(),
): VerificationStatus {
  const blockers: string[] = [];
  const warnings: string[] = [];

  if (!property.name?.trim()) blockers.push("اسم العقار غير موجود");
  if (!property.propertyNumber?.toString().trim())
    blockers.push("رقم العقار غير موجود");
  if (!property.city?.trim()) blockers.push("المدينة غير محددة");
  if (!property.location?.trim()) blockers.push("الموقع غير محدد");
  if (!property.type?.trim()) blockers.push("نوع العقار غير محدد");
  if (!Array.isArray(property.facilities) || property.facilities.length === 0)
    blockers.push("المرافق غير محددة");

  if (!normalizeWhatsAppDestination(property.whatsappNumber))
    warnings.push("رقم واتساب المالك مفقود أو غير صالح");
  if (!property.direction?.trim()) warnings.push("الاتجاه غير محدد");

  if (imageCount !== null) {
    if (imageCount === 0)
      blockers.push("لا توجد صور مرفوعة (0/3 كحد أدنى)");
    else if (imageCount < 3)
      blockers.push(`عدد الصور غير كافٍ (${imageCount}/3 كحد أدنى)`);
  }

  const hasAnyPrice =
    !!property.prices?.display ||
    !!property.prices?.weekday ||
    !!property.prices?.weekend ||
    !!property.prices?.overnight ||
    !!property.prices?.special ||
    !!property.prices?.holidays;
  if (!hasAnyPrice) warnings.push("لم يتم إدخال أي أسعار للعقار");

  const threeMonthsAgo = new Date(now);
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  if (property.updatedAt) {
    const lastUpdate = new Date(property.updatedAt);
    if (lastUpdate < threeMonthsAgo) {
      warnings.push("لم يُحدّث منذ أكثر من 3 أشهر");
    }
  }

  const fortyDaysAgo = new Date(now);
  fortyDaysAgo.setDate(fortyDaysAgo.getDate() - 40);
  if (
    property.subscriptionDate &&
    !isPremiumSubscriptionType(property.subscriptionType)
  ) {
    const subscriptionDate = new Date(property.subscriptionDate);
    if (subscriptionDate < fortyDaysAgo) {
      warnings.push("اشتراك عادي قديم (أكثر من 40 يوماً)");
    }
  }

  const issues = [...blockers, ...warnings];
  const needsAgeReview = warnings.some(
    (warning) =>
      warning.includes("لم يُحدّث منذ أكثر من 3 أشهر") ||
      warning.includes("اشتراك عادي قديم"),
  );
  const level: VerificationLevel = needsAgeReview
    ? "danger"
    : issues.length > 0
      ? "warning"
      : "ok";
  const label =
    level === "ok"
      ? "مكتمل"
      : level === "danger"
        ? "مراجعة"
        : blockers.length > 0
          ? "غير مكتمل"
          : "يحتاج مراجعة";

  return { level, label, issues, blockers, warnings };
}
