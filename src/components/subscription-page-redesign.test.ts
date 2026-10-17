import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("./subscription-page.tsx", import.meta.url),
  "utf8",
);

test("owner signup retains its three steps and all existing account fields", () => {
  for (const copy of [
    "اختيار الباقة",
    "بيانات العقار",
    "طريقة الدفع",
    "رقم العقار (5 أرقام) *",
    "اسم العقار *",
    "الرقم السري *",
    "رقم الواتساب *",
    "الموقع / الحي",
    "وسط الأسبوع",
    "نهاية الأسبوع",
    "مبيت",
    "إجازات",
  ]) {
    assert.ok(source.includes(copy), `missing owner signup copy: ${copy}`);
  }
  assert.match(source, /aria-current=\{currentStep === 1 \? "step" : undefined\}/);
  assert.match(source, /aria-current=\{currentStep === 2 \? "step" : undefined\}/);
  assert.match(source, /aria-current=\{currentStep === 3 \? "step" : undefined\}/);
});

test("owner signup keeps both payment methods as keyboard-accessible choices", () => {
  assert.match(
    source,
    /<button[\s\S]*?type="button"[\s\S]*?setPaymentMethod\('online'\)[\s\S]*?aria-pressed=\{paymentMethod === 'online'\}[\s\S]*?الدفع الإلكتروني/,
  );
  assert.match(
    source,
    /<button[\s\S]*?type="button"[\s\S]*?setPaymentMethod\('bank'\)[\s\S]*?aria-pressed=\{paymentMethod === 'bank'\}[\s\S]*?تحويل بنكي/,
  );
  assert.ok(source.includes("بطاقة ائتمان أو Apple Pay"));
  assert.ok(source.includes("مع تحميل إيصال التحويل"));
  assert.ok(source.includes("FREE_COMMISSION_CONSENT_TEXT"));
});
