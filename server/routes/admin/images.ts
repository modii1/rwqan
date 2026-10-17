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
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";

const router = Router();

const PROPERTY_NUMBER_PATTERN = /^[0-9]{4,8}$/;
const R2_IMAGE_FILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(jpe?g|png|webp)$/i;

function parsePropertyNumberParam(value: unknown): string | null {
  const candidate = typeof value === "string" ? value.trim() : "";
  return PROPERTY_NUMBER_PATTERN.test(candidate) ? candidate : null;
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

      const images = (list.Contents || [])
        .filter((obj) => obj.Key && /\.(jpg|jpeg|png|webp)$/i.test(obj.Key))
        .sort((a, b) => {
          const numA = parseInt(a.Key?.match(/(\d+)\./)?.[1] || "0");
          const numB = parseInt(b.Key?.match(/(\d+)\./)?.[1] || "0");
          return numA - numB;
        })
        .map((obj) => `${R2_PUBLIC_URL}/${obj.Key}`);

      res.json({ images });
    } catch (err: any) {
      console.error("ADMIN R2 LIST ERROR:", err?.message || err);
      // Return empty array instead of 500 to avoid breaking the UI
      res.json({ images: [] });
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

      // استخراج الـ key من URL: https://.../{propertyNumber}/{fileName}
      const fileName = url.split("/").pop();
      if (!fileName || !R2_IMAGE_FILE_PATTERN.test(fileName)) {
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
