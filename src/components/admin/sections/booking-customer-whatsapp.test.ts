import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getAdminCustomerWhatsAppHref } from "./booking-customer-whatsapp";

test("customer WhatsApp link stays internal and encodes only the booking id", () => {
  assert.equal(
    getAdminCustomerWhatsAppHref("booking/with spaces?phone=hidden"),
    "/api/admin/booking-commissions/booking%2Fwith%20spaces%3Fphone%3Dhidden/customer-whatsapp",
  );
});

test("admin dashboard renders the safe customer WhatsApp control in all three booking views", () => {
  const source = readFileSync(
    new URL("./booking-commissions.tsx", import.meta.url),
    "utf8",
  );

  assert.equal(
    source.match(/<CustomerWhatsAppLink bookingId=\{row\.id\}/g)?.length,
    3,
  );
  assert.match(source, /target="_blank"/);
  assert.match(source, /rel="noopener noreferrer"/);
  assert.match(source, /aria-label="فتح محادثة واتساب مع العميل"/);
  assert.match(source, /title="فتح محادثة واتساب مع العميل"/);
  assert.match(source, /<FaWhatsapp/);
  assert.doesNotMatch(source, /getAdminCustomerWhatsAppHref\(row\.customerPhoneMasked/);
});
