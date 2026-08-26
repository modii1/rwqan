import assert from "node:assert/strict";
import test from "node:test";
import { buildAdminCustomerContacts } from "./AdminCustomerContactService";

test("admin customers include every accepted contact without exposing raw identities", () => {
  const contacts = buildAdminCustomerContacts(
    [
      {
        id: "REQ-NEW",
        propertyNumber: "PROP-FREE",
        requestCode: "CODE-NEW",
        timestamp: "1787712000000",
        clientPhone: "0512345678",
        ipAddress: "203.0.113.10",
        deviceType: "mobile",
        dayOfWeek: "الأربعاء",
        hourOfDay: 10,
      },
      {
        id: "REQ-OLD",
        propertyNumber: "PROP-PAID",
        requestCode: "CODE-OLD",
        timestamp: "2026-08-25T08:00:00.000Z",
        clientPhone: "0598765432",
        ipAddress: "198.51.100.20",
        deviceType: "desktop",
        dayOfWeek: "الثلاثاء",
        hourOfDay: 8,
      },
    ],
    [
      { propertyNumber: "PROP-FREE", name: "Free property" },
      { propertyNumber: "PROP-PAID", name: "Paid property" },
    ],
    [
      {
        id: "BOOK-CODE-NEW",
        contactRequestId: "REQ-NEW",
        bookingStatus: "awaiting_response",
        customerPhoneMasked: "05•• ••5678",
        customerWhatsAppNextAllowedAt: null,
        adminCustomerWhatsAppTemplateVariants: ["technical_support"],
        isFreeProperty: true,
      },
    ],
  );

  assert.equal(contacts.length, 2);
  assert.equal(contacts[0].id, "REQ-NEW");
  assert.equal(contacts[0].bookingWorkflowId, "BOOK-CODE-NEW");
  assert.equal(contacts[0].bookingStatus, "awaiting_response");
  assert.equal(contacts[1].bookingWorkflowId, null);
  assert.equal(contacts[1].bookingStatus, "contact_only");
  assert.equal(contacts[1].customerPhoneMasked, "05•• ••5432");

  const serialized = JSON.stringify(contacts);
  assert.equal(serialized.includes("0512345678"), false);
  assert.equal(serialized.includes("0598765432"), false);
  assert.equal(serialized.includes("203.0.113.10"), false);
  assert.equal(serialized.includes("198.51.100.20"), false);
});

test("admin customers keep repeated contacts as separate request records", () => {
  const shared = {
    propertyNumber: "PROP-1",
    clientPhone: "0512345678",
    ipAddress: "203.0.113.10",
    deviceType: "mobile" as const,
    dayOfWeek: "الأربعاء",
    hourOfDay: 10,
  };
  const contacts = buildAdminCustomerContacts(
    [
      { ...shared, id: "REQ-1", requestCode: "CODE-1", timestamp: "1787712000000" },
      { ...shared, id: "REQ-2", requestCode: "CODE-2", timestamp: "1787712060000" },
    ],
    [{ propertyNumber: "PROP-1", name: "Property" }],
    [],
  );

  assert.deepEqual(contacts.map((contact) => contact.id), ["REQ-2", "REQ-1"]);
});
