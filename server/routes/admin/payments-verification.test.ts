import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";

import { firebaseService } from "../../firebaseService";
import paymentsRouter from "./payments";

test("admins can read the full receipt verification record", async (t) => {
  const original = firebaseService.getReceiptVerification;
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
  const endpoint = (paymentId: string) =>
    `http://127.0.0.1:${port}/api/admin/payments/${paymentId}/verification`;

  try {
    await t.test("returns the extracted fields and decision reasons", async () => {
      (firebaseService as any).getReceiptVerification = async () => ({
        paymentId: "PAY-VERIFY-1",
        recommendation: "مراجعة_يدوية",
        confidence: 72,
        amountMatch: true,
        currencyMatch: true,
        beneficiaryMatch: false,
        ibanMatch: false,
        referenceMatch: true,
        dateMatch: true,
        autoActivationAllowed: false,
        blockers: ["اسم المستفيد غير مطابق", "IBAN المستفيد غير مطابق"],
        reasons: ["المبلغ مطابق", "العملة مطابقة"],
        extractedAmount: 150,
        extractedBeneficiaryName: "شخص آخر",
        receiptHash: "a".repeat(64),
        decisionSource: "ai",
        model: "gemini-2.5-flash",
      });

      const response = await fetch(endpoint("PAY-VERIFY-1"));
      const payload = await response.json();
      assert.equal(response.status, 200);
      assert.equal(payload.paymentId, "PAY-VERIFY-1");
      assert.equal(payload.autoActivationAllowed, false);
      assert.deepEqual(payload.blockers, [
        "اسم المستفيد غير مطابق",
        "IBAN المستفيد غير مطابق",
      ]);
      assert.equal(payload.receiptHash, "a".repeat(64));
    });

    await t.test("returns 404 when no scan record exists", async () => {
      (firebaseService as any).getReceiptVerification = async () => null;
      const response = await fetch(endpoint("PAY-NONE"));
      assert.equal(response.status, 404);
    });

    await t.test("never leaks secrets on a lookup failure", async () => {
      (firebaseService as any).getReceiptVerification = async () => {
        throw new Error("GEMINI_API_KEY=super-secret-value");
      };
      const response = await fetch(endpoint("PAY-FAIL"));
      const payload = await response.json();
      assert.equal(response.status, 500);
      assert.ok(!JSON.stringify(payload).includes("super-secret-value"));
    });
  } finally {
    (firebaseService as any).getReceiptVerification = original;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
