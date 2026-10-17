/**
 * DEV-only R2 integration test.
 *
 * Safety contract (enforced at runtime by assertDevTestTarget):
 *  - refuses unless NODE_ENV=development
 *  - refuses unless the Firebase project is exactly `rwqan-sa-dev`
 *   - refuses unless the R2 bucket is exactly `rwqan-sa-dev`
 *   - refuses when external services are enabled
 *   - only touches synthetic `90001`-`90003` prefixes and deletes exactly the
 *     object keys it creates (never pre-existing files).
 *
 * Run (with the DEV server on :5001 and the E2E data seeded):
 *   $env:NODE_ENV="development"; npx tsx scripts/dev/r2-dev-integration-test.ts
 */
import "../../server/config/loadEnv";
import { randomBytes } from "node:crypto";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
} from "@aws-sdk/client-s3";
import type { APIRequestContext, BrowserContext } from "@playwright/test";
import { assertDevTestTarget } from "./e2e-test-data";
import { r2, R2_BUCKET } from "../../server/utils/r2";
import { storage } from "../../server/storage";

const BASE = "http://localhost:5001";
const OWNER = { propertyNumber: "90001", pin: "511111" };
const OTHER_OWNER = { propertyNumber: "90002", pin: "522222" };

const PNG_1x1_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const JPEG_PREFIX = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01]);

const pngBuffer = () => Buffer.from(PNG_1x1_BASE64, "base64");

type ResultStatus = "PASS" | "FAIL" | "BLOCKED" | "NA";
interface CaseResult {
  id: string;
  name: string;
  status: ResultStatus;
  detail: string;
}

const results: CaseResult[] = [];
const createdKeys = new Set<string>();

function record(id: string, name: string, status: ResultStatus, detail: string) {
  results.push({ id, name, status, detail });
  console.log(`[${status}] ${id} ${name} — ${detail}`);
}

async function loginOwner(ctx: BrowserContext, creds: { propertyNumber: string; pin: string }) {
  const res = await ctx.request.post(`${BASE}/api/owner/login`, { data: creds });
  if (res.status() !== 200) throw new Error(`owner login failed: ${res.status()}`);
}

async function loginAdmin(ctx: BrowserContext): Promise<boolean> {
  const code = process.env.ADMIN_CODE;
  const password = process.env.ADMIN_PASSWORD;
  if (!code || !password) return false;
  const res = await ctx.request.post(`${BASE}/api/admin/login`, {
    headers: { "sec-fetch-site": "same-origin" },
    data: { code, password },
  });
  return res.status() === 200;
}

async function listKeys(prefix: string): Promise<Set<string>> {
  const out = new Set<string>();
  const res = await r2.send(new ListObjectsV2Command({ Bucket: R2_BUCKET, Prefix: prefix }));
  for (const obj of res.Contents ?? []) if (obj.Key) out.add(obj.Key);
  return out;
}

async function readBytes(res: Awaited<ReturnType<APIRequestContext["get"]>>): Promise<Buffer> {
  return Buffer.from(await res.body());
}

async function main(): Promise<void> {
  const target = assertDevTestTarget();
  if (!r2 || !R2_BUCKET) {
    throw new Error("R2 client is not configured; cannot run R2 integration test");
  }
  console.log(`[target] project=${target.projectId} bucket=${target.r2Bucket} server=${BASE}`);

  const { chromium } = await import("@playwright/test");
  const browser = await chromium.launch({ headless: true });

  try {
    const ctx = await browser.newContext();
    await loginOwner(ctx, OWNER);

    // ---- R2-UP-001: owner uploads a real property image -------------------
    const name1 = `e2e-r2-${Date.now()}-${randomBytes(3).toString("hex")}.png`;
    const uploadRes = await ctx.request.post(`${BASE}/api/owner/images`, {
      multipart: { images: { name: name1, mimeType: "image/png", buffer: pngBuffer() } },
    });
    const uploadBody: any = await uploadRes.json().catch(() => ({}));
    const uploadedKeys: string[] = Array.isArray(uploadBody?.uploaded) ? uploadBody.uploaded : [];
    const uploadedUrls: string[] = Array.isArray(uploadBody?.urls) ? uploadBody.urls : [];
    uploadedKeys.forEach((k) => createdKeys.add(k));
    const key1 = uploadedKeys[0] || "";

    if (uploadRes.status() === 200 && uploadedKeys.length === 1) {
      record("R2-UP-001", "owner uploads property image (real R2 write)", "PASS", `status=200 key=${key1}`);
    } else {
      record("R2-UP-001", "owner uploads property image (real R2 write)", "FAIL",
        `status=${uploadRes.status()} body=${JSON.stringify(uploadBody)}`);
    }

    // ---- R2-URL-001: served URL is a real same-origin proxy, not fake ------
    const servedUrl = uploadedUrls[0] || "";
    if (/^\/api\/owner\/r2-image\?key=/.test(servedUrl) && !/\.example/i.test(servedUrl)) {
      record("R2-URL-001", "served image URL is a real same-origin proxy (no fake domain)", "PASS", servedUrl);
    } else {
      record("R2-URL-001", "served image URL is a real same-origin proxy (no fake domain)", "FAIL",
        `unexpected url=${servedUrl}`);
    }

    // ---- R2-RD-001: read the image back via the authenticated proxy --------
    if (key1) {
      const read1 = await ctx.request.get(`${BASE}/api/owner/r2-image?key=${encodeURIComponent(key1)}`);
      const ct = read1.headers()["content-type"] || "";
      const bytes = await readBytes(read1);
      if (read1.status() === 200 && /^image\//.test(ct) && bytes.compare(pngBuffer()) === 0) {
        record("R2-RD-001", "owner reads own private image (content matches upload)", "PASS",
          `status=200 content-type=${ct} bytes=${bytes.length}`);
      } else {
        record("R2-RD-001", "owner reads own private image (content matches upload)", "FAIL",
          `status=${read1.status()} ct=${ct} bytes=${bytes.length}`);
      }
    }

    // ---- R2-RD-002: reload — a brand new session still reads the object ----
    if (key1) {
      const ctx2 = await browser.newContext();
      await loginOwner(ctx2, OWNER);
      const read2 = await ctx2.request.get(`${BASE}/api/owner/r2-image?key=${encodeURIComponent(key1)}`);
      const bytes2 = await readBytes(read2);
      const ok = read2.status() === 200 && bytes2.compare(pngBuffer()) === 0;
      record("R2-RD-002", "image persists after reload (fresh session)", ok ? "PASS" : "FAIL",
        `status=${read2.status()} bytes=${bytes2.length}`);
      await ctx2.close();
    }

    // ---- R2-UX-001/002: renders in the owner gallery UI, and after reload ---
    if (key1) {
      const page = await ctx.newPage();
      const selector = `img[src*="${encodeURIComponent(key1)}"]`;
      try {
        await page.goto(`${BASE}/owner/images`, { waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForSelector(selector, { timeout: 60000 });
        await page.waitForFunction((sel) => {
          const img = document.querySelector(sel) as HTMLImageElement | null;
          return !!img && img.complete && img.naturalWidth > 0;
        }, selector, { timeout: 30000 });
        const w1 = await page.evaluate((sel) => (document.querySelector(sel) as HTMLImageElement).naturalWidth, selector);
        record("R2-UX-001", "uploaded image renders in owner gallery UI", w1 > 0 ? "PASS" : "FAIL", `naturalWidth=${w1}`);

        await page.reload({ waitUntil: "domcontentloaded", timeout: 60000 });
        await page.waitForSelector(selector, { timeout: 60000 });
        await page.waitForFunction((sel) => {
          const img = document.querySelector(sel) as HTMLImageElement | null;
          return !!img && img.complete && img.naturalWidth > 0;
        }, selector, { timeout: 30000 });
        const w2 = await page.evaluate((sel) => (document.querySelector(sel) as HTMLImageElement).naturalWidth, selector);
        record("R2-UX-002", "image still renders after page reload", w2 > 0 ? "PASS" : "FAIL", `naturalWidth=${w2}`);
      } catch (error) {
        record("R2-UX-001", "uploaded image renders in owner gallery UI", "FAIL", (error as Error).message);
      } finally {
        await page.close();
      }
    }

    // ---- R2-VAL-001: reject non-image content (magic bytes) ----------------
    {
      const res = await ctx.request.post(`${BASE}/api/owner/images`, {
        multipart: { images: { name: "e2e-r2-notimage.png", mimeType: "image/png", buffer: Buffer.from("not an image") } },
      });
      record("R2-VAL-001", "reject non-image content (magic-byte validation)", res.status() === 415 ? "PASS" : "FAIL",
        `status=${res.status()}`);
    }

    // ---- R2-VAL-002: reject image over the 2MB size cap --------------------
    {
      const big = Buffer.concat([JPEG_PREFIX, Buffer.alloc(2 * 1024 * 1024 + 1024, 0x41)]);
      const res = await ctx.request.post(`${BASE}/api/owner/images`, {
        multipart: { images: { name: "e2e-r2-big.jpg", mimeType: "image/jpeg", buffer: big } },
      });
      const body: any = await res.json().catch(() => ({}));
      const rejected = res.status() >= 400 && res.status() < 500;
      record("R2-VAL-002", "reject image over 2MB size cap", rejected ? "PASS" : "FAIL",
        `status=${res.status()} error=${body?.error ?? ""}`);
    }

    // ---- R2-AUTH-001: unauthenticated read is rejected ---------------------
    if (key1) {
      const anon = await browser.newContext();
      const res = await anon.request.get(`${BASE}/api/owner/r2-image?key=${encodeURIComponent(key1)}`);
      record("R2-AUTH-001", "unauthenticated read of private image is rejected", res.status() === 401 ? "PASS" : "FAIL",
        `status=${res.status()} (expected 401)`);
      await anon.close();
    }

    // ---- R2-AUTH-002: cross-owner read is rejected -------------------------
    if (key1) {
      const other = await browser.newContext();
      await loginOwner(other, OTHER_OWNER);
      const res = await other.request.get(`${BASE}/api/owner/r2-image?key=${encodeURIComponent(key1)}`);
      record("R2-AUTH-002", "cross-owner read is rejected (key outside session property)", res.status() === 403 ? "PASS" : "FAIL",
        `status=${res.status()} (expected 403)`);
      await other.close();
    }

    // ---- R2-PRIV-001: receipt object stays private -------------------------
    {
      const receiptKey = `receipts/90001-e2etest-${Date.now()}.jpg`;
      createdKeys.add(receiptKey);
      await r2.send(new PutObjectCommand({
        Bucket: R2_BUCKET,
        Key: receiptKey,
        Body: Buffer.concat([JPEG_PREFIX, Buffer.from("synthetic-receipt")]),
        ContentType: "image/jpeg",
      }));
      let storedPrivately = false;
      try {
        const got = await r2.send(new GetObjectCommand({ Bucket: R2_BUCKET, Key: receiptKey }));
        storedPrivately = Boolean(got.Body);
      } catch { storedPrivately = false; }

      const anon = await browser.newContext();
      const publicRead = await anon.request.get(`${BASE}/api/public/r2-image?key=${encodeURIComponent(receiptKey)}`);
      // Also confirm it does not leak through the owner image listing.
      const listRes = await ctx.request.get(`${BASE}/api/owner/r2-images`);
      const listBody: any = await listRes.json().catch(() => ({}));
      const listLeaksReceipt = Array.isArray(listBody?.images)
        && listBody.images.some((u: string) => String(u).includes("receipts"));
      await anon.close();

      const ok = publicRead.status() === 403 && storedPrivately && !listLeaksReceipt;
      record("R2-PRIV-001", "receipt stored privately, not served/listed publicly", ok ? "PASS" : "FAIL",
        `public_proxy=${publicRead.status()} stored=${storedPrivately} listed=${listLeaksReceipt}`);
    }

    // ---- R2-ADMIN-001/002: admin upload path enforces content validation ---
    {
      const adminCtx = await browser.newContext();
      const loggedIn = await loginAdmin(adminCtx);
      if (!loggedIn) {
        record("R2-ADMIN-001", "admin rejects non-image content", "BLOCKED",
          "ADMIN_CODE/ADMIN_PASSWORD not available in this environment");
        await adminCtx.close();
      } else {
        const before = await listKeys("90003/");

        const bad = await adminCtx.request.post(`${BASE}/api/admin/r2-images/90003`, {
          headers: { "sec-fetch-site": "same-origin" },
          multipart: { images: { name: "e2e-admin-notimage.png", mimeType: "image/png", buffer: Buffer.from("not an image") } },
        });
        record("R2-ADMIN-001", "admin rejects non-image content (magic-byte validation)",
          bad.status() === 415 ? "PASS" : "FAIL", `status=${bad.status()} (expected 415)`);

        const good = await adminCtx.request.post(`${BASE}/api/admin/r2-images/90003`, {
          headers: { "sec-fetch-site": "same-origin" },
          multipart: { images: { name: "e2e-admin-image.png", mimeType: "image/png", buffer: pngBuffer() } },
        });
        const goodBody: any = await good.json().catch(() => ({}));
        const after = await listKeys("90003/");
        const newKeys = [...after].filter((k) => !before.has(k));
        newKeys.forEach((k) => createdKeys.add(k));
        record("R2-ADMIN-002", "admin uploads a valid image with detected content-type",
          good.status() === 200 && goodBody?.ok === true && newKeys.length === 1 ? "PASS" : "FAIL",
          `status=${good.status()} body=${JSON.stringify(goodBody)} newKeys=${JSON.stringify(newKeys)}`);
        await adminCtx.close();
      }
    }

    // ---- R2-PUB-001/002: public image listing honours the visibility gate --
    {
      const gateProperty = "90003";
      const original = await storage.getPropertyByNumber(gateProperty);
      const originalStatus = original?.verificationStatus ?? "approved";
      let pendingStatus = 0;
      let restoredStatus = 0;
      try {
        await storage.updateProperty(gateProperty, { verificationStatus: "pending" });
        const pending = await ctx.request.get(`${BASE}/api/public/property-images/${gateProperty}`);
        pendingStatus = pending.status();
      } finally {
        await storage.updateProperty(gateProperty, { verificationStatus: originalStatus as any });
        const restored = await ctx.request.get(`${BASE}/api/public/property-images/${gateProperty}`);
        restoredStatus = restored.status();
      }
      record("R2-PUB-001", "public image listing blocked for non-approved property, allowed for approved",
        pendingStatus === 403 && restoredStatus === 200 ? "PASS" : "FAIL",
        `pending=${pendingStatus} (expected 403), restored=${restoredStatus} (expected 200)`);

      const unknown = await ctx.request.get(`${BASE}/api/public/property-images/99999`);
      const unknownBody: any = await unknown.json().catch(() => ({}));
      record("R2-PUB-002", "public image listing for unknown property returns empty list (no leakage)",
        unknown.status() === 200 && Array.isArray(unknownBody?.images) && unknownBody.images.length === 0 ? "PASS" : "FAIL",
        `status=${unknown.status()} body=${JSON.stringify(unknownBody)}`);
    }

    // ---- R2-SIGNED-001: presigned URL expiry (system does not use them) ----
    record("R2-SIGNED-001", "temporary/signed URL validity + expiry", "NA",
      "Codebase issues no presigned URLs; DEV serves private images via authenticated read-through proxies (no expiring links).");

    await ctx.close();
  } finally {
    for (const key of createdKeys) {
      try {
        await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
      } catch (error) {
        console.warn(`[cleanup] failed to delete ${key}: ${(error as Error).message}`);
      }
    }
    await browser.close();
  }

  const summary = {
    startedAt: new Date().toISOString(),
    target,
    total: results.length,
    pass: results.filter((r) => r.status === "PASS").length,
    fail: results.filter((r) => r.status === "FAIL").length,
    blocked: results.filter((r) => r.status === "BLOCKED").length,
    na: results.filter((r) => r.status === "NA").length,
    cases: results,
  };
  console.log("[summary] " + JSON.stringify(summary));
  const reportsDir = join(process.cwd(), "quality", "reports");
  if (!existsSync(reportsDir)) mkdirSync(reportsDir, { recursive: true });
  writeFileSync(join(reportsDir, "phase6-r2.json"), JSON.stringify(summary, null, 2));

  if (summary.fail > 0) process.exit(1);
}

main().catch((error) => {
  console.error("[R2 DEV TEST] fatal:", error);
  process.exit(1);
});
