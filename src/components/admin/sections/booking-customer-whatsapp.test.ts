import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  getAdminCustomerWhatsAppHref,
  getAdminCustomerWhatsAppRemainingMinutes,
} from "./booking-customer-whatsapp";

test("customer WhatsApp link stays internal and encodes only the booking id", () => {
  assert.equal(
    getAdminCustomerWhatsAppHref("booking/with spaces?phone=hidden"),
    "/api/admin/booking-commissions/booking%2Fwith%20spaces%3Fphone%3Dhidden/customer-whatsapp",
  );
});

test("customer WhatsApp control calculates the server-provided cooldown", () => {
  const now = Date.parse("2026-08-22T12:00:00.000Z");
  assert.equal(
    getAdminCustomerWhatsAppRemainingMinutes(
      "2026-08-22T12:30:00.000Z",
      now,
    ),
    30,
  );
  assert.equal(
    getAdminCustomerWhatsAppRemainingMinutes(
      "2026-08-22T12:00:00.000Z",
      now,
    ),
    0,
  );
  assert.equal(getAdminCustomerWhatsAppRemainingMinutes("invalid", now), 0);
});

test("admin dashboard renders the safe customer WhatsApp control in all three booking views", () => {
  const source = readFileSync(
    new URL("./booking-commissions.tsx", import.meta.url),
    "utf8",
  );

  assert.equal(
    source.match(/<CustomerWhatsAppLink\s+bookingId=\{row\.id\}/g)?.length,
    3,
  );
  assert.match(source, /window\.open\("about:blank", "_blank"\)/);
  assert.match(source, /method: "POST"/);
  assert.match(source, /body: JSON\.stringify\(\{ templateVariant \}\)/);
  assert.match(source, /popup\.location\.replace\(result\.handoffUrl\)/);
  assert.match(source, /onChanged\(\)/);
  assert.match(source, /\[bookingId, nextAllowedAt\]/);
  assert.match(source, /key=\{selected\.id\}/);
  assert.match(source, /if \(!popup\) \{/);
  assert.doesNotMatch(source, /target="_blank"/);
  assert.match(source, /aria-label="فتح محادثة واتساب مع العميل"/);
  assert.match(source, /title="فتح محادثة واتساب مع العميل"/);
  assert.match(source, /<FaWhatsapp/);
  assert.match(source, /customerWhatsAppNextAllowedAt/);
  assert.match(source, /adminCustomerWhatsAppTemplateVariants/);
  assert.match(source, /BOOKING_ADMIN_CUSTOMER_WHATSAPP_TEMPLATE_VARIANTS\.map/);
  assert.match(source, /!availableTemplateVariants\.has\(variant\)/);
  assert.match(source, /<DropdownMenuLabel className="text-right">/);
  assert.doesNotMatch(source, /ADMIN_CUSTOMER_WHATSAPP_COOLDOWN_MS/);
  assert.match(source, /nextAllowedAt: string \| null/);
  assert.match(source, /setLocalNextAllowedAt\(result\.nextAllowedAt\)/);
  assert.match(source, /aria-label="التواصل مع العميل متوقف مؤقتاً"/);
  assert.match(source, /sendNow \? "إرسال الرسالة الآن" : "إعادة إرسال الرسالة"/);
  assert.match(source, /بدون إنشاء نسخة مكررة/);
  assert.doesNotMatch(source, /getAdminCustomerWhatsAppHref\(row\.customerPhoneMasked/);
});
