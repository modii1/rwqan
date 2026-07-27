import assert from "node:assert/strict";
import test from "node:test";

import {
  R2ImageStorageUnavailableError,
  countR2ImagesStrict,
} from "./r2";

test("strict R2 image counting reports missing client or bucket configuration", async () => {
  await assert.rejects(
    () =>
      countR2ImagesStrict("12345", {
        client: null,
        bucket: "configured-bucket",
      }),
    R2ImageStorageUnavailableError,
  );
  await assert.rejects(
    () =>
      countR2ImagesStrict("12345", {
        client: { send: async () => ({ Contents: [] }) },
        bucket: undefined,
      }),
    R2ImageStorageUnavailableError,
  );
});

test("strict R2 image counting distinguishes a true zero from storage unavailability", async () => {
  const zero = await countR2ImagesStrict("12345", {
    client: { send: async () => ({ Contents: [] }) },
    bucket: "configured-bucket",
  });

  assert.equal(zero, 0);

  await assert.rejects(
    () =>
      countR2ImagesStrict("12345", {
        client: {
          send: async () => {
            throw new Error("R2 request failed");
          },
        },
        bucket: "configured-bucket",
      }),
    (error: unknown) => error instanceof R2ImageStorageUnavailableError,
  );
});

test("strict R2 image counting filters object keys to supported image extensions", async () => {
  let requestInput: Record<string, unknown> | undefined;
  const count = await countR2ImagesStrict("property-42", {
    client: {
      send: async (command) => {
        requestInput = (command as unknown as { input: Record<string, unknown> })
          .input;
        return {
          Contents: [
            { Key: "property-42/one.jpg" },
            { Key: "property-42/two.JPEG" },
            { Key: "property-42/three.png" },
            { Key: "property-42/four.WeBp" },
            { Key: "property-42/not-displayed.GIF" },
            { Key: "property-42/document.pdf" },
            { Key: "property-42/no-extension" },
            { Key: "property-42/fake.jpg.tmp" },
            {},
          ],
        };
      },
    },
    bucket: "configured-bucket",
  });

  assert.equal(count, 4);
  assert.deepEqual(requestInput, {
    Bucket: "configured-bucket",
    Prefix: "property-42/",
    MaxKeys: 200,
  });
});
