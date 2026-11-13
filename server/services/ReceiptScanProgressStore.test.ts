import assert from "node:assert/strict";
import test from "node:test";

import {
  isValidReceiptScanId,
  receiptScanProgressStore,
} from "./ReceiptScanProgressStore";

test("scan progress starts with the receipt stage active", () => {
  receiptScanProgressStore.clear();
  const snapshot = receiptScanProgressStore.start("scan-test-0001");
  assert.equal(snapshot.status, "running");
  assert.equal(snapshot.stages.length, 7);
  assert.equal(snapshot.stages[0].key, "received");
  assert.equal(snapshot.stages[0].status, "active");
  assert.ok(
    snapshot.stages.slice(1).every((stage) => stage.status === "pending")
  );
});

test("only stages confirmed by the scanner are advanced", () => {
  receiptScanProgressStore.clear();
  const scanId = "scan-test-0002";
  receiptScanProgressStore.start(scanId);
  receiptScanProgressStore.setStage(scanId, "received", "done");
  receiptScanProgressStore.setStage(scanId, "reading", "active");
  const snapshot = receiptScanProgressStore.get(scanId);
  assert.ok(snapshot);
  assert.equal(snapshot?.stages[0].status, "done");
  assert.equal(snapshot?.stages[1].status, "active");
  assert.equal(snapshot?.stages[2].status, "pending");
});

test("finishing stores the final status and unknown scans are absent", () => {
  receiptScanProgressStore.clear();
  const scanId = "scan-test-0003";
  receiptScanProgressStore.start(scanId);
  receiptScanProgressStore.finish(scanId, "done");
  assert.equal(receiptScanProgressStore.get(scanId)?.status, "done");
  assert.equal(receiptScanProgressStore.get("scan-does-not-exist"), null);
  receiptScanProgressStore.clear();
});

test("scan identifiers are validated before creating progress", () => {
  assert.equal(isValidReceiptScanId("scan-12345678"), true);
  assert.equal(isValidReceiptScanId("123e4567-e89b-12d3-a456-426614174000"), true);
  assert.equal(isValidReceiptScanId("short"), false);
  assert.equal(isValidReceiptScanId("bad id with spaces"), false);
  assert.equal(isValidReceiptScanId("bad/id"), false);
  assert.equal(isValidReceiptScanId(null), false);
});
