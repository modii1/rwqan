import assert from "node:assert/strict";
import test from "node:test";

import { FirebaseService } from "../firebaseService";
import {
  CUSTOMER_PHONE_OTP_MAX_ISSUES_PER_IP,
  CUSTOMER_PHONE_OTP_MAX_ISSUES_PER_PHONE,
  CUSTOMER_PHONE_OTP_TTL_MS,
  CustomerPhoneOtpConfigurationError,
  CustomerPhoneOtpError,
  createCustomerPhoneOtpService,
  type CustomerPhoneOtpErrorCode,
  type CustomerPhoneOtpSender,
} from "./CustomerPhoneOtpService";

type FakeData = Record<string, any>;

class FakeFirestore {
  private readonly collections = new Map<string, Map<string, FakeData>>();
  private transactionQueue: Promise<void> = Promise.resolve();

  collection(name: string): FakeCollectionReference {
    return new FakeCollectionReference(this, name);
  }

  async runTransaction<T>(
    operation: (transaction: FakeTransaction) => Promise<T>,
  ): Promise<T> {
    const result = this.transactionQueue.then(() =>
      operation(new FakeTransaction(this)));
    this.transactionQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  read(collectionName: string, id: string): FakeData | undefined {
    const value = this.collections.get(collectionName)?.get(id);
    return value ? { ...value } : undefined;
  }

  entries(collectionName: string): Array<[string, FakeData]> {
    return Array.from(this.collections.get(collectionName)?.entries() || [])
      .map(([id, value]) => [id, { ...value }]);
  }

  set(collectionName: string, id: string, data: FakeData): void {
    let collection = this.collections.get(collectionName);
    if (!collection) {
      collection = new Map();
      this.collections.set(collectionName, collection);
    }
    collection.set(id, { ...data });
  }

  update(collectionName: string, id: string, data: FakeData): void {
    const current = this.collections.get(collectionName)?.get(id);
    if (!current) throw new Error("Missing fake document");
    this.set(collectionName, id, { ...current, ...data });
  }

  delete(collectionName: string, id: string): void {
    this.collections.get(collectionName)?.delete(id);
  }
}

class FakeCollectionReference {
  constructor(
    private readonly database: FakeFirestore,
    private readonly collectionName: string,
  ) {}

  doc(id: string): FakeDocumentReference {
    return new FakeDocumentReference(this.database, this.collectionName, id);
  }
}

class FakeDocumentReference {
  constructor(
    private readonly database: FakeFirestore,
    readonly collectionName: string,
    readonly id: string,
  ) {}

  async get(): Promise<FakeDocumentSnapshot> {
    return new FakeDocumentSnapshot(this.database, this);
  }

  async delete(): Promise<void> {
    this.database.delete(this.collectionName, this.id);
  }
}

class FakeDocumentSnapshot {
  constructor(
    private readonly database: FakeFirestore,
    readonly ref: FakeDocumentReference,
  ) {}

  get exists(): boolean {
    return this.database.read(this.ref.collectionName, this.ref.id) !== undefined;
  }

  data(): FakeData | undefined {
    return this.database.read(this.ref.collectionName, this.ref.id);
  }
}

class FakeTransaction {
  constructor(private readonly database: FakeFirestore) {}

  async get(ref: FakeDocumentReference): Promise<FakeDocumentSnapshot> {
    return ref.get();
  }

  set(ref: FakeDocumentReference, data: FakeData): void {
    this.database.set(ref.collectionName, ref.id, data);
  }

  create(ref: FakeDocumentReference, data: FakeData): void {
    if (this.database.read(ref.collectionName, ref.id)) {
      throw new Error("Fake document already exists");
    }
    this.database.set(ref.collectionName, ref.id, data);
  }

  update(ref: FakeDocumentReference, data: FakeData): void {
    this.database.update(ref.collectionName, ref.id, data);
  }
}

const SECRET = "customer-phone-otp-test-secret-value-123456789";
const VALID_PHONE = "0512345678";
const CANONICAL_PHONE = "512345678";
const VALID_CODE = "123456";
const WRONG_CODE = "654321";
const VALID_IP = "203.0.113.25";

function challengeId(seed: number): string {
  return Buffer.alloc(32, seed).toString("base64url");
}

function createFirebaseStore(database: FakeFirestore): FirebaseService {
  const store = new FirebaseService();
  Object.defineProperty(store, "db", { value: database });
  return store;
}

function createHarness(options: {
  now?: number;
  sender?: CustomerPhoneOtpSender;
  createChallengeId?: () => string;
} = {}) {
  const database = new FakeFirestore();
  const store = createFirebaseStore(database);
  let currentTime = options.now ?? Date.UTC(2026, 7, 26, 12, 0, 0);
  let idSeed = 1;
  const sent: Array<{ phone: string; message: string; retries?: number }> = [];
  const sender = options.sender || (async (phone, message, retries) => {
    sent.push({ phone, message, retries });
    return { success: true };
  });
  const service = createCustomerPhoneOtpService({
    store,
    secret: SECRET,
    now: () => currentTime,
    createCode: () => VALID_CODE,
    createChallengeId: options.createChallengeId || (() => challengeId(idSeed++)),
    sender,
  });

  return {
    database,
    service,
    sent,
    advance(milliseconds: number) {
      currentTime += milliseconds;
    },
  };
}

async function captureOtpError(
  operation: Promise<unknown>,
  code: CustomerPhoneOtpErrorCode,
): Promise<CustomerPhoneOtpError> {
  try {
    await operation;
    assert.fail(`Expected customer phone OTP error ${code}`);
  } catch (error) {
    assert.ok(error instanceof CustomerPhoneOtpError);
    assert.equal(error.code, code);
    return error;
  }
}

test("issues a Saudi-normalized, opaque, HMAC-backed challenge and verifies it", async () => {
  const harness = createHarness();
  const issued = await harness.service.issue({
    phone: "+966 51 234 5678",
    ipAddress: VALID_IP,
  });

  assert.match(issued.challengeId, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(issued.maskedPhone, "05••••5678");
  assert.equal(harness.sent.length, 1);
  assert.equal(harness.sent[0].phone, CANONICAL_PHONE);
  assert.equal(harness.sent[0].retries, 2);
  assert.match(harness.sent[0].message, /123456/);
  assert.doesNotMatch(JSON.stringify(issued), /512345678|123456/);

  const stored = harness.database.read(
    "customer_phone_otp_challenges",
    issued.challengeId,
  );
  assert.ok(stored);
  assert.match(stored.phoneSubject, /^[a-f0-9]{64}$/);
  assert.match(stored.codeHash, /^[a-f0-9]{64}$/);
  assert.ok(stored.expiresAtTtl instanceof Date);
  assert.equal(stored.maxAttempts, 5);
  assert.doesNotMatch(JSON.stringify(stored), /512345678|0512345678|123456|203\.0\.113\.25/);

  const verified = await harness.service.verify({
    challengeId: issued.challengeId,
    phone: "٠٥١٢٣٤٥٦٧٨",
    code: VALID_CODE,
  });
  assert.equal(verified.verified, true);
  assert.equal(verified.challengeId, issued.challengeId);
  assert.ok(Number.isFinite(Date.parse(verified.verifiedAt)));
});

test("a wrong code consumes one attempt and a later correct code succeeds", async () => {
  const harness = createHarness();
  const issued = await harness.service.issue({ phone: VALID_PHONE, ipAddress: VALID_IP });

  const wrong = await captureOtpError(harness.service.verify({
    challengeId: issued.challengeId,
    phone: VALID_PHONE,
    code: WRONG_CODE,
  }), "CODE_INVALID");
  assert.equal(wrong.remainingAttempts, 4);
  assert.equal(harness.database.read(
    "customer_phone_otp_challenges",
    issued.challengeId,
  )?.attemptCount, 1);

  await harness.service.verify({
    challengeId: issued.challengeId,
    phone: VALID_PHONE,
    code: VALID_CODE,
  });
});

test("an expired challenge cannot be verified", async () => {
  const harness = createHarness();
  const issued = await harness.service.issue({ phone: VALID_PHONE, ipAddress: VALID_IP });
  harness.advance(CUSTOMER_PHONE_OTP_TTL_MS);

  await captureOtpError(harness.service.verify({
    challengeId: issued.challengeId,
    phone: VALID_PHONE,
    code: VALID_CODE,
  }), "CHALLENGE_EXPIRED");
});

test("a successfully used challenge cannot be replayed", async () => {
  const harness = createHarness();
  const issued = await harness.service.issue({ phone: VALID_PHONE, ipAddress: VALID_IP });
  const input = {
    challengeId: issued.challengeId,
    phone: VALID_PHONE,
    code: VALID_CODE,
  };
  await harness.service.verify(input);
  await captureOtpError(harness.service.verify(input), "CHALLENGE_USED");
});

test("atomic verification allows only one concurrent use", async () => {
  const harness = createHarness();
  const issued = await harness.service.issue({ phone: VALID_PHONE, ipAddress: VALID_IP });
  const input = {
    challengeId: issued.challengeId,
    phone: VALID_PHONE,
    code: VALID_CODE,
  };

  const attempts = await Promise.allSettled([
    harness.service.verify(input),
    harness.service.verify(input),
  ]);
  assert.equal(attempts.filter((attempt) => attempt.status === "fulfilled").length, 1);
  const rejection = attempts.find((attempt) => attempt.status === "rejected");
  assert.ok(rejection && rejection.status === "rejected");
  assert.ok(rejection.reason instanceof CustomerPhoneOtpError);
  assert.equal(rejection.reason.code, "CHALLENGE_USED");
});

test("five wrong attempts exhaust a challenge, including a mismatched phone", async () => {
  const harness = createHarness();
  const issued = await harness.service.issue({ phone: VALID_PHONE, ipAddress: VALID_IP });

  await captureOtpError(harness.service.verify({
    challengeId: issued.challengeId,
    phone: "0500000000",
    code: VALID_CODE,
  }), "CODE_INVALID");
  for (let attempt = 1; attempt < 4; attempt += 1) {
    await captureOtpError(harness.service.verify({
      challengeId: issued.challengeId,
      phone: VALID_PHONE,
      code: WRONG_CODE,
    }), "CODE_INVALID");
  }
  await captureOtpError(harness.service.verify({
    challengeId: issued.challengeId,
    phone: VALID_PHONE,
    code: WRONG_CODE,
  }), "ATTEMPTS_EXHAUSTED");
  await captureOtpError(harness.service.verify({
    challengeId: issued.challengeId,
    phone: VALID_PHONE,
    code: VALID_CODE,
  }), "ATTEMPTS_EXHAUSTED");

  const stored = harness.database.read(
    "customer_phone_otp_challenges",
    issued.challengeId,
  );
  assert.equal(stored?.attemptCount, 5);
  assert.ok(stored?.exhaustedAt);
});

test("per-phone issue limiting applies across different IP addresses", async () => {
  const harness = createHarness();
  for (let issue = 0; issue < CUSTOMER_PHONE_OTP_MAX_ISSUES_PER_PHONE; issue += 1) {
    await harness.service.issue({
      phone: VALID_PHONE,
      ipAddress: `203.0.113.${issue + 1}`,
    });
  }

  const error = await captureOtpError(harness.service.issue({
    phone: VALID_PHONE,
    ipAddress: "203.0.113.200",
  }), "RATE_LIMITED");
  assert.equal(error.scope, "phone");
  assert.ok((error.retryAfterMs || 0) > 0);
});

test("per-IP issue limiting applies across different phone numbers", async () => {
  const harness = createHarness();
  for (let issue = 0; issue < CUSTOMER_PHONE_OTP_MAX_ISSUES_PER_IP; issue += 1) {
    await harness.service.issue({
      phone: `05${String(issue).padStart(8, "0")}`,
      ipAddress: VALID_IP,
    });
  }

  const error = await captureOtpError(harness.service.issue({
    phone: "0599999999",
    ipAddress: VALID_IP,
  }), "RATE_LIMITED");
  assert.equal(error.scope, "ip");
});

test("equivalent IPv6 spellings share one issue-rate subject", async () => {
  const harness = createHarness();
  await harness.service.issue({ phone: VALID_PHONE, ipAddress: "0:0:0:0:0:0:0:1" });
  await harness.service.issue({ phone: "0500000000", ipAddress: "::1" });

  const ipLimits = harness.database.entries("customer_phone_otp_issue_limits")
    .filter(([, value]) => value.scope === "ip");
  assert.equal(ipLimits.length, 1);
  assert.equal(ipLimits[0][1].issueCount, 2);
});

test("a failed delivery deletes its challenge but retains abuse counters", async () => {
  const harness = createHarness({
    sender: async () => ({ success: false, error: "provider unavailable" }),
  });

  await captureOtpError(harness.service.issue({
    phone: VALID_PHONE,
    ipAddress: VALID_IP,
  }), "DELIVERY_FAILED");
  assert.equal(
    harness.database.entries("customer_phone_otp_challenges").length,
    0,
  );
  assert.equal(
    harness.database.entries("customer_phone_otp_issue_limits").length,
    2,
  );
});

test("a thrown delivery error also deletes its challenge", async () => {
  const harness = createHarness({
    sender: async () => {
      throw new Error("provider unavailable");
    },
  });

  await captureOtpError(harness.service.issue({
    phone: VALID_PHONE,
    ipAddress: VALID_IP,
  }), "DELIVERY_FAILED");
  assert.equal(
    harness.database.entries("customer_phone_otp_challenges").length,
    0,
  );
});

test("challenge-ID collisions are retried without consuming extra issue quota", async () => {
  const database = new FakeFirestore();
  const store = createFirebaseStore(database);
  const collidingId = challengeId(1);
  const succeedingId = challengeId(2);
  database.set("customer_phone_otp_challenges", collidingId, { occupied: true });
  const generatedIds = [collidingId, succeedingId];
  const service = createCustomerPhoneOtpService({
    store,
    secret: SECRET,
    now: () => Date.UTC(2026, 7, 26, 12, 0, 0),
    createCode: () => VALID_CODE,
    createChallengeId: () => generatedIds.shift() || challengeId(3),
    sender: async () => ({ success: true }),
  });

  const issued = await service.issue({ phone: VALID_PHONE, ipAddress: VALID_IP });
  assert.equal(issued.challengeId, succeedingId);
  for (const [, limit] of database.entries("customer_phone_otp_issue_limits")) {
    assert.equal(limit.issueCount, 1);
  }
});

test("invalid inputs and weak secret configuration fail with typed errors", async () => {
  const harness = createHarness();
  await captureOtpError(harness.service.issue({
    phone: "not-a-phone",
    ipAddress: VALID_IP,
  }), "INVALID_PHONE");
  await captureOtpError(harness.service.issue({
    phone: VALID_PHONE,
    ipAddress: "not-an-ip",
  }), "INVALID_IP");

  const weakSecretService = createCustomerPhoneOtpService({
    store: createFirebaseStore(new FakeFirestore()),
    secret: "too-short",
    sender: async () => ({ success: true }),
  });
  await assert.rejects(
    weakSecretService.issue({ phone: VALID_PHONE, ipAddress: VALID_IP }),
    CustomerPhoneOtpConfigurationError,
  );
});
