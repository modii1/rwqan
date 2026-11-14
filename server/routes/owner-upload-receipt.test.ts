import assert from "node:assert/strict";
import test from "node:test";
import express from "express";

import "../config/loadEnv";
import ownerRouter from "./owner";

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function withOwnerSession(
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = { propertyNumber: "90001" };
    next();
  });
  app.use(ownerRouter);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("the payments history exposes a receipt state for every payment", async () => {
  await withOwnerSession(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/owner/payments`);
    assert.equal(response.status, 200);
    const rows = (await response.json()) as any[];
    assert.ok(Array.isArray(rows));
    assert.ok(rows.length > 0, "expected at least one payment");
    for (const row of rows) {
      assert.equal(typeof row.hasReceipt, "boolean");
      assert.ok(
        Object.prototype.hasOwnProperty.call(row, "receiptScanStatus"),
        "receiptScanStatus must be present",
      );
      if (!row.hasReceipt) {
        assert.equal(row.receiptUrl, undefined);
      } else {
        assert.equal(typeof row.receiptUrl, "string");
      }
    }
  });
});

test("the upload route validates the request without creating or changing anything", async () => {
  await withOwnerSession(async (baseUrl) => {
    const missingFile = new FormData();
    missingFile.append("paymentId", "PAY-DOES-NOT-EXIST");
    const noFileResponse = await fetch(
      `${baseUrl}/api/owner/payment/upload-receipt`,
      { method: "POST", body: missingFile },
    );
    assert.equal(noFileResponse.status, 400);

    const form = new FormData();
    form.append("paymentId", "PAY-DOES-NOT-EXIST");
    form.append("receipt", new Blob([TINY_PNG], { type: "image/png" }), "tiny.png");
    const unknownPaymentResponse = await fetch(
      `${baseUrl}/api/owner/payment/upload-receipt`,
      { method: "POST", body: form },
    );
    assert.equal(unknownPaymentResponse.status, 404);
  });
});
