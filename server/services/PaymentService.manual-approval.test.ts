import assert from "node:assert/strict";
import test from "node:test";

import { firebaseService } from "../firebaseService";
import { paymentService } from "./PaymentService";

test("manual admin confirmation records the decision source explicitly", async () => {
  const originalGet = firebaseService.getPaymentById;
  const originalUpdate = firebaseService.updatePayment;
  let patch: Record<string, unknown> | null = null;

  (firebaseService as any).getPaymentById = async () => ({
    id: "PAY-MANUAL-1",
    propertyNumber: "PROP-1",
    packageId: "pkg-1",
    status: "قيد المراجعة",
    amount: 100,
    finalAmount: 100,
    paymentMethod: "تحويل بنكي",
  });
  (firebaseService as any).updatePayment = async (
    _id: string,
    updates: Record<string, unknown>,
  ) => {
    patch = updates;
    return { id: "PAY-MANUAL-1", ...updates };
  };

  try {
    await paymentService.confirmManually("PAY-MANUAL-1");
    assert.ok(patch);
    assert.equal((patch as any).status, "مكتمل");
    assert.equal((patch as any).approvalSource, "admin_manual");
    assert.ok((patch as any).approvedByAdminAt);
  } finally {
    (firebaseService as any).getPaymentById = originalGet;
    (firebaseService as any).updatePayment = originalUpdate;
  }
});
