import assert from "node:assert/strict";
import test from "node:test";
import {
  validateContactPhone,
  validateContactVerificationCode,
} from "./contact-phone-dialog";

test("contact phone dialog accepts common Saudi mobile formats", () => {
  assert.deepEqual(validateContactPhone("0512345678"), { phone: "512345678" });
  assert.deepEqual(validateContactPhone("966512345678"), { phone: "512345678" });
  assert.deepEqual(validateContactPhone("٠٥١٢٣٤٥٦٧٨"), { phone: "512345678" });
});

test("contact phone dialog returns useful validation errors", () => {
  assert.equal(validateContactPhone("").error, "رقم الجوال مطلوب");
  assert.equal(validateContactPhone("0412345678").error, "رقم الجوال السعودي يجب أن يبدأ بـ 5");
  assert.equal(validateContactPhone("05123").error, "أدخل رقم جوال صحيحاً من 9 أرقام بعد حذف الصفر");
});

test("contact phone dialog accepts exactly six verification digits", () => {
  assert.deepEqual(validateContactVerificationCode("123456"), { code: "123456" });
  assert.deepEqual(validateContactVerificationCode("١٢٣٤٥٦"), { code: "123456" });
  assert.equal(validateContactVerificationCode("").error, "رمز التحقق مطلوب");
  assert.equal(
    validateContactVerificationCode("12345").error,
    "أدخل رمز التحقق المكون من 6 أرقام",
  );
  assert.equal(
    validateContactVerificationCode("1234567").error,
    "أدخل رمز التحقق المكون من 6 أرقام",
  );
});
