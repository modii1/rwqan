export type BookingReversalReviewState =
  | "none"
  | "unresolved"
  | "collection_resumed"
  | "kept_paid";

function normalize(value: unknown): string {
  return String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

export function getBookingReversalReviewState(options: {
  reversalStatus?: unknown;
  reversalResolution?: unknown;
  latestEventType?: unknown;
  reportedEventDetail?: unknown;
  hasReportedEvent?: boolean;
  hasCollectionResumedEvent?: boolean;
  hasKeptPaidEvent?: boolean;
}): BookingReversalReviewState {
  const resolution = normalize(options.reversalResolution);
  if (resolution === "keep_paid") return "kept_paid";
  if (resolution === "resume_collection") return "collection_resumed";

  const reversalStatus = normalize(options.reversalStatus);
  const reportedDetail = normalize(options.reportedEventDetail);
  if (reversalStatus === "authorization_only") return "none";
  // A selected unresolved attempt is newer and more specific than historical
  // resolution events that may belong to a prior collection cycle.
  if (reversalStatus) return "unresolved";

  const latestEventType = normalize(options.latestEventType);
  if (latestEventType === "commission_payment_reversal_kept_paid") return "kept_paid";
  if (latestEventType === "commission_payment_reversal_collection_resumed") return "collection_resumed";
  if (latestEventType === "commission_payment_reversal_reported") {
    return reportedDetail === "authorization_only" ? "none" : "unresolved";
  }

  // Resolution events suppress the immutable reported event when an attempt is
  // no longer available in the admin response.
  if (options.hasKeptPaidEvent) return "kept_paid";
  if (options.hasCollectionResumedEvent) return "collection_resumed";
  if (options.hasReportedEvent && reportedDetail !== "authorization_only") {
    return "unresolved";
  }
  return "none";
}
