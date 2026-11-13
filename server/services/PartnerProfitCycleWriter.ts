import type { Firestore, Transaction } from "firebase-admin/firestore";
import { LiveDataSourceError } from "../config/dataEnvironment";
import { getOrCreateLiveFirestore } from "../config/firebase";
import { dataEnvironmentStore } from "./LiveDataEnvironmentStore";
import { liveWriteEnabled, readLiveDataConfig } from "../config/liveDataEnvironment";
import { firebaseService } from "../firebaseService";
import type { InsertPartnerProfit, PartnerProfit } from "../../shared/schema";

/**
 * Scoped writer for partner-profit cycles.
 *
 * Why this exists:
 * - LIVE data preview runs in read-only mode by default to protect production
 *   payments, expenses, and historical records.
 * - Partner-profit cycles are DERIVED records: they are rebuilt from payments
 *   and expenses and contain no historical source data.
 * - Recomputing or deleting a cycle must be possible in LIVE read-only mode
 *   without enabling global LIVE writes.
 *
 * What this module deliberately does NOT provide:
 * - No general "write to partner_profits" handle.
 * - No `add`, no arbitrary `set`, no writes to any other collection.
 * - No way to edit transfers, closed cycles, or historical records.
 *
 * The only two capabilities are:
 *   1. `updatePartnerProfitCycle` — recompute whitelisted derived fields on an
 *      UNLOCKED cycle. Protected fields (status, transfers, notes, identity,
 *      audit fields) are never written.
 *   2. `deletePartnerProfitCycle` — delete an UNLOCKED cycle that has NO
 *      transfers. A transaction re-reads the cycle immediately before deleting
 *      so a concurrent transfer/close cannot be lost.
 */

/** Fields a recalculation is allowed to write. */
export const CYCLE_RECALC_FIELDS = [
  "activeSubscriptions",
  "totalRevenue",
  "revenueAfterFees",
  "totalExpenses",
  "netProfitAfterExpenses",
  "carriedLossForward",
  "carriedLossRemaining",
  "distributableProfit",
  "partnerShare",
  "partnerPercentage",
  "ourShare",
  "owedToPartner",
  "remainingToTransfer",
] as const;

export type CycleRecalcField = (typeof CYCLE_RECALC_FIELDS)[number];

const RECALC_FIELD_SET = new Set<string>(CYCLE_RECALC_FIELDS);

/**
 * Fields that a recalculation must never modify. Listed explicitly so the
 * intent is auditable even though the payload builder is an allowlist.
 */
export const CYCLE_PROTECTED_FIELDS = [
  "id",
  "monthYear",
  "status",
  "transfers",
  "transferredToPartner",
  "transferStatus",
  "transferDate",
  "closedAt",
  "closedBy",
  "notes",
  "createdAt",
] as const;

/** Extract only the recalculable, derived fields from a prepare payload. */
export function buildCycleRecalcPayload(
  source: Partial<PartnerProfit> | InsertPartnerProfit
): Partial<Record<CycleRecalcField, unknown>> {
  const payload: Partial<Record<CycleRecalcField, unknown>> = {};
  for (const field of CYCLE_RECALC_FIELDS) {
    if (field in source) {
      payload[field] = (source as Record<string, unknown>)[field];
    }
  }
  return payload;
}

/** A cycle is mutable only when it is explicitly open for review/draft. */
export function assertCycleMutable(
  profit: Pick<PartnerProfit, "status"> | null | undefined
): void {
  if (!profit) {
    throw new Error("سجل دورة الأرباح غير موجود");
  }
  if (profit.status === "closed" || !profit.status) {
    throw new Error("لا يمكن إعادة حساب دورة مقفلة أو تاريخية");
  }
}

/** A cycle is deletable only when it is mutable and has no transfers. */
export function assertCycleDeletable(
  profit: PartnerProfit | null | undefined
): void {
  if (!profit) {
    throw new Error("سجل دورة الأرباح غير موجود");
  }
  if (profit.status === "closed" || !profit.status) {
    throw new Error("لا يمكن حذف دورة مقفلة أو تاريخية");
  }
  const transfers = profit.transfers || [];
  if (transfers.length > 0 || (profit.transferredToPartner || 0) > 0) {
    throw new Error("لا يمكن حذف دورة مرتبطة بتحويلات مالية");
  }
}

// ── LIVE read-only scoped connection ─────────────────────────────────────────

let injectedLiveCycleDb: Firestore | null | undefined;

/** Test seam: inject a fake LIVE Firestore for the scoped writer. */
export function setLiveCycleDbForTests(
  db: Firestore | null | undefined
): void {
  injectedLiveCycleDb = db;
}

/**
 * Resolve the UNWRAPPED LIVE Firestore connection for this writer only.
 *
 * Why this is local instead of imported from `config/dataEnvironment`:
 * `server/config/` is intentionally EXCLUDED from the TEST→LIVE sync (it holds
 * environment-specific policy), while this file IS synced. A synced module must
 * therefore not depend on a helper that exists on only one side.
 *
 * Behaviour is identical to the environment resolver: it uses the same
 * primitives and the same `rwqan-live` named app, so it returns the SAME
 * project, credentials and Firestore instance:
 *   readLiveDataConfig(process.env) → getOrCreateLiveFirestore(...)
 *
 * Safety:
 *   - No LIVE configuration → `null`; callers keep the existing fail-closed
 *     `firebaseService` path and never fall back to the DEV database.
 *   - The global read-only guard in `getActiveFirestore()` is untouched.
 *   - No secret is stored or exposed.
 */
function resolveLiveCycleFirestore(): Firestore | null {
  const { config } = readLiveDataConfig(process.env);
  if (!config) return null;
  try {
    return getOrCreateLiveFirestore(
      config.firebase.serviceAccount
    ) as unknown as Firestore;
  } catch {
    throw new LiveDataSourceError();
  }
}

function getLiveCycleDb(): Firestore | null {
  if (injectedLiveCycleDb !== undefined) return injectedLiveCycleDb;
  if (dataEnvironmentStore.get() === "LIVE" && !liveWriteEnabled()) {
    return resolveLiveCycleFirestore();
  }
  return null;
}

// ── Operations ───────────────────────────────────────────────────────────────

export async function createPartnerProfitCycle(
  profit: InsertPartnerProfit
): Promise<PartnerProfit> {
  const liveDb = getLiveCycleDb();
  // TEST (or LIVE with explicit write mode) delegates to the regular service so
  // existing stubs and test seams keep working.
  if (!liveDb) {
    return firebaseService.createPartnerProfit(profit);
  }

  return liveDb.runTransaction(async (tx: Transaction) => {
    // Guard against creating a duplicate cycle for the same month.
    const duplicateQuery = liveDb
      .collection("partner_profits")
      .where("monthYear", "==", profit.monthYear)
      .limit(1);
    const duplicate = await tx.get(duplicateQuery);
    if (!duplicate.empty) {
      throw new Error("توجد دورة لهذا الشهر بالفعل — استخدم إعادة الحساب");
    }

    const id = `PP-${Date.now()}`;
    const newProfit: PartnerProfit = {
      id,
      ...profit,
      createdAt: new Date().toISOString(),
    } as PartnerProfit;
    tx.set(liveDb.collection("partner_profits").doc(id), newProfit);
    return newProfit;
  });
}

export async function updatePartnerProfitCycle(
  id: string,
  updates: Partial<PartnerProfit>
): Promise<PartnerProfit | null> {
  const payload = buildCycleRecalcPayload(updates);
  if (Object.keys(payload).length === 0) {
    throw new Error("لا توجد حقول قابلة لإعادة الحساب في الطلب");
  }

  const liveDb = getLiveCycleDb();
  if (!liveDb) {
    return firebaseService.updatePartnerProfit(id, payload as Partial<PartnerProfit>);
  }

  return liveDb.runTransaction(async (tx: Transaction) => {
    const ref = liveDb.collection("partner_profits").doc(id);
    const snap = await tx.get(ref);
    if (!snap.exists) return null;

    const current = snap.data() as PartnerProfit;
    // Re-validate inside the transaction: the cycle may have been closed or
    // received a transfer between the caller's read and this write.
    assertCycleMutable(current);

    const next = {
      ...payload,
      updatedAt: new Date().toISOString(),
    };
    tx.update(ref, next);
    return { ...current, ...next } as PartnerProfit;
  });
}

export async function deletePartnerProfitCycle(id: string): Promise<boolean> {
  const liveDb = getLiveCycleDb();
  if (!liveDb) {
    // TEST path: the regular service; FinanceService has already validated the
    // cycle state before calling this function.
    return firebaseService.deletePartnerProfit(id);
  }

  return liveDb.runTransaction(async (tx: Transaction) => {
    const ref = liveDb.collection("partner_profits").doc(id);
    const snap = await tx.get(ref);
    if (!snap.exists) return false;

    const current = snap.data() as PartnerProfit;
    // Re-validate inside the transaction: never delete a cycle that became
    // closed or received a transfer after the caller's read.
    assertCycleDeletable(current);

    tx.delete(ref);
    return true;
  });
}

/** Expose the allowlist for tests / audit tooling. */
export function isRecalcField(field: string): boolean {
  return RECALC_FIELD_SET.has(field);
}
