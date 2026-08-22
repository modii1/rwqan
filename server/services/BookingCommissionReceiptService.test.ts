import assert from "node:assert/strict";
import test from "node:test";
import {
  BOOKING_COMMISSION_RECEIPT_MAX_BYTES,
  BookingCommissionReceiptError,
  detectBookingCommissionReceiptContentType,
  removeBookingCommissionReceipt,
  storeBookingCommissionReceipt,
} from "./BookingCommissionReceiptService";

function receiptFile(
  mimetype: string,
  buffer: Buffer,
): Express.Multer.File {
  return {
    fieldname: "receipt",
    originalname: "untrusted-name",
    encoding: "7bit",
    mimetype,
    buffer,
    size: buffer.length,
    destination: "",
    filename: "",
    path: "",
    stream: null as never,
  };
}

test("receipt detection accepts the four supported binary signatures", () => {
  assert.equal(
    detectBookingCommissionReceiptContentType(
      Buffer.from([0xff, 0xd8, 0xff, 0x00]),
    ),
    "image/jpeg",
  );
  assert.equal(
    detectBookingCommissionReceiptContentType(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    ),
    "image/png",
  );
  assert.equal(
    detectBookingCommissionReceiptContentType(
      Buffer.from("RIFF0000WEBP", "ascii"),
    ),
    "image/webp",
  );
  assert.equal(
    detectBookingCommissionReceiptContentType(Buffer.from("%PDF-1.7")),
    "application/pdf",
  );
  assert.equal(
    detectBookingCommissionReceiptContentType(Buffer.from("<html>not an image")),
    null,
  );
});

test("receipt storage rejects a MIME/signature mismatch before any upload", async () => {
  let sends = 0;
  await assert.rejects(
    () => storeBookingCommissionReceipt({
      bookingId: "BOOK-1",
      attemptId: "ATT-1",
      file: receiptFile("image/png", Buffer.from("%PDF-1.7")),
    }, {
      client: { send: async () => { sends += 1; return {} as never; } },
      bucket: "receipts",
      publicUrl: "https://receipts.example",
      randomSuffix: () => "random",
    }),
    (error: unknown) =>
      error instanceof BookingCommissionReceiptError &&
      error.code === "INVALID_RECEIPT_SIGNATURE" &&
      error.status === 415,
  );
  assert.equal(sends, 0);
});

test("receipt storage enforces the server-side size limit", async () => {
  await assert.rejects(
    () => storeBookingCommissionReceipt({
      bookingId: "BOOK-1",
      attemptId: "ATT-1",
      file: receiptFile(
        "image/jpeg",
        Buffer.alloc(BOOKING_COMMISSION_RECEIPT_MAX_BYTES + 1, 0xff),
      ),
    }, {
      client: { send: async () => ({} as never) },
      bucket: "receipts",
      publicUrl: "https://receipts.example",
      randomSuffix: () => "random",
    }),
    (error: unknown) =>
      error instanceof BookingCommissionReceiptError &&
      error.code === "RECEIPT_TOO_LARGE" &&
      error.status === 413,
  );
});

test("receipt storage ignores the client filename and uses an opaque random key", async () => {
  const commands: any[] = [];
  const stored = await storeBookingCommissionReceipt({
    bookingId: "BOOK/../../sensitive",
    attemptId: "ATT/../../sensitive",
    file: receiptFile(
      "image/png",
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]),
    ),
  }, {
    client: { send: async (command: unknown) => {
      commands.push(command);
      return {} as never;
    } },
    bucket: "receipts",
    publicUrl: "https://receipts.example/",
    randomSuffix: () => "fixed-random-suffix",
  });

  assert.match(
    stored.objectKey,
    /^booking-commission-receipts\/[a-f0-9]{24}\/[a-f0-9]{24}-fixed-random-suffix\.png$/,
  );
  assert.equal(stored.objectKey.includes("sensitive"), false);
  assert.equal(stored.url, `https://receipts.example/${stored.objectKey}`);
  assert.equal(stored.contentType, "image/png");
  assert.equal(stored.sizeBytes, 9);
  assert.equal(commands.length, 1);
  assert.equal(commands[0].input.Bucket, "receipts");
  assert.equal(commands[0].input.Key, stored.objectKey);
  assert.equal(commands[0].input.ContentType, "image/png");

  assert.equal(await removeBookingCommissionReceipt(stored.objectKey, {
    client: { send: async (command: unknown) => {
      commands.push(command);
      return {} as never;
    } },
    bucket: "receipts",
  }), true);
  assert.equal(commands[1].input.Key, stored.objectKey);
});
