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
