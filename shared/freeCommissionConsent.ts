import { z } from "zod";

export const FREE_COMMISSION_BASIS_POINTS = 1_000 as const;
export const FREE_COMMISSION_PERCENT = 10 as const;
export const FREE_COMMISSION_TERMS_VERSION = "2026-08-24-v1" as const;
export const FREE_COMMISSION_CONSENT_SOURCE = "public_subscription" as const;
export const FREE_COMMISSION_CONSENT_TEXT =
  "أوافق على دفع عمولة روقان بنسبة 10% من قيمة كل حجز يتم عبر المنصة." as const;

export const freeRegistrationPlanSchema = z.object({
  packageId: z.string().trim().min(1),
  isFree: z.boolean(),
  selectedAt: z.string().datetime(),
  source: z.literal(FREE_COMMISSION_CONSENT_SOURCE),
});

export const freeCommissionConsentSchema = z.object({
  accepted: z.literal(true),
  acceptedAt: z.string().datetime(),
  packageId: z.string().trim().min(1),
  commissionBasisPoints: z.literal(FREE_COMMISSION_BASIS_POINTS),
  termsVersion: z.literal(FREE_COMMISSION_TERMS_VERSION),
  source: z.literal(FREE_COMMISSION_CONSENT_SOURCE),
  statement: z.literal(FREE_COMMISSION_CONSENT_TEXT),
});

export type FreeRegistrationPlan = z.infer<typeof freeRegistrationPlanSchema>;
export type FreeCommissionConsent = z.infer<typeof freeCommissionConsentSchema>;

export function isFreeSubscriptionPackage(
  subscriptionPackage: { price?: unknown } | null | undefined,
): boolean {
  if (!subscriptionPackage) return false;
  const rawPrice = subscriptionPackage.price;
  if (
    (typeof rawPrice !== "number" && typeof rawPrice !== "string") ||
    (typeof rawPrice === "string" && rawPrice.trim() === "")
  ) {
    return false;
  }
  const price = Number(rawPrice);
  return Number.isFinite(price) && price === 0;
}

export function createPublicRegistrationPlan(options: {
  packageId: string;
  isFree: boolean;
  selectedAt: string;
}): FreeRegistrationPlan {
  return freeRegistrationPlanSchema.parse({
    ...options,
    source: FREE_COMMISSION_CONSENT_SOURCE,
  });
}

export function createPublicFreeCommissionConsent(options: {
  packageId: string;
  acceptedAt: string;
}): FreeCommissionConsent {
  return freeCommissionConsentSchema.parse({
    accepted: true,
    acceptedAt: options.acceptedAt,
    packageId: options.packageId,
    commissionBasisPoints: FREE_COMMISSION_BASIS_POINTS,
    termsVersion: FREE_COMMISSION_TERMS_VERSION,
    source: FREE_COMMISSION_CONSENT_SOURCE,
    statement: FREE_COMMISSION_CONSENT_TEXT,
  });
}

export function getForwardTrackedPublicRegistration(
  property: { registrationPlan?: unknown } | null | undefined,
): FreeRegistrationPlan | null {
  const parsed = freeRegistrationPlanSchema.safeParse(property?.registrationPlan);
  return parsed.success ? parsed.data : null;
}

export function hasValidFreeCommissionConsent(
  property: {
    registrationPlan?: unknown;
    freeCommissionConsent?: unknown;
  } | null | undefined,
): boolean {
  const registrationPlan = getForwardTrackedPublicRegistration(property);
  if (!registrationPlan?.isFree) return false;
  const parsed = freeCommissionConsentSchema.safeParse(
    property?.freeCommissionConsent,
  );
  return parsed.success && parsed.data.packageId === registrationPlan.packageId;
}
