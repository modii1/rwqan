import assert from "node:assert/strict";
import test from "node:test";
import { parseBookingCommissionSettingsDraft } from "./booking-commission-settings";

test("booking settings accept zero, upper bound, and Arabic digits", () => {
  assert.deepEqual(parseBookingCommissionSettingsDraft({
    customerDailyLimit: "٠",
    freeOwnerDailyLimit: "12",
    freePropertyContactDailyLimit: "۱۰۰۰",
  }), {
    customerDailyLimit: 0,
    freeOwnerDailyLimit: 12,
    freePropertyContactDailyLimit: 1_000,
  });
});

test("booking settings reject decimals, negatives, and values above the bound", () => {
  assert.equal(parseBookingCommissionSettingsDraft({
    customerDailyLimit: "1.5",
    freeOwnerDailyLimit: "3",
    freePropertyContactDailyLimit: "3",
  }), null);
  assert.equal(parseBookingCommissionSettingsDraft({
    customerDailyLimit: "3",
    freeOwnerDailyLimit: "-1",
    freePropertyContactDailyLimit: "3",
  }), null);
  assert.equal(parseBookingCommissionSettingsDraft({
    customerDailyLimit: "3",
    freeOwnerDailyLimit: "3",
    freePropertyContactDailyLimit: "1001",
  }), null);
});
