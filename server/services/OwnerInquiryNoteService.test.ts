import assert from "node:assert/strict";
import test from "node:test";
import { OwnerInquiryNoteService } from "./OwnerInquiryNoteService";

class FakeDocument {
  constructor(
    private readonly rows: Map<string, any>,
    private readonly id: string,
  ) {}
  async set(value: any) { this.rows.set(this.id, value); }
  async delete() { this.rows.delete(this.id); }
}

class FakeFirestore {
  readonly rows = new Map<string, any>();
  collection(name: string) {
    return {
      doc: (id: string) => new FakeDocument(this.rows, `${name}/${id}`),
      where: (_field: string, _operator: string, value: string) => ({
        get: async () => ({
          docs: [...this.rows.entries()]
            .filter(([id, row]) => id.startsWith(`${name}/`) && row.propertyNumber === value)
            .map(([, row]) => ({ data: () => row })),
        }),
      }),
    };
  }
}

test("owner inquiry notes are isolated by property and can be cleared", async () => {
  const database = new FakeFirestore();
  const service = new OwnerInquiryNoteService(database as never);
  const now = new Date("2026-09-26T12:00:00.000Z");
  await service.save({ propertyNumber: "P-1", inquiryId: "R-1", note: "  اتصل مساءً  ", now });
  await service.save({ propertyNumber: "P-2", inquiryId: "R-1", note: "ملاحظة أخرى", now });

  assert.deepEqual(await service.listForProperty("P-1"), [{
    propertyNumber: "P-1",
    inquiryId: "R-1",
    note: "اتصل مساءً",
    updatedAt: now.toISOString(),
  }]);
  assert.equal(await service.save({ propertyNumber: "P-1", inquiryId: "R-1", note: "" }), null);
  assert.deepEqual(await service.listForProperty("P-1"), []);
  assert.equal((await service.listForProperty("P-2")).length, 1);
});
