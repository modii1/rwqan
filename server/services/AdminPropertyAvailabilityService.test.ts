import assert from "node:assert/strict";
import test from "node:test";

import type { Property, Subscription } from "../../shared/schema";
import {
  buildAdminPropertyAvailabilityDashboard,
  isAdminFreePropertyCandidate,
} from "./AdminPropertyAvailabilityService";

function property(
  propertyNumber: string,
  overrides: Partial<Property> = {},
): Property {
  return {
    propertyNumber,
    name: `Property ${propertyNumber}`,
    whatsappNumber: "0500000001",
    city: "بريدة",
    direction: "شمال",
    type: "قسم",
    facilities: [],
    prices: {
      weekday: "100",
      weekend: "120",
      overnight: "140",
      holidays: "160",
    },
    subscriptionType: "عادي",
    verificationStatus: "approved",
    imageUrls: [],
    ...overrides,
  };
}

function subscription(
  propertyNumber: string,
  overrides: Partial<Subscription> = {},
): Subscription {
  return {
    id: `SUB-${propertyNumber}`,
    propertyNumber,
    packageId: "pkg-normal",
    startDate: "2026-08-01T00:00:00.000Z",
    endDate: "2099-12-31T23:59:59.999Z",
    status: "ساري",
    subscriptionType: "عادي",
    ...overrides,
  };
}

test("dashboard aggregates manual, commission, and combined property holds", () => {
  const dashboard = buildAdminPropertyAvailabilityDashboard([
    property("300", {
      name: "Manual hold",
      adminAvailabilityHold: {
        active: true,
        appliedAt: "2026-08-02T00:00:00.000Z",
        updatedAt: "2026-08-02T00:00:00.000Z",
        appliedBy: "admin",
      },
    }),
    property("100", {
      name: "Commission hold",
      commissionHold: {
        active: true,
        obligationIds: ["BOOK-100"],
        appliedAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
      },
    }),
    property("200", {
      name: "Combined hold",
      adminAvailabilityHold: {
        active: true,
        appliedAt: "2026-08-01T00:00:00.000Z",
        updatedAt: "2026-08-01T00:00:00.000Z",
        appliedBy: "admin",
      },
      commissionHold: {
        active: true,
        obligationIds: ["BOOK-200-A", "BOOK-200-B"],
        appliedAt: "2026-08-03T00:00:00.000Z",
        updatedAt: "2026-08-03T00:00:00.000Z",
      },
    }),
    property("400", { name: "Available free property" }),
  ], []);

  assert.deepEqual(
    dashboard.holds.map((hold) => ({
      propertyNumber: hold.propertyNumber,
      kind: hold.kind,
      suspendedAt: hold.suspendedAt,
      manualHold: hold.manualHold,
      commissionHold: hold.commissionHold,
      commissionObligationCount: hold.commissionObligationCount,
      commissionHoldVersion: hold.commissionHoldVersion,
    })),
    [
      {
        propertyNumber: "200",
        kind: "manual_and_commission",
        suspendedAt: "2026-08-03T00:00:00.000Z",
        manualHold: true,
        commissionHold: true,
        commissionObligationCount: 2,
        commissionHoldVersion: "timestamp:2026-08-03T00:00:00.000Z",
      },
      {
        propertyNumber: "300",
        kind: "manual",
        suspendedAt: "2026-08-02T00:00:00.000Z",
        manualHold: true,
        commissionHold: false,
        commissionObligationCount: 0,
        commissionHoldVersion: null,
      },
      {
        propertyNumber: "100",
        kind: "commission",
        suspendedAt: "2026-08-01T00:00:00.000Z",
        manualHold: false,
        commissionHold: true,
        commissionObligationCount: 1,
        commissionHoldVersion: "timestamp:2026-08-01T00:00:00.000Z",
      },
    ],
  );
  assert.deepEqual(dashboard.candidates, [{
    propertyNumber: "400",
    name: "Available free property",
  }]);
});

test("dashboard deduplicates commission obligations before reporting the count", () => {
  const dashboard = buildAdminPropertyAvailabilityDashboard([
    property("101", {
      commissionHold: {
        active: true,
        obligationIds: ["BOOK-A", "BOOK-A", "BOOK-B", "BOOK-C"],
        appliedAt: "2026-08-04T00:00:00.000Z",
        updatedAt: "2026-08-04T00:00:00.000Z",
      },
      commissionHoldOverride: {
        obligationIds: ["BOOK-B", "BOOK-B"],
        appliedAt: "2026-08-05T00:00:00.000Z",
        updatedAt: "2026-08-05T00:00:00.000Z",
        appliedBy: "admin",
      },
    }),
  ], []);

  assert.equal(dashboard.holds.length, 1);
  assert.equal(dashboard.holds[0]?.commissionObligationCount, 2);
});

test("candidate eligibility accepts approved free properties and rejects unapproved properties", () => {
  assert.equal(isAdminFreePropertyCandidate(property("201"), undefined), true);
  assert.equal(isAdminFreePropertyCandidate(
    property("202", { verificationStatus: "verified" }),
    subscription("202"),
  ), true);
  assert.equal(isAdminFreePropertyCandidate(
    property("203", { verificationStatus: undefined }),
    subscription("203"),
  ), true);
  assert.equal(isAdminFreePropertyCandidate(
    property("204", { verificationStatus: "pending" }),
    undefined,
  ), false);
  assert.equal(isAdminFreePropertyCandidate(
    property("205", { verificationStatus: "rejected" }),
    undefined,
  ), false);
});

test("active premium properties are excluded from free-property candidates", () => {
  const premiumSubscription = subscription("301", {
    packageId: "pkg-premium",
    subscriptionType: "مميز",
    packageType: "مميز",
    status: "ساري",
  });

  assert.equal(
    isAdminFreePropertyCandidate(property("301"), premiumSubscription),
    false,
  );
  assert.deepEqual(
    buildAdminPropertyAvailabilityDashboard(
      [property("301")],
      [premiumSubscription],
    ).candidates,
    [],
  );
});

test("temporarily suspended subscriptions are excluded from free-property candidates", () => {
  const suspendedSubscription = subscription("401", {
    status: "موقوف مؤقتاً",
    suspendedAt: "2026-08-20T00:00:00.000Z",
    remainingDurationMs: 86_400_000,
  });

  assert.equal(
    isAdminFreePropertyCandidate(property("401"), suspendedSubscription),
    false,
  );
  assert.deepEqual(
    buildAdminPropertyAvailabilityDashboard(
      [property("401")],
      [suspendedSubscription],
    ).candidates,
    [],
  );
});

test("dashboard DTOs expose only the sanitized availability summary", () => {
  const dashboard = buildAdminPropertyAvailabilityDashboard([
    property("501", {
      name: "Held property",
      pin: "1234",
      whatsappNumber: "0599999999",
      commissionHold: {
        active: true,
        obligationIds: ["SECRET-BOOKING-ID"],
        appliedAt: "2026-08-10T00:00:00.000Z",
        updatedAt: "2026-08-10T00:00:00.000Z",
      },
    }),
    property("502", {
      name: "Candidate property",
      pin: "5678",
      whatsappNumber: "0588888888",
    }),
  ], []);

  assert.deepEqual(Object.keys(dashboard.holds[0] || {}).sort(), [
    "commissionHold",
    "commissionHoldVersion",
    "commissionObligationCount",
    "kind",
    "manualHold",
    "name",
    "propertyNumber",
    "suspendedAt",
  ]);
  assert.deepEqual(Object.keys(dashboard.candidates[0] || {}).sort(), [
    "name",
    "propertyNumber",
  ]);

  const serialized = JSON.stringify(dashboard);
  for (const secret of [
    "0599999999",
    "0588888888",
    "1234",
    "5678",
    "SECRET-BOOKING-ID",
  ]) {
    assert.equal(serialized.includes(secret), false, secret);
  }
});
