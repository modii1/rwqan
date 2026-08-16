import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import {
  BOOKING_TOKEN_VERSION,
  BookingTokenConfigurationError,
  BookingTokenError,
  BookingTokenService,
} from "./BookingTokenService";

const SECRET = Buffer.alloc(32, 0x5a);
const TOKEN_DOMAIN = "rwqan.booking-token.v1\0";
const initialNow = Date.parse("2026-08-15T12:00:00.000Z");

function errorCode(error: unknown): string | undefined {
  return error instanceof BookingTokenError ? error.code : undefined;
}

function replaceFirstCharacter(value: string): string {
  return `${value[0] === "A" ? "B" : "A"}${value.slice(1)}`;
}

function independentlySign(encodedPayload: string): string {
  return createHmac("sha256", SECRET)
    .update(TOKEN_DOMAIN, "utf8")
    .update(encodedPayload, "ascii")
    .digest("base64url");
}

test("issues a signed base64url token and verifies both supported purposes", () => {
  const service = new BookingTokenService({ secret: SECRET, now: () => initialNow });

  for (const purpose of ["customer_response", "owner_payment"] as const) {
    const expiresAt = initialNow + 60_000;
    const token = service.issue({ bookingId: "BOOK-13383-1", purpose, expiresAt });
    const [encodedPayload, signature, extra] = token.split(".");

    assert.equal(extra, undefined);
    assert.match(encodedPayload, /^[A-Za-z0-9_-]+$/);
    assert.match(signature, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(signature, independentlySign(encodedPayload));
    assert.equal(token.includes("BOOK-13383-1"), false);
    assert.deepEqual(service.verify(token, purpose), {
      version: BOOKING_TOKEN_VERSION,
      bookingId: "BOOK-13383-1",
      purpose,
      expiresAt: new Date(expiresAt).toISOString(),
    });
  }
});

test("rejects payload and signature tampering", () => {
  const service = new BookingTokenService({ secret: SECRET, now: () => initialNow });
  const token = service.issue({
    bookingId: "BOOK-1",
    purpose: "customer_response",
    expiresAt: initialNow + 60_000,
  });
  const [payload, signature] = token.split(".");

  assert.throws(
    () => service.verify(`${replaceFirstCharacter(payload)}.${signature}`, "customer_response"),
    (error: unknown) => errorCode(error) === "TOKEN_INVALID_SIGNATURE",
  );
  assert.throws(
    () => service.verify(`${payload}.${replaceFirstCharacter(signature)}`, "customer_response"),
    (error: unknown) => errorCode(error) === "TOKEN_INVALID_SIGNATURE",
  );
});

test("rejects malformed structures and signed malformed payloads", () => {
  const service = new BookingTokenService({ secret: SECRET, now: () => initialNow });
  for (const malformed of [undefined, "", "one-part", "a.b.c", "*.abc", "abc.*", "abc.AA=="]) {
    assert.throws(
      () => service.verify(malformed, "customer_response"),
      (error: unknown) => errorCode(error) === "TOKEN_MALFORMED"
        || errorCode(error) === "TOKEN_INVALID_SIGNATURE",
    );
  }

  const malformedPayload = Buffer.from(JSON.stringify({
    v: BOOKING_TOKEN_VERSION,
    bookingId: "BOOK-1",
    purpose: "customer_response",
    expiresAt: initialNow + 60_000,
    unexpected: true,
  })).toString("base64url");
  const signedMalformedToken = `${malformedPayload}.${independentlySign(malformedPayload)}`;
  assert.throws(
    () => service.verify(signedMalformedToken, "customer_response"),
    (error: unknown) => errorCode(error) === "TOKEN_MALFORMED",
  );
});

test("purpose-bound tokens cannot be reused for another operation", () => {
  const service = new BookingTokenService({ secret: SECRET, now: () => initialNow });
  const token = service.issue({
    bookingId: "BOOK-1",
    purpose: "customer_response",
    expiresAt: initialNow + 60_000,
  });

  assert.throws(
    () => service.verify(token, "owner_payment"),
    (error: unknown) => errorCode(error) === "TOKEN_WRONG_PURPOSE",
  );
});

test("expiry is exclusive and enforced at the exact millisecond", () => {
  let now = initialNow;
  const service = new BookingTokenService({ secret: SECRET, now: () => now });
  const expiresAt = initialNow + 60_000;
  const token = service.issue({
    bookingId: "BOOK-1",
    purpose: "owner_payment",
    expiresAt,
  });

  now = expiresAt - 1;
  assert.equal(service.verify(token, "owner_payment").bookingId, "BOOK-1");
  now = expiresAt;
  assert.throws(
    () => service.verify(token, "owner_payment"),
    (error: unknown) => errorCode(error) === "TOKEN_EXPIRED",
  );
});

test("issuance rejects invalid ids, purposes, and non-future expiries", () => {
  const service = new BookingTokenService({ secret: SECRET, now: () => initialNow });
  assert.throws(() => service.issue({
    bookingId: " BOOK-1 ",
    purpose: "customer_response",
    expiresAt: initialNow + 1,
  }));
  assert.throws(() => service.issue({
    bookingId: "BOOK-1",
    purpose: "invalid" as "customer_response",
    expiresAt: initialNow + 1,
  }));
  assert.throws(() => service.issue({
    bookingId: "BOOK-1",
    purpose: "customer_response",
    expiresAt: initialNow,
  }));
  assert.throws(() => service.issue({
    bookingId: "BOOK-1",
    purpose: "customer_response",
    expiresAt: "not-a-date",
  }));
});

test("requires an explicit strong secret or SESSION_SECRET without a fallback", () => {
  assert.throws(
    () => new BookingTokenService({ secret: "short" }),
    BookingTokenConfigurationError,
  );

  const previousSecret = process.env.SESSION_SECRET;
  try {
    delete process.env.SESSION_SECRET;
    assert.throws(() => new BookingTokenService(), BookingTokenConfigurationError);

    process.env.SESSION_SECRET = "s".repeat(32);
    const service = new BookingTokenService({ now: () => initialNow });
    const token = service.issue({
      bookingId: "BOOK-ENV",
      purpose: "customer_response",
      expiresAt: initialNow + 1_000,
    });
    assert.equal(service.verify(token, "customer_response").bookingId, "BOOK-ENV");
  } finally {
    if (previousSecret === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = previousSecret;
  }
});
