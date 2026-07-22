import assert from "node:assert/strict";
import test from "node:test";
import { validateContactPhone } from "./contact-phone-dialog";

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
