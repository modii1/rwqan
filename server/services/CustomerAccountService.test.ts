import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";

import type { CustomerAccount } from "../../shared/customer";
import type { Property, Request as ContactRequest } from "../../shared/schema";
import { CustomerAccountError, CustomerAccountService } from "./CustomerAccountService";
import type { BookingFollowUpDocument } from "./BookingCommissionTypes";

const TEST_SECRET = "customer-account-test-secret-that-is-long-enough";
const PHONE = "512345678";
const NOW = new Date("2026-09-20T12:00:00.000Z");

class MemoryCustomerAccountStore {
  accounts = new Map<string, CustomerAccount>();
  requests: ContactRequest[] = [];
  bookings: BookingFollowUpDocument[] = [];
  properties = new Map<string, Pick<
    Property,
    | "propertyNumber"
    | "verificationStatus"
    | "commissionHold"
    | "adminAvailabilityHold"
    | "commissionHoldOverride"
  >>();
  subscriptionStatuses = new Map<string, string>();
  lastRequestLookup: { customerSubject: string } | null = null;

  async getCustomerAccount(id: string) {
    return this.accounts.get(id) || null;
  }

  async ensureCustomerAccount(account: CustomerAccount, touchLastLogin: boolean) {
    const current = this.accounts.get(account.id);
    if (!current) {
      this.accounts.set(account.id, structuredClone(account));
      return structuredClone(account);
    }
    const next = touchLastLogin
      ? { ...current, lastLoginAt: account.lastLoginAt }
      : current;
    this.accounts.set(account.id, structuredClone(next));
    return structuredClone(next);
  }

  async updateCustomerAccountProfile(
    id: string,
    updates: { fullName?: string; email?: string | null; updatedAt: string },
  ) {
    const current = this.accounts.get(id);
    if (!current) throw new Error("missing account");
    const next = { ...current, ...updates };
    this.accounts.set(id, structuredClone(next));
    return structuredClone(next);
  }

  async setCustomerFavorite(
    id: string,
    propertyNumber: string,
    selected: boolean,
    updatedAt: string,
  ) {
    const current = this.accounts.get(id);
    if (!current) throw new Error("missing account");
    const favorites = new Set(current.favoritePropertyNumbers);
    if (selected) favorites.add(propertyNumber);
    else favorites.delete(propertyNumber);
    const next = {
      ...current,
      favoritePropertyNumbers: [...favorites],
      updatedAt,
    };
    this.accounts.set(id, structuredClone(next));
    return structuredClone(next);
  }

  async getCustomerRequests(customerSubject: string) {
    this.lastRequestLookup = { customerSubject };
    return structuredClone(this.requests);
  }

  async listCustomerBookingFollowUps() {
    return structuredClone(this.bookings);
  }

  async getPropertyByNumber(propertyNumber: string) {
    return structuredClone(this.properties.get(propertyNumber) || null);
  }

  async getPropertySubscriptionStatus(propertyNumber: string) {
    return this.subscriptionStatuses.get(propertyNumber) || null;
  }
}

function withSecret<T>(run: () => Promise<T>): Promise<T> {
  const previous = process.env.SESSION_SECRET;
  process.env.SESSION_SECRET = TEST_SECRET;
  return run().finally(() => {
    if (previous === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previous;
  });
}

test("creates a durable account for the existing booking customer subject", () =>
  withSecret(async () => {
    const store = new MemoryCustomerAccountStore();
    const service = new CustomerAccountService(store, { now: () => NOW });

    const account = await service.ensureForVerifiedPhone("+966 51 234 5678", {
      touchLastLogin: true,
    });
    const expectedSubject = createHmac("sha256", TEST_SECRET)
      .update(`booking-customer-phone:${PHONE}`)
      .digest("hex");

    assert.equal(account.id, expectedSubject);
    assert.equal(account.phone, PHONE);
    assert.equal(account.createdAt, NOW.toISOString());
    assert.equal(store.accounts.size, 1);

    const profile = await service.getProfile(PHONE);
    assert.deepEqual(profile, {
      fullName: "",
      email: null,
      maskedPhone: "05•• ••5678",
      favoritePropertyNumbers: [],
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      lastLoginAt: NOW.toISOString(),
    });
    assert.equal(JSON.stringify(profile).includes(PHONE), false);
  }));

test("updates profile fields and manages favorite property IDs idempotently", () =>
  withSecret(async () => {
    const store = new MemoryCustomerAccountStore();
    store.properties.set("10001", {
      propertyNumber: "10001",
      verificationStatus: "approved",
    });
    store.properties.set("legacy-public", {
      propertyNumber: "legacy-public",
    });
    const service = new CustomerAccountService(store, { now: () => NOW });

    const profile = await service.updateProfile(PHONE, {
      fullName: "  Customer Name  ",
      email: "CUSTOMER@EXAMPLE.COM",
    });
    assert.equal(profile.fullName, "Customer Name");
    assert.equal(profile.email, "customer@example.com");

    assert.deepEqual(await service.setFavorite(PHONE, "10001", true), ["10001"]);
    assert.deepEqual(await service.setFavorite(PHONE, "10001", true), ["10001"]);
    assert.deepEqual(await service.setFavorite(PHONE, "10001", false), []);
    assert.deepEqual(
      await service.setFavorite(PHONE, "legacy-public", true),
      ["legacy-public"],
    );
    assert.deepEqual(
      await service.setFavorite(PHONE, "legacy-public", false),
      [],
    );

    await assert.rejects(
      () => service.setFavorite(PHONE, "missing", true),
      (error: unknown) =>
        error instanceof CustomerAccountError &&
        error.code === "PROPERTY_NOT_FOUND" &&
        error.status === 404,
    );
  }));

test("profile updates require a usable full name when that field is submitted", () =>
  withSecret(async () => {
    const store = new MemoryCustomerAccountStore();
    const service = new CustomerAccountService(store, { now: () => NOW });

    await assert.rejects(
      () => service.updateProfile(PHONE, { fullName: " " }),
      (error: unknown) => error instanceof Error && error.name === "ZodError",
    );
    await assert.rejects(
      () => service.updateProfile(PHONE, { fullName: "A" }),
      (error: unknown) => error instanceof Error && error.name === "ZodError",
    );
  }));

test("favorites reject non-approved, held, and suspended properties", () =>
  withSecret(async () => {
    const store = new MemoryCustomerAccountStore();
    store.properties.set("pending", {
      propertyNumber: "pending",
      verificationStatus: "pending",
    });
    store.properties.set("held", {
      propertyNumber: "held",
      verificationStatus: "approved",
      adminAvailabilityHold: {
        active: true,
        appliedAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
        appliedBy: "admin",
      },
    });
    store.properties.set("suspended", {
      propertyNumber: "suspended",
      verificationStatus: "approved",
    });
    store.subscriptionStatuses.set("suspended", "موقوف مؤقتاً");
    const service = new CustomerAccountService(store, { now: () => NOW });

    for (const [propertyNumber, status] of [
      ["pending", 403],
      ["held", 423],
      ["suspended", 423],
    ] as const) {
      await assert.rejects(
        () => service.setFavorite(PHONE, propertyNumber, true),
        (error: unknown) =>
          error instanceof CustomerAccountError &&
          error.code === "PROPERTY_NOT_AVAILABLE" &&
          error.status === status,
      );
    }
  }));

test("merges every accepted contact with booking follow-ups and preserves contact-only rows", () =>
  withSecret(async () => {
    const store = new MemoryCustomerAccountStore();
    const service = new CustomerAccountService(store, { now: () => NOW });
    store.requests = [
      {
        id: "request-contact-only",
        propertyNumber: "10001",
        requestCode: "REQ-CONTACT",
        timestamp: "2026-09-20T11:00:00.000Z",
        clientPhone: PHONE,
        ipAddress: "127.0.0.1",
        deviceType: "mobile",
        dayOfWeek: "الأحد",
        hourOfDay: 14,
      },
      {
        id: "request-confirmed",
        propertyNumber: "10002",
        requestCode: "REQ-BOOKED",
        timestamp: "2026-09-19T10:00:00.000Z",
        clientPhone: PHONE,
        ipAddress: "127.0.0.1",
        deviceType: "mobile",
        dayOfWeek: "السبت",
        hourOfDay: 13,
      },
    ];
    store.bookings = [{
      id: "booking-confirmed",
      contactRequestId: "request-confirmed",
      requestCode: "REQ-BOOKED",
      propertyNumber: "10002",
      propertyName: "Booked property",
      listedPriceOptionsHalalas: [100_000],
      customerSubject: "s".repeat(64),
      customerPhone: PHONE,
      ownerPhone: "598765432",
      followUpDueAt: "2026-09-19T11:00:00.000Z",
      createdAt: "2026-09-19T10:00:00.000Z",
      updatedAt: "2026-09-19T12:00:00.000Z",
      bookingStatus: "confirmed",
      bookingDecision: "yes",
      confirmationFacts: {
        timing: "weekend",
        bookingDate: { value: "2026-09-25", precision: "day" },
        pricePaidHalalas: 100_000,
      },
      confirmedAt: "2026-09-19T12:00:00.000Z",
      declinedAt: null,
    } as BookingFollowUpDocument];

    const history = await service.getHistory(PHONE);

    assert.equal(history.length, 2);
    assert.equal(history[0].id, "request-contact-only");
    assert.equal(history[0].bookingStatus, "contact_only");
    assert.equal(history[0].propertyName, null);
    assert.equal(history[1].id, "booking-confirmed");
    assert.equal(history[1].bookingStatus, "confirmed");
    assert.equal(history[1].questionnaire?.pricePaidHalalas, 100_000);
    assert.equal(JSON.stringify(history).includes(PHONE), false);
    assert.match(store.lastRequestLookup?.customerSubject || "", /^[a-f0-9]{64}$/);
  }));

test("unmatched same-subject workflows require explicit customer response evidence", () =>
  withSecret(async () => {
    const store = new MemoryCustomerAccountStore();
    const service = new CustomerAccountService(store, { now: () => NOW });
    const { customerSubject } = service.subjectForPhone(PHONE);
    const base = {
      propertyNumber: "10003",
      propertyName: "Legacy property",
      listedPriceOptionsHalalas: [90_000],
      customerSubject,
      customerPhone: PHONE,
      ownerPhone: "598765432",
      followUpDueAt: "2026-09-18T11:00:00.000Z",
      createdAt: "2026-09-18T10:00:00.000Z",
      updatedAt: "2026-09-18T10:00:00.000Z",
      declinedAt: null,
    };
    store.bookings = [
      {
        ...base,
        id: "booking-unmatched-awaiting",
        contactRequestId: "legacy-request-awaiting",
        requestCode: "REQ-LEGACY-AWAITING",
        bookingStatus: "awaiting_response",
        bookingDecision: null,
        confirmationFacts: null,
        confirmedAt: null,
      } as BookingFollowUpDocument,
      {
        ...base,
        id: "booking-unmatched-confirmed",
        contactRequestId: "legacy-request-confirmed",
        requestCode: "REQ-LEGACY-CONFIRMED",
        bookingStatus: "confirmed",
        bookingDecision: "yes",
        confirmationFacts: {
          timing: "weekend",
          bookingDate: { value: "2026-09-25", precision: "day" },
          pricePaidHalalas: 90_000,
        },
        confirmedAt: "2026-09-18T12:00:00.000Z",
        updatedAt: "2026-09-18T12:00:00.000Z",
      } as BookingFollowUpDocument,
    ];

    const history = await service.getHistory(PHONE);

    assert.deepEqual(history.map(({ id }) => id), [
      "booking-unmatched-confirmed",
    ]);
    assert.equal(history[0]?.bookingStatus, "confirmed");
    assert.equal(
      JSON.stringify(history).includes("REQ-LEGACY-AWAITING"),
      false,
    );
  }));
