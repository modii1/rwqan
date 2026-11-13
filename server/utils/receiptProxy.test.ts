import assert from "node:assert/strict";
import test from "node:test";

import { receiptProxyPath } from "./receiptProxy";

test("receipt proxy paths encode every object key and never expose a public URL", () => {
  const path = receiptProxyPath("receipts/PROP-1-123.png");
  assert.equal(path, "/api/receipts/view?key=receipts%2FPROP-1-123.png");
  assert.ok(path.startsWith("/api/receipts/view"));
  assert.equal(receiptProxyPath(""), "");
});
