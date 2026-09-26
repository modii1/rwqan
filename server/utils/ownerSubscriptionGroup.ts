import type {
  MultiPropertySubscription,
  Property,
  Subscription,
} from "../../shared/schema";
import { isSubscriptionStatusActive } from "../../shared/subscriptionType";
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
> & Partial<Pick<typeof firebaseService, "getMultiPropertySubscriptions">>;

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

function multiPropertyMembers(
  record: MultiPropertySubscription,
): Set<string> {
  return new Set([
    record.propertyNumber1,
    record.propertyNumber2,
    ...(record.additionalProperties || []),
    ...(record.linkedProperties || []),
  ].map(normalizePropertyNumber).filter(Boolean));
}

function isCurrentMultiPropertyMembership(
  record: MultiPropertySubscription,
  nowMs: number,
): boolean {
  const endTime = Date.parse(String(record.endDate || ""));
  return isSubscriptionStatusActive(
    record.status,
    !Number.isFinite(endTime) || endTime < nowMs,
  );
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
  const multiPropertySubscriptions = reader.getMultiPropertySubscriptions
    ? await reader.getMultiPropertySubscriptions()
    : [];
  const currentMultiGroups = multiPropertySubscriptions.filter((record) =>
    isCurrentMultiPropertyMembership(record, Date.now()) &&
    multiPropertyMembers(record).has(requestedNumber)
  );
  const multiGroupRoots = new Set(
    currentMultiGroups
      .map((record) => normalizePropertyNumber(record.propertyNumber1))
      .filter(Boolean),
  );
  if (multiGroupRoots.size > 1) {
    throw new OwnerSubscriptionGroupError(
      "بيانات ربط العقار لا تتطابق مع المالك الحالي",
    );
  }
  const declaredParent = normalizePropertyNumber(
    requestedSubscription?.linkedProperty || requestedProperty.linkedProperty,
  );
  const multiGroupRoot = Array.from(multiGroupRoots)[0] || "";
  if (declaredParent && multiGroupRoot && declaredParent !== multiGroupRoot) {
    throw new OwnerSubscriptionGroupError(
      "بيانات ربط العقار لا تتطابق مع المالك الحالي",
    );
  }
  const mainPropertyNumber = declaredParent || multiGroupRoot || requestedNumber;
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
  const relevantMultiGroups = multiPropertySubscriptions.filter((record) => {
    if (!isCurrentMultiPropertyMembership(record, Date.now())) return false;
    const members = multiPropertyMembers(record);
    return members.has(requestedNumber) || members.has(mainPropertyNumber);
  });
  for (const record of relevantMultiGroups) {
    if (normalizePropertyNumber(record.propertyNumber1) !== mainPropertyNumber) {
      throw new OwnerSubscriptionGroupError(
        "بيانات ربط العقار لا تتطابق مع المالك الحالي",
      );
    }
    for (const propertyNumber of multiPropertyMembers(record)) {
      if (propertyNumber === mainPropertyNumber) continue;
      const memberProperty = propertyNumber === requestedNumber
        ? requestedProperty
        : await reader.getPropertyByNumber(propertyNumber);
      const memberPin = normalizePropertyNumber(memberProperty?.pin);
      if (!memberProperty || !requestedPin || memberPin !== requestedPin) {
        throw new OwnerSubscriptionGroupError(
          "بيانات ربط العقار لا تتطابق مع المالك الحالي",
        );
      }
      linked.add(propertyNumber);
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
