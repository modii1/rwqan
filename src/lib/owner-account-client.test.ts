import assert from "node:assert/strict";
import test from "node:test";

import {
  ownerAccountApiError,
  parseOwnerAccountChallenge,
  validateOwnerAccountCode,
  validateOwnerAccountPhone,
  validateOwnerAccountPropertyNumber,
} from "./owner-account-client";

test("owner account login accepts common Saudi mobile formats", () => {
  assert.deepEqual(validateOwnerAccountPhone("055 123 4567"), { phone: "551234567" });
  assert.deepEqual(validateOwnerAccountPhone("+966 55 123 4567"), { phone: "551234567" });
  assert.deepEqual(validateOwnerAccountPhone("٠٥٥١٢٣٤٥٦٧"), { phone: "551234567" });
});

test("owner account login rejects missing and non-Saudi mobile numbers", () => {
  assert.equal(validateOwnerAccountPhone("").error, "رقم الجوال مطلوب");
  assert.equal(validateOwnerAccountPhone("1234").error, "أدخل رقم جوال سعودي صحيح");
});

test("owner account verification requires exactly six numeric digits", () => {
  assert.deepEqual(validateOwnerAccountCode("١٢٣٤٥٦"), { code: "123456" });
  assert.equal(validateOwnerAccountCode("").error, "رمز التحقق مطلوب");
  assert.equal(validateOwnerAccountCode("12345").error, "أدخل رمز التحقق المكون من 6 أرقام");
});

test("adding an owner property requires its five-digit property number", () => {
  assert.deepEqual(validateOwnerAccountPropertyNumber("12-345"), { propertyNumber: "12345" });
  assert.equal(validateOwnerAccountPropertyNumber("").error, "رقم العقار مطلوب");
  assert.equal(validateOwnerAccountPropertyNumber("1234").error, "رقم العقار يجب أن يكون 5 أرقام");
});

test("owner account challenge parsing fails closed on malformed API responses", () => {
  assert.deepEqual(
    parseOwnerAccountChallenge({
      challengeId: "challenge-1",
      maskedPhone: "05•••1234",
      expiresInSeconds: 600,
    }),
    {
      challengeId: "challenge-1",
      maskedPhone: "05•••1234",
      expiresInSeconds: 600,
    },
  );
  assert.equal(parseOwnerAccountChallenge({ challengeId: "challenge-1" }), null);
  assert.equal(parseOwnerAccountChallenge({ challengeId: "challenge-1", maskedPhone: "x", expiresInSeconds: 0 }), null);
});

test("owner account API errors prefer the backend error without exposing malformed values", () => {
  assert.equal(ownerAccountApiError({ error: "العقار مرتبط بحساب آخر" }, "fallback"), "العقار مرتبط بحساب آخر");
  assert.equal(ownerAccountApiError({ message: "محاولة غير صالحة" }, "fallback"), "محاولة غير صالحة");
  assert.equal(ownerAccountApiError({ error: { private: true } }, "fallback"), "fallback");
});
