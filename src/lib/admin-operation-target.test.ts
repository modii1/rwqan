import assert from "node:assert/strict";
import test from "node:test";

import {
  getAdminOperationTarget,
  getAdminWhatsAppTab,
} from "./admin-operation-target";

test("reads bounded operations inbox targets", () => {
  const params = new URLSearchParams("booking=%20BOOK-42%20&payment=PAY-3");
  assert.equal(getAdminOperationTarget(params, "booking"), "BOOK-42");
  assert.equal(getAdminOperationTarget(params, "payment"), "PAY-3");
  assert.equal(getAdminOperationTarget(params, "property"), "");

  params.set("log", "x".repeat(257));
  assert.equal(getAdminOperationTarget(params, "log"), "");
});

test("accepts only known WhatsApp dashboard tabs", () => {
  assert.equal(
    getAdminWhatsAppTab(new URLSearchParams("tab=activity")),
    "activity",
  );
  assert.equal(
    getAdminWhatsAppTab(new URLSearchParams("tab=unknown")),
    "workflow",
  );
});
