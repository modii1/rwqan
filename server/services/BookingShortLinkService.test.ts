import assert from "node:assert/strict";
import test from "node:test";
import { BookingTokenService } from "./BookingTokenService";
import {
  BookingShortLinkError,
  BookingShortLinkService,
  createCustomerBookingShortCode,
} from "./BookingShortLinkService";

type FakeData = Record<string, unknown>;

class FakeFirestore {
  private readonly documents = new Map<string, FakeData>();
  private transactionQueue = Promise.resolve();
  transactionCalls = 0;
  createCalls = 0;

  collection(name: string) {
    return {
      doc: (id: string) => new FakeDocumentReference(this, name, id),
    };
  }

  async runTransaction<T>(
    operation: (transaction: FakeTransaction) => Promise<T>,
  ): Promise<T> {
    const previous = this.transactionQueue;
    let release = () => {};
    this.transactionQueue = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    this.transactionCalls += 1;
    try {
      return await operation(new FakeTransaction(this));
    } finally {
      release();
    }
  }

  key(collection: string, id: string): string {
    return `${collection}/${id}`;
  }

  read(collection: string, id: string): FakeData | undefined {
    const value = this.documents.get(this.key(collection, id));
    return value ? structuredClone(value) : undefined;
  }

  create(collection: string, id: string, data: FakeData): void {
    const key = this.key(collection, id);
    if (this.documents.has(key)) throw new Error(`Existing fake document ${key}`);
    this.createCalls += 1;
    this.documents.set(key, structuredClone(data));
  }

  seed(collection: string, id: string, data: FakeData): void {
    this.documents.set(this.key(collection, id), structuredClone(data));
  }
}

class FakeDocumentReference {
  constructor(
    readonly database: FakeFirestore,
    readonly collectionName: string,
    readonly id: string,
  ) {}

  async get(): Promise<FakeSnapshot> {
    return new FakeSnapshot(this);
  }
}

class FakeSnapshot {
  constructor(readonly ref: FakeDocumentReference) {}

  get exists(): boolean {
    return Boolean(this.ref.database.read(this.ref.collectionName, this.ref.id));
  }

  data(): FakeData | undefined {
    return this.ref.database.read(this.ref.collectionName, this.ref.id);
  }
}

class FakeTransaction {
  constructor(private readonly database: FakeFirestore) {}

  async get(reference: FakeDocumentReference): Promise<FakeSnapshot> {
    return reference.get();
  }

  create(reference: FakeDocumentReference, data: FakeData): void {
    this.database.create(reference.collectionName, reference.id, data);
  }
}

const SECRET = "booking-short-link-test-secret-value-123456789";
const INITIAL_NOW = Date.parse("2026-08-22T12:00:00.000Z");
const EXPIRES_AT = INITIAL_NOW + 90 * 24 * 60 * 60 * 1_000;
const BOOKING_ID = "BOOK-REQ-13383-001";

function customerToken(): string {
  return new BookingTokenService({ secret: SECRET, now: () => INITIAL_NOW }).issue({
    bookingId: BOOKING_ID,
    purpose: "customer_response",
    expiresAt: EXPIRES_AT,
  });
}

test("customer aliases are compact, deterministic, opaque, and purpose-bound", () => {
  const code = createCustomerBookingShortCode(BOOKING_ID, SECRET);
  assert.match(code, /^[A-Za-z0-9_-]{22}$/);
  assert.equal(code, createCustomerBookingShortCode(BOOKING_ID, SECRET));
  assert.notEqual(
    code,
    createCustomerBookingShortCode("BOOK-REQ-13383-002", SECRET),
  );
  assert.equal(code.includes("13383"), false);
  assert.equal(code.includes("BOOK"), false);
});

test("lazy alias creation is atomic and idempotent without storing raw identifiers", async () => {
  const database = new FakeFirestore();
  const service = new BookingShortLinkService({
    database: database as never,
    secret: SECRET,
    now: () => INITIAL_NOW,
  });
  const token = customerToken();

  const [first, second] = await Promise.all([
    service.ensureCustomerResponseLink({
      bookingId: BOOKING_ID,
      token,
      expiresAt: EXPIRES_AT,
    }),
    service.ensureCustomerResponseLink({
      bookingId: BOOKING_ID,
      token,
      expiresAt: EXPIRES_AT,
    }),
  ]);

  assert.equal(first, second);
  assert.equal(database.transactionCalls, 2);
  assert.equal(database.createCalls, 1);
  const stored = database.read("booking_short_links", first);
  assert.ok(stored);
  assert.equal(stored.purpose, "customer_response");
  assert.equal(stored.token, token);
  assert.equal(stored.expiresAt, new Date(EXPIRES_AT).toISOString());
  assert.deepEqual(stored.expiresAtTtl, new Date(EXPIRES_AT));
  assert.equal(Object.hasOwn(stored, "bookingId"), false);
  assert.equal(Object.hasOwn(stored, "customerPhone"), false);

  assert.deepEqual(await service.resolveCustomerResponse(first), {
    token,
    expiresAt: new Date(EXPIRES_AT).toISOString(),
  });
});

test("aliases reject malformed, missing, expired, and corrupt targets", async () => {
  const database = new FakeFirestore();
  let now = INITIAL_NOW;
  const service = new BookingShortLinkService({
    database: database as never,
    secret: SECRET,
    now: () => now,
  });

  await assert.rejects(
    () => service.resolveCustomerResponse("BOOK-13383"),
    (error: unknown) =>
      error instanceof BookingShortLinkError &&
      error.code === "SHORT_LINK_MALFORMED",
  );
  await assert.rejects(
    () => service.resolveCustomerResponse("A".repeat(22)),
    (error: unknown) =>
      error instanceof BookingShortLinkError &&
      error.code === "SHORT_LINK_NOT_FOUND",
  );

  const code = await service.ensureCustomerResponseLink({
    bookingId: BOOKING_ID,
    token: customerToken(),
    expiresAt: EXPIRES_AT,
  });
  now = EXPIRES_AT;
  await assert.rejects(
    () => service.resolveCustomerResponse(code),
    (error: unknown) =>
      error instanceof BookingShortLinkError &&
      error.code === "SHORT_LINK_EXPIRED",
  );

  const corruptCode = "B".repeat(22);
  database.seed("booking_short_links", corruptCode, {
    schemaVersion: 1,
    purpose: "owner_payment",
    token: customerToken(),
    expiresAt: new Date(EXPIRES_AT).toISOString(),
    createdAt: new Date(INITIAL_NOW).toISOString(),
  });
  now = INITIAL_NOW;
  await assert.rejects(
    () => service.resolveCustomerResponse(corruptCode),
    (error: unknown) =>
      error instanceof BookingShortLinkError &&
      error.code === "SHORT_LINK_INVALID",
  );
});

test("an alias cannot be rebound to another signed target", async () => {
  const database = new FakeFirestore();
  const service = new BookingShortLinkService({
    database: database as never,
    secret: SECRET,
    now: () => INITIAL_NOW,
  });
  const code = service.customerCode(BOOKING_ID);
  database.seed("booking_short_links", code, {
    schemaVersion: 1,
    purpose: "customer_response",
    token: "tampered.target",
    expiresAt: new Date(EXPIRES_AT).toISOString(),
    createdAt: new Date(INITIAL_NOW).toISOString(),
  });

  await assert.rejects(
    () => service.resolveCustomerResponse(code),
    (error: unknown) =>
      error instanceof BookingShortLinkError &&
      error.code === "SHORT_LINK_INVALID",
  );

  await assert.rejects(
    () => service.ensureCustomerResponseLink({
      bookingId: BOOKING_ID,
      token: customerToken(),
      expiresAt: EXPIRES_AT,
    }),
    (error: unknown) =>
      error instanceof BookingShortLinkError &&
      error.code === "SHORT_LINK_INVALID",
  );

  const wrongCode = "C".repeat(22);
  database.seed("booking_short_links", wrongCode, {
    schemaVersion: 1,
    purpose: "customer_response",
    token: customerToken(),
    expiresAt: new Date(EXPIRES_AT).toISOString(),
    createdAt: new Date(INITIAL_NOW).toISOString(),
  });
  await assert.rejects(
    () => service.resolveCustomerResponse(wrongCode),
    (error: unknown) =>
      error instanceof BookingShortLinkError &&
      error.code === "SHORT_LINK_INVALID",
  );
});
