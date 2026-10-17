import assert from "node:assert/strict";
import test from "node:test";

import {
  getMaximumPrimaryPropertyPrice,
  getPrimaryPropertyPrice,
  getPrimaryPropertyPriceDisplay,
} from "./propertyPrice";

test("price filters use the same weekday-first value displayed on cards", () => {
  const prices = { weekday: "450", weekend: "800" };
  assert.equal(getPrimaryPropertyPrice(prices), 450);
  assert.equal(getPrimaryPropertyPriceDisplay(prices), "450");
});

test("zero or missing weekday prices fall back to a valid weekend price", () => {
  assert.equal(getPrimaryPropertyPrice({ weekday: "0", weekend: "600" }), 600);
  assert.equal(getPrimaryPropertyPriceDisplay({ weekday: "", weekend: "600" }), "600");
  assert.equal(getPrimaryPropertyPrice({ weekday: "bad", weekend: "" }), 0);
});

test("the slider ceiling follows actual prices instead of a fixed sentinel", () => {
  assert.equal(getMaximumPrimaryPropertyPrice([
    { prices: { weekday: "120000", weekend: "900" } },
    { prices: { weekday: "500", weekend: "800" } },
  ]), 120000);
  assert.equal(getMaximumPrimaryPropertyPrice([], 750), 750);
});
