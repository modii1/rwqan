import {
  createHmac,
  timingSafeEqual,
} from "node:crypto";
import {
  bookingTokenPurposeSchema,
  type BookingTokenPurpose,
} from "../../shared/booking";

export const BOOKING_TOKEN_VERSION = 1 as const;
const BOOKING_TOKEN_DOMAIN = "rwqan.booking-token.v1\0";
const MINIMUM_SECRET_BYTES = 32;
const base64UrlPattern = /^[A-Za-z0-9_-]+$/;
const bookingIdPattern = /^[^\u0000-\u001f\u007f]{1,160}$/;

export type BookingTokenErrorCode =
  | "TOKEN_MALFORMED"
  | "TOKEN_INVALID_SIGNATURE"
  | "TOKEN_WRONG_PURPOSE"
  | "TOKEN_EXPIRED";

export class BookingTokenError extends Error {
  constructor(readonly code: BookingTokenErrorCode, message: string) {
    super(message);
    this.name = "BookingTokenError";
  }
}

export class BookingTokenConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BookingTokenConfigurationError";
  }
}

export interface BookingTokenServiceOptions {
  secret?: string | Buffer;
  now?: () => number;
}

export interface IssueBookingTokenOptions {
  bookingId: string;
  purpose: BookingTokenPurpose;
  expiresAt: Date | string | number;
}

export interface VerifiedBookingToken {
  version: typeof BOOKING_TOKEN_VERSION;
  bookingId: string;
  purpose: BookingTokenPurpose;
  expiresAt: string;
}

interface SerializedBookingTokenPayload {
  v: typeof BOOKING_TOKEN_VERSION;
  bookingId: string;
  purpose: BookingTokenPurpose;
  expiresAt: number;
}

function resolveSecret(secret?: string | Buffer): Buffer {
  const configuredSecret = secret ?? process.env.SESSION_SECRET;
  if (configuredSecret === undefined || configuredSecret.length === 0) {
    throw new BookingTokenConfigurationError(
      "SESSION_SECRET is required for booking tokens",
    );
  }

  const secretBuffer = Buffer.isBuffer(configuredSecret)
    ? Buffer.from(configuredSecret)
    : Buffer.from(configuredSecret, "utf8");
  if (secretBuffer.length < MINIMUM_SECRET_BYTES) {
    throw new BookingTokenConfigurationError(
      `Booking token secret must be at least ${MINIMUM_SECRET_BYTES} bytes`,
    );
  }
  return secretBuffer;
}

function parseExpiry(value: Date | string | number): number {
  const expiresAt = value instanceof Date
    ? value.getTime()
    : typeof value === "number"
      ? value
      : Date.parse(value);
  if (!Number.isSafeInteger(expiresAt) || expiresAt < 0) {
    throw new RangeError("Invalid booking token expiry");
  }
  return expiresAt;
}

function requireBookingId(value: unknown): string {
  if (typeof value !== "string" || value.trim() !== value || !bookingIdPattern.test(value)) {
    throw new RangeError("Invalid booking id");
  }
  return value;
}

function decodeCanonicalBase64Url(value: string): Buffer | null {
  if (!value || !base64UrlPattern.test(value)) return null;
  try {
    const decoded = Buffer.from(value, "base64url");
    return decoded.toString("base64url") === value ? decoded : null;
  } catch {
    return null;
  }
}

export class BookingTokenService {
  private readonly secret: Buffer;
  private readonly now: () => number;

  constructor(options: BookingTokenServiceOptions = {}) {
    this.secret = resolveSecret(options.secret);
    this.now = options.now || Date.now;
  }

  issue(options: IssueBookingTokenOptions): string {
    const bookingId = requireBookingId(options.bookingId);
    const purpose = bookingTokenPurposeSchema.parse(options.purpose);
    const expiresAt = parseExpiry(options.expiresAt);
    const now = this.now();
    if (!Number.isFinite(now)) throw new RangeError("Invalid current time");
    if (expiresAt <= now) throw new RangeError("Booking token expiry must be in the future");

    const payload: SerializedBookingTokenPayload = {
      v: BOOKING_TOKEN_VERSION,
      bookingId,
      purpose,
      expiresAt,
    };
    const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    const signature = this.sign(encodedPayload).toString("base64url");
    return `${encodedPayload}.${signature}`;
  }

  verify(token: unknown, expectedPurpose: BookingTokenPurpose): VerifiedBookingToken {
    const purpose = bookingTokenPurposeSchema.parse(expectedPurpose);
    if (typeof token !== "string") {
      throw new BookingTokenError("TOKEN_MALFORMED", "Malformed booking token");
    }

    const parts = token.split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      throw new BookingTokenError("TOKEN_MALFORMED", "Malformed booking token");
    }
    const [encodedPayload, encodedSignature] = parts;
    if (!base64UrlPattern.test(encodedPayload)) {
      throw new BookingTokenError("TOKEN_MALFORMED", "Malformed booking token");
    }

    const suppliedSignature = decodeCanonicalBase64Url(encodedSignature);
    const expectedSignature = this.sign(encodedPayload);
    const comparableSignature = suppliedSignature?.length === expectedSignature.length
      ? suppliedSignature
      : Buffer.alloc(expectedSignature.length);
    const signatureMatches = timingSafeEqual(expectedSignature, comparableSignature)
      && suppliedSignature?.length === expectedSignature.length;
    if (!signatureMatches) {
      throw new BookingTokenError("TOKEN_INVALID_SIGNATURE", "Invalid booking token");
    }

    const payloadBuffer = decodeCanonicalBase64Url(encodedPayload);
    if (!payloadBuffer) {
      throw new BookingTokenError("TOKEN_MALFORMED", "Malformed booking token");
    }

    let payload: unknown;
    try {
      payload = JSON.parse(payloadBuffer.toString("utf8"));
    } catch {
      throw new BookingTokenError("TOKEN_MALFORMED", "Malformed booking token");
    }

    if (!this.isPayload(payload)) {
      throw new BookingTokenError("TOKEN_MALFORMED", "Malformed booking token");
    }
    if (payload.purpose !== purpose) {
      throw new BookingTokenError("TOKEN_WRONG_PURPOSE", "Wrong booking token purpose");
    }
    if (payload.expiresAt <= this.now()) {
      throw new BookingTokenError("TOKEN_EXPIRED", "Expired booking token");
    }

    return {
      version: BOOKING_TOKEN_VERSION,
      bookingId: payload.bookingId,
      purpose: payload.purpose,
      expiresAt: new Date(payload.expiresAt).toISOString(),
    };
  }

  private sign(encodedPayload: string): Buffer {
    return createHmac("sha256", this.secret)
      .update(BOOKING_TOKEN_DOMAIN, "utf8")
      .update(encodedPayload, "ascii")
      .digest();
  }

  private isPayload(value: unknown): value is SerializedBookingTokenPayload {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const payload = value as Record<string, unknown>;
    if (Object.keys(payload).sort().join(",") !== "bookingId,expiresAt,purpose,v") return false;
    return payload.v === BOOKING_TOKEN_VERSION
      && typeof payload.bookingId === "string"
      && payload.bookingId.trim() === payload.bookingId
      && bookingIdPattern.test(payload.bookingId)
      && bookingTokenPurposeSchema.safeParse(payload.purpose).success
      && typeof payload.expiresAt === "number"
      && Number.isSafeInteger(payload.expiresAt)
      && payload.expiresAt >= 0;
  }
}

export function createBookingTokenService(
  options: BookingTokenServiceOptions = {},
): BookingTokenService {
  return new BookingTokenService(options);
}
