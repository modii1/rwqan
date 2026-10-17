import assert from "node:assert/strict";
import { test } from "node:test";

import { runOwnerManualVerification } from "./owner-verification";

test("manual verification replaces an OSRM InvalidUrl payload with a useful error", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    JSON.stringify({
      message: 'URL string malformed close to position 1: "/"',
      code: "InvalidUrl",
    }),
    { status: 400, headers: { "Content-Type": "application/json" } },
  );

  try {
    await assert.rejects(
      runOwnerManualVerification(),
      /تم الاتصال بخدمة أخرى بدلاً من روقان/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("manual verification preserves the server's silent repeat flag", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(
    JSON.stringify({
      success: true,
      verified: true,
      alreadyVerified: true,
      notificationRequired: false,
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );

  try {
    const result = await runOwnerManualVerification();
    assert.equal(result.verified, true);
    assert.equal(result.notificationRequired, false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
