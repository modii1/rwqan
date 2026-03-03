import { Router } from "express";
import { requireAdmin } from "../middleware";
import { propertyService } from "../../services";
import { r2, R2_BUCKET, R2_PUBLIC_URL } from "../../utils/r2";
import { upload } from "../../utils/helpers";
import {
  PutObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";

const router = Router();

router.get("/api/admin/r2-images-count", async (req, res) => {
    try {
      if (!r2 || !R2_BUCKET) return res.json({});
      // جلب جميع العقارات
      const properties = await propertyService.getAll();
      const counts: Record<string, number> = {};

      // التحقق من كل عقار
      for (const prop of properties) {
        const propertyNumber = prop.propertyNumber;
        try {
          const list = await r2.send(
            new ListObjectsV2Command({
              Bucket: R2_BUCKET,
              Prefix: `${propertyNumber}/`,
            })
          );

          // عد الصور فقط (jpg, png, webp)
          const imageCount = (list.Contents || []).filter(
            (obj) => obj.Key && /\.(jpg|jpeg|png|webp)$/i.test(obj.Key)
          ).length;

          counts[propertyNumber] = imageCount;
        } catch {
          counts[propertyNumber] = 0;
        }
      }

      res.json({ counts });
    } catch (err) {
      console.error("R2 COUNT ERROR:", err);
      res.status(500).json({ error: "Failed to count R2 images" });
    }
  });

  // جلب جميع صور عقار من R2
  router.get("/api/admin/r2-images/:propertyNumber", async (req, res) => {
    try {
      const propertyNumber = req.params.propertyNumber;
      if (!propertyNumber || !propertyNumber.trim()) {
        return res.json({ images: [] });
      }
      if (!r2 || !R2_BUCKET) return res.json({ images: [] });

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
    upload.array("images"),
    async (req, res) => {
      try {
        const propertyNumber = req.params.propertyNumber;
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
        for (const file of files) {
          await r2.send(
            new PutObjectCommand({
              Bucket: R2_BUCKET || "",
              Key: `${propertyNumber}/${index}.jpg`,
              Body: file.buffer,
              ContentType: "image/jpeg",
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
      const { propertyNumber } = req.params;
      const { url } = req.body;

      if (!url) {
        return res.status(400).json({ error: "URL مطلوبة" });
      }

      // استخراج الـ key من URL: https://.../{propertyNumber}/{fileName}
      const fileName = url.split("/").pop();
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
