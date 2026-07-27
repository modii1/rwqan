import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import express from "express";

import addonsRouter from "./addons";
import { firebaseService } from "../../firebaseService";
import { addOnService, paymentService } from "../../services";

test("admin add-on decisions use only the exact linked payment and fail closed for Paymob", async () => {
  const originals = {
    getAddon: firebaseService.getPropertyAddOnById,
    applyDecision: firebaseService.applyAdminPropertyAddOnDecision,
    getPayment: paymentService.getById,
    getAllPayments: paymentService.getAll,
    reconcile: paymentService.reconcilePaymobAddonIntention,
    getPackage: addOnService.getPackageById,
  };
  let addon: any;
  let payment: any;
  let reconciliation: any = { status: "paid", review: "pending" };
  let decisionResult: any = {
    status: "applied",
    addon: { id: "ADDON-1", status: "active" },
  };
  const reconciliations: string[] = [];
  const decisions: any[] = [];
  let broadPaymentReads = 0;

  (firebaseService as any).getPropertyAddOnById = async () => addon;
  (firebaseService as any).applyAdminPropertyAddOnDecision = async (
    params: any,
  ) => {
    decisions.push(params);
    return decisionResult;
  };
  (paymentService as any).getById = async (id: string) =>
    payment?.id === id ? payment : null;
  (paymentService as any).getAll = async () => {
    broadPaymentReads += 1;
    throw new Error("admin decision must never scan payments");
  };
  (paymentService as any).reconcilePaymobAddonIntention = async (
    id: string,
  ) => {
    reconciliations.push(id);
    return reconciliation;
  };
  (addOnService as any).getPackageById = async () => ({
    id: "PKG-1",
    durationDays: 7,
  });

  const app = express();
  app.use(express.json());
  app.use(addonsRouter);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const { port } = server.address() as AddressInfo;
  const baseUrl = `http://127.0.0.1:${port}`;
  const post = (action: "approve" | "reject") =>
    fetch(`${baseUrl}/api/admin/addons/${action}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ propertyAddOnId: addon?.id }),
    });

  try {
    addon = {
      id: "ADDON-1",
      propertyNumber: "PROP-1",
      addOnPackageId: "PKG-1",
      paymentId: "PAY-EXACT",
      source: "paymob",
      status: "pending",
    };
    payment = {
      id: "PAY-EXACT",
      propertyNumber: "PROP-1",
      packageId: "PKG-1",
      action: "addon",
      paymentMethod: "VISA",
      merchantAttemptKey: "ATTEMPT-1",
      paymentReference: "INT-1",
      transactionId: "TX-1",
      paymentCheckoutUrl: "https://checkout.example/1",
      paymobOrderId: "ORDER-1",
      intentionState: "created",
      status: "نجح - قيد التحقق",
      completedAt: "2026-07-27T10:00:00.000Z",
    };

    const approved = await post("approve");
    assert.equal(approved.status, 200);
    assert.deepEqual(reconciliations, ["PAY-EXACT"]);
    assert.equal(decisions.length, 1);
    assert.equal(decisions[0].paymentId, "PAY-EXACT");
    assert.equal(decisions[0].mode, "settled_paymob");
    assert.equal(decisions[0].decision, "approve");
    assert.equal(broadPaymentReads, 0);

    reconciliation = { status: "unpaid" };
    const writesBeforeUnpaid = decisions.length;
    const unpaidApproval = await post("approve");
    assert.equal(unpaidApproval.status, 409);
    assert.equal((await unpaidApproval.json()).code, "PAYMOB_PAYMENT_NOT_PAID");
    assert.equal(decisions.length, writesBeforeUnpaid);

    const unpaidRejection = await post("reject");
    assert.equal(unpaidRejection.status, 409);
    assert.equal((await unpaidRejection.json()).code, "PAYMOB_REJECTION_DEFERRED");
    assert.equal(decisions.length, writesBeforeUnpaid);

    reconciliation = { status: "already_processed" };
    const paidRejection = await post("reject");
    assert.equal(paidRejection.status, 409);
    assert.equal((await paidRejection.json()).code, "PAYMOB_PAYMENT_ALREADY_PAID");
    assert.equal(decisions.length, writesBeforeUnpaid);

    payment = { ...payment, packageId: "OTHER-PACKAGE" };
    const reconciliationsBeforeConflict = reconciliations.length;
    const linkConflict = await post("approve");
    assert.equal(linkConflict.status, 409);
    assert.equal(
      (await linkConflict.json()).code,
      "PAYMOB_PAYMENT_IDENTITY_MISMATCH",
    );
    assert.equal(reconciliations.length, reconciliationsBeforeConflict);
    assert.equal(decisions.length, writesBeforeUnpaid);

    payment = {
      ...payment,
      packageId: "PKG-1",
      paymentMethod: "تحويل بنكي",
      merchantAttemptKey: "ATTEMPT-STILL-PAYMOB",
    };
    reconciliation = { status: "identity_mismatch" };
    const mislabeledProvider = await post("approve");
    assert.equal(mislabeledProvider.status, 409);
    assert.equal(
      (await mislabeledProvider.json()).code,
      "PAYMOB_PAYMENT_IDENTITY_MISMATCH",
    );
    assert.equal(decisions.length, writesBeforeUnpaid);

    addon = { ...addon, source: "bank_transfer" };
    payment = {
      id: "PAY-EXACT",
      propertyNumber: "PROP-1",
      packageId: "PKG-1",
      action: "addon",
      paymentMethod: "تحويل بنكي",
      receiptUrl: "https://receipts.example/1.jpg",
      status: "قيد المراجعة",
    };
    const reconciliationsBeforeBank = reconciliations.length;
    const bankApproval = await post("approve");
    assert.equal(bankApproval.status, 200);
    assert.equal(reconciliations.length, reconciliationsBeforeBank);
    assert.equal(decisions.at(-1).mode, "bank_transfer");
    assert.equal(decisions.at(-1).paymentId, "PAY-EXACT");

    addon = {
      id: "ADDON-LEGACY",
      propertyNumber: "PROP-1",
      addOnPackageId: "PKG-1",
      source: "admin",
      status: "pending",
    };
    payment = null;
    const legacyRejection = await post("reject");
    assert.equal(legacyRejection.status, 200);
    assert.equal(decisions.at(-1).mode, "legacy_without_payment");
    assert.equal(decisions.at(-1).paymentId, undefined);

    addon = { ...addon, source: "paymob" };
    decisionResult = { status: "rejected", reason: "unsafe_legacy_state" };
    const unsafeIdentityFreePaymob = await post("reject");
    assert.equal(unsafeIdentityFreePaymob.status, 409);
    assert.equal(
      (await unsafeIdentityFreePaymob.json()).code,
      "PAYMOB_PAYMENT_NOT_RECONCILABLE",
    );
    assert.equal(broadPaymentReads, 0);
  } finally {
    (firebaseService as any).getPropertyAddOnById = originals.getAddon;
    (firebaseService as any).applyAdminPropertyAddOnDecision =
      originals.applyDecision;
    (paymentService as any).getById = originals.getPayment;
    (paymentService as any).getAll = originals.getAllPayments;
    (paymentService as any).reconcilePaymobAddonIntention = originals.reconcile;
    (addOnService as any).getPackageById = originals.getPackage;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});
