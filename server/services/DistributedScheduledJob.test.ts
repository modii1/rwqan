import assert from "node:assert/strict";
import test from "node:test";
import {
  DistributedScheduledJobLeaseLostError,
  DistributedScheduledJobRunner,
  fixedWindowKey,
  riyadhDayKey,
} from "./DistributedScheduledJob";

type Row = Record<string, any>;

class FakeDocument {
  constructor(readonly id: string) {}
}

class FakeFirestore {
  readonly rows = new Map<string, Row>();
  private queue = Promise.resolve();

  collection(name: string) {
    return { doc: (id: string) => new FakeDocument(`${name}/${id}`) };
  }

  runTransaction<T>(callback: (transaction: any) => Promise<T>): Promise<T> {
    const run = this.queue.then(() => callback({
      get: async (ref: FakeDocument) => {
        const row = this.rows.get(ref.id);
        return { exists: Boolean(row), data: () => row };
      },
      set: (ref: FakeDocument, value: Row, options?: { merge?: boolean }) => {
        const next = options?.merge
          ? { ...(this.rows.get(ref.id) || {}), ...value }
          : value;
        this.rows.set(ref.id, next);
      },
    }));
    this.queue = run.then(() => undefined, () => undefined);
    return run;
  }
}

class ManualRuntime {
  private callback: (() => void | Promise<void>) | null = null;
  private current: Date;

  constructor(now: Date) {
    this.current = now;
  }

  now = () => new Date(this.current);

  setNow(value: Date) {
    this.current = value;
  }

  setInterval = (callback: () => void | Promise<void>) => {
    this.callback = callback;
    return { unref() {} } as ReturnType<typeof setInterval>;
  };

  clearInterval = () => {
    this.callback = null;
  };

  async tick(): Promise<void> {
    const callback = this.callback;
    if (callback) await callback();
  }
}

test("time-window helpers are stable", () => {
  const now = new Date("2026-09-26T21:30:00.000Z");
  assert.equal(fixedWindowKey(now, 15 * 60_000), String(Math.floor(now.getTime() / 900_000)));
  assert.equal(riyadhDayKey(now), "2026-09-27");
});

test("only one worker executes a completed scheduler window", async () => {
  const database = new FakeFirestore();
  const first = new DistributedScheduledJobRunner(database as never, "first");
  const second = new DistributedScheduledJobRunner(database as never, "second");
  let executions = 0;
  const options = {
    jobName: "payment-reconciliation",
    windowKey: "slot-1",
    task: async () => ++executions,
  };

  const results = await Promise.all([first.run(options), second.run(options)]);
  assert.equal(executions, 1);
  assert.deepEqual(results.map((result) => result.status).sort(), ["completed", "skipped"]);
  assert.equal((await first.run(options)).status, "skipped");
});

test("a failed window releases its lease for a safe retry", async () => {
  const database = new FakeFirestore();
  const runner = new DistributedScheduledJobRunner(database as never, "worker");
  await assert.rejects(() => runner.run({
    jobName: "daily",
    windowKey: "2026-09-26",
    task: async () => { throw new Error("temporary"); },
  }), /temporary/);

  const result = await runner.run({
    jobName: "daily",
    windowKey: "2026-09-26",
    task: async () => "retried",
  });
  assert.deepEqual(result, { status: "completed", value: "retried" });
});

test("an active job renews retention TTLs while blocking an adjacent window", async () => {
  const database = new FakeFirestore();
  const startedAt = new Date("2026-09-26T12:00:00.000Z");
  const runtime = new ManualRuntime(startedAt);
  const first = new DistributedScheduledJobRunner(
    database as never,
    "first",
    runtime as never,
  );
  const second = new DistributedScheduledJobRunner(
    database as never,
    "second",
    runtime as never,
  );
  let release!: () => void;
  const waitForRelease = new Promise<void>((resolve) => {
    release = resolve;
  });
  let notifyStarted!: () => void;
  const taskStarted = new Promise<void>((resolve) => {
    notifyStarted = resolve;
  });
  let adjacentExecutions = 0;

  const firstRun = first.run({
    jobName: "payment-reconciliation",
    windowKey: "slot-1",
    now: startedAt,
    leaseMs: 60_000,
    task: async () => {
      notifyStarted();
      await waitForRelease;
      return "first-completed";
    },
  });
  await taskStarted;

  runtime.setNow(new Date(startedAt.getTime() + 50_000));
  await runtime.tick();

  const renewedRows = [...database.rows.values()].filter(
    (candidate) => candidate.status === "running",
  );
  assert.equal(renewedRows.length, 2);
  for (const renewedRow of renewedRows) {
    assert.equal(
      renewedRow.expiresAtTtl.getTime(),
      startedAt.getTime() + 50_000 + 30 * 24 * 60 * 60 * 1_000,
    );
  }

  runtime.setNow(new Date(startedAt.getTime() + 70_000));
  const blocked = await second.run({
    jobName: "payment-reconciliation",
    windowKey: "slot-2",
    now: runtime.now(),
    leaseMs: 60_000,
    task: async () => ++adjacentExecutions,
  });
  assert.deepEqual(blocked, { status: "skipped" });
  assert.equal(adjacentExecutions, 0);

  release();
  assert.deepEqual(await firstRun, {
    status: "completed",
    value: "first-completed",
  });

  runtime.setNow(new Date(startedAt.getTime() + 71_000));
  const retried = await second.run({
    jobName: "payment-reconciliation",
    windowKey: "slot-2",
    now: runtime.now(),
    leaseMs: 60_000,
    task: async () => ++adjacentExecutions,
  });
  assert.deepEqual(retried, { status: "completed", value: 1 });
});

test("a running job renews its lease so another worker cannot reclaim it", async () => {
  const database = new FakeFirestore();
  const startedAt = new Date("2026-09-26T12:00:00.000Z");
  const runtime = new ManualRuntime(startedAt);
  const first = new DistributedScheduledJobRunner(
    database as never,
    "first",
    runtime as never,
  );
  const second = new DistributedScheduledJobRunner(
    database as never,
    "second",
    runtime as never,
  );
  let release!: () => void;
  const waitForRelease = new Promise<void>((resolve) => {
    release = resolve;
  });
  let notifyStarted!: () => void;
  const taskStarted = new Promise<void>((resolve) => {
    notifyStarted = resolve;
  });

  const firstRun = first.run({
    jobName: "long-running-reconciliation",
    windowKey: "slot-1",
    now: startedAt,
    leaseMs: 60_000,
    task: async (lease) => {
      notifyStarted();
      await waitForRelease;
      lease.throwIfLeaseLost();
      return "first-completed";
    },
  });
  await taskStarted;

  runtime.setNow(new Date(startedAt.getTime() + 50_000));
  await runtime.tick();

  runtime.setNow(new Date(startedAt.getTime() + 70_000));
  const competingRun = await second.run({
    jobName: "long-running-reconciliation",
    windowKey: "slot-1",
    now: runtime.now(),
    leaseMs: 60_000,
    task: async () => "must-not-run",
  });
  assert.deepEqual(competingRun, { status: "skipped" });

  release();
  assert.deepEqual(await firstRun, {
    status: "completed",
    value: "first-completed",
  });
});

test("a worker cannot complete a job after another worker owns its lease", async () => {
  const database = new FakeFirestore();
  const startedAt = new Date("2026-09-26T12:00:00.000Z");
  const runtime = new ManualRuntime(startedAt);
  const runner = new DistributedScheduledJobRunner(
    database as never,
    "first",
    runtime as never,
  );
  let release!: () => void;
  const waitForRelease = new Promise<void>((resolve) => {
    release = resolve;
  });
  let notifyStarted!: () => void;
  const taskStarted = new Promise<void>((resolve) => {
    notifyStarted = resolve;
  });
  let observedAbort = false;

  const run = runner.run({
    jobName: "stolen-lease",
    windowKey: "slot-1",
    now: startedAt,
    leaseMs: 60_000,
    task: async (lease) => {
      notifyStarted();
      await waitForRelease;
      observedAbort = lease.signal.aborted;
      lease.throwIfLeaseLost();
      return "must-not-complete";
    },
  });
  await taskStarted;

  const row = [...database.rows.values()].find(
    (candidate) => candidate.windowKey === "slot-1",
  )!;
  row.leaseToken = "replacement-token";
  row.workerId = "second";
  runtime.setNow(new Date(startedAt.getTime() + 30_000));
  await runtime.tick();
  release();

  await assert.rejects(
    run,
    DistributedScheduledJobLeaseLostError,
  );
  assert.equal(observedAbort, true);
  assert.equal(row.status, "running");
  assert.equal(row.leaseToken, "replacement-token");
});
