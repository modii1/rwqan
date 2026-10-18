import assert from "node:assert/strict";
import test from "node:test";

import { getCustomerBookingActions } from "./customer-booking-actions";

test("customer booking actions match the current request state", () => {
  assert.deepEqual(getCustomerBookingActions("awaiting_response"), {
    canContactAgain: false,
    canBookAgain: false,
    canDownloadSummary: false,
  });
  assert.deepEqual(getCustomerBookingActions("expired"), {
    canContactAgain: true,
    canBookAgain: true,
    canDownloadSummary: false,
  });
  assert.deepEqual(getCustomerBookingActions("confirmed"), {
    canContactAgain: false,
    canBookAgain: true,
    canDownloadSummary: true,
  });
});
