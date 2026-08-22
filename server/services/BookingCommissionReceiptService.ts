import { createHash, randomBytes } from "node:crypto";
import {
  DeleteObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import type { NextFunction, Request, Response } from "express";
import multer from "multer";
import { R2_BUCKET, R2_PUBLIC_URL, r2 } from "../utils/r2";

export const BOOKING_COMMISSION_RECEIPT_MAX_BYTES = 5 * 1024 * 1024;

export type BookingCommissionReceiptContentType =
  | "image/jpeg"
  | "image/png"
  | "image/webp"
  | "application/pdf";

export type StoredBookingCommissionReceipt = {
  url: string;
  objectKey: string;
  contentType: BookingCommissionReceiptContentType;
  sizeBytes: number;
};

export class BookingCommissionReceiptError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "BookingCommissionReceiptError";
  }
}

const allowedClaimedTypes = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

const receiptUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: BOOKING_COMMISSION_RECEIPT_MAX_BYTES,
    files: 1,
    fields: 0,
    // Busboy emits partsLimit when the configured threshold is reached, so a
    // one-file form needs a threshold above its single part.
    parts: 2,
  },
  fileFilter: (_req, file, callback) => {
    if (!allowedClaimedTypes.has(String(file.mimetype || "").toLowerCase())) {
      callback(new BookingCommissionReceiptError(
        "INVALID_RECEIPT_TYPE",
        "صيغة الإيصال غير مدعومة.",
        415,
      ));
      return;
    }
    callback(null, true);
  },
});

function uploadErrorResponse(error: unknown): BookingCommissionReceiptError {
  if (error instanceof BookingCommissionReceiptError) return error;
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return new BookingCommissionReceiptError(
        "RECEIPT_TOO_LARGE",
        "حجم الإيصال يتجاوز الحد المسموح.",
        413,
      );
    }
    return new BookingCommissionReceiptError(
      "INVALID_RECEIPT_UPLOAD",
      "تعذر قراءة ملف الإيصال.",
      400,
    );
  }
  return new BookingCommissionReceiptError(
    "INVALID_RECEIPT_UPLOAD",
    "تعذر قراءة ملف الإيصال.",
    400,
  );
}

export function parseBookingCommissionReceipt(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  receiptUpload.single("receipt")(req, res, (error: unknown) => {
    if (!error) {
      next();
      return;
    }
    const mapped = uploadErrorResponse(error);
    res.status(mapped.status).json({ code: mapped.code, error: mapped.message });
  });
}

export function detectBookingCommissionReceiptContentType(
  buffer: Buffer,
): BookingCommissionReceiptContentType | null {
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) return "image/jpeg";
  if (
    buffer.length >= 8 &&
    buffer.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    )
  ) return "image/png";
  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) return "image/webp";
  if (
    buffer.length >= 5 &&
    buffer.subarray(0, 5).toString("ascii") === "%PDF-"
  ) return "application/pdf";
  return null;
}

function normalizedClaimedContentType(value: string): string {
  return value.toLowerCase() === "image/jpg"
    ? "image/jpeg"
    : value.toLowerCase();
}

function opaquePathSegment(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 24);
}

export type BookingCommissionReceiptStorageDependencies = {
  client: Pick<S3Client, "send"> | null;
  bucket: string | undefined;
  publicUrl: string;
  randomSuffix: () => string;
};

const defaultStorageDependencies: BookingCommissionReceiptStorageDependencies = {
  client: r2,
  bucket: R2_BUCKET,
  publicUrl: R2_PUBLIC_URL,
  randomSuffix: () => randomBytes(16).toString("hex"),
};

export async function storeBookingCommissionReceipt(
  input: {
    bookingId: string;
    attemptId: string;
    file: Express.Multer.File;
  },
  dependencies: BookingCommissionReceiptStorageDependencies =
    defaultStorageDependencies,
): Promise<StoredBookingCommissionReceipt> {
  if (
    !input.file?.buffer?.length ||
    input.file.buffer.length > BOOKING_COMMISSION_RECEIPT_MAX_BYTES
  ) {
    throw new BookingCommissionReceiptError(
      input.file?.buffer?.length ? "RECEIPT_TOO_LARGE" : "RECEIPT_REQUIRED",
      input.file?.buffer?.length
        ? "حجم الإيصال يتجاوز الحد المسموح."
        : "الإيصال مطلوب.",
      input.file?.buffer?.length ? 413 : 400,
    );
  }

  const detectedType = detectBookingCommissionReceiptContentType(
    input.file.buffer,
  );
  if (
    !detectedType ||
    detectedType !== normalizedClaimedContentType(input.file.mimetype)
  ) {
    throw new BookingCommissionReceiptError(
      "INVALID_RECEIPT_SIGNATURE",
      "محتوى الإيصال لا يطابق صيغة الملف.",
      415,
    );
  }

  const { client, bucket, publicUrl } = dependencies;
  if (!client || !bucket || !/^https?:\/\//i.test(publicUrl)) {
    throw new BookingCommissionReceiptError(
      "RECEIPT_STORAGE_UNAVAILABLE",
      "خدمة رفع الإيصالات غير متاحة حالياً.",
      503,
    );
  }

  const extension = detectedType === "application/pdf"
    ? "pdf"
    : detectedType === "image/png"
      ? "png"
      : detectedType === "image/webp"
        ? "webp"
        : "jpg";
  const objectKey = [
    "booking-commission-receipts",
    opaquePathSegment(input.bookingId),
    `${opaquePathSegment(input.attemptId)}-${dependencies.randomSuffix()}.${extension}`,
  ].join("/");

  await client.send(new PutObjectCommand({
    Bucket: bucket,
    Key: objectKey,
    Body: input.file.buffer,
    ContentType: detectedType,
  }));

  return {
    url: `${publicUrl.replace(/\/+$/, "")}/${objectKey}`,
    objectKey,
    contentType: detectedType,
    sizeBytes: input.file.buffer.length,
  };
}

export async function removeBookingCommissionReceipt(
  objectKey: string,
  dependencies: Pick<BookingCommissionReceiptStorageDependencies, "client" | "bucket"> =
    defaultStorageDependencies,
): Promise<boolean> {
  if (!dependencies.client || !dependencies.bucket || !objectKey) return false;
  await dependencies.client.send(new DeleteObjectCommand({
    Bucket: dependencies.bucket,
    Key: objectKey,
  }));
  return true;
}
