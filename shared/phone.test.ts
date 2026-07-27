import assert from "node:assert/strict";
import test from "node:test";

import { normalizeSaudiMobilePhone, normalizeWhatsAppDestination } from "./phone";

test("normalizes common Saudi mobile formats", () => {
  assert.equal(normalizeSaudiMobilePhone("512345678"), "512345678");
  assert.equal(normalizeSaudiMobilePhone("0512345678"), "512345678");
  assert.equal(normalizeSaudiMobilePhone("+966 51 234 5678"), "512345678");
  assert.equal(normalizeSaudiMobilePhone("+966 051 234 5678"), "512345678");
  assert.equal(normalizeSaudiMobilePhone("00966512345678"), "512345678");
});

test("normalizes Arabic phone digits and rejects invalid numbers", () => {
  assert.equal(normalizeSaudiMobilePhone("٠٥١٢٣٤٥٦٧٨"), "512345678");
  assert.equal(normalizeSaudiMobilePhone("۰۵۱۲۳۴۵۶۷۸"), "512345678");
  assert.equal(normalizeSaudiMobilePhone("0412345678"), null);
  assert.equal(normalizeSaudiMobilePhone("051234567"), null);
});

test("normalizes Saudi owner numbers for WhatsApp destinations", () => {
  assert.equal(normalizeWhatsAppDestination("512345678"), "966512345678");
  assert.equal(normalizeWhatsAppDestination("0512345678"), "966512345678");
  assert.equal(normalizeWhatsAppDestination("+966 51 234 5678"), "966512345678");
  assert.equal(normalizeWhatsAppDestination("+966 051 234 5678"), "966512345678");
  assert.equal(normalizeWhatsAppDestination("00966512345678"), "966512345678");
  assert.equal(normalizeWhatsAppDestination("0412345678"), null);
  assert.equal(normalizeWhatsAppDestination("+966 041 234 5678"), null);
  assert.equal(normalizeWhatsAppDestination("invalid"), null);
});
