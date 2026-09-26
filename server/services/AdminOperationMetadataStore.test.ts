import assert from "node:assert/strict";
import test from "node:test";
import {
  AdminOperationMetadataStore,
  adminOperationDocumentId,
} from "./AdminOperationMetadataStore";

type Row = Record<string, unknown>;

class FakeDocumentReference {
  constructor(readonly path: string) {}
}

class FakeFirestore {
  readonly rows = new Map<string, Row>();
  private queue = Promise.resolve();

  collection(name: string) {
    return {
      doc: (id: string) => new FakeDocumentReference(`${name}/${id}`),
      get: async () => ({
        docs: [...this.rows.entries()]
          .filter(([path]) => path.startsWith(`${name}/`))
          .map(([path, value]) => ({
            id: path.slice(name.length + 1),
            data: () => value,
          })),
      }),
    };
  }

  runTransaction<T>(callback: (transaction: {
    get: (reference: FakeDocumentReference) => Promise<{
      exists: boolean;
      data: () => Row | undefined;
    }>;
    set: (reference: FakeDocumentReference, value: Row) => void;
  }) => Promise<T>): Promise<T> {
    const result = this.queue.then(() => callback({
      get: async (reference) => {
        const value = this.rows.get(reference.path);
        return {
          exists: Boolean(value),
          data: () => value,
        };
      },
      set: (reference, value) => {
        this.rows.set(reference.path, value);
      },
    }));
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }
}

test("operation document identifiers are stable and safe for Firestore paths", () => {
  const first = adminOperationDocumentId("booking-notification/a b");
  const second = adminOperationDocumentId("booking-notification/a b");
  assert.equal(first, second);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first.includes("/"), false);
});

test("persists assignment, resolution, reopening, notes, and an admin audit trail", async () => {
  const database = new FakeFirestore();
  const store = new AdminOperationMetadataStore(database as never, "operations");
  const operationId = "booking-dispute-B-1";

  const assigned = await store.update(operationId, {
    assignee: "فريق المدفوعات",
    state: "resolved",
  }, new Date("2026-09-26T08:00:00.000Z"));
  assert.equal(assigned.assignee, "فريق المدفوعات");
  assert.equal(assigned.state, "resolved");
  assert.equal(assigned.resolvedBy, "admin");
  assert.equal(assigned.resolvedAt, "2026-09-26T08:00:00.000Z");
  assert.deepEqual(
    assigned.audit.map((entry) => entry.action),
    ["assigned", "resolved"],
  );
  assert.equal(assigned.audit.every((entry) => entry.actor === "admin"), true);

  const noted = await store.addNote(
    operationId,
    "تمت مطابقة الإيصال مع كشف الحساب",
    new Date("2026-09-26T08:05:00.000Z"),
  );
  assert.equal(noted.notes.length, 1);
  assert.equal(noted.notes[0].body, "تمت مطابقة الإيصال مع كشف الحساب");
  assert.equal(noted.notes[0].actor, "admin");
  assert.equal(noted.audit.at(-1)?.action, "note_added");

  const reopened = await store.update(operationId, {
    assignee: null,
    state: "open",
  }, new Date("2026-09-26T08:10:00.000Z"));
  assert.equal(reopened.assignee, null);
  assert.equal(reopened.state, "open");
  assert.equal(reopened.resolvedAt, null);
  assert.equal(reopened.resolvedBy, null);
  assert.deepEqual(
    reopened.audit.slice(-2).map((entry) => entry.action),
    ["unassigned", "reopened"],
  );

  const listed = await store.list();
  assert.equal(listed.length, 1);
  assert.deepEqual(listed[0], reopened);
  const serialized = JSON.stringify(listed);
  assert.equal(serialized.includes("secret"), false);
});

test("validates operation metadata before writing", async () => {
  const database = new FakeFirestore();
  const store = new AdminOperationMetadataStore(database as never, "operations");

  await assert.rejects(
    () => store.update("", { state: "open" }),
    (error: any) => error?.code === "INVALID_OPERATION_ID",
  );
  await assert.rejects(
    () => store.update("operation-1", { assignee: "a".repeat(81) }),
    (error: any) => error?.code === "INVALID_ASSIGNEE",
  );
  await assert.rejects(
    () => store.update("operation-1", { assignee: {} as never }),
    (error: any) => error?.code === "INVALID_ASSIGNEE",
  );
  await assert.rejects(
    () => store.addNote("operation-1", " "),
    (error: any) => error?.code === "INVALID_NOTE",
  );
  assert.equal(database.rows.size, 0);
});

test("retains a safe operation snapshot and reopens a newer recurrence", async () => {
  const database = new FakeFirestore();
  const store = new AdminOperationMetadataStore(database as never, "operations");
  const snapshot = {
    category: "suspended_property" as const,
    priority: "critical" as const,
    title: "عقار موقوف",
    description: "يحتاج متابعة",
    reference: "P-1",
    propertyNumber: "P-1",
    propertyName: "العقار",
    occurredAt: "2026-09-26T08:00:00.000Z",
    statusLabel: "موقوف",
    href: "/admin/suspended-subscriptions?property=P-1",
    actionLabel: "فتح الإيقاف",
  };
  const resolved = await store.update("property-hold-P-1", {
    state: "resolved",
    snapshot,
  }, new Date("2026-09-26T09:00:00.000Z"));
  assert.deepEqual(resolved.snapshot, snapshot);

  const sameOccurrence = await store.update("property-hold-P-1", {
    assignee: "فريق الاشتراكات",
    snapshot,
  }, new Date("2026-09-26T09:30:00.000Z"));
  assert.equal(sameOccurrence.state, "resolved");
  assert.equal(
    sameOccurrence.audit.some((entry) => entry.action === "reopened"),
    false,
  );

  const nextOccurrence = { ...snapshot, occurredAt: "2026-09-26T10:00:00.000Z" };
  const assigned = await store.update("property-hold-P-1", {
    assignee: "فريق العمولات",
    snapshot: nextOccurrence,
  }, new Date("2026-09-26T10:05:00.000Z"));
  assert.equal(assigned.state, "open");
  assert.equal(assigned.resolvedAt, null);
  assert.deepEqual(
    assigned.audit.slice(-2).map((entry) => entry.action),
    ["reopened", "assigned"],
  );
});
