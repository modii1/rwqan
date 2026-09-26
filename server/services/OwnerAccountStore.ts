import { timingSafeEqual } from "node:crypto";

import {
  ownerAccountOtpChallengeSchema,
  ownerAccountPhoneIndexSchema,
  ownerAccountSchema,
  ownerPropertyMembershipSchema,
  type OwnerAccount,
  type OwnerAccountOtpChallenge,
  type OwnerPropertyMembership,
} from "../../shared/owner-accounts";
import { db } from "../config/firebase";
import type {
  CreateOwnerAccountChallengeResult,
  OwnerAccountOtpIssueScope,
  OwnerAccountStore,
  VerifyOwnerLoginChallengeResult,
  VerifyOwnerPropertyChallengeResult,
} from "./OwnerAccountService";

const ACCOUNTS = "owner_accounts";
const PHONE_INDEXES = "owner_account_phone_indexes";
const MEMBERSHIPS = "owner_property_memberships";
const CHALLENGES = "owner_account_otp_challenges";
const ISSUE_LIMITS = "owner_account_otp_issue_limits";

function defaultDatabase(): FirebaseFirestore.Firestore {
  if (!db) throw new Error("Firebase not initialized");
  return db;
}

function dateMillis(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string") return Date.parse(value);
  if (value && typeof value === "object") {
    const candidate = value as {
      toMillis?: () => number;
      seconds?: number;
      nanoseconds?: number;
      _seconds?: number;
      _nanoseconds?: number;
    };
    if (typeof candidate.toMillis === "function") return candidate.toMillis();
    if (typeof candidate.seconds === "number") {
      return candidate.seconds * 1000 +
        Math.floor((candidate.nanoseconds || 0) / 1_000_000);
    }
    if (typeof candidate._seconds === "number") {
      return candidate._seconds * 1000 +
        Math.floor((candidate._nanoseconds || 0) / 1_000_000);
    }
  }
  return Number.NaN;
}

function parseChallenge(
  value: FirebaseFirestore.DocumentData | undefined,
): OwnerAccountOtpChallenge | null {
  const ttlMillis = dateMillis(value?.expiresAtTtl);
  const parsed = ownerAccountOtpChallengeSchema.safeParse({
    ...value,
    expiresAtTtl: Number.isFinite(ttlMillis)
      ? new Date(ttlMillis)
      : value?.expiresAtTtl,
  });
  return parsed.success ? parsed.data : null;
}

function digestMatches(left: unknown, right: unknown): boolean {
  if (
    typeof left !== "string" ||
    typeof right !== "string" ||
    !/^[a-f0-9]{64}$/.test(left) ||
    !/^[a-f0-9]{64}$/.test(right)
  ) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

type ChallengeCheck =
  | { status: "verified"; verifiedAt: string }
  | { status: "invalid"; remainingAttempts: number; updates: Record<string, unknown> }
  | { status: "exhausted"; updates?: Record<string, unknown> }
  | { status: "missing" | "expired" | "used" | "binding_mismatch" };

function checkChallenge(input: {
  challenge: OwnerAccountOtpChallenge | null;
  purpose: OwnerAccountOtpChallenge["purpose"];
  phoneSubject: string;
  ownerAccountId: string | null;
  propertyNumber: string | null;
  candidateCodeHash: string;
  now: number;
}): ChallengeCheck {
  const challenge = input.challenge;
  if (!challenge) return { status: "missing" };
  if (challenge.consumedAt) return { status: "used" };
  const expiry = Date.parse(challenge.expiresAt);
  if (!Number.isFinite(expiry) || expiry <= input.now) {
    return { status: "expired" };
  }
  if (challenge.exhaustedAt || challenge.attemptCount >= challenge.maxAttempts) {
    return { status: "exhausted" };
  }
  if (
    challenge.purpose !== input.purpose ||
    challenge.ownerAccountId !== input.ownerAccountId ||
    challenge.propertyNumber !== input.propertyNumber ||
    !digestMatches(challenge.phoneSubject, input.phoneSubject)
  ) {
    return { status: "binding_mismatch" };
  }
  const updatedAt = new Date(input.now).toISOString();
  if (digestMatches(challenge.codeHash, input.candidateCodeHash)) {
    return { status: "verified", verifiedAt: updatedAt };
  }
  const attemptCount = challenge.attemptCount + 1;
  if (attemptCount >= challenge.maxAttempts) {
    return {
      status: "exhausted",
      updates: { attemptCount, exhaustedAt: updatedAt, updatedAt },
    };
  }
  return {
    status: "invalid",
    remainingAttempts: challenge.maxAttempts - attemptCount,
    updates: { attemptCount, updatedAt },
  };
}

function applyFailedCheck(
  transaction: FirebaseFirestore.Transaction,
  challengeRef: FirebaseFirestore.DocumentReference,
  check: ChallengeCheck,
): void {
  if ("updates" in check && check.updates) {
    transaction.update(challengeRef, check.updates);
  }
}

function consumeVerifiedChallenge(
  transaction: FirebaseFirestore.Transaction,
  challengeRef: FirebaseFirestore.DocumentReference,
  verifiedAt: string,
): void {
  transaction.update(challengeRef, {
    consumedAt: verifiedAt,
    updatedAt: verifiedAt,
  });
}

export class FirestoreOwnerAccountStore implements OwnerAccountStore {
  constructor(
    private readonly getDatabase: () => FirebaseFirestore.Firestore = defaultDatabase,
  ) {}

  async getAccountByPhoneSubject(phoneSubject: string): Promise<OwnerAccount | null> {
    if (!/^[a-f0-9]{64}$/.test(phoneSubject)) return null;
    const databaseInstance = this.getDatabase();
    const indexSnapshot = await databaseInstance
      .collection(PHONE_INDEXES)
      .doc(phoneSubject)
      .get();
    if (!indexSnapshot.exists) return null;
    const index = ownerAccountPhoneIndexSchema.safeParse(indexSnapshot.data());
    if (!index.success || !digestMatches(index.data.phoneSubject, phoneSubject)) {
      return null;
    }
    return this.getAccount(index.data.ownerAccountId);
  }

  async getAccount(id: string): Promise<OwnerAccount | null> {
    const snapshot = await this.getDatabase().collection(ACCOUNTS).doc(id).get();
    if (!snapshot.exists) return null;
    const parsed = ownerAccountSchema.safeParse(snapshot.data());
    return parsed.success && parsed.data.id === id ? parsed.data : null;
  }

  async getChallengeContext(challengeId: string): Promise<Pick<
    OwnerAccountOtpChallenge,
    "purpose" | "ownerAccountId" | "propertyNumber"
  > | null> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(challengeId)) return null;
    const snapshot = await this.getDatabase().collection(CHALLENGES).doc(challengeId).get();
    if (!snapshot.exists) return null;
    const challenge = parseChallenge(snapshot.data());
    return challenge
      ? {
          purpose: challenge.purpose,
          ownerAccountId: challenge.ownerAccountId,
          propertyNumber: challenge.propertyNumber,
        }
      : null;
  }

  async getMembership(propertyNumber: string): Promise<OwnerPropertyMembership | null> {
    const snapshot = await this.getDatabase().collection(MEMBERSHIPS).doc(propertyNumber).get();
    if (!snapshot.exists) return null;
    const parsed = ownerPropertyMembershipSchema.safeParse(snapshot.data());
    return parsed.success && parsed.data.propertyNumber === propertyNumber
      ? parsed.data
      : null;
  }

  async listActiveMemberships(ownerAccountId: string): Promise<OwnerPropertyMembership[]> {
    const snapshot = await this.getDatabase().collection(MEMBERSHIPS)
      .where("ownerAccountId", "==", ownerAccountId)
      .get();
    return snapshot.docs
      .map((document) => ownerPropertyMembershipSchema.safeParse(document.data()))
      .filter((result): result is { success: true; data: OwnerPropertyMembership } =>
        result.success && result.data.ownerAccountId === ownerAccountId &&
        result.data.propertyNumber === result.data.propertyNumber.trim())
      .map((result) => result.data)
      .filter((membership) => membership.status === "active")
      .sort((left, right) => {
        if (left.isPrimary !== right.isPrimary) return left.isPrimary ? -1 : 1;
        return left.createdAt.localeCompare(right.createdAt) ||
          left.propertyNumber.localeCompare(right.propertyNumber);
      });
  }

  async validateActiveMembership(input: {
    ownerAccountId: string;
    authVersion: number;
    propertyNumber: string;
  }): Promise<boolean> {
    const [account, membership] = await Promise.all([
      this.getAccount(input.ownerAccountId),
      this.getMembership(input.propertyNumber),
    ]);
    return Boolean(
      account?.status === "active" &&
      account.authVersion === input.authVersion &&
      membership?.status === "active" &&
      membership.ownerAccountId === input.ownerAccountId,
    );
  }

  async createChallenge(input: {
    challenge: OwnerAccountOtpChallenge;
    ipSubject: string;
    now: number;
    windowMs: number;
    maxIssuesPerIp: number;
    maxIssuesPerPhone: number;
  }): Promise<CreateOwnerAccountChallengeResult> {
    const parsed = ownerAccountOtpChallengeSchema.parse(input.challenge);
    if (!/^[a-f0-9]{64}$/.test(input.ipSubject)) {
      throw new RangeError("Invalid owner OTP IP subject");
    }
    const databaseInstance = this.getDatabase();
    const challengeRef = databaseInstance.collection(CHALLENGES).doc(parsed.id);
    const limits = databaseInstance.collection(ISSUE_LIMITS);
    const ipRef = limits.doc(`ip-${input.ipSubject}`);
    const phoneRef = limits.doc(`phone-${parsed.phoneSubject}`);

    return databaseInstance.runTransaction(async (transaction) => {
      const [challengeSnapshot, ipSnapshot, phoneSnapshot] = await Promise.all([
        transaction.get(challengeRef),
        transaction.get(ipRef),
        transaction.get(phoneRef),
      ]);
      if (challengeSnapshot.exists) return { status: "collision" } as const;

      const readLimit = (
        data: FirebaseFirestore.DocumentData | undefined,
        maxIssues: number,
      ) => {
        const storedStart = Number(data?.windowStartedAt);
        const validStart = Number.isSafeInteger(storedStart) && storedStart >= 0;
        const elapsed = validStart ? Math.max(0, input.now - storedStart) : input.windowMs;
        const active = validStart && elapsed < input.windowMs;
        const count = active && Number.isSafeInteger(Number(data?.issueCount))
          ? Math.max(0, Number(data?.issueCount))
          : 0;
        return {
          windowStartedAt: active ? storedStart : input.now,
          issueCount: count,
          limited: count >= maxIssues,
          retryAfterMs: Math.max(1, input.windowMs - (active ? elapsed : 0)),
        };
      };
      const ip = readLimit(ipSnapshot.data(), input.maxIssuesPerIp);
      const phone = readLimit(phoneSnapshot.data(), input.maxIssuesPerPhone);
      if (ip.limited) {
        return { status: "rate_limited", scope: "ip", retryAfterMs: ip.retryAfterMs } as const;
      }
      if (phone.limited) {
        return { status: "rate_limited", scope: "phone", retryAfterMs: phone.retryAfterMs } as const;
      }

      const updatedAt = new Date(input.now).toISOString();
      const nextLimit = (
        id: string,
        scope: OwnerAccountOtpIssueScope,
        value: { windowStartedAt: number; issueCount: number },
      ) => ({
        id,
        scope,
        windowStartedAt: value.windowStartedAt,
        issueCount: value.issueCount + 1,
        updatedAt,
        expiresAtTtl: new Date(value.windowStartedAt + input.windowMs * 2),
      });
      transaction.set(ipRef, nextLimit(`ip-${input.ipSubject}`, "ip", ip));
      transaction.set(
        phoneRef,
        nextLimit(`phone-${parsed.phoneSubject}`, "phone", phone),
      );
      transaction.create(challengeRef, parsed);
      return { status: "created" } as const;
    });
  }

  async deleteChallenge(challengeId: string): Promise<void> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(challengeId)) return;
    await this.getDatabase().collection(CHALLENGES).doc(challengeId).delete();
  }

  async verifyLoginChallenge(input: {
    challengeId: string;
    phoneSubject: string;
    ownerAccountId: string;
    candidateCodeHash: string;
    now: number;
  }): Promise<VerifyOwnerLoginChallengeResult> {
    const databaseInstance = this.getDatabase();
    const challengeRef = databaseInstance.collection(CHALLENGES).doc(input.challengeId);
    const accountRef = databaseInstance.collection(ACCOUNTS).doc(input.ownerAccountId);
    return databaseInstance.runTransaction(async (transaction) => {
      const [challengeSnapshot, accountSnapshot] = await Promise.all([
        transaction.get(challengeRef),
        transaction.get(accountRef),
      ]);
      const check = checkChallenge({
        challenge: parseChallenge(challengeSnapshot.data()),
        purpose: "login",
        phoneSubject: input.phoneSubject,
        ownerAccountId: input.ownerAccountId,
        propertyNumber: null,
        candidateCodeHash: input.candidateCodeHash,
        now: input.now,
      });
      if (check.status !== "verified") {
        applyFailedCheck(transaction, challengeRef, check);
        return check;
      }
      const account = ownerAccountSchema.safeParse(accountSnapshot.data());
      if (
        !account.success ||
        account.data.id !== input.ownerAccountId ||
        account.data.status !== "active" ||
        !digestMatches(account.data.phoneSubject, input.phoneSubject)
      ) {
        consumeVerifiedChallenge(
          transaction,
          challengeRef,
          check.verifiedAt,
        );
        return { status: "account_unavailable" } as const;
      }

      consumeVerifiedChallenge(transaction, challengeRef, check.verifiedAt);
      transaction.update(accountRef, {
        lastLoginAt: check.verifiedAt,
        updatedAt: check.verifiedAt,
      });
      return {
        status: "verified",
        verifiedAt: check.verifiedAt,
        account: { ...account.data, lastLoginAt: check.verifiedAt, updatedAt: check.verifiedAt },
      } as const;
    });
  }

  async verifyAndClaimProperty(input: {
    challengeId: string;
    phoneSubject: string;
    propertyNumber: string;
    candidateCodeHash: string;
    proposedOwnerAccountId: string;
    now: number;
  }): Promise<VerifyOwnerPropertyChallengeResult> {
    const databaseInstance = this.getDatabase();
    const challengeRef = databaseInstance.collection(CHALLENGES).doc(input.challengeId);
    const membershipRef = databaseInstance.collection(MEMBERSHIPS).doc(input.propertyNumber);
    const phoneIndexRef = databaseInstance.collection(PHONE_INDEXES).doc(input.phoneSubject);
    const proposedAccountRef = databaseInstance.collection(ACCOUNTS).doc(
      input.proposedOwnerAccountId,
    );
    return databaseInstance.runTransaction(async (transaction) => {
      const [challengeSnapshot, membershipSnapshot, phoneIndexSnapshot, proposedSnapshot] =
        await Promise.all([
          transaction.get(challengeRef),
          transaction.get(membershipRef),
          transaction.get(phoneIndexRef),
          transaction.get(proposedAccountRef),
        ]);
      const check = checkChallenge({
        challenge: parseChallenge(challengeSnapshot.data()),
        purpose: "claim_current_property",
        phoneSubject: input.phoneSubject,
        ownerAccountId: null,
        propertyNumber: input.propertyNumber,
        candidateCodeHash: input.candidateCodeHash,
        now: input.now,
      });
      if (check.status !== "verified") {
        applyFailedCheck(transaction, challengeRef, check);
        return check;
      }
      if (membershipSnapshot.exists) {
        transaction.update(challengeRef, {
          consumedAt: check.verifiedAt,
          updatedAt: check.verifiedAt,
        });
        return { status: "property_claimed" } as const;
      }

      const parsedIndex = phoneIndexSnapshot.exists
        ? ownerAccountPhoneIndexSchema.safeParse(phoneIndexSnapshot.data())
        : null;
      if (parsedIndex && !parsedIndex.success) {
        consumeVerifiedChallenge(
          transaction,
          challengeRef,
          check.verifiedAt,
        );
        return { status: "account_unavailable" } as const;
      }
      const ownerAccountId = parsedIndex?.success
        ? parsedIndex.data.ownerAccountId
        : input.proposedOwnerAccountId;
      const accountRef = databaseInstance.collection(ACCOUNTS).doc(ownerAccountId);
      const accountSnapshot = ownerAccountId === input.proposedOwnerAccountId
        ? proposedSnapshot
        : await transaction.get(accountRef);
      const existingMemberships = parsedIndex?.success
        ? await transaction.get(
          databaseInstance.collection(MEMBERSHIPS)
            .where("ownerAccountId", "==", ownerAccountId),
        )
        : null;
      let account: OwnerAccount;
      if (parsedIndex?.success) {
        const parsedAccount = ownerAccountSchema.safeParse(accountSnapshot.data());
        if (
          !parsedAccount.success ||
          parsedAccount.data.status !== "active" ||
          !digestMatches(parsedAccount.data.phoneSubject, input.phoneSubject)
        ) {
          consumeVerifiedChallenge(
            transaction,
            challengeRef,
            check.verifiedAt,
          );
          return { status: "account_unavailable" } as const;
        }
        account = parsedAccount.data;
      } else {
        if (accountSnapshot.exists) {
          consumeVerifiedChallenge(
            transaction,
            challengeRef,
            check.verifiedAt,
          );
          return { status: "account_unavailable" } as const;
        }
        account = {
          id: ownerAccountId,
          schemaVersion: 1,
          phoneSubject: input.phoneSubject,
          authVersion: 1,
          status: "active",
          createdAt: check.verifiedAt,
          updatedAt: check.verifiedAt,
          lastLoginAt: check.verifiedAt,
        };
      }
      const hasActiveMembership = Boolean(existingMemberships?.docs.some((document) => {
        const parsed = ownerPropertyMembershipSchema.safeParse(document.data());
        return parsed.success && parsed.data.status === "active";
      }));
      const membership: OwnerPropertyMembership = {
        schemaVersion: 1,
        ownerAccountId,
        propertyNumber: input.propertyNumber,
        status: "active",
        isPrimary: !hasActiveMembership,
        createdAt: check.verifiedAt,
        updatedAt: check.verifiedAt,
        revokedAt: null,
      };

      consumeVerifiedChallenge(transaction, challengeRef, check.verifiedAt);
      if (!parsedIndex?.success) {
        transaction.create(accountRef, account);
        transaction.create(phoneIndexRef, {
          schemaVersion: 1,
          phoneSubject: input.phoneSubject,
          ownerAccountId,
          createdAt: check.verifiedAt,
          updatedAt: check.verifiedAt,
        });
      } else {
        account = { ...account, lastLoginAt: check.verifiedAt, updatedAt: check.verifiedAt };
        transaction.update(accountRef, {
          lastLoginAt: check.verifiedAt,
          updatedAt: check.verifiedAt,
        });
      }
      transaction.create(membershipRef, membership);
      return {
        status: "verified",
        account,
        membership,
        verifiedAt: check.verifiedAt,
      } as const;
    });
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
    const databaseInstance = this.getDatabase();
    const challengeRef = databaseInstance.collection(CHALLENGES).doc(input.challengeId);
    const accountRef = databaseInstance.collection(ACCOUNTS).doc(input.ownerAccountId);
    const membershipRef = databaseInstance.collection(MEMBERSHIPS).doc(input.propertyNumber);
    return databaseInstance.runTransaction(async (transaction) => {
      const [challengeSnapshot, accountSnapshot, membershipSnapshot] = await Promise.all([
        transaction.get(challengeRef),
        transaction.get(accountRef),
        transaction.get(membershipRef),
      ]);
      const check = checkChallenge({
        challenge: parseChallenge(challengeSnapshot.data()),
        purpose: "attach_property",
        phoneSubject: input.phoneSubject,
        ownerAccountId: input.ownerAccountId,
        propertyNumber: input.propertyNumber,
        candidateCodeHash: input.candidateCodeHash,
        now: input.now,
      });
      if (check.status !== "verified") {
        applyFailedCheck(transaction, challengeRef, check);
        return check;
      }
      const account = ownerAccountSchema.safeParse(accountSnapshot.data());
      if (
        !account.success ||
        account.data.status !== "active" ||
        account.data.authVersion !== input.authVersion
      ) {
        consumeVerifiedChallenge(
          transaction,
          challengeRef,
          check.verifiedAt,
        );
        return { status: "account_unavailable" } as const;
      }
      if (membershipSnapshot.exists) {
        transaction.update(challengeRef, {
          consumedAt: check.verifiedAt,
          updatedAt: check.verifiedAt,
        });
        return { status: "property_claimed" } as const;
      }
      const membership: OwnerPropertyMembership = {
        schemaVersion: 1,
        ownerAccountId: input.ownerAccountId,
        propertyNumber: input.propertyNumber,
        status: "active",
        isPrimary: false,
        createdAt: check.verifiedAt,
        updatedAt: check.verifiedAt,
        revokedAt: null,
      };
      consumeVerifiedChallenge(transaction, challengeRef, check.verifiedAt);
      transaction.create(membershipRef, membership);
      return {
        status: "verified",
        account: account.data,
        membership,
        verifiedAt: check.verifiedAt,
      } as const;
    });
  }
}

export const ownerAccountStore = new FirestoreOwnerAccountStore();
