import { Router } from "express";
import { requireAdmin } from "../middleware";
import { propertyService } from "../../services";
import {
  R2ImageStorageUnavailableError,
  R2_BUCKET,
  R2_PUBLIC_URL,
  countR2ImagesStrict,
  r2,
} from "../../utils/r2";
import { uploadImages } from "../../utils/helpers";
import { detectBookingCommissionReceiptContentType } from "../../services/BookingCommissionReceiptService";
import {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";

const router = Router();

const PROPERTY_NUMBER_PATTERN = /^[0-9]{4,8}$/;
const R2_IMAGE_FILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(jpe?g|png|webp)$/i;
// Mirrors the public read-through proxy: only property images under a numeric
// property-prefix directory are eligible. This excludes receipts/private keys.
const ADMIN_R2_IMAGE_KEY_PATTERN = /^[0-9]{4,8}\/[A-Za-z0-9][A-Za-z0-9._-]*\.(jpe?g|png|webp)$/i;

function parsePropertyNumberParam(value: unknown): string | null {
  const candidate = typeof value === "string" ? value.trim() : "";
  return PROPERTY_NUMBER_PATTERN.test(candidate) ? candidate : null;
}

// Build the URL the admin gallery uses to display an R2 image. In local DEV
// (placeholder R2_PUBLIC_URL with no DNS) we emit a same-origin authenticated
// proxy URL; production keeps the existing public URL behavior unchanged.
export function buildAdminImageUrl(
  key: string,
  opts: { devProxy: boolean; origin: string; publicUrl: string },
): string {
  if (opts.devProxy) {
    return `${opts.origin}/api/admin/r2-image?key=${encodeURIComponent(key)}`;
  }
  return `${opts.publicUrl}/${key}`;
}

// Derive the R2 file name from a delete request. Accepts either a same-origin
// proxy URL (/api/admin/r2-image?key=...) or a direct public URL
// (https://<public>/{propertyNumber}/{fileName}), mirroring the owner delete
// path. Returns null when the result is not a valid image file name.
export function parseAdminImageDeleteKey(url: unknown): string | null {
  const raw = typeof url === "string" ? url : String(url ?? "");
  if (!raw) return null;

  const proxyKeyMatch = raw.match(/[?&]key=([^&]+)/);
  let keyCandidate = proxyKeyMatch ? decodeURIComponent(proxyKeyMatch[1]) : raw;
  try {
    keyCandidate = decodeURIComponent(keyCandidate);
  } catch {
    /* already decoded */
  }

  const fileName = keyCandidate.split("/").pop() || "";
  return R2_IMAGE_FILE_PATTERN.test(fileName) ? fileName : null;
}

router.get("/api/admin/r2-images-count", async (req, res) => {
    try {
      if (!r2 || !R2_BUCKET) {
        return res.status(503).json({
          available: false,
          code: "IMAGE_STORAGE_UNAVAILABLE",
          error:
            "تعذر التحقق من صور العقارات حالياً. تحقق من إعدادات تخزين الصور ثم حاول مرة أخرى.",
        });
      }
      // جلب جميع العقارات
      const properties = await propertyService.getAll();
      const counts: Record<string, number> = {};

      // التحقق من كل عقار
      for (const prop of properties) {
        const propertyNumber = prop.propertyNumber;
        try {
          counts[propertyNumber] = await countR2ImagesStrict(propertyNumber);
        } catch (error) {
          if (error instanceof R2ImageStorageUnavailableError) {
            return res.status(503).json({
              available: false,
              code: "IMAGE_STORAGE_UNAVAILABLE",
              error:
                "تعذر التحقق من صور العقارات حالياً. حاول مرة أخرى قبل الاعتماد على عدد الصور.",
            });
          }
          throw error;
        }
      }

      res.json({ available: true, counts });
    } catch (err) {
      console.error("R2 COUNT ERROR:", err);
      res.status(500).json({
        available: false,
        code: "IMAGE_COUNT_FAILED",
        error: "تعذر تحميل أعداد صور العقارات حالياً.",
      });
    }
  });

  // جلب جميع صور عقار من R2
  router.get("/api/admin/r2-images/:propertyNumber", async (req, res) => {
    try {
      const propertyNumber = parsePropertyNumberParam(req.params.propertyNumber);
      if (!propertyNumber) {
        return res.json({ images: [] });
      }
      if (!r2) {
        console.warn(`[ADMIN R2] r2 client is null for property ${propertyNumber} — env vars not set`);
        return res.json({ images: [] });
      }
      if (!R2_BUCKET) {
        console.warn(`[ADMIN R2] R2_BUCKET_NAME not set for property ${propertyNumber}`);
        return res.json({ images: [] });
      }

      const list = await r2.send(
        new ListObjectsV2Command({
          Bucket: R2_BUCKET,
          Prefix: `${propertyNumber}/`,
        })
      );

      // DEV only: R2_PUBLIC_URL is a placeholder domain (no DNS). Mirror the
      // owner/public behavior by emitting same-origin authenticated proxy URLs
      // (bucket stays private). Production keeps the public URL unchanged.
      const useDevProxy = process.env.NODE_ENV === "development";
      const origin = `${req.protocol}://${req.get("host")}`;

      const images = (list.Contents || [])
        .filter((obj) => obj.Key && /\.(jpg|jpeg|png|webp)$/i.test(obj.Key))
        .sort((a, b) => {
          const numA = parseInt(a.Key?.match(/(\d+)\./)?.[1] || "0");
          const numB = parseInt(b.Key?.match(/(\d+)\./)?.[1] || "0");
          return numA - numB;
        })
        .map((obj) =>
          buildAdminImageUrl(obj.Key as string, {
            devProxy: useDevProxy,
            origin,
            publicUrl: R2_PUBLIC_URL,
          }),
        );

      res.json({ images });
    } catch (err: any) {
      console.error("ADMIN R2 LIST ERROR:", err?.message || err);
      // Return empty array instead of 500 to avoid breaking the UI
      res.json({ images: [] });
    }
  });

  // GET /api/admin/r2-image - Serve a private R2 image to an authenticated admin
  // (DEV display path; the bucket itself stays private). Only numeric
  // property-prefix image keys are eligible, so receipts and other private
  // files can never be served through this route.
  router.get("/api/admin/r2-image", requireAdmin, async (req, res) => {
    try {
      const key = typeof req.query.key === "string" ? req.query.key.trim() : "";

      if (!key) {
        return res.status(400).json({ error: "معرّف الصورة مطلوب" });
      }
      if (!ADMIN_R2_IMAGE_KEY_PATTERN.test(key)) {
        return res.status(403).json({ error: "معرّف الصورة غير صالح" });
      }
      if (!r2 || !R2_BUCKET) {
        return res.status(503).json({ error: "تخزين الصور غير متاح" });
      }

      const output = await r2.send(
        new GetObjectCommand({ Bucket: R2_BUCKET, Key: key })
      );
      const body = output.Body;
      if (!body) {
        return res.status(404).json({ error: "الصورة غير موجودة" });
      }

      const stream = body as any;
      res.setHeader("Content-Type", output.ContentType || "image/jpeg");
      if (output.ContentLength !== undefined) {
        res.setHeader("Content-Length", String(output.ContentLength));
      }
      res.setHeader("Cache-Control", "private, max-age=86400");
      if (typeof stream.pipe === "function") {
        return stream.pipe(res);
      }
      return res.send(Buffer.isBuffer(body) ? body : Buffer.from(body as any));
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
      if (status === 404 || (error as { name?: string })?.name === "NoSuchKey") {
        return res.status(404).json({ error: "الصورة غير موجودة" });
      }
      console.error("[ADMIN R2 IMAGE] error:", error);
      return res.status(500).json({ error: "تعذر تحميل الصورة" });
    }
  });

  // رفع صور جديدة لعقار من لوحة التحكم
  router.post(
    "/api/admin/r2-images/:propertyNumber",
    uploadImages.array("images"),
    async (req, res) => {
      try {
        const propertyNumber = parsePropertyNumberParam(req.params.propertyNumber);
        if (!propertyNumber) {
          return res.status(400).json({ error: "رقم العقار غير صحيح" });
        }
        if (!r2 || !R2_BUCKET) return res.json({ success: true, count: 0 });

        // عد الصور الحالية لتحديد البداية
        const list = await r2.send(
          new ListObjectsV2Command({
            Bucket: R2_BUCKET,
            Prefix: `${propertyNumber}/`,
          })
        );

        let index = (list.Contents?.length || 0) + 1;

        const files = Array.isArray(req.files) ? req.files : [];
        if (files.length === 0) {
          return res.status(400).json({ error: "لا توجد صور تم رفعها" });
        }

        // Match the owner upload path: reject anything that is not a real
        // image (magic-byte check), and store the detected type instead of
        // blindly labelling every upload as image/jpeg.
        const detectedTypes = files.map((file) =>
          detectBookingCommissionReceiptContentType(file.buffer),
        );
        if (detectedTypes.some((type) => !type || type === "application/pdf")) {
          return res.status(415).json({ error: "صيغة الصورة غير مدعومة" });
        }

        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          const detectedType = detectedTypes[i] as string;
          const extension = detectedType === "image/png"
            ? "png"
            : detectedType === "image/webp"
              ? "webp"
              : "jpg";
          await r2.send(
            new PutObjectCommand({
              Bucket: R2_BUCKET || "",
              Key: `${propertyNumber}/${index}.${extension}`,
              Body: file.buffer,
              ContentType: detectedType,
            })
          );
          index++;
        }

        res.json({ ok: true });
      } catch (err) {
        res.status(500).json({ error: "Admin upload failed" });
      }
    }
  );

  // حذف صورة من R2 باستخدام URL (نفس طريقة المالك)
  router.post("/api/admin/r2-images/:propertyNumber/delete", async (req, res) => {
    try {
      const propertyNumber = parsePropertyNumberParam(req.params.propertyNumber);
      const { url } = req.body;

      if (!propertyNumber) {
        return res.status(400).json({ error: "رقم العقار غير صحيح" });
      }

      if (!url) {
        return res.status(400).json({ error: "URL مطلوبة" });
      }

      // The gallery may submit either a same-origin proxy URL
      // (/api/admin/r2-image?key=...) in DEV or a direct public URL
      // (https://<public>/{propertyNumber}/{fileName}). Derive the key from
      // either form, mirroring the owner delete path.
      const fileName = parseAdminImageDeleteKey(url);
      if (!fileName) {
        return res.status(400).json({ error: "رابط الصورة غير صحيح" });
      }
      const key = `${propertyNumber}/${fileName}`;
      if (!r2 || !R2_BUCKET) return res.json({ ok: true });

      console.log(`🔴 [ADMIN DELETE] Deleting: ${key}`);

      await r2.send(
        new DeleteObjectCommand({
          Bucket: R2_BUCKET,
          Key: key,
        })
      );

      console.log(`✅ [ADMIN DELETE] Deleted: ${key}`);
      res.json({ ok: true });
    } catch (err: any) {
      console.error("ADMIN R2 DELETE ERROR:", err?.message);
      res.status(500).json({ error: "فشل الحذف" });
    }
  });

export default router;
