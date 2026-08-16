import assert from "node:assert/strict";
import test from "node:test";
import { getOwnerCommissionViewState } from "./booking-commission-state";

test("paid commission takes precedence over a stale pending dispute", () => {
  assert.equal(getOwnerCommissionViewState({
    commissionStatus: "paid",
    disputeStatus: "pending",
    disputedLocally: true,
  }), "paid");
});

test("accepted disputes and waived commissions are closed", () => {
  assert.equal(getOwnerCommissionViewState({
    commissionStatus: "waived",
    disputeStatus: "accepted",
  }), "waived");
});

test("a rejected dispute overrides stale local pending state", () => {
  assert.equal(getOwnerCommissionViewState({
    commissionStatus: "pending",
    disputeStatus: "rejected",
    disputedLocally: true,
  }), "dispute_rejected");
});

test("only an unresolved dispute hides payment controls", () => {
  assert.equal(getOwnerCommissionViewState({
    commissionStatus: "disputed",
    disputeStatus: "pending",
  }), "dispute_pending");
  assert.equal(getOwnerCommissionViewState({
    commissionStatus: "pending",
    disputeStatus: "none",
  }), "payable");
});
