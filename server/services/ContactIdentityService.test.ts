import assert from "node:assert/strict";
import test from "node:test";
import type { ContactIdentitySession } from "../../shared/schema";
import {
  CONTACT_IDENTITY_MAX_AGE_MS,
  ContactIdentityService,
  getContactIdentityCookieOptions,
  maskContactPhone,
  type ContactIdentityStore,
} from "./ContactIdentityService";

const TOKEN_A = "a".repeat(43);
const TOKEN_B = "b".repeat(43);
const VISITOR_A = "v".repeat(43);

class MemoryContactIdentityStore implements ContactIdentityStore {
  readonly sessions = new Map<string, ContactIdentitySession>();
  readonly previousIds: Array<string | undefined> = [];
  issueLimitAllowed = true;

  async getContactIdentitySession(id: string): Promise<ContactIdentitySession | null> {
    return this.sessions.get(id) || null;
  }

  async replaceContactIdentitySession(
    session: ContactIdentitySession,
    previousId?: string,
  ): Promise<void> {
    this.sessions.set(session.id, session);
    if (previousId && previousId !== session.id) this.sessions.delete(previousId);
    this.previousIds.push(previousId);
  }

  async deleteContactIdentitySession(id: string): Promise<void> {
    this.sessions.delete(id);
  }

  async consumeContactIdentityIssueLimit() {
    return this.issueLimitAllowed
      ? { allowed: true as const, retryAfterMs: 0 as const }
      : { allowed: false as const, retryAfterMs: 30_000 };
  }
}

test("issues an opaque remembered-contact token and resolves the canonical phone", async () => {
  const store = new MemoryContactIdentityStore();
  const now = Date.parse("2026-07-22T12:00:00.000Z");
  const service = new ContactIdentityService(store, {
    now: () => now,
    createToken: () => TOKEN_A,
    createVisitorId: () => VISITOR_A,
  });

  const issued = await service.issueVerified("+966 51 234 5678");
  assert.equal(issued.token, TOKEN_A);
  assert.equal(issued.clientPhone, "512345678");
  assert.equal(issued.visitorId, VISITOR_A);
  assert.equal(issued.expiresAt, new Date(now + CONTACT_IDENTITY_MAX_AGE_MS).toISOString());
  assert.equal(store.sessions.has(TOKEN_A), false, "raw tokens must never be Firestore IDs");
  assert.equal(store.sessions.has(service.hashToken(TOKEN_A)), true);
  assert.equal(
    store.sessions.get(service.hashToken(TOKEN_A))?.expiresAtTtl.getTime(),
    now + CONTACT_IDENTITY_MAX_AGE_MS,
  );
  assert.equal(JSON.stringify([...store.sessions.values()]).includes(TOKEN_A), false);

  assert.deepEqual(await service.resolve(TOKEN_A), {
    clientPhone: "512345678",
    sessionId: service.hashToken(TOKEN_A),
    visitorId: VISITOR_A,
    verifiedAt: new Date(now).toISOString(),
    expiresAt: issued.expiresAt,
  });
});

test("rotates the token when the contact phone changes", async () => {
  const store = new MemoryContactIdentityStore();
  const tokens = [TOKEN_A, TOKEN_B];
  let visitorIdCreations = 0;
  const service = new ContactIdentityService(store, {
    createToken: () => tokens.shift()!,
    createVisitorId: () => {
      visitorIdCreations += 1;
      return VISITOR_A;
    },
  });

  await service.issueVerified("0512345678");
  const changed = await service.issueVerified("0598765432", TOKEN_A);

  assert.equal(changed.token, TOKEN_B);
  assert.equal(changed.visitorId, VISITOR_A);
  assert.equal(await service.resolve(TOKEN_A), null);
  assert.equal((await service.resolve(TOKEN_B))?.clientPhone, "598765432");
  assert.equal((await service.resolve(TOKEN_B))?.visitorId, VISITOR_A);
  assert.equal(visitorIdCreations, 1, "token rotation must not rotate the visitor identity");
  assert.equal(store.previousIds.at(-1), service.hashToken(TOKEN_A));
});

test("legacy unverified sessions are rejected and cannot authorize a customer", async () => {
  const store = new MemoryContactIdentityStore();
  const now = Date.parse("2026-07-22T12:00:00.000Z");
  const service = new ContactIdentityService(store, {
    now: () => now,
    createToken: () => TOKEN_B,
    createVisitorId: () => VISITOR_A,
  });
  const legacySessionId = service.hashToken(TOKEN_A);
  store.sessions.set(legacySessionId, {
    id: legacySessionId,
    clientPhone: "512345678",
    createdAt: new Date(now).toISOString(),
    updatedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + CONTACT_IDENTITY_MAX_AGE_MS).toISOString(),
    expiresAtTtl: new Date(now + CONTACT_IDENTITY_MAX_AGE_MS),
  });

  assert.equal(await service.resolve(TOKEN_A), null);
  assert.equal(store.sessions.has(legacySessionId), false);

  const verified = await service.issueVerified("0598765432", TOKEN_A);
  assert.equal(verified.visitorId, VISITOR_A);
  assert.equal(store.sessions.get(service.hashToken(TOKEN_B))?.verificationVersion, 1);
});

test("rejects malformed, expired, and invalid-phone identities", async () => {
  const store = new MemoryContactIdentityStore();
  let now = Date.parse("2026-07-22T12:00:00.000Z");
  const service = new ContactIdentityService(store, {
    now: () => now,
    createToken: () => TOKEN_A,
    createVisitorId: () => VISITOR_A,
  });

  await assert.rejects(() => service.issueVerified("0412345678"), RangeError);
  assert.equal(await service.resolve("not-a-token"), null);

  await service.issueVerified("0512345678");
  now += CONTACT_IDENTITY_MAX_AGE_MS;
  assert.equal(await service.resolve(TOKEN_A), null);
  assert.equal(store.sessions.size, 0, "expired server records are deleted lazily");
});

test("revocation is idempotent and phone masking never returns the full number", async () => {
  const store = new MemoryContactIdentityStore();
  const service = new ContactIdentityService(store, {
    createToken: () => TOKEN_A,
    createVisitorId: () => VISITOR_A,
  });

  await service.issueVerified("0512345678");
  await service.revoke(TOKEN_A);
  await service.revoke(TOKEN_A);

  assert.equal(await service.resolve(TOKEN_A), null);
  assert.equal(maskContactPhone("0512345678"), "05•• ••5678");
  assert.equal(maskContactPhone("invalid"), null);
});

test("contact identity cookies are protected and persist for ninety days", () => {
  const options = getContactIdentityCookieOptions();
  assert.equal(options.httpOnly, true);
  assert.equal(options.sameSite, "lax");
  assert.equal(options.path, "/");
  assert.equal(options.maxAge, CONTACT_IDENTITY_MAX_AGE_MS);
});
