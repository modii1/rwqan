import express from "express";
import { storage } from "./storage";
import { googleDriveService } from "./googleDrive";

const router = express.Router();

// ========================
//  GET ALL PROPERTIES
// ========================
router.get("/", async (_req, res) => {
  try {
    const items = await storage.getProperties();
    res.json(items);
  } catch (e) {
    res.status(500).json({ error: "فشل في جلب العقارات" });
  }
});

// ========================
//  CREATE PROPERTY
// ========================
router.post("/", async (req, res) => {
  try {
    const data = req.body;

    const exists = await storage.getPropertyByNumber(data.propertyNumber);
    if (exists) return res.status(400).json({ error: "رقم العقار مستخدم" });

    const folderId = await googleDriveService.createPropertyFolder(
      data.propertyNumber,
      data.name
    );

    const created = await storage.createProperty({
      ...data,
      driveFolderId: folderId,
      imageUrls: [],
    });

    res.json(created);
  } catch (e) {
    res.status(500).json({ error: "خطأ أثناء إنشاء العقار" });
  }
});

// ========================
//  UPDATE PROPERTY
// ========================
router.put("/:id", async (req, res) => {
  try {
    const updated = await storage.updateProperty(req.params.id, req.body);
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: "فشل في التحديث" });
  }
});

// ========================
//  DELETE PROPERTY
// ========================
router.delete("/:id", async (req, res) => {
  try {
    await storage.deleteProperty(req.params.id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: "فشل في الحذف" });
  }
});

export default router;
