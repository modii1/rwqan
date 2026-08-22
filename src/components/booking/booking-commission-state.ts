export type OwnerCommissionViewState =
  | "paid"
  | "waived"
  | "dispute_pending"
  | "dispute_rejected"
  | "payable";

export type BookingCommissionElectronicPaymentMethod = "cards" | "applepay";

function normalize(value: unknown): string {
  return String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export function getOwnerCommissionViewState(options: {
  commissionStatus: unknown;
  disputeStatus: unknown;
  disputedLocally?: boolean;
}): OwnerCommissionViewState {
  const commissionStatus = normalize(options.commissionStatus);
  const disputeStatus = normalize(options.disputeStatus);

  if (["paid", "completed", "settled", "مسددة"].includes(commissionStatus)) {
    return "paid";
  }
  if (disputeStatus === "accepted" || commissionStatus === "waived") {
    return "waived";
  }
  if (disputeStatus === "rejected") {
    return "dispute_rejected";
  }
  if (
    disputeStatus === "pending"
    || ["disputed", "under_dispute", "اعتراض"].includes(commissionStatus)
    || options.disputedLocally
  ) {
    return "dispute_pending";
  }
  return "payable";
}

export function getBookingCommissionElectronicPaymentMethod(options: {
  activeAttemptMethod: unknown;
  activeAttemptStatus: unknown;
}): BookingCommissionElectronicPaymentMethod {
  return normalize(options.activeAttemptMethod) === "applepay"
    && normalize(options.activeAttemptStatus) === "created"
    ? "applepay"
    : "cards";
}
