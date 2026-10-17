import assert from "node:assert/strict";
import test from "node:test";

import { OwnerInquiryVisibilityService } from "./OwnerInquiryVisibilityService";

class FakeDocument {
  constructor(
    private readonly rows: Map<string, any>,
    private readonly id: string,
  ) {}

  async set(value: any) {
    this.rows.set(this.id, value);
  }
}

class FakeFirestore {
  readonly rows = new Map<string, any>();

  collection(name: string) {
    return {
      doc: (id: string) => new FakeDocument(this.rows, `${name}/${id}`),
      where: (_field: string, _operator: string, value: string) => ({
        get: async () => ({
          docs: [...this.rows.entries()]
            .filter(([id, row]) =>
              id.startsWith(`${name}/`) && row.propertyNumber === value
            )
            .map(([, row]) => ({ data: () => row })),
        }),
      }),
    };
  }
}

test("owner inquiry hides preserve an auditable property-scoped record", async () => {
  const database = new FakeFirestore();
  const service = new OwnerInquiryVisibilityService(database as never);
  const now = new Date("2026-09-26T12:00:00.000Z");

  await service.hide({
    propertyNumber: "P-1",
    inquiryId: "R-1",
    contactRequestId: "R-1",
    bookingId: "B-1",
    now,
  });
  await service.hide({
    propertyNumber: "P-2",
    inquiryId: "R-1",
    contactRequestId: "R-1",
    now,
  });

  assert.deepEqual(await service.listHiddenForProperty("P-1"), [{
    propertyNumber: "P-1",
    inquiryId: "R-1",
    contactRequestId: "R-1",
    bookingId: "B-1",
    hiddenAt: now.toISOString(),
  }]);
  assert.equal((await service.listHiddenForProperty("P-2")).length, 1);
});
