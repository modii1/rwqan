import assert from "node:assert/strict";
import test from "node:test";

import {
  ReceiptDuplicateGuard,
  hashReceiptContent,
  hashReceiptReference,
  normalizeClaimReference,
  type ReceiptClaimCollection,
  type ReceiptClaimStore,
  type ReceiptClaimResult,
} from "./ReceiptDuplicateGuard";

type Entry = { paymentId: string; status: "claimed" | "finalized" };

/**
 * In-memory store that behaves like the Firestore transaction: the
 * check-and-set happens synchronously, so two concurrent calls cannot both
 * create the same claim.
 */
class MemoryReceiptClaimStore implements ReceiptClaimStore {
  readonly entries = new Map<string, Entry>();

  private key(collection: ReceiptClaimCollection, id: string) {
    return `${collection}/${id}`;
  }

  async claim(collection: ReceiptClaimCollection, id: string, paymentId: string) {
    const key = this.key(collection, id);
    const existing = this.entries.get(key);
    if (existing && existing.paymentId !== paymentId) {
      return { claimed: false, ownerPaymentId: existing.paymentId };
    }
    this.entries.set(key, {
      paymentId,
      status: existing?.status ?? "claimed",
    });
    return { claimed: true, ownerPaymentId: paymentId };
  }

  async finalize(
    collection: ReceiptClaimCollection,
    id: string,
    paymentId: string,
  ) {
    const key = this.key(collection, id);
    const existing = this.entries.get(key);
    if (!existing || existing.paymentId !== paymentId) return;
    this.entries.set(key, { paymentId, status: "finalized" });
  }

  async release(collection: ReceiptClaimCollection, id: string, paymentId: string) {
    const key = this.key(collection, id);
    const existing = this.entries.get(key);
    if (!existing || existing.paymentId !== paymentId) return;
    if (existing.status === "finalized") return;
    this.entries.delete(key);
  }
}

const RECEIPT_BYTES = Buffer.from("synthetic receipt bytes");
const OTHER_BYTES = Buffer.from("a different synthetic receipt");

test("the same receipt image can only be claimed by one payment", async () => {
  const store = new MemoryReceiptClaimStore();
  const guard = new ReceiptDuplicateGuard(store);
  const hash = hashReceiptContent(RECEIPT_BYTES);

  const first = await guard.claimFingerprint(hash, "PAY-1");
  const second = await guard.claimFingerprint(hash, "PAY-2");

  assert.equal(first.status, "claimed");
  assert.equal(second.status, "duplicate");
  if (second.status === "duplicate") {
    assert.equal(second.ownerPaymentId, "PAY-1");
  }
});

test("re-claiming the same receipt for the same payment is idempotent", async () => {
  const store = new MemoryReceiptClaimStore();
  const guard = new ReceiptDuplicateGuard(store);
  const hash = hashReceiptContent(RECEIPT_BYTES);

  assert.equal((await guard.claimFingerprint(hash, "PAY-1")).status, "claimed");
  assert.equal((await guard.claimFingerprint(hash, "PAY-1")).status, "claimed");
});

test("two concurrent uploads of the same image produce exactly one winner", async () => {
  const store = new MemoryReceiptClaimStore();
  const guard = new ReceiptDuplicateGuard(store);
  const hash = hashReceiptContent(RECEIPT_BYTES);

  const outcomes: ReceiptClaimResult[] = await Promise.all([
    guard.claimFingerprint(hash, "PAY-A"),
    guard.claimFingerprint(hash, "PAY-B"),
  ]);

  assert.equal(outcomes.filter((item) => item.status === "claimed").length, 1);
  assert.equal(outcomes.filter((item) => item.status === "duplicate").length, 1);
});

test("a released claim can be reused, but a finalized claim cannot", async () => {
  const store = new MemoryReceiptClaimStore();
  const guard = new ReceiptDuplicateGuard(store);
  const hash = hashReceiptContent(RECEIPT_BYTES);

  await guard.claimFingerprint(hash, "PAY-1");
  await guard.releaseFingerprint(hash, "PAY-1");
  assert.equal((await guard.claimFingerprint(hash, "PAY-2")).status, "claimed");

  await guard.finalizeFingerprint(hash, "PAY-2", { recommendation: "مراجعة_يدوية" });
  await guard.releaseFingerprint(hash, "PAY-2");
  assert.equal((await guard.claimFingerprint(hash, "PAY-3")).status, "duplicate");
});

test("the same bank reference can only back one payment", async () => {
  const store = new MemoryReceiptClaimStore();
  const guard = new ReceiptDuplicateGuard(store);

  const first = await guard.claimReference("  tx-abcd-1234 ", "PAY-1");
  const second = await guard.claimReference("TXABCD1234", "PAY-2");

  assert.equal(first.status, "claimed");
  assert.equal(second.status, "duplicate");
  assert.equal(normalizeClaimReference("  tx-abcd-1234 "), "TXABCD1234");
});

test("different references are independent", async () => {
  const store = new MemoryReceiptClaimStore();
  const guard = new ReceiptDuplicateGuard(store);

  assert.equal((await guard.claimReference("TX-111111", "PAY-1")).status, "claimed");
  assert.equal((await guard.claimReference("TX-222222", "PAY-2")).status, "claimed");
});

test("too-short references are skipped instead of blocking payments", async () => {
  const store = new MemoryReceiptClaimStore();
  const guard = new ReceiptDuplicateGuard(store);

  const result = await guard.claimReference("123", "PAY-1");
  assert.equal(result.status, "skipped");
  assert.equal(store.entries.size, 0);
});

test("the persisted reference index contains only hashes", async () => {
  const store = new MemoryReceiptClaimStore();
  const guard = new ReceiptDuplicateGuard(store);
  const reference = "TX-SECRET-REFERENCE";

  await guard.claimReference(reference, "PAY-1");
  const keys = Array.from(store.entries.keys());
  assert.equal(keys.length, 1);
  assert.ok(!keys[0].includes(reference));
  assert.ok(keys[0].includes(hashReceiptReference(normalizeClaimReference(reference))));
});
