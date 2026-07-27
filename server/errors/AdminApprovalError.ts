import type { Response } from "express";

export type AdminApprovalErrorCode =
  | "PROPERTY_NOT_FOUND"
  | "PROPERTY_LOOKUP_FAILED"
  | "PROPERTY_INCOMPLETE"
  | "PROPERTY_VALIDATION_FAILED"
  | "IMAGE_STORAGE_UNAVAILABLE"
  | "PAYMENT_ID_REQUIRED"
  | "PAYMENT_NOT_FOUND"
  | "PAYMENT_LOOKUP_FAILED"
  | "PAYMENT_NOT_PENDING"
  | "PAYMENT_PACKAGE_MISSING"
  | "PACKAGE_NOT_FOUND"
  | "PACKAGE_LOOKUP_FAILED"
  | "SUBSCRIPTION_LOOKUP_FAILED"
  | "SUBSCRIPTION_PREPARATION_FAILED"
  | "PAYMENT_QUEUE_FAILED"
  | "PAYMENT_ACTIVATION_FAILED"
  | "PAYMENT_FULFILLMENT_IN_PROGRESS"
  | "PAYMENT_ACTION_IN_PROGRESS"
  | "PAYMENT_ACTION_NO_LONGER_ELIGIBLE"
  | "PROPERTY_SUSPENDED"
  | "VERIFICATION_UPDATE_FAILED"
  | "PROPERTY_REJECTION_FAILED"
  | "PAYMENT_REJECTION_FAILED"
  | "APPROVAL_PARTIALLY_COMPLETED";

export type AdminApprovalErrorOptions = {
  status: number;
  code: AdminApprovalErrorCode;
  message: string;
  missingFields?: string[];
  warnings?: string[];
  partial?: boolean;
};

export class AdminApprovalError extends Error {
  readonly status: number;
  readonly code: AdminApprovalErrorCode;
  readonly missingFields?: string[];
  readonly warnings?: string[];
  readonly partial?: boolean;

  constructor(options: AdminApprovalErrorOptions) {
    super(options.message);
    this.name = "AdminApprovalError";
    this.status = options.status;
    this.code = options.code;
    this.missingFields = options.missingFields;
    this.warnings = options.warnings;
    this.partial = options.partial;
  }
}

/**
 * Signals that a multi-write operation failed after at least one write may
 * already have reached the database. The public admin error keeps the
 * operation-specific safe message while adding `partial: true`.
 */
export class PartialMutationError extends Error {
  constructor(cause?: unknown) {
    super("The operation may have been partially persisted", { cause });
    this.name = "PartialMutationError";
  }
}

export function mapKnownApprovalError(error: unknown): AdminApprovalError | null {
  if (error instanceof AdminApprovalError) return error;

  if (
    error instanceof Error &&
    "code" in error &&
    (error as { code?: unknown }).code === "PROPERTY_SUSPENDED"
  ) {
    const status =
      "status" in error && typeof (error as { status?: unknown }).status === "number"
        ? (error as { status: number }).status
        : 423;
    return new AdminApprovalError({
      status,
      code: "PROPERTY_SUSPENDED",
      message: error.message,
    });
  }

  if (
    error instanceof Error &&
    error.message === "Payment fulfillment is already in progress"
  ) {
    return new AdminApprovalError({
      status: 409,
      code: "PAYMENT_FULFILLMENT_IN_PROGRESS",
      message: "تفعيل هذا الدفع قيد التنفيذ بالفعل. حدّث الصفحة وحاول مرة أخرى بعد قليل.",
    });
  }

  return null;
}

export function contextualizeAdminApprovalError(
  error: unknown,
  options: AdminApprovalErrorOptions,
): AdminApprovalError {
  const knownError = mapKnownApprovalError(error);
  if (knownError) return knownError;

  return new AdminApprovalError({
    ...options,
    ...(error instanceof PartialMutationError ? { partial: true } : {}),
  });
}

export async function runAdminApprovalStage<T>(
  operation: () => T | Promise<T>,
  options: AdminApprovalErrorOptions,
): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw contextualizeAdminApprovalError(error, options);
  }
}

export function sendAdminApprovalError(
  res: Response,
  error: unknown,
  fallbackMessage: string,
): Response {
  const knownError = mapKnownApprovalError(error);
  if (!knownError) {
    return res.status(500).json({
      success: false,
      code: "APPROVAL_FAILED",
      message: fallbackMessage,
      error: fallbackMessage,
    });
  }

  return res.status(knownError.status).json({
    success: false,
    code: knownError.code,
    message: knownError.message,
    error: knownError.message,
    ...(knownError.missingFields
      ? { missingFields: knownError.missingFields }
      : {}),
    ...(knownError.warnings ? { warnings: knownError.warnings } : {}),
    ...(knownError.partial !== undefined
      ? { partial: knownError.partial }
      : {}),
  });
}
