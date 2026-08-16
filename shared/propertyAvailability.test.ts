import assert from "node:assert/strict";
import test from "node:test";
import { hasActiveCommissionHold } from "./propertyAvailability";

test("only an explicit active commission hold blocks a property", () => {
  assert.equal(hasActiveCommissionHold({
    commissionHold: { active: true, obligationIds: ["BOOK-1"] },
  }), true);

  for (const property of [
    undefined,
    null,
    false,
    0,
    "property",
    {},
    { commissionHold: null },
    { commissionHold: {} },
    { commissionHold: { active: false, obligationIds: ["BOOK-1"] } },
    { commissionHold: { active: "true", obligationIds: ["BOOK-1"] } },
    { commissionHold: { active: 1, obligationIds: ["BOOK-1"] } },
    { commissionHold: { obligationIds: ["BOOK-1"] } },
  ]) {
    assert.equal(hasActiveCommissionHold(property), false);
  }
});

test("the active marker is sufficient even while obligation metadata is absent", () => {
  assert.equal(hasActiveCommissionHold({ commissionHold: { active: true } }), true);
  assert.equal(hasActiveCommissionHold({
    commissionHold: { active: true, obligationIds: "legacy-value" },
  }), true);
});
