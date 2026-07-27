import assert from "node:assert/strict";
import test from "node:test";

import {
  MUTABLE_WORKFLOW_POLL_INTERVAL_MS,
  getAdminPaymentsRefetchInterval,
  getAdminVerificationRefetchInterval,
  getOwnerPendingPaymentRefetchInterval,
  hasPendingAdminPayment,
  hasPendingPropertyVerification,
} from "./workflow-query-refresh";

test("admin payments poll only while an actionable payment is present", () => {
  for (const status of [
    "قيد المراجعة",
    "معلق",
    "قيد التحقق",
    "نجح - قيد التحقق",
    "pending",
  ]) {
    assert.equal(hasPendingAdminPayment([{ status }]), true);
    assert.equal(
      getAdminPaymentsRefetchInterval([{ status }]),
      MUTABLE_WORKFLOW_POLL_INTERVAL_MS,
    );
  }

  assert.equal(
    getAdminPaymentsRefetchInterval([
      { status: "مكتمل" },
      { status: "مرفوض" },
    ]),
    false,
  );
  assert.equal(getAdminPaymentsRefetchInterval(undefined), false);
});

test("a claimed payment remains refreshable even if its display status lags", () => {
  assert.equal(
    getAdminPaymentsRefetchInterval([
      { status: "مكتمل", fulfillmentState: "processing" },
    ]),
    MUTABLE_WORKFLOW_POLL_INTERVAL_MS,
  );
  assert.equal(
    getAdminPaymentsRefetchInterval([
      { status: "مكتمل", fulfillmentState: "fulfilled" },
    ]),
    false,
  );
});

test("verification polling stops when every property reaches a terminal state", () => {
  assert.equal(hasPendingPropertyVerification([{ verificationStatus: "pending" }]), true);
  assert.equal(
    getAdminVerificationRefetchInterval([
      { verificationStatus: "approved" },
      { verificationStatus: "incomplete" },
    ]),
    MUTABLE_WORKFLOW_POLL_INTERVAL_MS,
  );
  assert.equal(
    getAdminVerificationRefetchInterval([
      { verificationStatus: "approved" },
      { verificationStatus: "verified" },
      { verificationStatus: "rejected" },
    ]),
    false,
  );
  assert.equal(getAdminVerificationRefetchInterval(undefined), false);
});

test("owner pending-payment polling follows only the server pending flag", () => {
  assert.equal(
    getOwnerPendingPaymentRefetchInterval({ hasPending: true }),
    MUTABLE_WORKFLOW_POLL_INTERVAL_MS,
  );
  assert.equal(
    getOwnerPendingPaymentRefetchInterval({ hasPending: false }),
    false,
  );
  assert.equal(getOwnerPendingPaymentRefetchInterval(undefined), false);
});
