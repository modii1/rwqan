import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import type { BookingDisplayRow } from "@/components/booking/booking-display";
import {
  customerContactStatus,
  filterCustomerAccounts,
  filterCustomerContacts,
  summarizeCustomerContacts,
  type AdminCustomerAccountRow,
} from "./customers-model";

function contact(
  id: string,
  bookingStatus: string,
  overrides: Partial<BookingDisplayRow> = {},
): BookingDisplayRow {
  return {
    id,
    propertyNumber: `P-${id}`,
    propertyName: `Property ${id}`,
    requestCode: `REQ-${id}`,
    customerPhoneMasked: `05••••${id.padStart(4, "0").slice(-4)}`,
    contactAt: "2026-08-20T12:00:00.000Z",
    bookingStatus,
    ...overrides,
  };
}

test("customer contact status distinguishes requests from confirmed bookings", () => {
  assert.equal(customerContactStatus(contact("0", "contact_only")), "contact_only");
  assert.equal(customerContactStatus(contact("1", "awaiting_response")), "awaiting");
  assert.equal(customerContactStatus(contact("2", "confirmed")), "confirmed");
  assert.equal(customerContactStatus(contact("3", "declined")), "declined");
  assert.equal(
    customerContactStatus(contact("4", "awaiting_response", {
      events: [{ type: "customer_followup_expired" }],
    })),
    "expired",
  );
});

test("customer contact filtering searches safe admin fields and sorts newest first", () => {
  const older = contact("11", "awaiting_response", {
    customerPhoneMasked: "05••••1111",
    contactAt: "2026-08-20T12:00:00.000Z",
  });
  const newer = contact("22", "confirmed", {
    propertyName: "الريف المائي",
    customerPhoneMasked: "05••••2222",
    contactAt: "2026-08-21T12:00:00.000Z",
  });

  assert.deepEqual(
    filterCustomerContacts([older, newer], "", "all").map((row) => row.id),
    ["22", "11"],
  );
  assert.deepEqual(
    filterCustomerContacts([older, newer], "2222", "all").map((row) => row.id),
    ["22"],
  );
  assert.deepEqual(
    filterCustomerContacts([older, newer], "", "confirmed").map((row) => row.id),
    ["22"],
  );
});

test("customer contact summary counts each platform contact request once", () => {
  assert.deepEqual(
    summarizeCustomerContacts([
      contact("0", "contact_only"),
      contact("1", "awaiting_response"),
      contact("2", "confirmed"),
      contact("3", "declined"),
      contact("4", "expired"),
    ]),
    {
      total: 5,
      contactOnly: 1,
      awaiting: 1,
      confirmed: 1,
      declined: 1,
      expired: 1,
    },
  );
});

test("admin dashboard exposes customers as its own routable section", () => {
  const dashboardSource = readFileSync(
    new URL("../admin-dashboard.tsx", import.meta.url),
    "utf8",
  );
  const routeSource = readFileSync(
    new URL("../../../app/admin/[...section]/page.tsx", import.meta.url),
    "utf8",
  );

  assert.match(dashboardSource, /import CustomersSection from "\.\/sections\/customers"/);
  assert.match(dashboardSource, /label="العملاء"/);
  assert.match(dashboardSource, /activeSection === "customers"/);
  assert.match(dashboardSource, /<CustomersSection \/>/);
  assert.match(routeSource, /"customers"/);
});

test("registered customer account filtering uses profile, favorites, and verified history", () => {
  const account = (
    id: string,
    fullName: string,
    lastLoginAt: string,
  ): AdminCustomerAccountRow => ({
    id,
    fullName,
    email: `${id}@example.com`,
    customerPhoneMasked: `05••••${id.padStart(4, "0").slice(-4)}`,
    favoritePropertyNumbers: [`FAV-${id}`],
    createdAt: "2026-08-01T08:00:00.000Z",
    updatedAt: "2026-08-01T08:00:00.000Z",
    lastLoginAt,
    contactCount: 1,
    confirmedBookingCount: 0,
    latestContactAt: "2026-08-20T12:00:00.000Z",
    contacts: [contact(id, "contact_only", { propertyName: `History ${id}` })],
  });
  const older = account("11", "Older Customer", "2026-08-20T08:00:00.000Z");
  const newer = account("22", "Newer Customer", "2026-08-21T08:00:00.000Z");

  assert.deepEqual(
    filterCustomerAccounts([older, newer], "").map((row) => row.id),
    ["22", "11"],
  );
  assert.deepEqual(
    filterCustomerAccounts([older, newer], "newer").map((row) => row.id),
    ["22"],
  );
  assert.deepEqual(
    filterCustomerAccounts([older, newer], "FAV-11").map((row) => row.id),
    ["11"],
  );
  assert.deepEqual(
    filterCustomerAccounts([older, newer], "History 22").map((row) => row.id),
    ["22"],
  );
});
