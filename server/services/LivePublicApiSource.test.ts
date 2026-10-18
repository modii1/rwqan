import assert from "node:assert/strict";
import test from "node:test";
import { LivePublicApiError, createLivePublicApiSource } from "./LivePublicApiSource";

function mockFetch(payload: unknown, status = 200): void {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;
}

test("reads and normalises production properties from the public API", async () => {
  const originalFetch = globalThis.fetch;
  mockFetch([
    {
      propertyNumber: "00001",
      name: "شاليه بيت القمر",
      city: "بريدة",
      imageUrls: ["https://pub-e2fc1c0a598f4f0e91e47af63219848e.r2.dev/00001/1.jpg"],
      facilities: "مسبح,حديقة",
    },
    { propertyNumber: "00002", name: "فيلا", city: "الرياض", facilities: "[\"ملعب\"]" },
  ]);
  try {
    const source = createLivePublicApiSource({
      baseUrl: "https://rwqan.sa",
      timeoutMs: 5000,
    });
    const properties = await source.getProperties();
    assert.equal(properties.length, 2);
    assert.equal(properties[0]?.propertyNumber, "00001");
    assert.deepEqual(properties[0]?.facilities, ["مسبح", "حديقة"]);
    assert.equal(properties[1]?.propertyNumber, "00002");
    assert.deepEqual(properties[1]?.facilities, ["ملعب"]);
    assert.ok(Array.isArray(properties[0]?.imageUrls));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a non-OK response fails closed (no fallback)", async () => {
  const originalFetch = globalThis.fetch;
  mockFetch({ error: "boom" }, 500);
  try {
    const source = createLivePublicApiSource({
      baseUrl: "https://rwqan.sa",
      timeoutMs: 5000,
    });
    await assert.rejects(() => source.getProperties(), LivePublicApiError);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("a non-array payload fails closed", async () => {
  const originalFetch = globalThis.fetch;
  mockFetch({ unexpected: true });
  try {
    const source = createLivePublicApiSource({
      baseUrl: "https://rwqan.sa",
      timeoutMs: 5000,
    });
    await assert.rejects(() => source.getProperties(), LivePublicApiError);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("the base URL must be https", () => {
  assert.throws(
    () => createLivePublicApiSource({ baseUrl: "http://insecure.example", timeoutMs: 1000 }),
    /https/,
  );
});
