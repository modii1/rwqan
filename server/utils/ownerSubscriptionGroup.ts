import type { Property, Subscription } from "../../shared/schema";
import { firebaseService } from "../firebaseService";

export type OwnerSubscriptionGroup = {
  requestedPropertyNumber: string;
  mainPropertyNumber: string;
  requestedProperty: Property;
  mainProperty: Property;
  requestedSubscription: Subscription | null;
  mainSubscription: Subscription | null;
  linkedPropertyNumbers: string[];
  propertyNumbers: string[];
};

type GroupReader = Pick<
  typeof firebaseService,
  | "getPropertyByNumber"
  | "getSubscriptionByPropertyNumber"
  | "getSubscriptionsLinkedToProperty"
>;

export class OwnerSubscriptionGroupError extends Error {
  readonly status = 409;
  readonly code = "LINKED_GROUP_INCONSISTENT";

  constructor(message: string) {
    super(message);
    this.name = "OwnerSubscriptionGroupError";
  }
}

function normalizePropertyNumber(value: unknown): string {
  return String(value || "").trim();
}

/**
 * Resolve one stable group root even when the owner opens the payment page
 * from a linked child. Payments and fulfillment must always target this root;
 * otherwise every child-initiated renewal can reverse the group direction.
 */
export async function resolveOwnerSubscriptionGroup(
  requestedPropertyNumber: string,
  reader: GroupReader = firebaseService,
): Promise<OwnerSubscriptionGroup> {
  const requestedNumber = normalizePropertyNumber(requestedPropertyNumber);
  const requestedProperty = await reader.getPropertyByNumber(requestedNumber);
  if (!requestedProperty) {
    throw new OwnerSubscriptionGroupError("العقار غير موجود");
  }

  const requestedSubscription =
    await reader.getSubscriptionByPropertyNumber(requestedNumber);
  const declaredParent = normalizePropertyNumber(
    requestedSubscription?.linkedProperty || requestedProperty.linkedProperty,
  );
  const mainPropertyNumber = declaredParent || requestedNumber;
  const mainProperty = mainPropertyNumber === requestedNumber
    ? requestedProperty
    : await reader.getPropertyByNumber(mainPropertyNumber);
  if (!mainProperty) {
    throw new OwnerSubscriptionGroupError(
      `العقار الرئيسي المرتبط ${mainPropertyNumber} غير موجود`,
    );
  }

  const requestedPin = normalizePropertyNumber(requestedProperty.pin);
  const mainPin = normalizePropertyNumber(mainProperty.pin);
  if (
    mainPropertyNumber !== requestedNumber &&
    (!requestedPin || !mainPin || requestedPin !== mainPin)
  ) {
    throw new OwnerSubscriptionGroupError(
      "بيانات ربط العقار لا تتطابق مع المالك الحالي",
    );
  }

  const mainSubscription = mainPropertyNumber === requestedNumber
    ? requestedSubscription
    : await reader.getSubscriptionByPropertyNumber(mainPropertyNumber);
  const linkedSubscriptions = mainSubscription || declaredParent
    ? await reader.getSubscriptionsLinkedToProperty(mainPropertyNumber)
    : [];
  const linked = new Set<string>();

  for (const propertyNumber of mainSubscription?.linkedProperties || []) {
    const normalized = normalizePropertyNumber(propertyNumber);
    if (normalized && normalized !== mainPropertyNumber) linked.add(normalized);
  }
  for (const subscription of linkedSubscriptions) {
    const normalized = normalizePropertyNumber(subscription.propertyNumber);
    if (
      normalized &&
      normalized !== mainPropertyNumber &&
      normalizePropertyNumber(subscription.linkedProperty) === mainPropertyNumber
    ) {
      linked.add(normalized);
    }
  }
  if (mainPropertyNumber !== requestedNumber) linked.add(requestedNumber);

  const linkedPropertyNumbers = Array.from(linked).sort((left, right) =>
    left.localeCompare(right),
  );
  return {
    requestedPropertyNumber: requestedNumber,
    mainPropertyNumber,
    requestedProperty,
    mainProperty,
    requestedSubscription,
    mainSubscription,
    linkedPropertyNumbers,
    propertyNumbers: [mainPropertyNumber, ...linkedPropertyNumbers],
  };
}
