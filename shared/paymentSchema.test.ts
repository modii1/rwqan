import assert from "node:assert/strict";
import test from "node:test";

import { paymentSchema } from "./schema";

const payment = (paymentMethod: string) => ({
  id: "PAY-1",
  propertyNumber: "PROP-1",
  packageId: "pkg-month",
  amount: 40,
  discountAmount: 0,
  finalAmount: 40,
  status: "مكتمل",
  paymentMethod,
});

test("payment schema preserves exact Paymob payment methods", () => {
  for (const method of ["APPLE_PAY", "VISA", "MASTERCARD", "MADA"]) {
    assert.equal(paymentSchema.parse(payment(method)).paymentMethod, method);
  }
});

test("payment schema still rejects empty or unbounded method values", () => {
  assert.equal(paymentSchema.safeParse(payment(" ")).success, false);
  assert.equal(paymentSchema.safeParse(payment("X".repeat(65))).success, false);
});
