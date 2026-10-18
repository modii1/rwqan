import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(relativeUrl: string): string {
  return readFileSync(new URL(relativeUrl, import.meta.url), "utf8");
}

test("every admin sidebar section keeps the URL in sync", () => {
  const dashboard = source("./admin-dashboard.tsx");
  assert.doesNotMatch(dashboard, /onClick=\{\(\) => setActiveSection\(/);
  assert.match(dashboard, /router\.push\(section \? `\/admin\/\$\{section\}` : "\/admin"\)/);
});

test("mobile admin navigation exposes labels instead of icon-only controls", () => {
  const dashboard = source("./admin-dashboard.tsx");
  assert.match(dashboard, /<span>\{label\}<\/span>/);
  assert.doesNotMatch(dashboard, /<span className="hidden md:inline">\{label\}<\/span>/);
});

test("operations target sections consume their direct-action query parameters", () => {
  const bookingCommissions = source("./sections/booking-commissions.tsx");
  const payments = source("./sections/payments.tsx");
  const properties = source("./sections/properties.tsx");
  const verification = source("./sections/verification.tsx");
  const whatsapp = source("./sections/whatsapp.tsx");

  assert.match(bookingCommissions, /getAdminOperationTarget\(searchParams, "booking"\)/);
  assert.match(payments, /getAdminOperationTarget\(searchParams, "payment"\)/);
  assert.match(properties, /getAdminOperationTarget\(searchParams, "property"\)/);
  assert.match(verification, /getAdminOperationTarget\(searchParams, "property"\)/);
  assert.match(whatsapp, /getAdminOperationTarget\(searchParams, "log"\)/);
  assert.match(whatsapp, /getAdminWhatsAppTab\(searchParams\)/);
});
