import assert from "node:assert/strict";
import test from "node:test";
import type { AddressInfo } from "node:net";
import express from "express";

import { R2ImageStorageUnavailableError } from "../utils/r2";
import { createPublicPropertyImagesHandler } from "./public";

test("public image route distinguishes a real empty list from R2 unavailability", async () => {
  let mode: "empty" | "images" | "unavailable" = "empty";
  const requestedProperties: string[] = [];
  const app = express();
  app.get(
    "/api/public/property-images/:propertyNumber",
    createPublicPropertyImagesHandler(async (propertyNumber) => {
      requestedProperties.push(propertyNumber);
      if (mode === "unavailable") throw new R2ImageStorageUnavailableError();
      if (mode === "images") {
        return ["https://images.example/14006/1779584631700-0.jpg"];
      }
      return [];
    }),
  );
  const server = app.listen(0, "127.0.0.1");

  try {
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const { port } = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${port}`;

    const empty = await fetch(`${baseUrl}/api/public/property-images/EMPTY`);
    assert.equal(empty.status, 200);
    assert.deepEqual(await empty.json(), { images: [] });

    mode = "images";
    const present = await fetch(`${baseUrl}/api/public/property-images/14006`);
    assert.equal(present.status, 200);
    assert.deepEqual(await present.json(), {
      images: ["https://images.example/14006/1779584631700-0.jpg"],
    });

    mode = "unavailable";
    const unavailable = await fetch(`${baseUrl}/api/public/property-images/14006`);
    assert.equal(unavailable.status, 503);
    assert.deepEqual(await unavailable.json(), {
      code: "IMAGE_STORAGE_UNAVAILABLE",
      error: "تعذر تحميل صور العقار مؤقتاً",
    });
    assert.deepEqual(requestedProperties, ["EMPTY", "14006", "14006"]);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
