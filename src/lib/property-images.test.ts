import assert from "node:assert/strict";
import test from "node:test";

import {
  PROPERTY_IMAGE_PLACEHOLDER,
  fetchPropertyImageUrls,
  getCachedPropertyImage,
  getPropertyImageSetKey,
  hasCachedPropertyImages,
} from "./property-images";

test("a transient image API failure retries and returns the real timestamp key", async () => {
  let calls = 0;
  const waits: number[] = [];
  const images = await fetchPropertyImageUrls(
    "14006",
    async (url) => {
      calls += 1;
      assert.equal(url, "/api/public/property-images/14006");
      if (calls === 1) {
        return { ok: false, json: async () => ({ code: "IMAGE_STORAGE_UNAVAILABLE" }) };
      }
      return {
        ok: true,
        json: async () => ({
          images: ["https://images.example/14006/1779584631700-0.jpg"],
        }),
      };
    },
    {
      attempts: 2,
      retryDelayMs: 10,
      wait: async (milliseconds) => { waits.push(milliseconds); },
    },
  );

  assert.equal(calls, 2);
  assert.deepEqual(waits, [10]);
  assert.deepEqual(images, [
    "https://images.example/14006/1779584631700-0.jpg",
  ]);
});

test("a genuine successful empty image list is not retried", async () => {
  let calls = 0;
  const images = await fetchPropertyImageUrls("EMPTY", async () => {
    calls += 1;
    return { ok: true, json: async () => ({ images: [] }) };
  });

  assert.deepEqual(images, []);
  assert.equal(calls, 1);
});

test("cards use the real cached R2 key instead of assuming 1.jpg", () => {
  const timestampImage =
    "https://images.example/14006/1779584631700-0.jpg";
  const images = new Map([["14006", [timestampImage]]]);

  assert.equal(hasCachedPropertyImages(images, "14006"), true);
  assert.equal(getCachedPropertyImage("14006", 0, images), timestampImage);
});

test("missing images use a local placeholder rather than a nonexistent R2 key", () => {
  const images = new Map<string, string[]>([["14006", []]]);

  assert.equal(hasCachedPropertyImages(images, "14006"), false);
  assert.equal(
    getCachedPropertyImage("14006", 0, images),
    PROPERTY_IMAGE_PLACEHOLDER,
  );
  assert.equal(getCachedPropertyImage("14006", 0, images).includes("/1.jpg"), false);
});

test("image effect key changes when same-size search results change identity", () => {
  assert.notEqual(
    getPropertyImageSetKey(["14005"]),
    getPropertyImageSetKey(["14006"]),
  );
});
