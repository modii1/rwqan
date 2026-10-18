import { createHash, randomUUID } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { activeFirestore as db } from "../config/dataEnvironment";

const COLLECTION = "scheduled_job_runs";
const RETENTION_MS = 30 * 24 * 60 * 60 * 1_000;

type RunOptions<T> = {
  jobName: string;
  windowKey: string;
  task: (lease: DistributedJobLease) => Promise<T>;
  now?: Date;
  leaseMs?: number;
};

export type DistributedJobLease = {
  signal: AbortSignal;
  throwIfLeaseLost: () => void;
};

type ScheduledJobRuntime = {
  now: () => Date;
  setInterval: (
    callback: () => void | Promise<void>,
    delayMs: number,
  ) => ReturnType<typeof setInterval>;
  clearInterval: (handle: ReturnType<typeof setInterval>) => void;
};

const systemRuntime: ScheduledJobRuntime = {
  now: () => new Date(),
  setInterval: (callback, delayMs) => setInterval(callback, delayMs),
  clearInterval: (handle) => clearInterval(handle),
};

export type DistributedJobRunResult<T> =
  | { status: "completed"; value: T }
  | { status: "skipped" };

export class DistributedScheduledJobLeaseLostError extends Error {
  constructor(message = "Distributed scheduled-job lease was lost") {
    super(message);
    this.name = "DistributedScheduledJobLeaseLostError";
  }
}

function jobDocumentId(jobName: string, windowKey: string): string {
  return createHash("sha256")
    .update(`${jobName}:${windowKey}`)
    .digest("hex");
}

function activeJobDocumentId(jobName: string): string {
  return `active-${createHash("sha256").update(jobName).digest("hex")}`;
}

export function fixedWindowKey(now: Date, windowMs: number): string {
  if (!Number.isFinite(windowMs) || windowMs <= 0) {
    throw new Error("windowMs must be a positive number");
  }
  return String(Math.floor(now.getTime() / windowMs));
}

export function riyadhDayKey(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

/**
 * Claims a named scheduler window and a job-wide active lease transactionally.
 * Completed windows cannot run again, adjacent windows cannot overlap, and an
 * abandoned claim becomes retryable after its lease.
 */
export class DistributedScheduledJobRunner {
  constructor(
    private readonly database: Firestore,
    private readonly workerId: string = randomUUID(),
    private readonly runtime: ScheduledJobRuntime = systemRuntime,
  ) {}

  async run<T>(options: RunOptions<T>): Promise<DistributedJobRunResult<T>> {
    const now = options.now || this.runtime.now();
    const leaseMs = Math.max(60_000, options.leaseMs || 30 * 60_000);
    const leaseToken = randomUUID();
    const windowRef = this.database
      .collection(COLLECTION)
      .doc(jobDocumentId(options.jobName, options.windowKey));
    const activeRef = this.database
      .collection(COLLECTION)
      .doc(activeJobDocumentId(options.jobName));

    const claimed = await this.database.runTransaction(async (transaction) => {
      const windowSnapshot = await transaction.get(windowRef);
      const currentWindow = windowSnapshot.exists
        ? windowSnapshot.data()
        : undefined;
      if (currentWindow?.completedAt) return false;
      const activeSnapshot = await transaction.get(activeRef);
      const currentActive = activeSnapshot.exists
        ? activeSnapshot.data()
        : undefined;
      const windowLeaseExpiresAtMillis = Number(
        currentWindow?.leaseExpiresAtMillis || 0,
      );
      const activeLeaseExpiresAtMillis = Number(
        currentActive?.leaseExpiresAtMillis || 0,
      );
      if (
        windowLeaseExpiresAtMillis > now.getTime()
        || (
          currentActive?.status === "running"
          && activeLeaseExpiresAtMillis > now.getTime()
        )
      ) return false;

      const leaseExpiresAtMillis = now.getTime() + leaseMs;
      transaction.set(windowRef, {
        jobName: options.jobName,
        windowKey: options.windowKey,
        status: "running",
        workerId: this.workerId,
        leaseToken,
        leaseStartedAt: now.toISOString(),
        leaseExpiresAtMillis,
        updatedAt: now.toISOString(),
        expiresAtTtl: new Date(now.getTime() + RETENTION_MS),
      }, { merge: true });
      transaction.set(activeRef, {
        jobName: options.jobName,
        activeWindowKey: options.windowKey,
        status: "running",
        workerId: this.workerId,
        leaseToken,
        leaseStartedAt: now.toISOString(),
        leaseExpiresAtMillis,
        updatedAt: now.toISOString(),
        expiresAtTtl: new Date(now.getTime() + RETENTION_MS),
      }, { merge: true });
      return true;
    });

    if (!claimed) return { status: "skipped" };

    const controller = new AbortController();
    let leaseLost = false;
    let heartbeatStopped = false;
    let renewalInFlight = Promise.resolve();
    const heartbeatEveryMs = Math.max(1_000, Math.floor(leaseMs / 3));

    const markLeaseLost = (reason?: unknown) => {
      leaseLost = true;
      if (!controller.signal.aborted) {
        controller.abort(reason);
      }
    };
    const renewLease = async () => {
      if (heartbeatStopped || leaseLost) return;
      const renewedAt = this.runtime.now();
      try {
        const renewed = await this.database.runTransaction(async (transaction) => {
          const windowSnapshot = await transaction.get(windowRef);
          const currentWindow = windowSnapshot.exists
            ? windowSnapshot.data()
            : undefined;
          const activeSnapshot = await transaction.get(activeRef);
          const currentActive = activeSnapshot.exists
            ? activeSnapshot.data()
            : undefined;
          if (
            currentWindow?.leaseToken !== leaseToken ||
            currentWindow?.status !== "running" ||
            currentWindow?.completedAt ||
            currentActive?.leaseToken !== leaseToken ||
            currentActive?.status !== "running" ||
            currentActive?.activeWindowKey !== options.windowKey
          ) {
            return false;
          }
          const leaseExpiresAtMillis = Math.max(
            Number(currentWindow.leaseExpiresAtMillis || 0),
            Number(currentActive.leaseExpiresAtMillis || 0),
            renewedAt.getTime() + leaseMs,
          );
          const renewal = {
            leaseExpiresAtMillis,
            leaseRenewedAt: renewedAt.toISOString(),
            updatedAt: renewedAt.toISOString(),
            expiresAtTtl: new Date(renewedAt.getTime() + RETENTION_MS),
          };
          transaction.set(windowRef, renewal, { merge: true });
          transaction.set(activeRef, renewal, { merge: true });
          return true;
        });
        if (!renewed) markLeaseLost();
      } catch (error) {
        // Renewal is what preserves this worker's authority. If it cannot be
        // confirmed, stop cooperative tasks instead of allowing more effects.
        markLeaseLost(error);
      }
    };
    const heartbeatHandle = this.runtime.setInterval(() => {
      renewalInFlight = renewalInFlight.then(renewLease);
      return renewalInFlight;
    }, heartbeatEveryMs);
    heartbeatHandle.unref?.();

    const stopHeartbeat = async () => {
      if (!heartbeatStopped) {
        heartbeatStopped = true;
        this.runtime.clearInterval(heartbeatHandle);
      }
      await renewalInFlight;
    };

    const lease: DistributedJobLease = {
      signal: controller.signal,
      throwIfLeaseLost: () => {
        if (leaseLost || controller.signal.aborted) {
          throw new DistributedScheduledJobLeaseLostError();
        }
      },
    };

    try {
      const value = await options.task(lease);
      await stopHeartbeat();
      lease.throwIfLeaseLost();
      const completedAt = this.runtime.now();
      const completed = await this.database.runTransaction(async (transaction) => {
        const windowSnapshot = await transaction.get(windowRef);
        const currentWindow = windowSnapshot.exists
          ? windowSnapshot.data()
          : undefined;
        const activeSnapshot = await transaction.get(activeRef);
        const currentActive = activeSnapshot.exists
          ? activeSnapshot.data()
          : undefined;
        if (
          currentWindow?.leaseToken !== leaseToken ||
          currentWindow?.status !== "running" ||
          currentWindow?.completedAt ||
          currentActive?.leaseToken !== leaseToken ||
          currentActive?.status !== "running" ||
          currentActive?.activeWindowKey !== options.windowKey
        ) return false;
        transaction.set(windowRef, {
          status: "completed",
          completedAt: completedAt.toISOString(),
          leaseExpiresAtMillis: 0,
          updatedAt: completedAt.toISOString(),
          expiresAtTtl: new Date(completedAt.getTime() + RETENTION_MS),
        }, { merge: true });
        transaction.set(activeRef, {
          status: "idle",
          activeWindowKey: null,
          workerId: null,
          leaseToken: null,
          leaseExpiresAtMillis: 0,
          leaseReleasedAt: completedAt.toISOString(),
          lastCompletedWindowKey: options.windowKey,
          updatedAt: completedAt.toISOString(),
          expiresAtTtl: new Date(completedAt.getTime() + RETENTION_MS),
        }, { merge: true });
        return true;
      });
      if (!completed) throw new DistributedScheduledJobLeaseLostError();
      return { status: "completed", value };
    } catch (error) {
      await stopHeartbeat();
      const failedAt = this.runtime.now();
      await this.database.runTransaction(async (transaction) => {
        const windowSnapshot = await transaction.get(windowRef);
        const currentWindow = windowSnapshot.exists
          ? windowSnapshot.data()
          : undefined;
        const activeSnapshot = await transaction.get(activeRef);
        const currentActive = activeSnapshot.exists
          ? activeSnapshot.data()
          : undefined;
        const ownsWindow = currentWindow?.leaseToken === leaseToken
          && currentWindow?.status === "running"
          && !currentWindow?.completedAt;
        const ownsActive = currentActive?.leaseToken === leaseToken
          && currentActive?.status === "running"
          && currentActive?.activeWindowKey === options.windowKey;
        if (ownsWindow) {
          transaction.set(windowRef, {
            status: "failed",
            lastError: String(
              error instanceof Error ? error.message : error,
            ).slice(0, 500),
            failedAt: failedAt.toISOString(),
            leaseExpiresAtMillis: 0,
            updatedAt: failedAt.toISOString(),
            expiresAtTtl: new Date(failedAt.getTime() + RETENTION_MS),
          }, { merge: true });
        }
        if (ownsActive) {
          transaction.set(activeRef, {
            status: "idle",
            activeWindowKey: null,
            workerId: null,
            leaseToken: null,
            leaseExpiresAtMillis: 0,
            leaseReleasedAt: failedAt.toISOString(),
            lastFailedWindowKey: options.windowKey,
            updatedAt: failedAt.toISOString(),
            expiresAtTtl: new Date(failedAt.getTime() + RETENTION_MS),
          }, { merge: true });
        }
      }).catch((releaseError) => {
        console.error("Could not release distributed scheduler claim:", releaseError);
      });
      throw error;
    }
  }
}

const defaultRunner = db ? new DistributedScheduledJobRunner(db) : null;

export async function runDistributedScheduledJob<T>(
  options: RunOptions<T>,
): Promise<DistributedJobRunResult<T>> {
  if (!defaultRunner) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("Firestore is required for production scheduled work");
    }
    const controller = new AbortController();
    return {
      status: "completed",
      value: await options.task({
        signal: controller.signal,
        throwIfLeaseLost: () => undefined,
      }),
    };
  }
  return defaultRunner.run(options);
}
