import assert from "node:assert/strict";
import test from "node:test";
import express from "express";
import type { AddressInfo } from "node:net";
import router from "./finance";
import { financeService } from "../../services";

const originals: Record<string, any> = {};

function stub(method: string, fn: any) {
  if (!(method in originals)) originals[method] = (financeService as any)[method];
  (financeService as any)[method] = fn;
}

function restoreAll() {
  for (const [method, fn] of Object.entries(originals)) {
    (financeService as any)[method] = fn;
  }
}

test.afterEach(() => restoreAll());

async function withServer<T>(
  run: (baseUrl: string) => Promise<T>
): Promise<T> {
  const app = express();
  app.use(express.json());
  app.use(router);
  const server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", resolve));
  try {
    const { port } = server.address() as AddressInfo;
    return await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("DELETE /api/admin/partner-profits/:id returns success for a deleted derived cycle", async () => {
  stub("deleteMonthlyCycle", async (id: string) => id === "PP-1");
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/admin/partner-profits/PP-1`, {
      method: "DELETE",
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.success, true);
    assert.equal(body.id, "PP-1");
    assert.match(body.message, /المدفوعات والتكاليف والتحويلات لم تُمس/);
  });
});

test("DELETE /api/admin/partner-profits/:id returns 404 for a missing cycle", async () => {
  stub("deleteMonthlyCycle", async () => false);
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/admin/partner-profits/PP-MISSING`, {
      method: "DELETE",
    });
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.match(body.error, /غير موجود/);
  });
});

test("DELETE /api/admin/partner-profits/:id returns 400 when protected", async () => {
  stub("deleteMonthlyCycle", async () => {
    throw new Error("لا يمكن حذف دورة مرتبطة بتحويلات مالية");
  });
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/admin/partner-profits/PP-TRANSFERRED`, {
      method: "DELETE",
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.match(body.error, /مرتبطة بتحويلات/);
  });
});

test("POST /api/admin/partner-profits/prepare returns the recalculated values", async () => {
  stub("prepareMonthlyCycle", async (monthYear?: string) => ({
    id: "PP-2026-11",
    monthYear: monthYear || "2026-11",
    revenueAfterFees: 77.24,
    totalExpenses: 20,
    netProfitAfterExpenses: 57.24,
    partnerShare: 28.62,
    status: "pending_review",
  }));
  await withServer(async (baseUrl) => {
    const res = await fetch(`${baseUrl}/api/admin/partner-profits/prepare`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ monthYear: "2026-11" }),
    });
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(body.id, "PP-2026-11");
    assert.equal(body.revenueAfterFees, 77.24);
    assert.equal(body.netProfitAfterExpenses, 57.24);
    assert.equal(body.partnerShare, 28.62);
  });
});
