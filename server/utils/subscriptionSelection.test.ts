import assert from "node:assert/strict";
import test from "node:test";

import type { Subscription } from "../../shared/schema";
import { selectCurrentSubscriptionForProperty } from "./subscriptionSelection";

const subscription = (
  values: Partial<Subscription> & Pick<Subscription, "id" | "propertyNumber">,
): Subscription => ({
  packageId: "pkg",
  startDate: "2026-01-01T00:00:00.000Z",
  endDate: "2026-01-02T00:00:00.000Z",
  status: "active",
  ...values,
});

test("canonical subscription wins over a later legacy duplicate", () => {
  const selected = selectCurrentSubscriptionForProperty(
    [
      subscription({
        id: "legacy",
        propertyNumber: "P-1",
        endDate: "2035-01-01T00:00:00.000Z",
      }),
      subscription({
        id: "SUB-P-1",
        propertyNumber: "P-1",
        status: "موقوف مؤقتاً",
      }),
    ],
    "P-1",
  );

  assert.equal(selected?.id, "SUB-P-1");
  assert.equal(selected?.status, "موقوف مؤقتاً");
});

test("newest legacy subscription wins when no canonical document exists", () => {
  const selected = selectCurrentSubscriptionForProperty(
    [
      subscription({
        id: "legacy-old",
        propertyNumber: "P-2",
        endDate: "2026-02-01T00:00:00.000Z",
      }),
      subscription({
        id: "legacy-new",
        propertyNumber: "P-2",
        endDate: "2026-03-01T00:00:00.000Z",
      }),
    ],
    "P-2",
  );

  assert.equal(selected?.id, "legacy-new");
});
