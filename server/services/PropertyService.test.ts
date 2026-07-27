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
