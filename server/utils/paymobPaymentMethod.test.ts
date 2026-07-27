import assert from "node:assert/strict";
import test from "node:test";

import {
  getExactPaymobPaymentMethod,
  isGenericPaymobPaymentMethod,
} from "./paymobPaymentMethod";

test("Paymob payment method normalization accepts exact subtypes only", () => {
  assert.equal(
    getExactPaymobPaymentMethod({
      cardSubType: "APPLE_PAY",
      paymentMethod: "card",
    }),
    "APPLE_PAY",
  );
  assert.equal(
    getExactPaymobPaymentMethod({
      cardSubType: "card",
      paymentMethod: "visa",
    }),
    "visa",
  );
  for (const generic of [
    "",
    "بطاقة",
    "card",
    "cards",
    "paymob",
    "تحويل بنكي",
    "bank_transfer",
    "تأكيد يدوي",
    "unknown",
  ]) {
    assert.equal(isGenericPaymobPaymentMethod(generic), true, generic);
    assert.equal(
      getExactPaymobPaymentMethod({
        cardSubType: generic,
        paymentMethod: generic,
      }),
      null,
      generic,
    );
  }
});
