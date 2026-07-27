import assert from "node:assert/strict";
import test from "node:test";

import {
  R2ImageStorageUnavailableError,
  countR2ImagesStrict,
  listR2PropertyImagesStrict,
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

test("strict R2 image listing returns real object keys in image order", async () => {
  let requestInput: Record<string, unknown> | undefined;
  const images = await listR2PropertyImagesStrict("14006", {
    client: {
      send: async (command) => {
        requestInput = (command as unknown as { input: Record<string, unknown> }).input;
        return {
          Contents: [
            { Key: "14006/1779584631700-10.jpg" },
            { Key: "14006/receipt.pdf" },
            { Key: "14006/1779584631700-0.jpg" },
            { Key: "14006/1779584631700-2.WEBP" },
          ],
        };
      },
    },
    bucket: "configured-bucket",
    publicUrl: "https://images.example/",
  });

  assert.deepEqual(images, [
    "https://images.example/14006/1779584631700-0.jpg",
    "https://images.example/14006/1779584631700-2.WEBP",
    "https://images.example/14006/1779584631700-10.jpg",
  ]);
  assert.deepEqual(requestInput, {
    Bucket: "configured-bucket",
    Prefix: "14006/",
  });
});

test("strict R2 image listing distinguishes no images from storage failure", async () => {
  const noImages = await listR2PropertyImagesStrict("14006", {
    client: { send: async () => ({ Contents: [] }) },
    bucket: "configured-bucket",
    publicUrl: "https://images.example",
  });
  assert.deepEqual(noImages, []);

  await assert.rejects(
    () =>
      listR2PropertyImagesStrict("14006", {
        client: {
          send: async () => {
            throw new Error("temporary storage error");
          },
        },
        bucket: "configured-bucket",
        publicUrl: "https://images.example",
      }),
    R2ImageStorageUnavailableError,
  );
});
