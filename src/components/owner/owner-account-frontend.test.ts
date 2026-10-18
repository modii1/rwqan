import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const ownerLoginSource = readFileSync(new URL("./owner-login.tsx", import.meta.url), "utf8");
const accountLoginSource = readFileSync(new URL("./owner-account-login.tsx", import.meta.url), "utf8");
const accountManagerSource = readFileSync(new URL("./owner-account-manager.tsx", import.meta.url), "utf8");
const ownerPageSource = readFileSync(new URL("./owner-page.tsx", import.meta.url), "utf8");

test("the owner login offers phone OTP while retaining the property and PIN fallback", () => {
  assert.match(ownerLoginSource, /value="account"[\s\S]*?رقم الجوال/);
  assert.match(ownerLoginSource, /value="legacy"[\s\S]*?رقم العقار/);
  assert.match(ownerLoginSource, /<OwnerAccountLogin/);
  assert.match(ownerLoginSource, /fetch\("\/api\/owner\/login"/);
  assert.match(ownerLoginSource, /data-testid="input-property-number"/);
  assert.match(ownerLoginSource, /data-testid="input-pin"/);
});

test("the account login implements a Saudi phone and six-digit one-time-code flow", () => {
  assert.match(accountLoginSource, /fetch\("\/api\/owner\/account\/login\/challenge"/);
  assert.match(accountLoginSource, /fetch\("\/api\/owner\/account\/login\/verify"/);
  assert.match(accountLoginSource, /body: JSON\.stringify\(\{ phone: validation\.phone \}\)/);
  assert.match(accountLoginSource, /challengeId: challenge\.challengeId,[\s\S]*?phone,[\s\S]*?code: validation\.code/);
  assert.match(accountLoginSource, /autoComplete="one-time-code"/);
  assert.match(accountLoginSource, /maxLength=\{6\}/);
});

test("the owner header exposes opt-in account claiming and verified property attachment", () => {
  assert.match(ownerPageSource, /<OwnerPropertySwitcher \/>[\s\S]*?<OwnerAccountManager \/>/);
  assert.match(accountManagerSource, /session\?\.hasOwnerAccount === true/);
  assert.match(accountManagerSource, /"\/api\/owner\/account\/claim\/challenge"/);
  assert.match(accountManagerSource, /"\/api\/owner\/account\/claim\/verify"/);
  assert.match(accountManagerSource, /"\/api\/owner\/account\/properties\/challenge"/);
  assert.match(accountManagerSource, /"\/api\/owner\/account\/properties\/verify"/);
  assert.match(accountManagerSource, /queryKey: \["\/api\/owner\/properties"\]/);
});

test("the owner account dialog is constrained to the mobile viewport and has accessible controls", () => {
  assert.match(accountManagerSource, /max-h-\[calc\(100svh-1\.5rem\)\]/);
  assert.match(accountManagerSource, /w-\[calc\(100%-1\.5rem\)\]/);
  assert.match(accountManagerSource, /overflow-y-auto/);
  assert.match(accountManagerSource, /aria-label=\{actionLabel\}/);
  assert.match(accountManagerSource, /inputMode="numeric"/);
  assert.match(accountManagerSource, /autoComplete="one-time-code"/);
});
