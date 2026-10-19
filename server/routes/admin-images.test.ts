import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";
import express from "express";

import { requireAdmin, requireSameOrigin } from "./middleware";
import adminImagesRoutes, {
  buildAdminImageUrl,
  parseAdminImageDeleteKey,
} from "./admin/images";

// ---------------------------------------------------------------------------
// Unit: listing URL building (DEV proxy vs production public URL)
// ---------------------------------------------------------------------------

test("buildAdminImageUrl returns a same-origin proxy URL in DEV", () => {
  const url = buildAdminImageUrl("90001/1779-0.png", {
    devProxy: true,
    origin: "http://localhost:5001",
    publicUrl: "https://your-dev-public-r2-domain.example",
  });
  assert.equal(
    url,
    "http://localhost:5001/api/admin/r2-image?key=90001%2F1779-0.png",
  );
});

test("buildAdminImageUrl keeps the public URL behavior outside DEV", () => {
  const url = buildAdminImageUrl("90001/1779-0.png", {
    devProxy: false,
    origin: "http://localhost:5001",
    publicUrl: "https://pub-example.r2.dev",
  });
  assert.equal(url, "https://pub-example.r2.dev/90001/1779-0.png");
});

// ---------------------------------------------------------------------------
// Unit: delete key parsing (proxy URL + direct URL compatibility)
// ---------------------------------------------------------------------------

test("parseAdminImageDeleteKey extracts the file name from a proxy URL", () => {
  assert.equal(
    parseAdminImageDeleteKey(
      "http://localhost:5001/api/admin/r2-image?key=90001%2F1779-0.png",
    ),
    "1779-0.png",
  );
  assert.equal(
    parseAdminImageDeleteKey("/api/admin/r2-image?key=90001/1.png"),
    "1.png",
  );
});

test("parseAdminImageDeleteKey still accepts direct public URLs", () => {
  assert.equal(
    parseAdminImageDeleteKey("https://pub-example.r2.dev/90001/1.png"),
    "1.png",
  );
});

test("parseAdminImageDeleteKey rejects non-image file names and empties", () => {
  assert.equal(parseAdminImageDeleteKey("not-a-valid-url"), null);
  assert.equal(parseAdminImageDeleteKey(""), null);
  assert.equal(parseAdminImageDeleteKey(undefined), null);
  assert.equal(
    parseAdminImageDeleteKey("/api/admin/r2-image?key=90001%2Fnotes.txt"),
    null,
  );
});

// ---------------------------------------------------------------------------
// Access control: proxy is admin-only, same-origin, and key-validated
// ---------------------------------------------------------------------------

test("admin image proxy is session protected and validates the key", async () => {
  const app = express();
  app.use((req, _res, next) => {
    (req as any).session = {
      ...(req.get("x-test-admin") === "1" ? { isAdmin: true } : {}),
    };
    next();
  });
  app.use("/api/admin", requireSameOrigin, requireAdmin);
  app.use(adminImagesRoutes);

  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const { port } = server.address() as AddressInfo;
    const base = `http://127.0.0.1:${port}`;
    const asAdmin = { "x-test-admin": "1" };

    const crossSite = await fetch(`${base}/api/admin/r2-image?key=90001%2F1.png`, {
      headers: { ...asAdmin, "sec-fetch-site": "cross-site" },
    });
    assert.equal(crossSite.status, 403);

    const anonymous = await fetch(`${base}/api/admin/r2-image?key=90001%2F1.png`);
    assert.equal(anonymous.status, 401);

    const missing = await fetch(`${base}/api/admin/r2-image`, { headers: asAdmin });
    assert.equal(missing.status, 400);

    for (const key of [
      "receipts%2Fsecret.png",
      "booking-commission-receipts%2F1.png",
      "90001%2F..%2Fsecret.png",
      "90001%2Fnotes.txt",
      "abc%2F1.png",
    ]) {
      const response = await fetch(`${base}/api/admin/r2-image?key=${key}`, {
        headers: asAdmin,
      });
      assert.equal(response.status, 403, `expected 403 for key=${key}`);
    }

    // A well-formed key passes validation and reaches storage. In the unit
    // environment R2 is unconfigured (503); when configured an unknown key
    // yields 404. It must never be an auth/validation rejection.
    const valid = await fetch(
      `${base}/api/admin/r2-image?key=99999%2Fzzz-admin-proxy-display-test.png`,
      { headers: asAdmin },
    );
    assert.ok(
      valid.status === 503 || valid.status === 404,
      `unexpected status for valid key: ${valid.status}`,
    );
  } finally {
    if (server.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => (error ? reject(error) : resolve()));
      });
    }
  }
});

// ---------------------------------------------------------------------------
// Deletion regression: proxy URLs are accepted; direct URLs still work
// ---------------------------------------------------------------------------

test("admin image delete accepts proxy URLs and validates input", async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).session = {
      ...(req.get("x-test-admin") === "1" ? { isAdmin: true } : {}),
    };
    next();
  });
  app.use("/api/admin", requireSameOrigin, requireAdmin);
  app.use(adminImagesRoutes);

  const server = app.listen(0, "127.0.0.1");
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const { port } = server.address() as AddressInfo;
    const endpoint = `http://127.0.0.1:${port}/api/admin/r2-images/99999/delete`;
    const asAdmin = { "x-test-admin": "1" };

    const anonymous = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "/api/admin/r2-image?key=99999%2Fx.png" }),
    });
    assert.equal(anonymous.status, 401);

    const crossSite = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", ...asAdmin, "sec-fetch-site": "cross-site" },
      body: JSON.stringify({ url: "/api/admin/r2-image?key=99999%2Fx.png" }),
    });
    assert.equal(crossSite.status, 403);

    const invalid = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", ...asAdmin },
      body: JSON.stringify({ url: "not-a-valid-url" }),
    });
    assert.equal(invalid.status, 400);

    // Under the old implementation url.split("/").pop() returned
    // "r2-image?key=99999%2F..." which failed validation (400). The proxy URL
    // must now be accepted. The key is intentionally non-existent so this stays
    // a safe no-op delete when R2 is configured.
    const proxied = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", ...asAdmin },
      body: JSON.stringify({
        url: "/api/admin/r2-image?key=99999%2Fzzz-admin-proxy-delete-test.png",
      }),
    });
    assert.equal(proxied.status, 200);
    assert.deepEqual(await proxied.json(), { ok: true });

    // Direct public URL form must keep working.
    const direct = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", ...asAdmin },
      body: JSON.stringify({
        url: "https://pub-example.r2.dev/99999/zzz-admin-direct-delete-test.png",
      }),
    });
    assert.equal(direct.status, 200);
    assert.deepEqual(await direct.json(), { ok: true });
  } finally {
    if (server.listening) {
      await new Promise<void>((resolve, reject) => {
        server.close((error?: Error) => (error ? reject(error) : resolve()));
      });
    }
  }
});
