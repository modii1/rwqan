import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAdminCustomerAccounts,
  buildAdminCustomerContacts,
  summarizeAdminCustomerAccounts,
} from "./AdminCustomerContactService";

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

test("registered customer accounts include only verified subject-linked history", () => {
  const firstSubject = "a".repeat(64);
  const secondSubject = "b".repeat(64);
  const unknownSubject = "c".repeat(64);
  const requests = [
    {
      id: "REQ-VERIFIED",
      propertyNumber: "PROP-1",
      requestCode: "CODE-VERIFIED",
      timestamp: "2026-08-25T08:00:00.000Z",
      clientPhone: "0512345678",
      customerSubject: firstSubject,
      actorType: "anonymous" as const,
      ipAddress: "203.0.113.10",
      deviceType: "mobile" as const,
      dayOfWeek: "الثلاثاء",
      hourOfDay: 8,
    },
    {
      id: "REQ-LEGACY-PHONE-ONLY",
      propertyNumber: "PROP-2",
      requestCode: "CODE-LEGACY",
      timestamp: "2026-08-24T08:00:00.000Z",
      clientPhone: "0512345678",
      ipAddress: "203.0.113.11",
      deviceType: "mobile" as const,
      dayOfWeek: "الاثنين",
      hourOfDay: 8,
    },
    {
      id: "REQ-SECOND-ACCOUNT",
      propertyNumber: "PROP-4",
      requestCode: "CODE-SECOND",
      timestamp: "2026-08-22T08:00:00.000Z",
      clientPhone: "0598765432",
      customerSubject: secondSubject,
      actorType: "anonymous" as const,
      ipAddress: "203.0.113.13",
      deviceType: "mobile" as const,
      dayOfWeek: "السبت",
      hourOfDay: 8,
    },
    {
      id: "REQ-UNKNOWN-ACCOUNT",
      propertyNumber: "PROP-5",
      requestCode: "CODE-UNKNOWN",
      timestamp: "2026-08-21T08:00:00.000Z",
      clientPhone: "0555555555",
      customerSubject: unknownSubject,
      actorType: "anonymous" as const,
      ipAddress: "203.0.113.14",
      deviceType: "mobile" as const,
      dayOfWeek: "الجمعة",
      hourOfDay: 8,
    },
    {
      id: "REQ-ADMIN",
      propertyNumber: "PROP-3",
      requestCode: "CODE-ADMIN",
      timestamp: "2026-08-23T08:00:00.000Z",
      clientPhone: "0512345678",
      customerSubject: firstSubject,
      actorType: "admin" as const,
      ipAddress: "203.0.113.12",
      deviceType: "desktop" as const,
      dayOfWeek: "الأحد",
      hourOfDay: 8,
    },
  ];
  const contacts = buildAdminCustomerContacts(
    requests,
    [
      { propertyNumber: "PROP-1", name: "Property 1" },
      { propertyNumber: "PROP-2", name: "Property 2" },
      { propertyNumber: "PROP-3", name: "Property 3" },
      { propertyNumber: "PROP-4", name: "Property 4" },
      { propertyNumber: "PROP-5", name: "Property 5" },
    ],
    [{
      id: "BOOK-1",
      contactRequestId: "REQ-VERIFIED",
      bookingStatus: "confirmed",
      customerPhoneMasked: "05•• ••5678",
      customerWhatsAppNextAllowedAt: null,
      adminCustomerWhatsAppTemplateVariants: [],
      isFreeProperty: true,
    }],
  );
  const accounts = buildAdminCustomerAccounts(
    [
      {
        id: firstSubject,
        schemaVersion: 1 as const,
        phone: "512345678",
        fullName: "Customer One",
        email: "customer@example.com",
        favoritePropertyNumbers: ["PROP-9"],
        createdAt: "2026-08-01T08:00:00.000Z",
        updatedAt: "2026-08-20T08:00:00.000Z",
        lastLoginAt: "2026-08-25T09:00:00.000Z",
      },
      {
        id: secondSubject,
        schemaVersion: 1 as const,
        phone: "598765432",
        fullName: "",
        email: null,
        favoritePropertyNumbers: [],
        createdAt: "2026-08-02T08:00:00.000Z",
        updatedAt: "2026-08-02T08:00:00.000Z",
        lastLoginAt: "2026-08-02T08:00:00.000Z",
      },
    ],
    requests,
    contacts,
  );

  assert.equal(accounts.length, 2);
  assert.equal(accounts[0].fullName, "Customer One");
  assert.deepEqual(accounts[0].contacts.map((contact) => contact.id), [
    "REQ-VERIFIED",
  ]);
  assert.equal(accounts[0].confirmedBookingCount, 1);
  assert.deepEqual(accounts[1].contacts.map((contact) => contact.id), [
    "REQ-SECOND-ACCOUNT",
  ]);
  assert.equal(accounts[1].contactCount, 1);
  assert.deepEqual(summarizeAdminCustomerAccounts(accounts), {
    total: 2,
    withProfile: 1,
    favoriteProperties: 1,
    verifiedContacts: 2,
    confirmedBookings: 1,
  });

  const serialized = JSON.stringify(accounts);
  assert.equal(serialized.includes(firstSubject), false);
  assert.equal(serialized.includes(secondSubject), false);
  assert.equal(serialized.includes("0512345678"), false);
  assert.equal(serialized.includes("512345678"), false);
  assert.equal(serialized.includes("CODE-LEGACY"), false);
  assert.equal(serialized.includes("CODE-ADMIN"), false);
  assert.equal(serialized.includes("CODE-UNKNOWN"), false);
});
