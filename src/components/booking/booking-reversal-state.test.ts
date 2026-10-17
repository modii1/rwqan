import assert from "node:assert/strict";
import test from "node:test";
import { getBookingReversalReviewState } from "./booking-reversal-state";

test("an unresolved reversal remains reviewable", () => {
  assert.equal(getBookingReversalReviewState({
    reversalStatus: "refunded",
    hasReportedEvent: true,
    reportedEventDetail: "refunded",
  }), "unresolved");
});

test("resolution fields suppress the older pending reversal event", () => {
  assert.equal(getBookingReversalReviewState({
    reversalStatus: "refunded",
    reversalResolution: "keep_paid",
    hasReportedEvent: true,
  }), "kept_paid");
  assert.equal(getBookingReversalReviewState({
    reversalStatus: "voided",
    reversalResolution: "resume_collection",
    hasReportedEvent: true,
  }), "collection_resumed");
});

test("resolution events suppress pending state when an attempt is not returned", () => {
  assert.equal(getBookingReversalReviewState({
    hasReportedEvent: true,
    hasKeptPaidEvent: true,
  }), "kept_paid");
  assert.equal(getBookingReversalReviewState({
    hasReportedEvent: true,
    hasCollectionResumedEvent: true,
  }), "collection_resumed");
});

test("a current unresolved attempt overrides a prior cycle resolution event", () => {
  assert.equal(getBookingReversalReviewState({
    reversalStatus: "refunded",
    hasReportedEvent: true,
    hasKeptPaidEvent: true,
  }), "unresolved");
});

test("the latest timeline event identifies a new reversal after an older resolution", () => {
  assert.equal(getBookingReversalReviewState({
    latestEventType: "commission_payment_reversal_reported",
    reportedEventDetail: "voided",
    hasReportedEvent: true,
    hasKeptPaidEvent: true,
  }), "unresolved");
});

test("authorization-only callbacks never become reversal review actions", () => {
  assert.equal(getBookingReversalReviewState({
    reversalStatus: "authorization_only",
    hasReportedEvent: true,
    reportedEventDetail: "authorization_only",
  }), "none");
});
