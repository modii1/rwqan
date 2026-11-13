/**
 * Atomic receipt/reference duplicate guard.
 *
 * The same receipt image (SHA-256 of the bytes) may only be used for one
 * payment. A bank transfer reference / transaction id may also only back one
 * payment. The claim is performed inside a Firestore transaction, so two
 * concurrent uploads cannot both win the same key.
 *
 * Only hashes are stored for references; the raw bank reference is never
 * persisted in the duplicate index.
 */
import { createHash } from "node:crypto";
import { getActiveFirestore } from "../config/dataEnvironment";
import { normalizeReference } from "../utils/receiptMatching";

export const RECEIPT_FINGERPRINT_COLLECTION = "receipt_fingerprints";
export const RECEIPT_REFERENCE_COLLECTION = "receipt_references";

export type ReceiptClaimCollection =
  | typeof RECEIPT_FINGERPRINT_COLLECTION
  | typeof RECEIPT_REFERENCE_COLLECTION;

export type ReceiptClaimResult =
  | { status: "claimed"; key: string }
  | { status: "duplicate"; key: string; ownerPaymentId: string }
  | { status: "skipped"; reason: string };

export interface ReceiptClaimStore {
  claim(
    collection: ReceiptClaimCollection,
    key: string,
    paymentId: string,
  ): Promise<{ claimed: boolean; ownerPaymentId: string | null }>;
  finalize(
    collection: ReceiptClaimCollection,
    key: string,
    paymentId: string,
    metadata?: Record<string, unknown>,
  ): Promise<void>;
  release(
    collection: ReceiptClaimCollection,
    key: string,
    paymentId: string,
  ): Promise<void>;
}

export function hashReceiptContent(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

export function normalizeClaimReference(value: unknown): string {
  return normalizeReference(value);
}

export function hashReceiptReference(normalizedReference: string): string {
  return createHash("sha256").update(normalizedReference).digest("hex");
}

export class ReceiptDuplicateGuard {
  constructor(private readonly store: ReceiptClaimStore) {}

  async claimFingerprint(
    hash: string,
    paymentId: string,
  ): Promise<ReceiptClaimResult> {
    const normalized = String(hash ?? "").trim().toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(normalized)) {
      return { status: "skipped", reason: "invalid_fingerprint" };
    }
    const result = await this.store.claim(
      RECEIPT_FINGERPRINT_COLLECTION,
      normalized,
      paymentId,
    );
    if (!result.claimed) {
      return {
        status: "duplicate",
        key: normalized,
        ownerPaymentId: result.ownerPaymentId ?? "",
      };
    }
    return { status: "claimed", key: normalized };
  }

  async claimReference(
    reference: unknown,
    paymentId: string,
  ): Promise<ReceiptClaimResult> {
    const normalized = normalizeClaimReference(reference);
    // Too-short references are not unique enough to reserve.
    if (normalized.length < 6) {
      return { status: "skipped", reason: "reference_too_short" };
    }
    const key = hashReceiptReference(normalized);
    const result = await this.store.claim(
      RECEIPT_REFERENCE_COLLECTION,
      key,
      paymentId,
    );
    if (!result.claimed) {
      return {
        status: "duplicate",
        key,
        ownerPaymentId: result.ownerPaymentId ?? "",
      };
    }
    return { status: "claimed", key };
  }

  async finalizeFingerprint(
    hash: string,
    paymentId: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.store.finalize(
      RECEIPT_FINGERPRINT_COLLECTION,
      String(hash ?? "").trim().toLowerCase(),
      paymentId,
      metadata,
    );
  }

  async finalizeReference(
    referenceHash: string,
    paymentId: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await this.store.finalize(
      RECEIPT_REFERENCE_COLLECTION,
      referenceHash,
      paymentId,
      metadata,
    );
  }

  async releaseFingerprint(hash: string, paymentId: string): Promise<void> {
    await this.store.release(
      RECEIPT_FINGERPRINT_COLLECTION,
      String(hash ?? "").trim().toLowerCase(),
      paymentId,
    );
  }
}

/** Firestore-backed store used by the running server. */
export function createFirestoreReceiptClaimStore(): ReceiptClaimStore {
  return {
    async claim(collection, key, paymentId) {
      const db = getActiveFirestore();
      return db.runTransaction(async (transaction) => {
        const ref = db.collection(collection).doc(key);
        const snapshot = await transaction.get(ref);
        const now = new Date().toISOString();
        if (snapshot.exists) {
          const data = snapshot.data() as
            | { paymentId?: unknown; status?: unknown }
            | undefined;
          const ownerPaymentId = String(data?.paymentId ?? "");
          if (ownerPaymentId && ownerPaymentId !== paymentId) {
            return { claimed: false, ownerPaymentId };
          }
          transaction.set(
            ref,
            { paymentId, status: "claimed", updatedAt: now },
            { merge: true },
          );
          return { claimed: true, ownerPaymentId: paymentId };
        }
        transaction.set(ref, {
          paymentId,
          status: "claimed",
          createdAt: now,
          updatedAt: now,
        });
        return { claimed: true, ownerPaymentId: paymentId };
      });
    },

    async finalize(collection, key, paymentId, metadata) {
      const db = getActiveFirestore();
      await db.runTransaction(async (transaction) => {
        const ref = db.collection(collection).doc(key);
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists) return;
        const data = snapshot.data() as { paymentId?: unknown } | undefined;
        if (String(data?.paymentId ?? "") !== paymentId) return;
        transaction.set(
          ref,
          {
            ...(metadata ?? {}),
            status: "finalized",
            updatedAt: new Date().toISOString(),
          },
          { merge: true },
        );
      });
    },

    async release(collection, key, paymentId) {
      const db = getActiveFirestore();
      await db.runTransaction(async (transaction) => {
        const ref = db.collection(collection).doc(key);
        const snapshot = await transaction.get(ref);
        if (!snapshot.exists) return;
        const data = snapshot.data() as
          | { paymentId?: unknown; status?: unknown }
          | undefined;
        if (String(data?.paymentId ?? "") !== paymentId) return;
        // Never release a finalized claim: it is the durable proof of use.
        if (String(data?.status ?? "") === "finalized") return;
        transaction.delete(ref);
      });
    },
  };
}

let defaultGuard: ReceiptDuplicateGuard | null = null;

export function receiptDuplicateGuard(): ReceiptDuplicateGuard {
  if (!defaultGuard) {
    defaultGuard = new ReceiptDuplicateGuard(createFirestoreReceiptClaimStore());
  }
  return defaultGuard;
}

/**
 * Test-only seam. Production code never calls this; it lets route tests use an
 * in-memory store without touching Firestore.
 */
export function setReceiptDuplicateGuardForTests(
  guard: ReceiptDuplicateGuard | null,
): void {
  defaultGuard = guard;
}
