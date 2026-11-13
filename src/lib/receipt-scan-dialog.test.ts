import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

/**
 * Regression guards for the receipt-scan dialog lifecycle.
 *
 * The dialog must only close from the explicit close control. Finishing a scan
 * (success, review, non-receipt, duplicate or technical failure) must never
 * change the open state, and the dialog must stay mounted across the page's
 * success/loading branches.
 */

const PAGE = new URL("../app/owner/subscription/page.tsx", import.meta.url);
const OVERLAY = new URL("../components/receipt-scan-overlay.tsx", import.meta.url);

async function readPage(): Promise<string> {
  return readFile(PAGE, "utf8");
}

function sliceBetween(
  source: string,
  startMarker: string,
  endMarker: string
): string {
  const start = source.indexOf(startMarker);
  assert.ok(start >= 0, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.ok(end > start, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("the scan dialog is mounted in every page branch", async () => {
  const source = await readPage();

  assert.match(source, /const receiptScanOverlay = \(/);

  const addOnBranch = sliceBetween(
    source,
    "if (addOnPaymentSuccess)",
    "if (subLoading)"
  );
  const loadingBranch = sliceBetween(
    source,
    "if (subLoading)",
    "// Success Screen"
  );
  const successBranch = sliceBetween(
    source,
    "if (paymentSuccess)",
    "// Incomplete Data Dialog"
  );
  const mainBranch = source.slice(source.indexOf("// Incomplete Data Dialog"));

  for (const [name, branch] of [
    ["add-on success", addOnBranch],
    ["loading", loadingBranch],
    ["payment success", successBranch],
    ["main", mainBranch],
  ] as const) {
    assert.ok(
      branch.includes("{receiptScanOverlay}"),
      `the scan dialog must stay mounted in the ${name} branch`
    );
  }
});

test("finishing or failing a scan never changes the open state", async () => {
  const source = await readPage();

  const finishBody = sliceBetween(
    source,
    "const finishReceiptScan",
    "const failReceiptScan"
  );
  const failBody = sliceBetween(
    source,
    "const failReceiptScan",
    "useEffect(() => () => stopScanPolling()"
  );

  assert.doesNotMatch(finishBody, /\bopen\s*:/);
  assert.doesNotMatch(failBody, /\bopen\s*:/);
});

test("only the explicit close control closes the dialog", async () => {
  const source = await readPage();

  const closeAssignments =
    source.match(
      /setReceiptScan\(\(prev\) => \(\{ \.\.\.prev, open: false \}\)\)/g
    ) ?? [];
  assert.equal(
    closeAssignments.length,
    1,
    "there must be exactly one open:false assignment"
  );

  const overlayStart = source.indexOf("const receiptScanOverlay");
  const overlayEnd = source.indexOf("// Add-on Payment Success Screen");
  const overlayBlock = source.slice(overlayStart, overlayEnd);
  assert.match(overlayBlock, /onClose=\{\(\) => \{/);
  assert.ok(
    overlayBlock.includes("open: false"),
    "the only close path must be the dialog's onClose"
  );
});

test("the overlay component has no timer or effect that closes it", async () => {
  const source = await readFile(OVERLAY, "utf8");

  assert.doesNotMatch(source, /setTimeout|setInterval/);
  assert.doesNotMatch(source, /onClose\(\)/);
  const explicitCloseHandlers = source.match(/onClick=\{onClose\}/g) ?? [];
  assert.equal(
    explicitCloseHandlers.length,
    2,
    "closing must be limited to the header X and the bottom button"
  );
});

test("waiting animations stop once a result is shown", async () => {
  const source = await readFile(OVERLAY, "utf8");

  assert.match(source, /frozen=\{outcome !== "scanning"\}/);
  assert.match(source, /isScanning\s*\?\s*"rwqan-progress-active"/);
  // The old blue palette must not return.
  assert.doesNotMatch(source, /#315f92|#c9d9eb|#274d78|#e6eff8/);
});
