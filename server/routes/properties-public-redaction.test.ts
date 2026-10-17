import assert from "node:assert/strict";
import test from "node:test";
import {
  createPublicFreeCommissionConsent,
  createPublicRegistrationPlan,
} from "../../shared/freeCommissionConsent";
import { toPublicProperty } from "./properties";

test("public property DTOs redact free-plan registration and consent evidence", () => {
  const acceptedAt = "2026-08-24T10:00:00.000Z";
  const publicProperty = toPublicProperty({
    propertyNumber: "PROP-1",
    name: "Property",
    pin: "1234",
    whatsappNumber: "966500000000",
    facilities: ["pool"],
    registrationPlan: createPublicRegistrationPlan({
      packageId: "pkg-free",
      isFree: true,
      selectedAt: acceptedAt,
    }),
    freeCommissionConsent: createPublicFreeCommissionConsent({
      packageId: "pkg-free",
      acceptedAt,
    }),
  });

  assert.equal("pin" in publicProperty, false);
  assert.equal("whatsappNumber" in publicProperty, false);
  assert.equal("registrationPlan" in publicProperty, false);
  assert.equal("freeCommissionConsent" in publicProperty, false);
  assert.deepEqual(publicProperty.facilities, ["pool"]);
});
