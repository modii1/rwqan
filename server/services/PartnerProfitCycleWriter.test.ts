import assert from "node:assert/strict";
import test from "node:test";
import {
  assertCycleDeletable,
  assertCycleMutable,
  buildCycleRecalcPayload,
  createPartnerProfitCycle,
  deletePartnerProfitCycle,
  isRecalcField,
  setLiveCycleDbForTests,
  updatePartnerProfitCycle,
} from "./PartnerProfitCycleWriter";
import type { PartnerProfit } from "../../shared/schema";

function makeProfit(overrides: Partial<PartnerProfit> = {}): PartnerProfit {
  return {
    id: "PP-2026-11",
    monthYear: "2026-11",
    status: "pending_review",
    activeSubscriptions: 2,
    totalRevenue: 80,
    revenueAfterFees: 77.24,
    totalExpenses: 20,
    netProfitAfterExpenses: 57.24,
    carriedLossForward: 0,
    carriedLossRemaining: 0,
    distributableProfit: 57.24,
    partnerShare: 28.62,
    partnerPercentage: 50,
    ourShare: 28.62,
    owedToPartner: 28.62,
    transferredToPartner: 0,
    remainingToTransfer: 28.62,
    transfers: [],
    transferStatus: "pending",
    ...overrides,
  } as PartnerProfit;
}

interface FakeDbState {
  db: any;
  docs: Map<string, PartnerProfit>;
  calls: {
    updates: Array<{ id: string; data: Record<string, unknown> }>;
    deletes: string[];
    sets: Array<{ id: string; data: Record<string, unknown> }>;
  };
}

function makeFakeDb(initial: PartnerProfit[] = []): FakeDbState {
  const docs = new Map(initial.map((doc) => [doc.id, { ...doc }]));
  const calls: FakeDbState["calls"] = { updates: [], deletes: [], sets: [] };

  const makeRef = (id: string) => ({ id, path: `partner_profits/${id}` });

  const db: any = {
    collection(name: string) {
      assert.equal(name, "partner_profits", "writer must only touch partner_profits");
      return {
        doc(id: string) {
          return makeRef(id);
        },
        where(field: string, _op: string, value: unknown) {
          return {
            limit(_n: number) {
              return { __query: true, field, value };
            },
          };
        },
      };
    },
    async runTransaction(fn: (tx: any) => unknown) {
      const tx = {
        async get(refOrQuery: any) {
          if (refOrQuery?.__query) {
            const matches = [...docs.values()].filter(
              (doc) => (doc as any)[refOrQuery.field] === refOrQuery.value
            );
            return {
              empty: matches.length === 0,
              size: matches.length,
              docs: matches.map((doc) => ({ data: () => doc })),
            };
          }
          const data = docs.get(refOrQuery.id);
          return {
            exists: Boolean(data),
            data: () => data,
          };
        },
        update(ref: any, data: Record<string, unknown>) {
          calls.updates.push({ id: ref.id, data });
          const current = docs.get(ref.id);
          if (current) docs.set(ref.id, { ...current, ...data } as PartnerProfit);
        },
        delete(ref: any) {
          calls.deletes.push(ref.id);
          docs.delete(ref.id);
        },
        set(ref: any, data: Record<string, unknown>) {
          calls.sets.push({ id: ref.id, data });
          docs.set(ref.id, data as PartnerProfit);
        },
      };
      return fn(tx);
    },
  };

  return { db, docs, calls };
}

test.afterEach(() => {
  setLiveCycleDbForTests(undefined);
});

test("buildCycleRecalcPayload keeps only derived fields and drops protected fields", () => {
  const payload = buildCycleRecalcPayload({
    id: "PP-1",
    monthYear: "2026-11",
    status: "pending_review",
    transfers: [{ id: "T1", amount: 10, date: "2026-11-01" }],
    transferredToPartner: 10,
    transferStatus: "pending",
    notes: "secret",
    createdAt: "2026-01-01",
    revenueAfterFees: 77.24,
    totalExpenses: 20,
    partnerShare: 28.62,
  } as any);

  assert.equal(payload.revenueAfterFees, 77.24);
  assert.equal(payload.totalExpenses, 20);
  assert.equal(payload.partnerShare, 28.62);
  for (const protectedField of [
    "id",
    "monthYear",
    "status",
    "transfers",
    "transferredToPartner",
    "transferStatus",
    "notes",
    "createdAt",
  ]) {
    assert.equal(
      protectedField in payload,
      false,
      `${protectedField} must never be recalculated`
    );
  }
});

test("isRecalcField reflects the allowlist", () => {
  assert.equal(isRecalcField("revenueAfterFees"), true);
  assert.equal(isRecalcField("transfers"), false);
  assert.equal(isRecalcField("status"), false);
});

test("assertCycleMutable rejects closed and historical cycles", () => {
  assert.throws(() => assertCycleMutable(makeProfit({ status: "closed" })), /مقفلة أو تاريخية/);
  assert.throws(
    () => assertCycleMutable({ status: undefined } as any),
    /مقفلة أو تاريخية/
  );
  assert.doesNotThrow(() => assertCycleMutable(makeProfit({ status: "pending_review" })));
  assert.doesNotThrow(() => assertCycleMutable(makeProfit({ status: "draft" })));
});

test("assertCycleDeletable rejects closed cycles and cycles with transfers", () => {
  assert.throws(
    () => assertCycleDeletable(makeProfit({ status: "closed" })),
    /مقفلة أو تاريخية/
  );
  assert.throws(
    () => assertCycleDeletable(makeProfit({ status: undefined } as any)),
    /مقفلة أو تاريخية/
  );
  assert.throws(
    () =>
      assertCycleDeletable(
        makeProfit({
          transfers: [{ id: "T1", amount: 10, date: "2026-11-01" }],
        })
      ),
    /مرتبطة بتحويلات/
  );
  assert.throws(
    () => assertCycleDeletable(makeProfit({ transferredToPartner: 5 })),
    /مرتبطة بتحويلات/
  );
  assert.doesNotThrow(() => assertCycleDeletable(makeProfit()));
});

test("LIVE path updates only derived fields on an unlocked cycle", async () => {
  const { db, calls, docs } = makeFakeDb([makeProfit({ notes: "keep me" })]);
  setLiveCycleDbForTests(db);

  const result = await updatePartnerProfitCycle("PP-2026-11", {
    id: "PP-2026-11",
    monthYear: "2026-11",
    status: "pending_review",
    transfers: [],
    transferredToPartner: 0,
    notes: "keep me",
    revenueAfterFees: 70,
    totalExpenses: 15,
    partnerShare: 27.5,
  } as Partial<PartnerProfit>);

  assert.ok(result);
  assert.equal(calls.updates.length, 1);
  const { data } = calls.updates[0];
  assert.equal(data.revenueAfterFees, 70);
  assert.equal(data.totalExpenses, 15);
  assert.equal(data.partnerShare, 27.5);
  assert.equal("status" in data, false);
  assert.equal("transfers" in data, false);
  assert.equal("notes" in data, false);
  assert.equal("monthYear" in data, false);
  // Protected data in the stored document is preserved.
  assert.equal(docs.get("PP-2026-11")?.status, "pending_review");
  assert.equal(docs.get("PP-2026-11")?.notes, "keep me");
});

test("LIVE path refuses to recalculate a closed cycle", async () => {
  const { db, calls } = makeFakeDb([makeProfit({ status: "closed" })]);
  setLiveCycleDbForTests(db);

  await assert.rejects(
    () =>
      updatePartnerProfitCycle("PP-2026-11", {
        revenueAfterFees: 70,
      } as Partial<PartnerProfit>),
    /مقفلة أو تاريخية/
  );
  assert.equal(calls.updates.length, 0);
});

test("LIVE path deletes an unlocked cycle without transfers", async () => {
  const { db, calls, docs } = makeFakeDb([makeProfit()]);
  setLiveCycleDbForTests(db);

  const deleted = await deletePartnerProfitCycle("PP-2026-11");
  assert.equal(deleted, true);
  assert.deepEqual(calls.deletes, ["PP-2026-11"]);
  assert.equal(docs.has("PP-2026-11"), false);
});

test("LIVE path refuses to delete a closed cycle", async () => {
  const { db, calls } = makeFakeDb([makeProfit({ status: "closed" })]);
  setLiveCycleDbForTests(db);

  await assert.rejects(
    () => deletePartnerProfitCycle("PP-2026-11"),
    /مقفلة أو تاريخية/
  );
  assert.equal(calls.deletes.length, 0);
});

test("LIVE path refuses to delete a cycle with transfers", async () => {
  const { db, calls } = makeFakeDb([
    makeProfit({
      transferredToPartner: 10,
      transfers: [{ id: "T1", amount: 10, date: "2026-11-01" }],
    }),
  ]);
  setLiveCycleDbForTests(db);

  await assert.rejects(
    () => deletePartnerProfitCycle("PP-2026-11"),
    /مرتبطة بتحويلات/
  );
  assert.equal(calls.deletes.length, 0);
});

test("LIVE path refuses to create a duplicate cycle for the same month", async () => {
  const { db, calls } = makeFakeDb([makeProfit()]);
  setLiveCycleDbForTests(db);

  await assert.rejects(
    () =>
      createPartnerProfitCycle({
        monthYear: "2026-11",
        activeSubscriptions: 0,
        totalRevenue: 0,
        revenueAfterFees: 0,
        totalExpenses: 0,
        netProfitAfterExpenses: 0,
        carriedLossForward: 0,
        carriedLossRemaining: 0,
        distributableProfit: 0,
        partnerShare: 0,
        partnerPercentage: 50,
        ourShare: 0,
        owedToPartner: 0,
        transferredToPartner: 0,
        remainingToTransfer: 0,
        transfers: [],
        transferStatus: "pending",
        status: "pending_review",
      }),
    /توجد دورة لهذا الشهر/
  );
  assert.equal(calls.sets.length, 0);
});
