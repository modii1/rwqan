import assert from "node:assert/strict";
import test from "node:test";
import { FinanceService } from "./FinanceService";
import { firebaseService } from "../firebaseService";
import type { PartnerProfit } from "../../shared/schema";

const originals: Record<string, any> = {};

function stub(method: string, fn: any) {
  if (!(method in originals)) originals[method] = (firebaseService as any)[method];
  (firebaseService as any)[method] = fn;
}

function restoreAll() {
  for (const [method, fn] of Object.entries(originals)) {
    (firebaseService as any)[method] = fn;
  }
}

function makeProfit(overrides: Partial<PartnerProfit> = {}): PartnerProfit {
  return {
    id: "PP-2026-11",
    monthYear: "2026-11",
    status: "pending_review",
    activeSubscriptions: 1,
    totalRevenue: 1000,
    revenueAfterFees: 960,
    totalExpenses: 0,
    netProfitAfterExpenses: 960,
    carriedLossForward: 0,
    carriedLossRemaining: 0,
    distributableProfit: 960,
    partnerShare: 480,
    partnerPercentage: 50,
    ourShare: 480,
    owedToPartner: 480,
    transferredToPartner: 0,
    remainingToTransfer: 480,
    transfers: [],
    ...overrides,
  } as PartnerProfit;
}

test.afterEach(() => restoreAll());

test("recordTransfer rejects exceeding partner share", async () => {
  stub("getPartnerProfitById", async () => makeProfit());
  const service = new FinanceService();

  await assert.rejects(
    () => service.recordTransfer("PP-2026-11", 500, "REF-1", "admin-1"),
    /يتجاوز المستحق المتبقي/
  );
});

test("recordTransfer accepts partial transfer within remaining", async () => {
  let updated: any = null;
  stub("getPartnerProfitById", async () => makeProfit());
  stub("updatePartnerProfit", async (_id: string, data: any) => {
    updated = data;
    return makeProfit({ transfers: data.transfers, transferredToPartner: data.transferredToPartner, remainingToTransfer: data.remainingToTransfer });
  });
  const service = new FinanceService();

  const result = await service.recordTransfer("PP-2026-11", 200, "REF-1", "admin-1");
  assert.ok(result);
  assert.equal(updated.transferredToPartner, 200);
  assert.equal(result?.remainingToTransfer, 280);
});

test("recordTransfer rejects duplicate reference and amount", async () => {
  stub("getPartnerProfitById", async () =>
    makeProfit({
      transferredToPartner: 200,
      remainingToTransfer: 280,
      transfers: [{ id: "T1", amount: 200, date: "2026-11-05", reference: "REF-1" }],
    })
  );
  const service = new FinanceService();

  await assert.rejects(
    () => service.recordTransfer("PP-2026-11", 200, "REF-1", "admin-1"),
    /مسجل مسبقًا/
  );
});

test("updatePartnerProfitNotes rejects closed or historical records", async () => {
  stub("getPartnerProfitById", async () => makeProfit({ status: "closed" }));
  const service = new FinanceService();

  await assert.rejects(
    () => service.updatePartnerProfitNotes("PP-2026-11", "note"),
    /مقفلة أو تاريخية/
  );
});

test("updatePartnerProfitNotes accepts pending records", async () => {
  let updated: any = null;
  stub("getPartnerProfitById", async () => makeProfit({ status: "pending_review" }));
  stub("updatePartnerProfit", async (_id: string, data: any) => {
    updated = data;
    return makeProfit({ notes: data.notes });
  });
  const service = new FinanceService();

  const result = await service.updatePartnerProfitNotes("PP-2026-11", "ملاحظة جديدة");
  assert.equal(updated.notes, "ملاحظة جديدة");
  assert.equal(result?.notes, "ملاحظة جديدة");
});

test("prepareMonthlyCycle treats historical records without status as closed", async () => {
  const historical: PartnerProfit = {
    id: "PP-2026-01",
    monthYear: "2026-01",
    activeSubscriptions: 0,
    totalRevenue: 0,
    revenueAfterFees: 0,
    totalExpenses: 0,
    netProfitAfterExpenses: 0,
    carriedLossForward: 0,
    carriedLossRemaining: 300,
    distributableProfit: 0,
    partnerShare: 0,
    partnerPercentage: 50,
    ourShare: 0,
    owedToPartner: 0,
    transferredToPartner: 0,
    remainingToTransfer: 0,
    transfers: [],
    transferStatus: "pending",
  } as unknown as PartnerProfit;
  let created: any = null;
  stub("getPayments", async () => [
    { id: "P1", status: "مكتمل", finalAmount: 1000, netAmount: 960, completedAt: "2026-11-05T00:00:00.000Z" } as any,
  ]);
  stub("getExpenses", async () => []);
  stub("getPartnerProfits", async () => [historical]);
  stub("createPartnerProfit", async (data: any) => { created = data; return { id: "PP-2026-11", ...data }; });
  const service = new FinanceService();

  await service.prepareMonthlyCycle("2026-11");
  assert.equal(created.carriedLossForward, 300);
  assert.equal(created.distributableProfit, 660);
  assert.equal(created.partnerShare, 330);
});

test("prepareMonthlyCycle updates the existing cycle instead of creating a duplicate", async () => {
  const existing = makeProfit({
    id: "PP-EXISTING",
    status: "pending_review",
    notes: "ملاحظة محفوظة",
    transferredToPartner: 5,
    remainingToTransfer: 475,
    transfers: [{ id: "T1", amount: 5, date: "2026-11-05", reference: "REF" }],
  });
  let updatedId: string | null = null;
  let updatedPayload: any = null;
  let createCalled = false;

  stub("getPayments", async () => [
    { id: "P1", status: "مكتمل", finalAmount: 80, netAmount: 77.24, completedAt: "2026-11-05T00:00:00.000Z" } as any,
  ]);
  stub("getExpenses", async () => [
    { id: "E1", title: "تكلفة", amount: 20, date: "2026-11-01", expenseType: "مرة واحدة", isActive: true } as any,
  ]);
  stub("getPartnerProfits", async () => [existing]);
  stub("updatePartnerProfit", async (id: string, data: any) => {
    updatedId = id;
    updatedPayload = data;
    return { ...existing, ...data };
  });
  stub("createPartnerProfit", async () => {
    createCalled = true;
    throw new Error("should not create a duplicate cycle");
  });
  // A recalculation must never write to source financial records.
  for (const method of [
    "updatePayment",
    "updatePaymentStatus",
    "updatePaymentFees",
    "updateExpense",
    "deleteExpense",
  ]) {
    stub(method, async () => {
      throw new Error(`recalculation must not call ${method}`);
    });
  }

  const service = new FinanceService();
  const result = await service.prepareMonthlyCycle("2026-11");

  assert.equal(createCalled, false, "must not create a second cycle for the same month");
  assert.equal(updatedId, "PP-EXISTING");
  assert.equal(result.id, "PP-EXISTING");
  assert.equal(updatedPayload.revenueAfterFees, 77.24);
  assert.equal(updatedPayload.totalExpenses, 20);
  assert.equal(updatedPayload.partnerShare, 28.62);
  // Protected fields are not rewritten by the scoped writer.
  assert.equal("status" in updatedPayload, false);
  assert.equal("transfers" in updatedPayload, false);
  assert.equal("transferredToPartner" in updatedPayload, false);
  assert.equal("notes" in updatedPayload, false);
  assert.equal("monthYear" in updatedPayload, false);
});

test("deleteMonthlyCycle deletes an unlocked cycle without transfers and touches nothing else", async () => {
  let deletedId: string | null = null;
  stub("getPartnerProfitById", async () => makeProfit({ id: "PP-TEST", transfers: [], transferredToPartner: 0 }));
  stub("deletePartnerProfit", async (id: string) => {
    deletedId = id;
    return true;
  });
  // These must never be called by a cycle delete.
  stub("getPayments", async () => {
    throw new Error("delete must not read payments");
  });
  stub("getExpenses", async () => {
    throw new Error("delete must not read expenses");
  });
  stub("updatePartnerProfit", async () => {
    throw new Error("delete must not update transfers");
  });

  const service = new FinanceService();
  const deleted = await service.deleteMonthlyCycle("PP-TEST");

  assert.equal(deleted, true);
  assert.equal(deletedId, "PP-TEST");
});

test("deleteMonthlyCycle refuses a closed cycle", async () => {
  let deleteCalled = false;
  stub("getPartnerProfitById", async () => makeProfit({ id: "PP-CLOSED", status: "closed" }));
  stub("deletePartnerProfit", async () => {
    deleteCalled = true;
    return true;
  });

  const service = new FinanceService();
  await assert.rejects(
    () => service.deleteMonthlyCycle("PP-CLOSED"),
    /مقفلة أو تاريخية/
  );
  assert.equal(deleteCalled, false);
});

test("deleteMonthlyCycle refuses a historical cycle without status", async () => {
  let deleteCalled = false;
  stub("getPartnerProfitById", async () =>
    makeProfit({ id: "PP-OLD", status: undefined } as any)
  );
  stub("deletePartnerProfit", async () => {
    deleteCalled = true;
    return true;
  });

  const service = new FinanceService();
  await assert.rejects(
    () => service.deleteMonthlyCycle("PP-OLD"),
    /مقفلة أو تاريخية/
  );
  assert.equal(deleteCalled, false);
});

test("deleteMonthlyCycle refuses a cycle with transfers", async () => {
  let deleteCalled = false;
  stub("getPartnerProfitById", async () =>
    makeProfit({
      id: "PP-TRANSFERRED",
      transferredToPartner: 10,
      transfers: [{ id: "T1", amount: 10, date: "2026-11-05" }],
    })
  );
  stub("deletePartnerProfit", async () => {
    deleteCalled = true;
    return true;
  });

  const service = new FinanceService();
  await assert.rejects(
    () => service.deleteMonthlyCycle("PP-TRANSFERRED"),
    /مرتبطة بتحويلات/
  );
  assert.equal(deleteCalled, false);
});

test("deleteMonthlyCycle returns false for a missing cycle", async () => {
  stub("getPartnerProfitById", async () => null);
  const service = new FinanceService();
  const deleted = await service.deleteMonthlyCycle("PP-MISSING");
  assert.equal(deleted, false);
});
