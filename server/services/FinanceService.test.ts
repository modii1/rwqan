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
