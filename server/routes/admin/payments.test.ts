import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import { AdminApprovalError } from "../../errors/AdminApprovalError";
import { paymentService } from "../../services";
import { PropertySuspendedError } from "../../services/propertySuspension";
import paymentsRouter from "./payments";

test("payment approval returns structured, safe admin errors", async (t) => {
  const originalApproveBankTransfer = paymentService.approveBankTransfer;
  const originalRejectBankTransfer = paymentService.rejectBankTransfer;
  const originalConfirmManually = paymentService.confirmManually;

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = { isAdmin: true };
    next();
  });
  app.use(paymentsRouter);

  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });
  const { port } = server.address() as AddressInfo;
  const endpoint = `http://127.0.0.1:${port}/api/admin/payment/approve`;
  const rejectEndpoint = `http://127.0.0.1:${port}/api/admin/payment/reject`;
  const confirmEndpoint = `http://127.0.0.1:${port}/api/admin/payments/payment-1/confirm`;

  const approve = (paymentId = "payment-1") =>
    fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paymentId }),
    });
  const rejectPayment = (body: Record<string, unknown>) =>
    fetch(rejectEndpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const confirmPayment = () =>
    fetch(confirmEndpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });

  try {
    await t.test("reports when a new property is queued instead of activated", async () => {
      (paymentService as any).approveBankTransfer = async () => ({
        outcome: "queued",
      });

      const response = await approve();
      const payload = await response.json();

      assert.equal(response.status, 200);
      assert.equal(payload.ok, true);
      assert.equal(payload.outcome, "queued");
      assert.match(payload.message, /بانتظار اعتماد الإدارة/);
    });

    await t.test("reports when an existing subscription is activated", async () => {
      (paymentService as any).approveBankTransfer = async () => ({
        outcome: "activated",
      });

      const response = await approve();
      const payload = await response.json();

      assert.equal(response.status, 200);
      assert.equal(payload.ok, true);
      assert.equal(payload.outcome, "activated");
      assert.match(payload.message, /تفعيل الاشتراك/);
    });

    await t.test("incomplete properties retain all validation details", async () => {
      (paymentService as any).approveBankTransfer = async () => {
        throw new AdminApprovalError({
          status: 422,
          code: "PROPERTY_INCOMPLETE",
          message: "Complete the required property data before approval.",
          missingFields: ["name", "images"],
          warnings: ["direction"],
        });
      };

      const response = await approve();
      assert.equal(response.status, 422);
      assert.deepEqual(await response.json(), {
        success: false,
        code: "PROPERTY_INCOMPLETE",
        message: "Complete the required property data before approval.",
        error: "Complete the required property data before approval.",
        missingFields: ["name", "images"],
        warnings: ["direction"],
      });
    });

    await t.test("an in-progress fulfillment receives a contextual conflict", async () => {
      (paymentService as any).approveBankTransfer = async () => {
        throw new Error("Payment fulfillment is already in progress");
      };

      const response = await approve();
      const payload = await response.json();

      assert.equal(response.status, 409);
      assert.equal(payload.success, false);
      assert.equal(payload.code, "PAYMENT_FULFILLMENT_IN_PROGRESS");
      assert.equal(typeof payload.message, "string");
      assert.equal(payload.message.length > 0, true);
      assert.equal(payload.error, payload.message);
    });

    await t.test("unexpected internal errors are not leaked", async () => {
      const internalDetail = "SECRET_FIREBASE_DOCUMENT_PATH";
      (paymentService as any).approveBankTransfer = async () => {
        throw new Error(internalDetail);
      };

      const response = await approve();
      const responseText = await response.text();
      const payload = JSON.parse(responseText);

      assert.equal(response.status, 500);
      assert.equal(payload.success, false);
      assert.equal(payload.code, "APPROVAL_FAILED");
      assert.equal(payload.message, payload.error);
      assert.equal(responseText.includes(internalDetail), false);
    });

    await t.test("a missing payment identifier is a structured client error", async () => {
      let serviceCalls = 0;
      (paymentService as any).approveBankTransfer = async () => {
        serviceCalls += 1;
      };

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      const payload = await response.json();

      assert.equal(response.status, 400);
      assert.equal(payload.success, false);
      assert.equal(payload.code, "PAYMENT_ID_REQUIRED");
      assert.equal(serviceCalls, 0);
    });

    await t.test("payment rejection preserves its exact partial failure", async () => {
      (paymentService as any).rejectBankTransfer = async () => {
        throw new AdminApprovalError({
          status: 500,
          code: "PAYMENT_REJECTION_FAILED",
          message: "Linked property PROP-2 could not be cancelled.",
          partial: true,
        });
      };

      const response = await rejectPayment({ paymentId: "payment-1" });
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), {
        success: false,
        code: "PAYMENT_REJECTION_FAILED",
        message: "Linked property PROP-2 could not be cancelled.",
        error: "Linked property PROP-2 could not be cancelled.",
        partial: true,
      });
    });

    await t.test("payment rejection requires an identifier before service work", async () => {
      let serviceCalls = 0;
      (paymentService as any).rejectBankTransfer = async () => {
        serviceCalls += 1;
      };

      const response = await rejectPayment({});
      const payload = await response.json();

      assert.equal(response.status, 400);
      assert.equal(payload.code, "PAYMENT_ID_REQUIRED");
      assert.equal(serviceCalls, 0);
    });

    await t.test("unexpected payment rejection errors stay private", async () => {
      const internalDetail = "SECRET_REJECTION_DOCUMENT_PATH";
      (paymentService as any).rejectBankTransfer = async () => {
        throw new Error(internalDetail);
      };

      const response = await rejectPayment({ paymentId: "payment-1" });
      const responseText = await response.text();
      const payload = JSON.parse(responseText);

      assert.equal(response.status, 500);
      assert.equal(payload.code, "APPROVAL_FAILED");
      assert.equal(responseText.includes(internalDetail), false);
    });

    await t.test("manual confirmation reports a suspended property as locked", async () => {
      (paymentService as any).confirmManually = async () => {
        throw new PropertySuspendedError();
      };

      const response = await confirmPayment();
      const payload = await response.json();

      assert.equal(response.status, 423);
      assert.equal(payload.success, false);
      assert.equal(payload.code, "PROPERTY_SUSPENDED");
      assert.equal(payload.message, payload.error);
      assert.match(payload.error, /موقوف مؤقتاً/);
    });
  } finally {
    paymentService.approveBankTransfer = originalApproveBankTransfer;
    paymentService.rejectBankTransfer = originalRejectBankTransfer;
    paymentService.confirmManually = originalConfirmManually;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
