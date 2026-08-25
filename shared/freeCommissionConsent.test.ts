import assert from "node:assert/strict";
import test from "node:test";
import {
  FREE_COMMISSION_BASIS_POINTS,
  FREE_COMMISSION_CONSENT_SOURCE,
  FREE_COMMISSION_CONSENT_TEXT,
  FREE_COMMISSION_TERMS_VERSION,
  createPublicFreeCommissionConsent,
  createPublicRegistrationPlan,
  getForwardTrackedPublicRegistration,
  hasValidFreeCommissionConsent,
  isFreeSubscriptionPackage,
} from "./freeCommissionConsent";

test("free subscription packages are determined from canonical numeric price", () => {
  assert.equal(isFreeSubscriptionPackage({ price: 0 }), true);
  assert.equal(isFreeSubscriptionPackage({ price: "0" }), true);
  assert.equal(isFreeSubscriptionPackage({ price: -1 }), false);
  assert.equal(isFreeSubscriptionPackage({ price: 1 }), false);
  assert.equal(isFreeSubscriptionPackage({ price: null }), false);
  assert.equal(isFreeSubscriptionPackage({ price: "" }), false);
  assert.equal(isFreeSubscriptionPackage({ price: "   " }), false);
  assert.equal(isFreeSubscriptionPackage({ price: "invalid" }), false);
  assert.equal(isFreeSubscriptionPackage(undefined), false);
});

test("public free commission consent is versioned and bound to its package", () => {
  const acceptedAt = "2026-08-24T10:00:00.000Z";
  const registrationPlan = createPublicRegistrationPlan({
    packageId: "pkg-free",
    isFree: true,
    selectedAt: acceptedAt,
  });
  const freeCommissionConsent = createPublicFreeCommissionConsent({
    packageId: "pkg-free",
    acceptedAt,
  });
  const property = { registrationPlan, freeCommissionConsent };

  assert.deepEqual(registrationPlan, {
    packageId: "pkg-free",
    isFree: true,
    selectedAt: acceptedAt,
    source: FREE_COMMISSION_CONSENT_SOURCE,
  });
  assert.deepEqual(freeCommissionConsent, {
    accepted: true,
    acceptedAt,
    packageId: "pkg-free",
    commissionBasisPoints: FREE_COMMISSION_BASIS_POINTS,
    termsVersion: FREE_COMMISSION_TERMS_VERSION,
    source: FREE_COMMISSION_CONSENT_SOURCE,
    statement: FREE_COMMISSION_CONSENT_TEXT,
  });
  assert.deepEqual(getForwardTrackedPublicRegistration(property), registrationPlan);
  assert.equal(hasValidFreeCommissionConsent(property), true);
  assert.equal(hasValidFreeCommissionConsent({
    ...property,
    freeCommissionConsent: {
      ...freeCommissionConsent,
      packageId: "another-package",
    },
  }), false);
});

test("legacy and paid registrations do not masquerade as consented free plans", () => {
  const selectedAt = "2026-08-24T10:00:00.000Z";
  assert.equal(getForwardTrackedPublicRegistration({}), null);
  assert.equal(hasValidFreeCommissionConsent({}), false);
  assert.equal(hasValidFreeCommissionConsent({
    registrationPlan: createPublicRegistrationPlan({
      packageId: "pkg-paid",
      isFree: false,
      selectedAt,
    }),
  }), false);
});
