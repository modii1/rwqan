import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const gatewaySource = readFileSync(
  new URL("./auth-gateway.tsx", import.meta.url),
  "utf8",
);
const ownerLoginSource = readFileSync(
  new URL("../owner/owner-login.tsx", import.meta.url),
  "utf8",
);
const customerAuthSource = readFileSync(
  new URL("../customer/customer-auth-page.tsx", import.meta.url),
  "utf8",
);
const ownerLoginPageSource = readFileSync(
  new URL("../../app/owner/login/page.tsx", import.meta.url),
  "utf8",
);
const customerLoginPageSource = readFileSync(
  new URL("../../app/customer/login/page.tsx", import.meta.url),
  "utf8",
);
const customerRegisterPageSource = readFileSync(
  new URL("../../app/customer/register/page.tsx", import.meta.url),
  "utf8",
);

test("the auth gateway exposes customer, owner, and admin as one accessible role selector", () => {
  assert.match(gatewaySource, /id: "customer", label: "العميل"/);
  assert.match(gatewaySource, /id: "owner", label: "مالك العقار"/);
  assert.match(gatewaySource, /id: "admin", label: "المسؤول"/);
  assert.match(gatewaySource, /<Tabs[\s\S]*?value=\{activeRole\}/);
  assert.match(
    gatewaySource,
    /onValueChange=\{\(value\) => onRoleChange\(value as AuthRole\)\}/,
  );
  assert.match(gatewaySource, /aria-label="اختيار نوع الحساب"/);
  assert.match(gatewaySource, /data-testid=\{`auth-role-\$\{role\.id\}`\}/);
  assert.doesNotMatch(gatewaySource, /<main(?:\s|>)/);
});

test("the unified login renders the existing customer flow beside the owner and admin forms", () => {
  assert.match(
    ownerLoginSource,
    /mode === "customer"[\s\S]*?<CustomerAuthPage[\s\S]*?variant="login"[\s\S]*?embedded/,
  );
  assert.match(ownerLoginSource, /data-testid="auth-panel-owner"/);
  assert.match(ownerLoginSource, /data-testid="auth-panel-admin"/);
  assert.match(ownerLoginSource, /fetch\("\/api\/owner\/login"/);
  assert.match(ownerLoginSource, /fetch\("\/api\/admin\/login"/);
});

test("switching roles preserves the current query while changing only the mode", () => {
  assert.match(
    ownerLoginSource,
    /const nextUrl = new URL\(window\.location\.href\);[\s\S]*?nextUrl\.searchParams\.set\("mode", nextMode\);[\s\S]*?window\.history\.replaceState\(window\.history\.state, "", nextUrl\)/,
  );
  assert.match(
    customerAuthSource,
    /ownerLoginRoleHref\(role, searchParams\.toString\(\)\)/,
  );
  assert.match(
    customerAuthSource,
    /ownerLoginRoleHref\("owner", searchParams\.toString\(\)\)/,
  );
  assert.match(
    ownerLoginPageSource,
    /initialMode=\{parseAuthRole\(params\.mode\)\}/,
  );
});

test("dedicated customer login and registration keep their distinct existing flows", () => {
  assert.match(
    customerLoginPageSource,
    /<CustomerAuthPage variant="login" \/>/,
  );
  assert.match(
    customerRegisterPageSource,
    /<CustomerAuthPage variant="register" \/>/,
  );
  assert.match(customerAuthSource, /const switchHref = `\$\{isRegister \? "\/customer\/login" : "\/customer\/register"\}\?\$\{switchParams\.toString\(\)\}`/);
  assert.match(customerAuthSource, /safeCustomerReturnPath\(searchParams\.get\("returnTo"\)\)/);
  assert.match(customerAuthSource, /safePendingFavorite\(searchParams\.get\("favorite"\)\)/);
});

test("the redesign retains the existing account fields and supporting actions", () => {
  for (const copy of [
    "رقم العقار",
    "الرقم السري",
    "نسيت الرقم السري؟",
    "ليس لديك حساب؟",
    "سجل معنا الآن",
    "كود المسؤول",
    "كلمة المرور",
  ]) {
    assert.ok(ownerLoginSource.includes(copy), `missing owner/admin copy: ${copy}`);
  }

  for (const copy of [
    "الاسم الكامل",
    "البريد الإلكتروني (اختياري)",
    "رقم الجوال",
    "إرسال رمز التحقق",
    "رمز التحقق",
    "تأكيد رقم الجوال",
  ]) {
    assert.ok(customerAuthSource.includes(copy), `missing customer copy: ${copy}`);
  }
});
