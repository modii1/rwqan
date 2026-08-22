import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  getBookingCommissionElectronicPaymentMethod,
  getOwnerCommissionViewState,
} from "./booking-commission-state";

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

test("new electronic selections use cards while an existing Apple Pay checkout resumes safely", () => {
  assert.equal(getBookingCommissionElectronicPaymentMethod({
    activeAttemptMethod: null,
    activeAttemptStatus: null,
  }), "cards");
  assert.equal(getBookingCommissionElectronicPaymentMethod({
    activeAttemptMethod: "cards",
    activeAttemptStatus: "created",
  }), "cards");
  assert.equal(getBookingCommissionElectronicPaymentMethod({
    activeAttemptMethod: "applepay",
    activeAttemptStatus: "created",
  }), "applepay");
  assert.equal(getBookingCommissionElectronicPaymentMethod({
    activeAttemptMethod: "applepay",
    activeAttemptStatus: "rejected",
  }), "cards");
});

test("commission payment presents only online and bank choices with the short payment action", () => {
  const source = readFileSync(
    new URL("./booking-commission-client.tsx", import.meta.url),
    "utf8",
  );
  assert.deepEqual(
    source.match(/data-testid="button-commission-select-(?:online|bank)"/g),
    [
      'data-testid="button-commission-select-online"',
      'data-testid="button-commission-select-bank"',
    ],
  );
  assert.match(source, /startCheckout\(electronicCheckoutMethod\)/);
  assert.match(source, /ادفع الآن/);
  assert.doesNotMatch(source, /button-commission-pay-applepay/);
  assert.doesNotMatch(source, /متابعة الدفع بالبطاقة/);
  assert.doesNotMatch(source, /\/api\/owner\/payment\//);
});

test("commission bank presentation stays on its token-scoped receipt endpoint", () => {
  const source = readFileSync(
    new URL("./booking-commission-bank-transfer.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    source,
    /\/api\/booking-commissions\/\$\{encodeURIComponent\(token\)\}\/bank-transfer/,
  );
  assert.doesNotMatch(source, /\/api\/owner\/payment\//);
  assert.match(source, /showTrigger= true|showTrigger = true/);
});
