import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * Guard rails for the bank-transfer entry points. These tests do not execute
 * the route; they assert the decision inputs stay server-side by construction.
 */
test("the owner bank-transfer route never reads an AI decision from the client", async () => {
  const source = await readFile(new URL("./owner.ts", import.meta.url), "utf8");

  assert.doesNotMatch(
    source,
    /req\.body\.(aiScan|recommendation|confidence|matchScore|autoActivated|beneficiaryMatch|ibanMatch)/,
  );
  assert.match(
    source,
    /aiScanResult\?\.verification\?\.autoActivationAllowed === true/,
  );
  assert.match(source, /claimFingerprint\(/);
  assert.match(source, /claimReceiptReference\(/);
});

test("the add-on bank-transfer route never reads an AI decision from the client", async () => {
  const source = await readFile(
    new URL("./admin/addons.ts", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(
    source,
    /req\.body\.(aiScan|recommendation|confidence|matchScore|autoActivated)/,
  );
  assert.match(source, /claimFingerprint\(/);
});

test("a non-receipt document can never be auto-activated by the owner route", async () => {
  const source = await readFile(new URL("./owner.ts", import.meta.url), "utf8");
  assert.match(
    source,
    /aiScanResult\.documentType !== "bank_transfer_receipt"[\s\S]{0,160}autoActivationAllowed = false/,
  );
});

test("the duplicate guard runs before the receipt is scanned or stored", async () => {
  const source = await readFile(new URL("./owner.ts", import.meta.url), "utf8");
  const claimIndex = source.indexOf("claimFingerprint(");
  assert.ok(claimIndex > 0);
  // The bank-transfer upload path (after the claim) must scan only after it.
  const uploadIndex = source.indexOf("new PutObjectCommand(", claimIndex);
  const scanIndex = source.indexOf("scanReceiptWithAI(", claimIndex);
  assert.ok(uploadIndex > claimIndex);
  assert.ok(scanIndex > claimIndex);
});

test("the existing-payment receipt upload route reuses the payment and guards duplicates", async () => {
  const source = await readFile(new URL("./owner.ts", import.meta.url), "utf8");
  const start = source.indexOf('"/api/owner/payment/upload-receipt"');
  assert.ok(start > 0, "upload-receipt route must exist");
  const end = source.indexOf('router.get("/api/owner/r2-images"', start);
  assert.ok(end > start);
  const route = source.slice(start, end);

  assert.match(route, /paymentService\.update\(payment\.id/);
  assert.doesNotMatch(route, /paymentService\.create/);

  const claimIndex = route.indexOf("claimFingerprint(");
  const uploadIndex = route.indexOf("new PutObjectCommand(");
  assert.ok(claimIndex > 0, "fingerprint claim must exist");
  assert.ok(uploadIndex > claimIndex, "claim must run before R2 upload");

  const updateStart = route.indexOf("paymentService.update(payment.id");
  const updateBlock = route.slice(updateStart, updateStart + 260);
  assert.doesNotMatch(updateBlock, /\bstatus\s*:/);
  assert.doesNotMatch(updateBlock, /\bamount\s*:/);
});

test("the payment history derives the receipt state from the receipt itself", async () => {
  const dashboard = await readFile(
    new URL("../../src/components/owner/owner-dashboard.tsx", import.meta.url),
    "utf8",
  );
  assert.match(dashboard, /resolvePaymentReceiptStatus/);
  assert.match(dashboard, /payment\.receiptScanStatus/);
  assert.match(dashboard, /method: "HEAD"/);
  assert.match(dashboard, /\/api\/owner\/payment\/upload-receipt/);
});
