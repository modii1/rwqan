import assert from "node:assert/strict";
import test from "node:test";

import type {
  OwnerAccount,
  OwnerAccountOtpChallenge,
  OwnerPropertyMembership,
} from "../../shared/owner-accounts";
import {
  OwnerAccountOtpError,
  OwnerAccountService,
  type CreateOwnerAccountChallengeResult,
  type OwnerAccountStore,
  type VerifyOwnerLoginChallengeResult,
  type VerifyOwnerPropertyChallengeResult,
} from "./OwnerAccountService";

class MemoryOwnerAccountStore implements OwnerAccountStore {
  readonly accounts = new Map<string, OwnerAccount>();
  readonly phoneIndexes = new Map<string, string>();
  readonly memberships = new Map<string, OwnerPropertyMembership>();
  readonly challenges = new Map<string, OwnerAccountOtpChallenge>();

  async getAccountByPhoneSubject(subject: string): Promise<OwnerAccount | null> {
    const id = this.phoneIndexes.get(subject);
    return id ? this.accounts.get(id) || null : null;
  }

  async getAccount(id: string): Promise<OwnerAccount | null> {
    return this.accounts.get(id) || null;
  }

  async getChallengeContext(challengeId: string) {
    const challenge = this.challenges.get(challengeId);
    return challenge ? {
      purpose: challenge.purpose,
      ownerAccountId: challenge.ownerAccountId,
      propertyNumber: challenge.propertyNumber,
      phoneSubject: challenge.phoneSubject,
    } : null;
  }

  async getMembership(propertyNumber: string) {
    return this.memberships.get(propertyNumber) || null;
  }

  async listActiveMemberships(ownerAccountId: string) {
    return [...this.memberships.values()].filter((membership) =>
      membership.ownerAccountId === ownerAccountId && membership.status === "active");
  }

  async validateActiveMembership(input: {
    ownerAccountId: string;
    authVersion: number;
    propertyNumber: string;
  }) {
    const account = this.accounts.get(input.ownerAccountId);
    const membership = this.memberships.get(input.propertyNumber);
    return Boolean(
      account?.status === "active" &&
      account.authVersion === input.authVersion &&
      membership?.status === "active" &&
      membership.ownerAccountId === input.ownerAccountId,
    );
  }

  async createChallenge(input: {
    challenge: OwnerAccountOtpChallenge;
  }): Promise<CreateOwnerAccountChallengeResult> {
    if (this.challenges.has(input.challenge.id)) return { status: "collision" };
    this.challenges.set(input.challenge.id, structuredClone(input.challenge));
    return { status: "created" };
  }

  async deleteChallenge(challengeId: string) {
    this.challenges.delete(challengeId);
  }

  private verify(input: {
    challengeId: string;
    purpose: OwnerAccountOtpChallenge["purpose"];
    phoneSubject: string;
    ownerAccountId: string | null;
    propertyNumber: string | null;
    candidateCodeHash: string;
    now: number;
  }): VerifyOwnerLoginChallengeResult | VerifyOwnerPropertyChallengeResult {
    const challenge = this.challenges.get(input.challengeId);
    if (!challenge) return { status: "missing" };
    if (challenge.consumedAt) return { status: "used" };
    if (Date.parse(challenge.expiresAt) <= input.now) return { status: "expired" };
    if (challenge.exhaustedAt) return { status: "exhausted" };
    if (
      challenge.purpose !== input.purpose ||
      challenge.phoneSubject !== input.phoneSubject ||
      challenge.ownerAccountId !== input.ownerAccountId ||
      challenge.propertyNumber !== input.propertyNumber
    ) return { status: "binding_mismatch" };
    if (challenge.codeHash !== input.candidateCodeHash) {
      challenge.attemptCount += 1;
      if (challenge.attemptCount >= challenge.maxAttempts) {
        challenge.exhaustedAt = new Date(input.now).toISOString();
        return { status: "exhausted" };
      }
      return {
        status: "invalid",
        remainingAttempts: challenge.maxAttempts - challenge.attemptCount,
      };
    }
    challenge.consumedAt = new Date(input.now).toISOString();
    return { status: "verified", verifiedAt: challenge.consumedAt } as never;
  }

  async verifyLoginChallenge(input: {
    challengeId: string;
    phoneSubject: string;
    ownerAccountId: string;
    candidateCodeHash: string;
    now: number;
  }): Promise<VerifyOwnerLoginChallengeResult> {
    const base = this.verify({
      ...input,
      purpose: "login",
      propertyNumber: null,
    });
    if (base.status !== "verified") return base as VerifyOwnerLoginChallengeResult;
    const account = this.accounts.get(input.ownerAccountId);
    if (!account || account.status !== "active") return { status: "account_unavailable" };
    return { ...base, account };
  }

  async verifyAndClaimProperty(input: {
    challengeId: string;
    phoneSubject: string;
    propertyNumber: string;
    candidateCodeHash: string;
    proposedOwnerAccountId: string;
    now: number;
  }): Promise<VerifyOwnerPropertyChallengeResult> {
    const base = this.verify({
      ...input,
      purpose: "claim_current_property",
      ownerAccountId: null,
    });
    if (base.status !== "verified") return base as VerifyOwnerPropertyChallengeResult;
    if (this.memberships.has(input.propertyNumber)) return { status: "property_claimed" };
    const indexedId = this.phoneIndexes.get(input.phoneSubject);
    const ownerAccountId = indexedId || input.proposedOwnerAccountId;
    const now = new Date(input.now).toISOString();
    const account = indexedId
      ? this.accounts.get(indexedId)
      : {
          id: ownerAccountId,
          schemaVersion: 1 as const,
          phoneSubject: input.phoneSubject,
          authVersion: 1,
          status: "active" as const,
          createdAt: now,
          updatedAt: now,
          lastLoginAt: now,
        };
    if (!account || account.status !== "active") return { status: "account_unavailable" };
    this.accounts.set(account.id, account);
    this.phoneIndexes.set(input.phoneSubject, account.id);
    const membership: OwnerPropertyMembership = {
      schemaVersion: 1,
      ownerAccountId: account.id,
      propertyNumber: input.propertyNumber,
      status: "active",
      isPrimary: ![...this.memberships.values()].some((candidate) =>
        candidate.ownerAccountId === account.id && candidate.status === "active"),
      createdAt: now,
      updatedAt: now,
      revokedAt: null,
    };
    this.memberships.set(input.propertyNumber, membership);
    return { ...base, account, membership };
  }

  async verifyAndAttachProperty(input: {
    challengeId: string;
    phoneSubject: string;
    propertyNumber: string;
    ownerAccountId: string;
    authVersion: number;
    candidateCodeHash: string;
    now: number;
  }): Promise<VerifyOwnerPropertyChallengeResult> {
    const base = this.verify({ ...input, purpose: "attach_property" });
    if (base.status !== "verified") return base as VerifyOwnerPropertyChallengeResult;
    const account = this.accounts.get(input.ownerAccountId);
    if (
      !account || account.status !== "active" ||
      account.authVersion !== input.authVersion
    ) return { status: "account_unavailable" };
    if (this.memberships.has(input.propertyNumber)) return { status: "property_claimed" };
    const now = new Date(input.now).toISOString();
    const membership: OwnerPropertyMembership = {
      schemaVersion: 1,
      ownerAccountId: account.id,
      propertyNumber: input.propertyNumber,
      status: "active",
      isPrimary: false,
      createdAt: now,
      updatedAt: now,
      revokedAt: null,
    };
    this.memberships.set(input.propertyNumber, membership);
    return { ...base, account, membership };
  }
}

function fixture(initialNow = 1_800_000_000_000) {
  const store = new MemoryOwnerAccountStore();
  const sent: Array<{ phone: string; message: string }> = [];
  let id = 0;
  let now = initialNow;
  const properties = new Map<string, { propertyNumber: string; whatsappNumber: string | null }>([
    ["P-1", { propertyNumber: "P-1", whatsappNumber: "0551234567" }],
    ["P-2", { propertyNumber: "P-2", whatsappNumber: "0551234567" }],
    ["P-3", { propertyNumber: "P-3", whatsappNumber: "0561234567" }],
  ]);
  const service = new OwnerAccountService(store, {
    secret: "s".repeat(32),
    now: () => now,
    createCode: () => "123456",
    createOpaqueId: () => `${"A".repeat(41)}${String(++id).padStart(2, "0")}`,
    sender: async (phone, message) => {
      sent.push({ phone, message });
      return { success: true };
    },
    propertyReader: async (propertyNumber) => properties.get(propertyNumber) || null,
  });
  return {
    store,
    service,
    sent,
    properties,
    setNow: (value: number) => {
      now = value;
    },
  };
}

function seedAccountWithPrimaryProperty(
  service: OwnerAccountService,
  store: MemoryOwnerAccountStore,
  propertyNumber = "P-1",
): OwnerAccount {
  const timestamp = new Date(1_800_000_000_000).toISOString();
  const account: OwnerAccount = {
    id: "C".repeat(43),
    schemaVersion: 1,
    phoneSubject: service.phoneSubject("0551234567"),
    authVersion: 1,
    status: "active",
    createdAt: timestamp,
    updatedAt: timestamp,
    lastLoginAt: null,
  };
  store.accounts.set(account.id, account);
  store.memberships.set(propertyNumber, {
    schemaVersion: 1,
    ownerAccountId: account.id,
    propertyNumber,
    status: "active",
    isPrimary: true,
    createdAt: timestamp,
    updatedAt: timestamp,
    revokedAt: null,
  });
  return account;
}

test("owner account OTPs are purpose-bound and use the existing generic wording", async () => {
  const { service, sent } = fixture();
  const challenge = await service.issueClaim({
    propertyNumber: "P-1",
    ipAddress: "127.0.0.1",
  });
  assert.equal(challenge.expiresInSeconds, 600);
  assert.equal(challenge.maskedPhone, "05••••4567");
  assert.equal(
    sent[0]?.message,
    "رمز التحقق الخاص بك في روقان هو: 123456\nصالح لمدة 10 دقائق.\nلا تشارك هذا الرمز مع أي شخص.",
  );

  await assert.rejects(
    service.verifyAttach({
      challengeId: challenge.challengeId,
      code: "123456",
      ownerAccountId: `${"B".repeat(43)}`,
      authVersion: 1,
    }),
    (error: unknown) => error instanceof OwnerAccountOtpError &&
      error.code === "CHALLENGE_CONTEXT_INVALID",
  );
  const verified = await service.verifyClaim({
    challengeId: challenge.challengeId,
    code: "123456",
    propertyNumber: "P-1",
  });
  assert.equal(verified.memberships[0]?.propertyNumber, "P-1");
});

test("unknown owner phones receive an indistinguishable rate-limited decoy without an outbound message", async () => {
  const { service, sent, store } = fixture();
  const challenge = await service.issueLogin({
    phone: "0571234567",
    ipAddress: "127.0.0.1",
  });
  assert.match(challenge.challengeId, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(challenge.maskedPhone, "05••••4567");
  assert.equal(challenge.expiresInSeconds, 600);
  assert.equal(sent.length, 0);
  assert.equal(store.challenges.size, 1);
});

test("owner OTP challenges are one-use and enforce the attempt limit", async () => {
  const { service } = fixture();
  const challenge = await service.issueClaim({
    propertyNumber: "P-1",
    ipAddress: "127.0.0.1",
  });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await assert.rejects(
      service.verifyClaim({
        challengeId: challenge.challengeId,
        code: "000000",
        propertyNumber: "P-1",
      }),
      (error: unknown) => error instanceof OwnerAccountOtpError &&
        error.code === "CODE_INVALID",
    );
  }
  await assert.rejects(
    service.verifyClaim({
      challengeId: challenge.challengeId,
      code: "000000",
      propertyNumber: "P-1",
    }),
    (error: unknown) => error instanceof OwnerAccountOtpError &&
      error.code === "ATTEMPTS_EXHAUSTED",
  );

  const second = await service.issueClaim({
    propertyNumber: "P-2",
    ipAddress: "127.0.0.2",
  });
  await service.verifyClaim({
    challengeId: second.challengeId,
    code: "123456",
    propertyNumber: "P-2",
  });
  await assert.rejects(
    service.verifyClaim({
      challengeId: second.challengeId,
      code: "123456",
      propertyNumber: "P-2",
    }),
    (error: unknown) => error instanceof OwnerAccountOtpError &&
      error.code === "CHALLENGE_USED",
  );
});

test("concurrent claims isolate one property to one account", async () => {
  const { service, store } = fixture();
  const first = await service.issueClaim({ propertyNumber: "P-1", ipAddress: "127.0.0.1" });
  const second = await service.issueClaim({ propertyNumber: "P-1", ipAddress: "127.0.0.2" });
  const results = await Promise.allSettled([
    service.verifyClaim({ challengeId: first.challengeId, code: "123456", propertyNumber: "P-1" }),
    service.verifyClaim({ challengeId: second.challengeId, code: "123456", propertyNumber: "P-1" }),
  ]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  assert.equal(store.memberships.size, 1);
});

test("another account cannot attach a claimed or revoked property", async () => {
  const { service, store } = fixture();
  const account: OwnerAccount = {
    id: "C".repeat(43),
    schemaVersion: 1,
    phoneSubject: service.phoneSubject("0551234567"),
    authVersion: 1,
    status: "active",
    createdAt: new Date(1_800_000_000_000).toISOString(),
    updatedAt: new Date(1_800_000_000_000).toISOString(),
    lastLoginAt: null,
  };
  store.accounts.set(account.id, account);
  store.memberships.set("P-1", {
    schemaVersion: 1,
    ownerAccountId: account.id,
    propertyNumber: "P-1",
    status: "active",
    isPrimary: true,
    createdAt: account.createdAt,
    updatedAt: account.createdAt,
    revokedAt: null,
  });
  store.memberships.set("P-3", {
    schemaVersion: 1,
    ownerAccountId: "D".repeat(43),
    propertyNumber: "P-3",
    status: "revoked",
    isPrimary: true,
    createdAt: account.createdAt,
    updatedAt: account.createdAt,
    revokedAt: account.createdAt,
  });
  for (const propertyNumber of ["P-1", "P-3"]) {
    await assert.rejects(
      service.issueAttach({
        ownerAccountId: account.id,
        authVersion: 1,
        currentPropertyNumber: "P-1",
        propertyNumber,
        ipAddress: "127.0.0.1",
      }),
      (error: unknown) => error instanceof OwnerAccountOtpError &&
        error.code === "PROPERTY_ALREADY_CLAIMED",
    );
  }
});

test("attach sends the OTP to the target property's registered phone and adds only that property", async () => {
  const { service, store, sent, properties } = fixture();
  const account = seedAccountWithPrimaryProperty(service, store);
  const primaryMembership = structuredClone(store.memberships.get("P-1"));
  const primaryProperty = structuredClone(properties.get("P-1"));

  const challenge = await service.issueAttach({
    ownerAccountId: account.id,
    authVersion: 1,
    currentPropertyNumber: "P-1",
    propertyNumber: "P-3",
    ipAddress: "127.0.0.1",
  });

  assert.equal(sent.length, 1);
  assert.equal(sent[0]?.phone, "561234567");
  assert.notEqual(sent[0]?.phone, "551234567");

  const storedChallenge = store.challenges.get(challenge.challengeId);
  assert.equal(storedChallenge?.purpose, "attach_property");
  assert.equal(storedChallenge?.ownerAccountId, account.id);
  assert.equal(storedChallenge?.propertyNumber, "P-3");
  assert.equal(
    storedChallenge?.phoneSubject,
    service.phoneSubject("0561234567"),
  );

  const verified = await service.verifyAttach({
    challengeId: challenge.challengeId,
    code: "123456",
    ownerAccountId: account.id,
    authVersion: 1,
  });

  assert.deepEqual(
    verified.memberships.map((membership) => membership.propertyNumber).sort(),
    ["P-1", "P-3"],
  );
  assert.equal(store.memberships.get("P-3")?.isPrimary, false);
  assert.deepEqual(store.memberships.get("P-1"), primaryMembership);
  assert.deepEqual(properties.get("P-1"), primaryProperty);
});

test("an account for 00000 can add 00001 only through the 00001 registered phone", async () => {
  const { service, store, properties, sent } = fixture();
  const account = seedAccountWithPrimaryProperty(service, store, "00000");
  properties.set("00001", { propertyNumber: "00001", whatsappNumber: "0561234567" });

  const challenge = await service.issueAttach({
    ownerAccountId: account.id,
    authVersion: 1,
    currentPropertyNumber: "00000",
    propertyNumber: "00001",
    ipAddress: "127.0.0.1",
  });
  assert.equal(store.challenges.get(challenge.challengeId)?.propertyNumber, "00001");
  assert.equal(sent.at(-1)?.phone, "561234567");
  assert.notEqual(sent.at(-1)?.phone, "551234567");

  const verified = await service.verifyAttach({
    challengeId: challenge.challengeId,
    code: "123456",
    ownerAccountId: account.id,
    authVersion: 1,
  });
  assert.deepEqual(
    verified.memberships.map((membership) => membership.propertyNumber).sort(),
    ["00000", "00001"],
  );
});

test("attach rejects unknown properties and properties without a valid registered phone", async () => {
  const { service, store, properties } = fixture();
  const account = seedAccountWithPrimaryProperty(service, store);

  await assert.rejects(
    service.issueAttach({
      ownerAccountId: account.id,
      authVersion: 1,
      currentPropertyNumber: "P-1",
      propertyNumber: "MISSING",
      ipAddress: "127.0.0.1",
    }),
    (error: unknown) => error instanceof OwnerAccountOtpError &&
      error.code === "PROPERTY_NOT_FOUND",
  );

  properties.set("P-4", { propertyNumber: "P-4", whatsappNumber: null });
  await assert.rejects(
    service.issueAttach({
      ownerAccountId: account.id,
      authVersion: 1,
      currentPropertyNumber: "P-1",
      propertyNumber: "P-4",
      ipAddress: "127.0.0.1",
    }),
    (error: unknown) => error instanceof OwnerAccountOtpError &&
      error.code === "PROPERTY_PHONE_INVALID",
  );
});

test("attach requires an active account membership for the current property", async () => {
  const { service, store } = fixture();
  seedAccountWithPrimaryProperty(service, store);

  await assert.rejects(
    service.issueAttach({
      ownerAccountId: "C".repeat(43),
      authVersion: 1,
      currentPropertyNumber: "P-3",
      propertyNumber: "P-2",
      ipAddress: "127.0.0.1",
    }),
    (error: unknown) => error instanceof OwnerAccountOtpError &&
      error.code === "ACCOUNT_SESSION_INVALID",
  );
});

test("attach fails closed when the target property's phone changes after the challenge is issued", async () => {
  const { service, store, properties } = fixture();
  const account = seedAccountWithPrimaryProperty(service, store);

  const challenge = await service.issueAttach({
    ownerAccountId: account.id,
    authVersion: 1,
    currentPropertyNumber: "P-1",
    propertyNumber: "P-3",
    ipAddress: "127.0.0.1",
  });

  properties.set("P-3", { propertyNumber: "P-3", whatsappNumber: "0551234567" });

  await assert.rejects(
    service.verifyAttach({
      challengeId: challenge.challengeId,
      code: "123456",
      ownerAccountId: account.id,
      authVersion: 1,
    }),
    (error: unknown) => error instanceof OwnerAccountOtpError &&
      error.code === "CHALLENGE_CONTEXT_INVALID",
  );
  assert.equal(store.memberships.has("P-3"), false);
});

test("attach challenges cannot be verified by another account", async () => {
  const { service, store } = fixture();
  const account = seedAccountWithPrimaryProperty(service, store);

  const challenge = await service.issueAttach({
    ownerAccountId: account.id,
    authVersion: 1,
    currentPropertyNumber: "P-1",
    propertyNumber: "P-3",
    ipAddress: "127.0.0.1",
  });

  await assert.rejects(
    service.verifyAttach({
      challengeId: challenge.challengeId,
      code: "123456",
      ownerAccountId: "D".repeat(43),
      authVersion: 1,
    }),
    (error: unknown) => error instanceof OwnerAccountOtpError &&
      error.code === "CHALLENGE_CONTEXT_INVALID",
  );

  await assert.rejects(
    service.verifyAttach({
      challengeId: challenge.challengeId,
      code: "123456",
      ownerAccountId: account.id,
      authVersion: 2,
    }),
    (error: unknown) => error instanceof OwnerAccountOtpError &&
      error.code === "ACCOUNT_SESSION_INVALID",
  );

  assert.equal(store.memberships.has("P-3"), false);
});

test("attach rejects expired and already-consumed challenges", async () => {
  const { service, store, setNow } = fixture();
  const account = seedAccountWithPrimaryProperty(service, store);

  const expired = await service.issueAttach({
    ownerAccountId: account.id,
    authVersion: 1,
    currentPropertyNumber: "P-1",
    propertyNumber: "P-3",
    ipAddress: "127.0.0.1",
  });
  setNow(1_800_000_000_000 + 10 * 60 * 1000 + 1);
  await assert.rejects(
    service.verifyAttach({
      challengeId: expired.challengeId,
      code: "123456",
      ownerAccountId: account.id,
      authVersion: 1,
    }),
    (error: unknown) => error instanceof OwnerAccountOtpError &&
      error.code === "CHALLENGE_EXPIRED",
  );

  const consumed = await service.issueAttach({
    ownerAccountId: account.id,
    authVersion: 1,
    currentPropertyNumber: "P-1",
    propertyNumber: "P-2",
    ipAddress: "127.0.0.2",
  });
  await service.verifyAttach({
    challengeId: consumed.challengeId,
    code: "123456",
    ownerAccountId: account.id,
    authVersion: 1,
  });
  await assert.rejects(
    service.verifyAttach({
      challengeId: consumed.challengeId,
      code: "123456",
      ownerAccountId: account.id,
      authVersion: 1,
    }),
    (error: unknown) => error instanceof OwnerAccountOtpError &&
      error.code === "CHALLENGE_USED",
  );
});

test("concurrent attach verification consumes the challenge exactly once", async () => {
  const { service, store } = fixture();
  const account = seedAccountWithPrimaryProperty(service, store);

  const challenge = await service.issueAttach({
    ownerAccountId: account.id,
    authVersion: 1,
    currentPropertyNumber: "P-1",
    propertyNumber: "P-3",
    ipAddress: "127.0.0.1",
  });

  const results = await Promise.allSettled([
    service.verifyAttach({
      challengeId: challenge.challengeId,
      code: "123456",
      ownerAccountId: account.id,
      authVersion: 1,
    }),
    service.verifyAttach({
      challengeId: challenge.challengeId,
      code: "123456",
      ownerAccountId: account.id,
      authVersion: 1,
    }),
  ]);

  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = results.find(
    (result): result is PromiseRejectedResult => result.status === "rejected",
  );
  assert.ok(rejected);
  assert.ok(rejected.reason instanceof OwnerAccountOtpError);
  assert.equal(rejected.reason.code, "CHALLENGE_USED");
  assert.equal(store.memberships.has("P-3"), true);
});

test("attach reads the target phone from the property record without an owners document", async () => {
  const store = new MemoryOwnerAccountStore();
  const sent: Array<{ phone: string }> = [];
  let id = 0;
  // The attach reader only knows `properties` rows. There is deliberately no
  // owners/{propertyNumber} document anywhere in this test.
  const properties = new Map([
    ["00001", { propertyNumber: "00001", whatsappNumber: "0561234567" }],
  ]);
  const service = new OwnerAccountService(store, {
    secret: "s".repeat(32),
    now: () => 1_800_000_000_000,
    createCode: () => "123456",
    createOpaqueId: () => `${"A".repeat(41)}${String(++id).padStart(2, "0")}`,
    sender: async (phone) => {
      sent.push({ phone });
      return { success: true };
    },
    propertyReader: async () => {
      throw new Error("the claim phone reader must not be used for attach");
    },
    attachPropertyReader: async (propertyNumber) => properties.get(propertyNumber) || null,
  });
  const account = seedAccountWithPrimaryProperty(service, store, "00000");

  const challenge = await service.issueAttach({
    ownerAccountId: account.id,
    authVersion: 1,
    currentPropertyNumber: "00000",
    propertyNumber: "00001",
    ipAddress: "127.0.0.1",
  });
  assert.equal(sent[0]?.phone, "561234567");
  assert.equal(
    store.challenges.get(challenge.challengeId)?.phoneSubject,
    service.phoneSubject("0561234567"),
  );

  const verified = await service.verifyAttach({
    challengeId: challenge.challengeId,
    code: "123456",
    ownerAccountId: account.id,
    authVersion: 1,
  });
  assert.deepEqual(
    verified.memberships.map((membership) => membership.propertyNumber).sort(),
    ["00000", "00001"],
  );
  assert.equal(store.memberships.get("00001")?.isPrimary, false);
});

test("attach re-reads the property phone on verify and rejects a changed number", async () => {
  const store = new MemoryOwnerAccountStore();
  const sent: Array<{ phone: string }> = [];
  let id = 0;
  const properties = new Map<string, { propertyNumber: string; whatsappNumber: string | null }>([
    ["00001", { propertyNumber: "00001", whatsappNumber: "0561234567" }],
  ]);
  const service = new OwnerAccountService(store, {
    secret: "s".repeat(32),
    now: () => 1_800_000_000_000,
    createCode: () => "123456",
    createOpaqueId: () => `${"A".repeat(41)}${String(++id).padStart(2, "0")}`,
    sender: async (phone) => {
      sent.push({ phone });
      return { success: true };
    },
    propertyReader: async () => {
      throw new Error("the claim phone reader must not be used for attach");
    },
    attachPropertyReader: async (propertyNumber) => properties.get(propertyNumber) || null,
  });
  const account = seedAccountWithPrimaryProperty(service, store, "00000");

  const challenge = await service.issueAttach({
    ownerAccountId: account.id,
    authVersion: 1,
    currentPropertyNumber: "00000",
    propertyNumber: "00001",
    ipAddress: "127.0.0.1",
  });
  assert.equal(sent[0]?.phone, "561234567");

  properties.set("00001", { propertyNumber: "00001", whatsappNumber: "0551234567" });

  await assert.rejects(
    service.verifyAttach({
      challengeId: challenge.challengeId,
      code: "123456",
      ownerAccountId: account.id,
      authVersion: 1,
    }),
    (error: unknown) => error instanceof OwnerAccountOtpError &&
      error.code === "CHALLENGE_CONTEXT_INVALID",
  );
  assert.equal(store.memberships.has("00001"), false);
});
