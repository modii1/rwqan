import { createHmac, timingSafeEqual } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { activeFirestore as configuredDb } from "../config/dataEnvironment";
import { BookingTokenService } from "./BookingTokenService";

const SHORT_LINKS_COLLECTION = "booking_short_links";
const SHORT_LINK_DOMAIN = "rwqan.booking-short-link.v1\0";
const SHORT_CODE_LENGTH = 10;
const LEGACY_SHORT_CODE_BYTES = 16;
const LEGACY_SHORT_CODE_LENGTH = 22;
const MINIMUM_SECRET_BYTES = 32;
const SHORT_CODE_PATTERN = /^(?:[A-Za-z0-9_-]{10}|[A-Za-z0-9_-]{22})$/;

type BookingShortLinkPurpose = "customer_response" | "owner_payment";

interface BookingShortLinkDocument {
  schemaVersion: 1;
  purpose: BookingShortLinkPurpose;
  token: string;
  expiresAt: string;
  expiresAtTtl: Date;
  createdAt: string;
}

export class BookingShortLinkError extends Error {
  constructor(
    readonly code:
      | "SHORT_LINK_MALFORMED"
      | "SHORT_LINK_NOT_FOUND"
      | "SHORT_LINK_EXPIRED"
      | "SHORT_LINK_INVALID",
    message: string,
  ) {
    super(message);
    this.name = "BookingShortLinkError";
  }
}

export interface BookingShortLinkServiceOptions {
  database?: Firestore | null;
  secret?: string | Buffer;
  now?: () => number;
}

export interface EnsureCustomerShortLinkOptions {
  bookingId: string;
  token: string;
  expiresAt: Date | string | number;
}

export interface EnsureOwnerPaymentShortLinkOptions {
  token: string;
}

function resolveSecret(secret?: string | Buffer): Buffer {
  const configuredSecret = secret ?? process.env.SESSION_SECRET;
  if (configuredSecret === undefined || configuredSecret.length === 0) {
    throw new Error("SESSION_SECRET is required for booking short links");
  }
  const value = Buffer.isBuffer(configuredSecret)
    ? Buffer.from(configuredSecret)
    : Buffer.from(configuredSecret, "utf8");
  if (value.length < MINIMUM_SECRET_BYTES) {
    throw new Error(
      `Booking short-link secret must be at least ${MINIMUM_SECRET_BYTES} bytes`,
    );
  }
  return value;
}

function requireBookingId(value: string): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    value.length < 1 ||
    value.length > 160 ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new RangeError("Invalid booking id");
  }
  return value;
}

function requireSignedToken(value: string): string {
  if (
    typeof value !== "string" ||
    value.length < 3 ||
    value.length > 2_048 ||
    !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)
  ) {
    throw new RangeError("Invalid booking token");
  }
  return value;
}

function parseExpiry(value: Date | string | number): string {
  const timestamp = value instanceof Date
    ? value.getTime()
    : typeof value === "number"
      ? value
      : Date.parse(value);
  const date = new Date(timestamp);
  if (
    !Number.isSafeInteger(timestamp) ||
    timestamp < 0 ||
    !Number.isFinite(date.getTime())
  ) {
    throw new RangeError("Invalid booking short-link expiry");
  }
  return date.toISOString();
}

function parseDocument(value: unknown): BookingShortLinkDocument | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (
    candidate.schemaVersion !== 1 ||
    (candidate.purpose !== "customer_response" &&
      candidate.purpose !== "owner_payment") ||
    typeof candidate.token !== "string" ||
    !candidate.token ||
    typeof candidate.expiresAt !== "string" ||
    !Number.isFinite(Date.parse(candidate.expiresAt)) ||
    typeof candidate.createdAt !== "string" ||
    !Number.isFinite(Date.parse(candidate.createdAt))
  ) return null;
  return candidate as unknown as BookingShortLinkDocument;
}

export function createCustomerBookingShortCode(
  bookingId: string,
  secret?: string | Buffer,
): string {
  return createHmac("sha256", resolveSecret(secret))
    .update(SHORT_LINK_DOMAIN, "utf8")
    .update("customer_response\0", "utf8")
    .update(requireBookingId(bookingId), "utf8")
    .digest("base64url")
    .slice(0, SHORT_CODE_LENGTH);
}

export function createOwnerPaymentShortCode(
  token: string,
  secret?: string | Buffer,
): string {
  return createHmac("sha256", resolveSecret(secret))
    .update(SHORT_LINK_DOMAIN, "utf8")
    .update("owner_payment\0", "utf8")
    .update(requireSignedToken(token), "utf8")
    .digest("base64url")
    .slice(0, SHORT_CODE_LENGTH);
}

function createLegacyCustomerBookingShortCode(
  bookingId: string,
  secret: string | Buffer,
): string {
  return createHmac("sha256", resolveSecret(secret))
    .update(SHORT_LINK_DOMAIN, "utf8")
    .update("customer_response\0", "utf8")
    .update(requireBookingId(bookingId), "utf8")
    .digest()
    .subarray(0, LEGACY_SHORT_CODE_BYTES)
    .toString("base64url");
}

export class BookingShortLinkService {
  private readonly database: Firestore;
  private readonly secret: Buffer;
  private readonly now: () => number;

  constructor(options: BookingShortLinkServiceOptions = {}) {
    const database = options.database ?? configuredDb;
    if (!database) throw new Error("Firebase not initialized");
    this.database = database;
    this.secret = resolveSecret(options.secret);
    this.now = options.now || Date.now;
  }

  customerCode(bookingId: string): string {
    return createCustomerBookingShortCode(bookingId, this.secret);
  }

  ownerPaymentCode(token: string): string {
    return createOwnerPaymentShortCode(token, this.secret);
  }

  async ensureCustomerResponseLink(
    options: EnsureCustomerShortLinkOptions,
  ): Promise<string> {
    const bookingId = requireBookingId(options.bookingId);
    const expiresAt = parseExpiry(options.expiresAt);
    if (Date.parse(expiresAt) <= this.now()) {
      throw new RangeError("Booking short-link expiry must be in the future");
    }
    const tokenService = new BookingTokenService({
      secret: this.secret,
      now: this.now,
    });
    const verified = tokenService.verify(options.token, "customer_response");
    if (verified.bookingId !== bookingId || verified.expiresAt !== expiresAt) {
      throw new BookingShortLinkError(
        "SHORT_LINK_INVALID",
        "Booking short-link target mismatch",
      );
    }

    const code = this.customerCode(bookingId);
    const reference = this.database.collection(SHORT_LINKS_COLLECTION).doc(code);
    const document: BookingShortLinkDocument = {
      schemaVersion: 1,
      purpose: "customer_response",
      token: options.token,
      expiresAt,
      expiresAtTtl: new Date(expiresAt),
      createdAt: new Date(this.now()).toISOString(),
    };

    await this.database.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists) {
        transaction.create(reference, document);
        return;
      }
      const current = parseDocument(snapshot.data());
      if (
        !current ||
        current.purpose !== document.purpose ||
        current.token !== document.token ||
        current.expiresAt !== document.expiresAt
      ) {
        throw new BookingShortLinkError(
          "SHORT_LINK_INVALID",
          "Booking short-link collision or corrupt target",
        );
      }
    });

    return code;
  }

  async ensureOwnerPaymentLink(
    options: EnsureOwnerPaymentShortLinkOptions,
  ): Promise<string> {
    const token = requireSignedToken(options.token);
    const verified = new BookingTokenService({
      secret: this.secret,
      now: this.now,
    }).verify(token, "owner_payment");
    const code = this.ownerPaymentCode(token);
    const reference = this.database.collection(SHORT_LINKS_COLLECTION).doc(code);
    const document: BookingShortLinkDocument = {
      schemaVersion: 1,
      purpose: "owner_payment",
      token,
      expiresAt: verified.expiresAt,
      expiresAtTtl: new Date(verified.expiresAt),
      createdAt: new Date(this.now()).toISOString(),
    };

    await this.database.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      if (!snapshot.exists) {
        transaction.create(reference, document);
        return;
      }
      const current = parseDocument(snapshot.data());
      if (
        !current ||
        current.purpose !== document.purpose ||
        current.token !== document.token ||
        current.expiresAt !== document.expiresAt
      ) {
        throw new BookingShortLinkError(
          "SHORT_LINK_INVALID",
          "Booking short-link collision or corrupt target",
        );
      }
    });

    return code;
  }

  async resolveCustomerResponse(code: unknown): Promise<{
    token: string;
    expiresAt: string;
  }> {
    return this.resolve(code, "customer_response");
  }

  async resolveOwnerPayment(code: unknown): Promise<{
    token: string;
    expiresAt: string;
  }> {
    return this.resolve(code, "owner_payment");
  }

  private async resolve(
    code: unknown,
    purpose: BookingShortLinkPurpose,
  ): Promise<{ token: string; expiresAt: string }> {
    if (typeof code !== "string" || !SHORT_CODE_PATTERN.test(code)) {
      throw new BookingShortLinkError(
        "SHORT_LINK_MALFORMED",
        "Malformed booking short link",
      );
    }
    const snapshot = await this.database
      .collection(SHORT_LINKS_COLLECTION)
      .doc(code)
      .get();
    if (!snapshot.exists) {
      throw new BookingShortLinkError(
        "SHORT_LINK_NOT_FOUND",
        "Booking short link not found",
      );
    }
    const document = parseDocument(snapshot.data());
    if (!document || document.purpose !== purpose) {
      throw new BookingShortLinkError(
        "SHORT_LINK_INVALID",
        "Invalid booking short-link target",
      );
    }
    if (Date.parse(document.expiresAt) <= this.now()) {
      throw new BookingShortLinkError(
        "SHORT_LINK_EXPIRED",
        "Expired booking short link",
      );
    }
    let verified: ReturnType<BookingTokenService["verify"]>;
    try {
      verified = new BookingTokenService({
        secret: this.secret,
        now: this.now,
      }).verify(document.token, purpose);
    } catch {
      throw new BookingShortLinkError(
        "SHORT_LINK_INVALID",
        "Invalid booking short-link target",
      );
    }
    const expectedCode = purpose === "customer_response"
      ? code.length === LEGACY_SHORT_CODE_LENGTH
        ? createLegacyCustomerBookingShortCode(verified.bookingId, this.secret)
        : this.customerCode(verified.bookingId)
      : this.ownerPaymentCode(document.token);
    const suppliedCode = Buffer.from(code, "ascii");
    const expectedCodeBytes = Buffer.from(expectedCode, "ascii");
    const codeMatches = suppliedCode.length === expectedCodeBytes.length &&
      timingSafeEqual(suppliedCode, expectedCodeBytes);
    if (!codeMatches || verified.expiresAt !== document.expiresAt) {
      throw new BookingShortLinkError(
        "SHORT_LINK_INVALID",
        "Invalid booking short-link target",
      );
    }
    return { token: document.token, expiresAt: document.expiresAt };
  }
}

let singleton: BookingShortLinkService | null = null;

export function getBookingShortLinkService(): BookingShortLinkService {
  if (!singleton) singleton = new BookingShortLinkService();
  return singleton;
}
