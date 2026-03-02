"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const storage_1 = require("./storage");
const googleDrive_1 = require("./googleDrive");
const router = express_1.default.Router();
// ========================
//  GET ALL PROPERTIES
// ========================
router.get("/", async (_req, res) => {
    try {
        const items = await storage_1.storage.getProperties();
        res.json(items);
    }
    catch (e) {
        res.status(500).json({ error: "فشل في جلب العقارات" });
    }
});
// ========================
//  CREATE PROPERTY
// ========================
router.post("/", async (req, res) => {
    try {
        const data = req.body;
        const exists = await storage_1.storage.getPropertyByNumber(data.propertyNumber);
        if (exists)
            return res.status(400).json({ error: "رقم العقار مستخدم" });
        const folderId = await googleDrive_1.googleDriveService.createPropertyFolder(data.propertyNumber, data.name);
        const created = await storage_1.storage.createProperty({
            ...data,
            driveFolderId: folderId,
            imageUrls: [],
        });
        res.json(created);
    }
    catch (e) {
        res.status(500).json({ error: "خطأ أثناء إنشاء العقار" });
    }
});
// ========================
//  UPDATE PROPERTY
// ========================
router.put("/:id", async (req, res) => {
    try {
        const updated = await storage_1.storage.updateProperty(req.params.id, req.body);
        res.json(updated);
    }
    catch (e) {
        res.status(500).json({ error: "فشل في التحديث" });
    }
});
// ========================
//  DELETE PROPERTY
// ========================
router.delete("/:id", async (req, res) => {
    try {
        await storage_1.storage.deleteProperty(req.params.id);
        res.json({ ok: true });
    }
    catch (e) {
        res.status(500).json({ error: "فشل في الحذف" });
    }
});
exports.default = router;
