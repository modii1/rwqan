/**
 * Short-lived, in-memory progress for a receipt scan.
 *
 * Only the OWNER flow writes to it, and it contains nothing but stage states:
 * no file contents, no extracted data, no secrets. Entries expire quickly and
 * the store is bounded, so a scan never leaks across sessions for long.
 */
export type ReceiptScanStageKey =
  | "received"
  | "reading"
  | "amount"
  | "beneficiary"
  | "date"
  | "authenticity"
  | "finalizing";

export type ReceiptScanStageStatus = "pending" | "active" | "done" | "failed";

export interface ReceiptScanStageSnapshot {
  key: ReceiptScanStageKey;
  status: ReceiptScanStageStatus;
  at: string;
}

export interface ReceiptScanSnapshot {
  scanId: string;
  status: "running" | "done" | "error";
  startedAt: string;
  updatedAt: string;
  stages: ReceiptScanStageSnapshot[];
}

export const RECEIPT_SCAN_STAGE_KEYS: readonly ReceiptScanStageKey[] = [
  "received",
  "reading",
  "amount",
  "beneficiary",
  "date",
  "authenticity",
  "finalizing",
];

const TTL_MS = 10 * 60 * 1000;
const MAX_SESSIONS = 200;

function nowIso(): string {
  return new Date().toISOString();
}

export function isValidReceiptScanId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9-]{8,64}$/.test(value);
}

class ReceiptScanProgressStore {
  private sessions = new Map<
    string,
    { snapshot: ReceiptScanSnapshot; expiresAt: number }
  >();

  start(scanId: string): ReceiptScanSnapshot {
    this.prune();
    const timestamp = nowIso();
    const snapshot: ReceiptScanSnapshot = {
      scanId,
      status: "running",
      startedAt: timestamp,
      updatedAt: timestamp,
      stages: RECEIPT_SCAN_STAGE_KEYS.map((key, index) => ({
        key,
        status: index === 0 ? "active" : "pending",
        at: timestamp,
      })),
    };
    this.sessions.set(scanId, { snapshot, expiresAt: Date.now() + TTL_MS });
    return snapshot;
  }

  setStage(
    scanId: string | null | undefined,
    key: ReceiptScanStageKey,
    status: ReceiptScanStageStatus
  ): void {
    if (!scanId) return;
    const session = this.sessions.get(scanId);
    if (!session) return;
    const timestamp = nowIso();
    const stage = session.snapshot.stages.find((entry) => entry.key === key);
    if (stage) {
      stage.status = status;
      stage.at = timestamp;
    }
    session.snapshot.updatedAt = timestamp;
    session.expiresAt = Date.now() + TTL_MS;
  }

  finish(scanId: string | null | undefined, status: "done" | "error"): void {
    if (!scanId) return;
    const session = this.sessions.get(scanId);
    if (!session) return;
    session.snapshot.status = status;
    session.snapshot.updatedAt = nowIso();
    session.expiresAt = Date.now() + TTL_MS;
  }

  get(scanId: string): ReceiptScanSnapshot | null {
    this.prune();
    return this.sessions.get(scanId)?.snapshot ?? null;
  }

  clear(): void {
    this.sessions.clear();
  }

  private prune(): void {
    const now = Date.now();
    for (const [key, session] of this.sessions) {
      if (session.expiresAt <= now) this.sessions.delete(key);
    }
    while (this.sessions.size > MAX_SESSIONS) {
      const oldest = this.sessions.keys().next().value;
      if (oldest === undefined) break;
      this.sessions.delete(oldest);
    }
  }
}

export const receiptScanProgressStore = new ReceiptScanProgressStore();
