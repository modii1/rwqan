import { isSubscriptionStatusSuspended } from "../../shared/subscriptionType";
import { firebaseService } from "../firebaseService";

const PROPERTY_SUSPENDED_MESSAGE =
  "العقار موقوف مؤقتاً من الإدارة. التحقق وإشعارات المالك معطلة حتى إعادة التفعيل.";

export class PropertySuspendedError extends Error {
  readonly code = "PROPERTY_SUSPENDED" as const;
  readonly status = 423 as const;

  constructor(message = PROPERTY_SUSPENDED_MESSAGE) {
    super(message);
    this.name = "PropertySuspendedError";
  }
}

export async function isPropertySuspended(propertyNumber: string): Promise<boolean> {
  const normalizedPropertyNumber = String(propertyNumber || "").trim();
  if (!normalizedPropertyNumber) {
    throw new Error("Property number is required to check suspension status");
  }

  const subscription = await firebaseService.getSubscriptionByPropertyNumber(
    normalizedPropertyNumber,
  );
  return isSubscriptionStatusSuspended(subscription?.status);
}

export async function assertPropertyNotSuspended(propertyNumber: string): Promise<void> {
  if (await isPropertySuspended(propertyNumber)) {
    throw new PropertySuspendedError();
  }
}
