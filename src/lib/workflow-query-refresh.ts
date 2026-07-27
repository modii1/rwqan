export const MUTABLE_WORKFLOW_POLL_INTERVAL_MS = 30_000;

const PENDING_PAYMENT_STATUSES = new Set([
  "قيد المراجعة",
  "معلق",
  "قيد التحقق",
  "نجح - قيد التحقق",
  "pending",
]);

const PENDING_VERIFICATION_STATUSES = new Set(["pending", "incomplete"]);

type PaymentWorkflowState = {
  status?: string | null;
  fulfillmentState?: string | null;
};

type PropertyVerificationState = {
  verificationStatus?: string | null;
};

type PendingPaymentResponse = {
  hasPending?: boolean;
};

export function hasPendingAdminPayment(
  payments: readonly PaymentWorkflowState[] | undefined,
): boolean {
  return (
    payments?.some(
      (payment) =>
        PENDING_PAYMENT_STATUSES.has(String(payment.status || "").trim()) ||
        payment.fulfillmentState === "processing",
    ) ?? false
  );
}

export function getAdminPaymentsRefetchInterval(
  payments: readonly PaymentWorkflowState[] | undefined,
): number | false {
  return hasPendingAdminPayment(payments)
    ? MUTABLE_WORKFLOW_POLL_INTERVAL_MS
    : false;
}

export function hasPendingPropertyVerification(
  properties: readonly PropertyVerificationState[] | undefined,
): boolean {
  return (
    properties?.some((property) =>
      PENDING_VERIFICATION_STATUSES.has(
        String(property.verificationStatus || "").trim(),
      ),
    ) ?? false
  );
}

export function getAdminVerificationRefetchInterval(
  properties: readonly PropertyVerificationState[] | undefined,
): number | false {
  return hasPendingPropertyVerification(properties)
    ? MUTABLE_WORKFLOW_POLL_INTERVAL_MS
    : false;
}

export function getOwnerPendingPaymentRefetchInterval(
  response: PendingPaymentResponse | undefined,
): number | false {
  return response?.hasPending === true
    ? MUTABLE_WORKFLOW_POLL_INTERVAL_MS
    : false;
}
