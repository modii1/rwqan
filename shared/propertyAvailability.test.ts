import assert from "node:assert/strict";
import test from "node:test";
import {
  getActiveCommissionHoldVersion,
  getActiveCommissionHoldObligationIds,
  hasActiveAdminAvailabilityHold,
  hasActiveCommissionHold,
  hasActivePropertyHold,
  hasUnreleasedCommissionHold,
} from "./propertyAvailability";

test("only an explicit active commission hold blocks a property", () => {
  assert.equal(hasActiveCommissionHold({
    commissionHold: { active: true, obligationIds: ["BOOK-1"] },
  }), true);

  for (const property of [
    undefined,
    null,
    false,
    0,
    "property",
    {},
    { commissionHold: null },
    { commissionHold: {} },
    { commissionHold: { active: false, obligationIds: ["BOOK-1"] } },
    { commissionHold: { active: "true", obligationIds: ["BOOK-1"] } },
    { commissionHold: { active: 1, obligationIds: ["BOOK-1"] } },
    { commissionHold: { obligationIds: ["BOOK-1"] } },
  ]) {
    assert.equal(hasActiveCommissionHold(property), false);
  }
});

test("the active marker is sufficient even while obligation metadata is absent", () => {
  assert.equal(hasActiveCommissionHold({ commissionHold: { active: true } }), true);
  assert.equal(hasActiveCommissionHold({
    commissionHold: { active: true, obligationIds: "legacy-value" },
  }), true);
});

test("financial hold state remains raw while availability can be overridden", () => {
  const property = {
    commissionHold: {
      active: true,
      obligationIds: ["BOOK-1"],
      updatedAt: "2026-08-02T00:00:00.000Z",
    },
    commissionHoldOverride: { obligationIds: ["BOOK-1"] },
  };
  assert.equal(hasUnreleasedCommissionHold(property), true);
  assert.equal(hasActiveCommissionHold(property), false);
  assert.equal(
    getActiveCommissionHoldVersion(property),
    "timestamp:2026-08-02T00:00:00.000Z",
  );
  assert.equal(getActiveCommissionHoldVersion({
    commissionHold: { active: true, obligationIds: ["BOOK-B", "BOOK-A"] },
  }), 'legacy:["BOOK-A","BOOK-B"]');
});

test("a legacy empty commission hold override applies only to its exact fingerprint", () => {
  const property = {
    commissionHold: {
      active: true,
      obligationIds: [],
      appliedAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-08-02T00:00:00.000Z",
    },
    commissionHoldOverride: {
      emptyHoldFingerprint: "2026-08-02T00:00:00.000Z",
    },
  };

  assert.equal(hasActiveCommissionHold(property), false);
  assert.equal(hasActiveCommissionHold({
    ...property,
    commissionHoldOverride: {
      emptyHoldFingerprint: "2026-08-01T00:00:00.000Z",
    },
  }), true);
  assert.equal(hasActiveCommissionHold({
    ...property,
    commissionHold: {
      ...property.commissionHold,
      updatedAt: "2026-08-03T00:00:00.000Z",
    },
  }), true);
});

test("a commission override releases only the listed current obligations", () => {
  const property = {
    commissionHold: {
      active: true,
      obligationIds: ["BOOK-1", "BOOK-2", "BOOK-2"],
    },
    commissionHoldOverride: {
      obligationIds: ["BOOK-1", "BOOK-2"],
    },
  };

  assert.equal(hasActiveCommissionHold(property), false);
  assert.deepEqual(getActiveCommissionHoldObligationIds(property), []);

  const partiallyOverridden = {
    ...property,
    commissionHoldOverride: { obligationIds: ["BOOK-1"] },
  };
  assert.equal(hasActiveCommissionHold(partiallyOverridden), true);
  assert.deepEqual(
    getActiveCommissionHoldObligationIds(partiallyOverridden),
    ["BOOK-2"],
  );
});

test("a future commission obligation is not covered by an earlier override", () => {
  const overriddenProperty = {
    commissionHold: { active: true, obligationIds: ["BOOK-1"] },
    commissionHoldOverride: { obligationIds: ["BOOK-1"] },
  };
  assert.equal(hasActiveCommissionHold(overriddenProperty), false);

  const propertyWithNewObligation = {
    ...overriddenProperty,
    commissionHold: {
      active: true,
      obligationIds: ["BOOK-1", "BOOK-NEW"],
    },
  };
  assert.equal(hasActiveCommissionHold(propertyWithNewObligation), true);
  assert.deepEqual(
    getActiveCommissionHoldObligationIds(propertyWithNewObligation),
    ["BOOK-NEW"],
  );
});

test("only an explicit active admin availability hold is manual", () => {
  assert.equal(hasActiveAdminAvailabilityHold({
    adminAvailabilityHold: { active: true },
  }), true);

  for (const property of [
    undefined,
    null,
    {},
    { adminAvailabilityHold: null },
    { adminAvailabilityHold: {} },
    { adminAvailabilityHold: { active: false } },
    { adminAvailabilityHold: { active: "true" } },
    { adminAvailabilityHold: { active: 1 } },
  ]) {
    assert.equal(hasActiveAdminAvailabilityHold(property), false);
  }
});

test("the combined property hold remains active while either hold reason remains", () => {
  const overriddenCommission = {
    commissionHold: { active: true, obligationIds: ["BOOK-1"] },
    commissionHoldOverride: { obligationIds: ["BOOK-1"] },
  };
  assert.equal(hasActivePropertyHold(overriddenCommission), false);

  assert.equal(hasActivePropertyHold({
    ...overriddenCommission,
    adminAvailabilityHold: { active: true },
  }), true);

  assert.equal(hasActivePropertyHold({
    adminAvailabilityHold: { active: false },
    commissionHold: { active: true, obligationIds: ["BOOK-2"] },
  }), true);

  assert.equal(hasActivePropertyHold({
    adminAvailabilityHold: { active: true },
    commissionHold: { active: true, obligationIds: ["BOOK-2"] },
  }), true);
});
