import { Router } from "express";
import { requireAdmin } from "../middleware";
import { contentService } from "../../services";

const router = Router();

// ======================
// Blog API (Public)
// ======================

// جلب كل المقالات المنشورة (للعامة)
router.get("/api/blog", async (_req, res) => {
  try {
    const posts = await contentService.getAllPosts(true);
    res.json(posts);
  } catch (err) {
    console.error("Error fetching blog posts:", err);
    res.status(500).json({ error: "فشل في جلب المقالات" });
  }
});

// جلب مقال بالرابط الدائم (للعامة)
router.get("/api/blog/:slug", async (req, res) => {
  try {
    const { slug } = req.params;
    const post = await contentService.getPostBySlug(slug);
    if (!post || post.status !== "منشور") {
      return res.status(404).json({ error: "المقال غير موجود" });
    }
    res.json(post);
  } catch (err) {
    console.error("Error fetching blog post:", err);
    res.status(500).json({ error: "فشل في جلب المقال" });
  }
});

// ======================
// Blog API (Admin)
// ======================

// جلب كل المقالات (للأدمن)
router.get("/api/admin/blog", async (_req, res) => {
  try {
    const posts = await contentService.getAllPosts(false);
    res.json(posts);
  } catch (err) {
    console.error("Error fetching blog posts:", err);
    res.status(500).json({ error: "فشل في جلب المقالات" });
  }
});

// معاينة مقال (للأدمن - بدون التحقق من حالة النشر)
// Must be defined BEFORE /api/admin/blog/:id to avoid route conflict
router.get("/api/admin/blog/preview/:slug", async (req, res) => {
  try {
    const { slug } = req.params;
    const post = await contentService.getPostBySlug(slug);
    if (!post) {
      return res.status(404).json({ error: "المقال غير موجود" });
    }
    res.json(post);
  } catch (err) {
    console.error("Error previewing blog post:", err);
    res.status(500).json({ error: "فشل في جلب المقال" });
  }
});

// جلب مقال محدد للأدمن
router.get("/api/admin/blog/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const post = await contentService.getPostById(id);
    if (!post) {
      return res.status(404).json({ error: "المقال غير موجود" });
    }
    res.json(post);
  } catch (err) {
    console.error("Error fetching blog post:", err);
    res.status(500).json({ error: "فشل في جلب المقال" });
  }
});

// إنشاء مقال جديد
router.post("/api/admin/blog", async (req, res) => {
  try {
    const { title, slug } = req.body;
    if (!title?.trim()) {
      return res.status(400).json({ error: "عنوان المقال مطلوب" });
    }
    if (!slug?.trim()) {
      return res.status(400).json({ error: "الرابط الدائم (slug) مطلوب" });
    }
    const id = await contentService.createPost(req.body);
    res.json({ success: true, id, message: "تم إنشاء المقال بنجاح" });
  } catch (err) {
    console.error("Error creating blog post:", err);
    res.status(500).json({ error: "فشل في إنشاء المقال" });
  }
});

// تحديث مقال
router.put("/api/admin/blog/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { title, slug } = req.body;
    if (!title?.trim()) {
      return res.status(400).json({ error: "عنوان المقال مطلوب" });
    }
    if (!slug?.trim()) {
      return res.status(400).json({ error: "الرابط الدائم (slug) مطلوب" });
    }
    const success = await contentService.updatePost(id, req.body);
    if (!success) {
      return res.status(404).json({ error: "المقال غير موجود" });
    }
    res.json({ success: true, message: "تم تحديث المقال بنجاح" });
  } catch (err) {
    console.error("Error updating blog post:", err);
    res.status(500).json({ error: "فشل في تحديث المقال" });
  }
});

// تبديل حالة النشر (publish/unpublish)
router.patch("/api/admin/blog/:id/toggle-status", async (req, res) => {
  try {
    const { id } = req.params;
    const post = await contentService.getPostById(id);
    if (!post) {
      return res.status(404).json({ error: "المقال غير موجود" });
    }
    const newStatus = post.status === "منشور" ? "مسودة" : "منشور";
    const updates: any = { status: newStatus };
    if (newStatus === "منشور" && !post.publishedAt) {
      updates.publishedAt = new Date().toISOString();
    }
    const success = await contentService.updatePost(id, updates);
    if (!success) {
      return res.status(404).json({ error: "المقال غير موجود" });
    }
    res.json({ success: true, status: newStatus, message: newStatus === "منشور" ? "تم نشر المقال" : "تم إلغاء نشر المقال" });
  } catch (err) {
    console.error("Error toggling blog post status:", err);
    res.status(500).json({ error: "فشل في تغيير حالة المقال" });
  }
});

// حذف مقال
router.delete("/api/admin/blog/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const success = await contentService.deletePost(id);
    if (!success) {
      return res.status(404).json({ error: "المقال غير موجود" });
    }
    res.json({ success: true, message: "تم حذف المقال بنجاح" });
  } catch (err) {
    console.error("Error deleting blog post:", err);
    res.status(500).json({ error: "فشل في حذف المقال" });
  }
});

// ======================
// Property SEO API
// ======================

// جلب SEO لعقار محدد (للعامة)
router.get("/api/properties/:id/seo", async (req, res) => {
  try {
    const { id } = req.params;
    const seo = await contentService.getPropertySeo(id);
    res.json(seo || { propertyNumber: id, seoDescription: "", metaTitle: "", keywords: [] });
  } catch (err) {
    console.error("Error fetching property SEO:", err);
    res.status(500).json({ error: "فشل في جلب بيانات SEO" });
  }
});

// تحديث/إنشاء SEO لعقار
router.put("/api/admin/properties/:id/seo", async (req, res) => {
  try {
    const { id } = req.params;
    await contentService.updatePropertySeo(id, req.body);
    res.json({ success: true, message: "تم تحديث بيانات SEO بنجاح" });
  } catch (err) {
    console.error("Error updating property SEO:", err);
    res.status(500).json({ error: "فشل في تحديث بيانات SEO" });
  }
});

export default router;
