import assert from "node:assert/strict";
import test from "node:test";
import { getBookingCommissionDetailsPresentation } from "./booking-commissions-layout";

test("uses one mobile sheet presentation on mobile and the existing inline presentation on desktop", () => {
  assert.equal(getBookingCommissionDetailsPresentation(true), "mobile_sheet");
  assert.equal(getBookingCommissionDetailsPresentation(false), "desktop_inline");
});
