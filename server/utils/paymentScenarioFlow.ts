import { firebaseService } from "../firebaseService";
import type { Package, Payment, Property, Subscription } from "../../shared/schema";
import {
  calculateExtensionEndDate,
  calculateRemainingDays,
  calculateSubscriptionEndDate,
  formatDateRiyadh,
  getStartOfDayRiyadh,
} from "./dateUtils";
import { isPremiumSubscriptionType } from "../../shared/subscriptionType";

const ACTIVE_SUBSCRIPTION_STATUSES = new Set(["نشط", "نشط مجاني", "ساري", "active"]);

function parsePropertyNumberList(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
      const parsed = JSON.parse(trimmed);
      return parsePropertyNumberList(parsed);
    } catch {
      return [trimmed];
    }
  }
  return [String(value).trim()].filter(Boolean);
}

export function normalizeLinkedPropertyNumbers(paymentOrBody: any, mainPropertyNumber: string): string[] {
  const linked = new Set<string>();
  for (const propNumber of parsePropertyNumberList(paymentOrBody?.additionalProperties)) {
    if (propNumber !== mainPropertyNumber) linked.add(propNumber);
  }
  for (const propNumber of parsePropertyNumberList(paymentOrBody?.linkedProperties)) {
    if (propNumber !== mainPropertyNumber) linked.add(propNumber);
  }
  for (const propNumber of parsePropertyNumberList(paymentOrBody?.secondPropertyNumber)) {
    if (propNumber !== mainPropertyNumber) linked.add(propNumber);
  }
  return Array.from(linked);
}

export function isActiveSubscription(subscription?: Subscription | null): boolean {
  if (!subscription?.endDate) return false;
  return ACTIVE_SUBSCRIPTION_STATUSES.has(subscription.status) && calculateRemainingDays(subscription.endDate) >= 0;
}

export function hasPriorSubscription(subscription?: Subscription | null): boolean {
  return !!subscription?.endDate;
}

export function validateSubscriptionAction(
  action: unknown,
  currentSubscription?: Subscription | null,
): { ok: true } | { ok: false; status: number; error: string; nextAction: string; nextUrl: string; actionLabel: string } {
  if (action !== "extend" && action !== "upgrade") {
    return {
      ok: false,
      status: 400,
      error: "الإجراء غير صالح. اختر تمديد الاشتراك أو تغيير الباقة.",
      nextAction: "اختر الإجراء مرة أخرى",
      nextUrl: "/owner/subscription",
      actionLabel: "العودة للاشتراك",
    };
  }

  if (!isActiveSubscription(currentSubscription)) {
    return {
      ok: false,
      status: 400,
      error: "لا يمكن تنفيذ هذا الإجراء لأن الاشتراك الحالي غير نشط.",
      nextAction: "اختر باقة جديدة وابدأ اشتراكاً جديداً.",
      nextUrl: "/owner/subscription",
      actionLabel: "اختيار باقة",
    };
  }

  if (action === "extend") {
    const remaining = calculateRemainingDays(currentSubscription?.endDate || null);
    if (remaining > 10) {
      return {
        ok: false,
        status: 400,
        error: `يمكن التمديد فقط عندما تبقى 10 أيام أو أقل من الاشتراك الحالي. المتبقي الآن ${Math.floor(remaining)} يوم.`,
        nextAction: "انتظر حتى يصل الاشتراك إلى آخر 10 أيام أو اختر تغيير الباقة.",
        nextUrl: "/owner/subscription",
        actionLabel: "العودة للاشتراك",
      };
    }
  }

  return { ok: true };
}

export function calculateActionDates(
  action: string | undefined,
  currentSubscription: Subscription | null | undefined,
  durationDays: number,
): { startDate: Date; endDate: Date } {
  const today = getStartOfDayRiyadh();

  if (action === "extend" && currentSubscription?.endDate && calculateRemainingDays(currentSubscription.endDate) >= 0) {
    const startDate = new Date(currentSubscription.endDate);
    return {
      startDate,
      endDate: calculateExtensionEndDate(startDate, durationDays),
    };
  }

  return {
    startDate: today,
    endDate: calculateSubscriptionEndDate(null, durationDays),
  };
}

async function resolveExistingLinkedProperties(
  mainPropertyNumber: string,
  currentSubscription?: Subscription | null,
): Promise<string[]> {
  const linked = new Set<string>();

  if (currentSubscription?.linkedProperties) {
    for (const propNumber of currentSubscription.linkedProperties) {
      if (propNumber !== mainPropertyNumber) linked.add(propNumber);
    }
  }

  if (currentSubscription?.linkedProperty) {
    const parentPropertyNumber = currentSubscription.linkedProperty;
    if (parentPropertyNumber !== mainPropertyNumber) linked.add(parentPropertyNumber);

    const parentSubscription = await firebaseService.getSubscriptionByPropertyNumber(parentPropertyNumber);
    if (parentSubscription?.linkedProperties) {
      for (const propNumber of parentSubscription.linkedProperties) {
        if (propNumber !== mainPropertyNumber) linked.add(propNumber);
      }
    }
  }

  const multiSubscriptions = await firebaseService.getMultiPropertySubscriptions();
  for (const multiSub of multiSubscriptions) {
    if (!ACTIVE_SUBSCRIPTION_STATUSES.has(String(multiSub.status || "").trim())) continue;
    const group = new Set<string>();
    if (multiSub.propertyNumber1) group.add(multiSub.propertyNumber1);
    if (multiSub.propertyNumber2) group.add(multiSub.propertyNumber2);
    if (multiSub.additionalProperties) {
      for (const propNumber of multiSub.additionalProperties) group.add(propNumber);
    }

    if (group.has(mainPropertyNumber)) {
      for (const propNumber of group) {
        if (propNumber !== mainPropertyNumber) linked.add(propNumber);
      }
    }
  }

  return Array.from(linked);
}

function getPackageMaxProperties(pkg: Package): number {
  const maxProperties = Number((pkg as any).maxProperties || pkg.propertyCount || 1);
  return Number.isFinite(maxProperties) && maxProperties > 0 ? Math.floor(maxProperties) : 1;
}

export function splitLinkedPropertiesByPackageLimit(
  linkedProperties: string[],
  pkg: Package,
): { kept: string[]; unlinked: string[]; maxProperties: number; allowedLinkedCount: number } {
  const maxProperties = getPackageMaxProperties(pkg);
  const allowedLinkedCount = Math.max(0, maxProperties - 1);
  return {
    kept: linkedProperties.slice(0, allowedLinkedCount),
    unlinked: linkedProperties.slice(allowedLinkedCount),
    maxProperties,
    allowedLinkedCount,
  };
}

async function syncMultiPropertyRecord(params: {
  mainPropertyNumber: string;
  linkedProperties: string[];
  packageId: string;
  startDate: string;
  endDate: string;
  paymentId: string;
}) {
  const { mainPropertyNumber, linkedProperties, packageId, startDate, endDate, paymentId } = params;
  if (linkedProperties.length === 0) return;

  const groupMembers = new Set([mainPropertyNumber, ...linkedProperties]);
  const multiSubscriptions = await firebaseService.getMultiPropertySubscriptions();
  const existingGroup = multiSubscriptions.find((multiSub) => {
    const members = new Set<string>();
    if (multiSub.propertyNumber1) members.add(multiSub.propertyNumber1);
    if (multiSub.propertyNumber2) members.add(multiSub.propertyNumber2);
    if (multiSub.additionalProperties) {
      for (const propNumber of multiSub.additionalProperties) members.add(propNumber);
    }
    return Array.from(groupMembers).some((propNumber) => members.has(propNumber));
  });

  if (existingGroup) {
    await firebaseService.updateMultiPropertySubscription(existingGroup.id, {
      packageId,
      propertyNumber1: mainPropertyNumber,
      propertyNumber2: linkedProperties[0],
      additionalProperties: linkedProperties,
      startDate,
      endDate,
      status: "نشط",
      paymentId,
    } as any);
    return;
  }

  await firebaseService.createMultiPropertySubscription({
    packageId,
    propertyNumber1: mainPropertyNumber,
    propertyNumber2: linkedProperties[0],
    additionalProperties: linkedProperties,
    startDate,
    endDate,
    status: "نشط",
    paymentId,
  });
}

export async function activateVerifiedPaymentSubscription(params: {
  payment: Payment;
  property: Property;
  pkg: Package;
  receiptUrl?: string;
  startDate: Date | string;
  endDate: Date | string;
  finalAmount?: number;
}): Promise<{
  startDate: string;
  endDate: string;
  linkedProperties: string[];
  unlinkedProperties: string[];
  subscriptionType: string;
}> {
  const { payment, property, pkg, receiptUrl } = params;
  const mainPropertyNumber = payment.propertyNumber;
  const currentSubscription = await firebaseService.getSubscriptionByPropertyNumber(mainPropertyNumber);

  let linkedProperties = normalizeLinkedPropertyNumbers(payment as any, mainPropertyNumber);
  if (linkedProperties.length === 0) {
    linkedProperties = await resolveExistingLinkedProperties(mainPropertyNumber, currentSubscription);
  }

  const limited = splitLinkedPropertiesByPackageLimit(linkedProperties, pkg);
  const totalProperties = limited.kept.length + 1;
  const totalAmount = Number(params.finalAmount ?? payment.finalAmount ?? payment.amount ?? pkg.price ?? 0);
  const pricePerProperty = totalProperties > 0 ? totalAmount / totalProperties : totalAmount;
  const isPremium = isPremiumSubscriptionType(pkg.type) || pricePerProperty > 0;
  const subscriptionType = isPremium ? "مميز" : "عادي";
  const startDate = typeof params.startDate === "string" ? params.startDate : formatDateRiyadh(params.startDate);
  const endDate = typeof params.endDate === "string" ? params.endDate : formatDateRiyadh(params.endDate);

  const touchedProperties: string[] = [];
  try {
    await firebaseService.addSubscriptionToSheet(
      mainPropertyNumber,
      {
        packageId: pkg.id,
        price: pricePerProperty,
        subscriptionType,
        packageType: subscriptionType,
        startDate,
        endDate,
        paymentId: payment.id,
        linkedProperties: limited.kept.length > 0 ? limited.kept : undefined,
        propertyCount: totalProperties,
      },
      property,
      receiptUrl ?? payment.receiptUrl ?? "",
    );
    touchedProperties.push(mainPropertyNumber);
    await firebaseService.updateVerificationStatus(mainPropertyNumber, "approved");

    for (const linkedPropertyNumber of limited.kept) {
      await firebaseService.syncLinkedProperty(linkedPropertyNumber, mainPropertyNumber, {
        subscriptionType,
        startDate,
        endDate,
        status: "نشط",
        paymentId: payment.id,
        packageId: pkg.id,
      });
      touchedProperties.push(linkedPropertyNumber);
    }

    for (const unlinkedPropertyNumber of limited.unlinked) {
      const unlinkedSubscription = await firebaseService.getSubscriptionByPropertyNumber(unlinkedPropertyNumber);
      if (unlinkedSubscription) {
        await firebaseService.updateSubscription(unlinkedSubscription.id, {
          linkedProperty: "",
          linkedProperties: [],
          propertyCount: 1,
        } as any);
      }
      await firebaseService.updateProperty(unlinkedPropertyNumber, {
        linkedProperty: "",
        pendingApprovalFrom: "",
      } as any);
    }

    await syncMultiPropertyRecord({
      mainPropertyNumber,
      linkedProperties: limited.kept,
      packageId: pkg.id,
      startDate,
      endDate,
      paymentId: payment.id,
    });
  } catch (error) {
    for (const propertyNumber of touchedProperties.reverse()) {
      await firebaseService.cancelSubscription(propertyNumber, "فشل تفعيل العقارات المرتبطة - تم التراجع عن العملية");
    }
    throw error;
  }

  return {
    startDate,
    endDate,
    linkedProperties: limited.kept,
    unlinkedProperties: limited.unlinked,
    subscriptionType,
  };
}

export async function queueVerifiedNewPropertyForAdminApproval(params: {
  payment: Payment;
  property: Property;
  pkg: Package;
  startDate: Date | string;
  endDate: Date | string;
  finalAmount?: number;
  notes?: string;
}): Promise<{
  startDate: string;
  endDate: string;
  linkedProperties: string[];
  unlinkedProperties: string[];
  subscriptionType: string;
}> {
  const { payment, pkg } = params;
  const mainPropertyNumber = payment.propertyNumber;
  const currentSubscription = await firebaseService.getSubscriptionByPropertyNumber(mainPropertyNumber);

  let linkedProperties = normalizeLinkedPropertyNumbers(payment as any, mainPropertyNumber);
  if (linkedProperties.length === 0) {
    linkedProperties = await resolveExistingLinkedProperties(mainPropertyNumber, currentSubscription);
  }

  const limited = splitLinkedPropertiesByPackageLimit(linkedProperties, pkg);
  const totalProperties = limited.kept.length + 1;
  const totalAmount = Number(params.finalAmount ?? payment.finalAmount ?? payment.amount ?? pkg.price ?? 0);
  const pricePerProperty = totalProperties > 0 ? totalAmount / totalProperties : totalAmount;
  const subscriptionType = isPremiumSubscriptionType(pkg.type) || pricePerProperty > 0 ? "مميز" : "عادي";
  const startDate = typeof params.startDate === "string" ? params.startDate : formatDateRiyadh(params.startDate);
  const endDate = typeof params.endDate === "string" ? params.endDate : formatDateRiyadh(params.endDate);

  await firebaseService.updatePayment(payment.id, {
    status: "نجح - قيد التحقق",
    pendingStartDate: startDate,
    pendingEndDate: endDate,
    pendingPrice: totalAmount,
    pendingSubscriptionType: subscriptionType,
    additionalProperties: limited.kept,
    linkedProperties: limited.kept,
    notes: params.notes || "تم التحقق من الدفع وبيانات العقار - بانتظار اعتماد الإدارة للعقار الجديد",
  } as any);

  await firebaseService.updateProperty(mainPropertyNumber, {
    verificationStatus: "pending",
    smartVerificationPassed: true,
    smartVerificationPassedAt: new Date().toISOString(),
    pendingPaidSubscription: true,
  } as any);

  for (const unlinkedPropertyNumber of limited.unlinked) {
    const unlinkedSubscription = await firebaseService.getSubscriptionByPropertyNumber(unlinkedPropertyNumber);
    if (unlinkedSubscription) {
      await firebaseService.updateSubscription(unlinkedSubscription.id, {
        linkedProperty: "",
        linkedProperties: [],
        propertyCount: 1,
      } as any);
    }
    await firebaseService.updateProperty(unlinkedPropertyNumber, {
      linkedProperty: "",
      pendingApprovalFrom: "",
    } as any);
  }

  return {
    startDate,
    endDate,
    linkedProperties: limited.kept,
    unlinkedProperties: limited.unlinked,
    subscriptionType,
  };
}
