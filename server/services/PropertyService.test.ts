import assert from "node:assert/strict";
import test from "node:test";

import { firebaseService } from "../firebaseService";
import { PropertyService } from "./PropertyService";

test("ordinary property edits do not replay an existing verification status", async () => {
  const originalGetProperty = firebaseService.getPropertyByNumber;
  const originalUpdateProperty = firebaseService.updateProperty;
  const persistedUpdates: Array<Record<string, unknown>> = [];

  (firebaseService as any).getPropertyByNumber = async () => ({
    propertyNumber: "P-EDIT",
    name: "Before",
    verificationStatus: "approved",
  });
  (firebaseService as any).updateProperty = async (
    propertyNumber: string,
    updates: Record<string, unknown>,
  ) => {
    persistedUpdates.push(updates);
    return {
      propertyNumber,
      name: "Before",
      verificationStatus: "approved",
      ...updates,
    };
  };

  try {
    const updated = await new PropertyService().update(
      "P-EDIT",
      { name: "After" },
      { skipVerification: true },
    );

    assert.equal(updated.name, "After");
    assert.equal(persistedUpdates[0]?.name, "After");
    assert.equal("verificationStatus" in (persistedUpdates[0] || {}), false);
  } finally {
    firebaseService.getPropertyByNumber = originalGetProperty;
    firebaseService.updateProperty = originalUpdateProperty;
  }
});

test("property writes remove contradictory no-pool data when a pool is selected", async () => {
  const originalGetProperty = firebaseService.getPropertyByNumber;
  const originalUpdateProperty = firebaseService.updateProperty;
  let persistedFacilities: unknown;

  (firebaseService as any).getPropertyByNumber = async () => ({
    propertyNumber: "P-POOL",
    facilities: [],
  });
  (firebaseService as any).updateProperty = async (
    propertyNumber: string,
    updates: Record<string, unknown>,
  ) => {
    persistedFacilities = updates.facilities;
    return { propertyNumber, ...updates };
  };

  try {
    const indoorPool = "\u0645\u0633\u0628\u062d \u062f\u0627\u062e\u0644\u064a";
    const noPool = "\u0628\u062f\u0648\u0646 \u0645\u0633\u0628\u062d";
    await new PropertyService().update(
      "P-POOL",
      { facilities: [indoorPool, noPool] },
      { skipVerification: true },
    );
    assert.deepEqual(persistedFacilities, [indoorPool]);
  } finally {
    firebaseService.getPropertyByNumber = originalGetProperty;
    firebaseService.updateProperty = originalUpdateProperty;
  }
});

test("generic property edits cannot mutate top-level or dotted availability or commission holds", async () => {
  const originalGetProperty = firebaseService.getPropertyByNumber;
  const originalUpdateProperty = firebaseService.updateProperty;
  let persistedUpdates: Record<string, unknown> = {};

  (firebaseService as any).getPropertyByNumber = async () => ({
    propertyNumber: "P-HOLD",
    name: "Before",
  });
  (firebaseService as any).updateProperty = async (
    propertyNumber: string,
    updates: Record<string, unknown>,
  ) => {
    persistedUpdates = updates;
    return { propertyNumber, ...updates };
  };

  try {
    await new PropertyService().update(
      "P-HOLD",
      {
        name: "After",
        commissionHold: {
          active: false,
          obligationIds: [],
          updatedAt: new Date().toISOString(),
        },
        adminAvailabilityHold: {
          active: false,
          appliedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          appliedBy: "admin",
        },
        commissionHoldOverride: {
          obligationIds: ["BOOK-1"],
          appliedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          appliedBy: "admin",
        },
        "commissionHold.active": false,
        "commissionHold.obligationIds": [],
        "adminAvailabilityHold.active": false,
        "adminAvailabilityHold.appliedBy": "attacker",
        "commissionHoldOverride.obligationIds": ["BOOK-2"],
        "commissionHoldOverride.appliedBy": "attacker",
      } as any,
      { skipVerification: true },
    );

    assert.equal(persistedUpdates.name, "After");
    for (const protectedKey of [
      "commissionHold",
      "adminAvailabilityHold",
      "commissionHoldOverride",
      "commissionHold.active",
      "commissionHold.obligationIds",
      "adminAvailabilityHold.active",
      "adminAvailabilityHold.appliedBy",
      "commissionHoldOverride.obligationIds",
      "commissionHoldOverride.appliedBy",
    ]) {
      assert.equal(protectedKey in persistedUpdates, false, protectedKey);
    }
  } finally {
    firebaseService.getPropertyByNumber = originalGetProperty;
    firebaseService.updateProperty = originalUpdateProperty;
  }
});
