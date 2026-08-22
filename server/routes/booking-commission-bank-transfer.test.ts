import assert from "node:assert/strict";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";
import bookingRoutes from "./bookings";
import { firebaseService } from "../firebaseService";
import { bookingCommissionService } from "../services/BookingCommissionService";
import {
  BOOKING_COMMISSION_RECEIPT_MAX_BYTES,
  BookingCommissionReceiptError,
  detectBookingCommissionReceiptContentType,
} from "../services/BookingCommissionReceiptService";

function formWithFile(
  bytes: BlobPart,
  type: string,
  filename = "receipt",
): FormData {
  const form = new FormData();
  form.append("receipt", new Blob([bytes], { type }), filename);
  return form;
}

test("token-scoped bank receipt route validates origin, rate limit, multipart bounds, and file signature", async () => {
  const originals = {
    rateLimit: firebaseService.consumeContactRequestAttemptLimit,
    submit: bookingCommissionService.submitBankTransfer,
  };
  let rateLimited = false;
  let rateCalls = 0;
  const submitted: Array<{ token: string; size: number; mimetype: string }> = [];
  (firebaseService as any).consumeContactRequestAttemptLimit = async () => {
    rateCalls += 1;
    return rateLimited
      ? { allowed: false, retryAfterMs: 60_000 }
      : { allowed: true, retryAfterMs: 0 };
  };
  (bookingCommissionService as any).submitBankTransfer = async (
    token: string,
    file: Express.Multer.File | undefined,
  ) => {
    if (!file) {
      throw new BookingCommissionReceiptError(
        "RECEIPT_REQUIRED",
        "الإيصال مطلوب.",
        400,
      );
    }
    const detected = detectBookingCommissionReceiptContentType(file.buffer);
    if (!detected || detected !== file.mimetype) {
      throw new BookingCommissionReceiptError(
        "INVALID_RECEIPT_SIGNATURE",
        "محتوى الإيصال لا يطابق صيغة الملف.",
        415,
      );
    }
    submitted.push({ token, size: file.size, mimetype: file.mimetype });
    return {
      status: "pending_review",
      attemptId: "ATT-HTTP-1",
      receiptSubmittedAt: "2026-08-22T12:00:00.000Z",
    };
  };

  const app = express();
  app.use(bookingRoutes);
  let server: Server | undefined;
  try {
    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      server!.once("listening", resolve);
      server!.once("error", reject);
    });
    const { port } = server.address() as AddressInfo;
    const endpoint = `http://127.0.0.1:${port}/api/booking-commissions/OWNER-TOKEN/bank-transfer`;
    const sameOriginHeaders = { "sec-fetch-site": "same-origin" };

    const crossSite = await fetch(endpoint, {
      method: "POST",
      headers: { "sec-fetch-site": "cross-site" },
      body: formWithFile(
        Buffer.alloc(BOOKING_COMMISSION_RECEIPT_MAX_BYTES + 1, 0xff),
        "image/jpeg",
        "oversized.jpg",
      ),
    });
    assert.equal(crossSite.status, 403);
    assert.equal(rateCalls, 0, "origin rejection happens before rate limiting and multipart parsing");

    rateLimited = true;
    const limited = await fetch(endpoint, {
      method: "POST",
      headers: sameOriginHeaders,
      body: formWithFile(
        Buffer.alloc(BOOKING_COMMISSION_RECEIPT_MAX_BYTES + 1, 0xff),
        "image/jpeg",
        "oversized.jpg",
      ),
    });
    assert.equal(limited.status, 429);
    assert.equal(limited.headers.get("retry-after"), "60");
    assert.equal(submitted.length, 0);

    rateLimited = false;
    const missing = await fetch(endpoint, {
      method: "POST",
      headers: sameOriginHeaders,
      body: new FormData(),
    });
    assert.equal(missing.status, 400);
    assert.equal((await missing.json()).code, "RECEIPT_REQUIRED");

    const unsupported = await fetch(endpoint, {
      method: "POST",
      headers: sameOriginHeaders,
      body: formWithFile("plain text", "text/plain", "receipt.txt"),
    });
    assert.equal(unsupported.status, 415);
    assert.equal((await unsupported.json()).code, "INVALID_RECEIPT_TYPE");

    const oversized = await fetch(endpoint, {
      method: "POST",
      headers: sameOriginHeaders,
      body: formWithFile(
        Buffer.alloc(BOOKING_COMMISSION_RECEIPT_MAX_BYTES + 1, 0xff),
        "image/jpeg",
        "oversized.jpg",
      ),
    });
    assert.equal(oversized.status, 413);
    assert.equal((await oversized.json()).code, "RECEIPT_TOO_LARGE");

    const signatureMismatch = await fetch(endpoint, {
      method: "POST",
      headers: sameOriginHeaders,
      body: formWithFile("<html>not a jpeg</html>", "image/jpeg", "receipt.jpg"),
    });
    const signatureMismatchBody = await signatureMismatch.json();
    assert.equal(
      signatureMismatch.status,
      415,
      JSON.stringify(signatureMismatchBody),
    );
    assert.equal(signatureMismatchBody.code, "INVALID_RECEIPT_SIGNATURE");

    const validPng = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01,
    ]);
    const valid = await fetch(endpoint, {
      method: "POST",
      headers: sameOriginHeaders,
      body: formWithFile(validPng, "image/png", "receipt.png"),
    });
    assert.equal(valid.status, 200);
    assert.deepEqual(await valid.json(), {
      status: "pending_review",
      attemptId: "ATT-HTTP-1",
      receiptSubmittedAt: "2026-08-22T12:00:00.000Z",
    });
    assert.deepEqual(submitted, [{
      token: "OWNER-TOKEN",
      size: validPng.length,
      mimetype: "image/png",
    }]);
    assert.match(valid.headers.get("cache-control") || "", /no-store/);
  } finally {
    (firebaseService as any).consumeContactRequestAttemptLimit = originals.rateLimit;
    (bookingCommissionService as any).submitBankTransfer = originals.submit;
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => {
        server!.close((error?: Error) => (error ? reject(error) : resolve()));
      });
    }
  }
});
