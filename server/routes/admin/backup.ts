import { Router } from "express";
import fs from "fs";
import path from "path";
import { requireAdmin, requireSameOrigin } from "../middleware";
import { storage } from "../../storage";
import { firebaseService } from "../../firebaseService";
import { propertyService, subscriptionService, paymentService, discountService, analyticsService } from "../../services";
import type { Backup, CodeBackup } from "../../../shared/schema";

const router = Router();

router.use("/api/backups", requireSameOrigin, requireAdmin);
router.use("/api/code-backup", requireSameOrigin, requireAdmin);

const toBackupSummary = (backup: Backup) => {
  const summary: Partial<Backup> = { ...backup };
  delete summary.backupData;
  return summary;
};

const toCodeBackupSummary = (backup: CodeBackup) => {
  const summary: Partial<CodeBackup> = { ...backup };
  delete summary.files;
  return summary;
};

// ======================
// DATA BACKUP SYSTEM
// ======================

router.get("/api/backups", async (req, res) => {
  try {
    const backups = await storage.getBackups();
    res.json(backups.map(toBackupSummary));
  } catch (err: any) {
    console.error("Get backups error:", err?.message);
    res.status(500).json({ error: "Failed to load backups" });
  }
});

// GET single backup details
router.get("/api/backups/:id", async (req, res) => {
  try {
    const backup = await storage.getBackupById(req.params.id);
    if (!backup) {
      return res.status(404).json({ error: "Backup not found" });
    }
    res.json(backup);
  } catch (err: any) {
    console.error("Get backup error:", err?.message);
    res.status(500).json({ error: "Failed to load backup" });
  }
});

// CREATE backup - نسخة احتياطية جديدة
router.post("/api/backups", async (req, res) => {
  try {
    const { backupType, backupName, dataTypes, description } = req.body;

    // Validate input
    if (!backupType || !backupName || !dataTypes) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // Collect data based on dataTypes
    const backupData: any = {};
    let filesCount = 0;
    let sizeInMB = 0;

    if (dataTypes.includes('properties')) {
      backupData.properties = await propertyService.getAll();
      filesCount += backupData.properties.length;
      sizeInMB += JSON.stringify(backupData.properties).length / (1024 * 1024);
    }

    if (dataTypes.includes('subscriptions')) {
      backupData.subscriptions = await subscriptionService.getAll();
      filesCount += backupData.subscriptions.length;
      sizeInMB += JSON.stringify(backupData.subscriptions).length / (1024 * 1024);
    }

    if (dataTypes.includes('packages')) {
      backupData.packages = await subscriptionService.getPackages();
      filesCount += backupData.packages.length;
      sizeInMB += JSON.stringify(backupData.packages).length / (1024 * 1024);
    }

    if (dataTypes.includes('payments')) {
      backupData.payments = await paymentService.getAll();
      filesCount += backupData.payments.length;
      sizeInMB += JSON.stringify(backupData.payments).length / (1024 * 1024);
    }

    if (dataTypes.includes('discounts')) {
      backupData.discounts = await discountService.getAll();
      filesCount += backupData.discounts.length;
      sizeInMB += JSON.stringify(backupData.discounts).length / (1024 * 1024);
    }

    if (dataTypes.includes('requests')) {
      backupData.requests = await analyticsService.getAllRequests();
      filesCount += backupData.requests.length;
      sizeInMB += JSON.stringify(backupData.requests).length / (1024 * 1024);
    }

    if (dataTypes.includes('customer_accounts')) {
      backupData.customer_accounts = await firebaseService.getCustomerAccountsForBackup();
      filesCount += backupData.customer_accounts.length;
      sizeInMB += JSON.stringify(backupData.customer_accounts).length / (1024 * 1024);
    }

    if (dataTypes.includes('booking_followups')) {
      backupData.booking_followups = await firebaseService.getBookingFollowUpsForBackup();
      filesCount += backupData.booking_followups.length;
      sizeInMB += JSON.stringify(backupData.booking_followups).length / (1024 * 1024);
    }

    // Create backup record
    const backup = await storage.createBackup({
      backupType,
      backupName,
      status: 'جاري',
      dataTypes,
      filesCount,
      sizeInMB: parseFloat(sizeInMB.toFixed(2)),
      backupData,
      autoBackup: false,
      description,
    });

    // Mark as completed
    const completed = await storage.updateBackup(backup.id, {
      status: 'مكتمل',
      completedAt: new Date().toISOString(),
    });

    console.log(`✅ Backup created successfully: ${backup.id}`);
    res.json(toBackupSummary(completed));
  } catch (err: any) {
    console.error("Create backup error:", err?.message);
    res.status(500).json({ error: "Failed to create backup" });
  }
});

// RESTORE backup - استعادة نسخة احتياطية
router.post("/api/backups/:id/restore", async (req, res) => {
  try {
    const backup = await storage.getBackupById(req.params.id);
    if (!backup) {
      return res.status(404).json({ error: "Backup not found" });
    }

    // Perform restore (mark in storage)
    await storage.restoreBackup(req.params.id);

    console.log(`✅ Backup restored: ${req.params.id}`);
    res.json({ ok: true, message: "تم استعادة النسخة الاحتياطية بنجاح" });
  } catch (err: any) {
    console.error("Restore backup error:", err?.message);
    res.status(500).json({ error: "Failed to restore backup" });
  }
});

// DELETE backup
router.delete("/api/backups/:id", async (req, res) => {
  try {
    const backup = await storage.getBackupById(req.params.id);
    if (!backup) {
      return res.status(404).json({ error: "Backup not found" });
    }

    await storage.deleteBackup(req.params.id);
    console.log(`✅ Backup deleted: ${req.params.id}`);
    res.json({ ok: true, message: "تم حذف النسخة الاحتياطية" });
  } catch (err: any) {
    console.error("Delete backup error:", err?.message);
    res.status(500).json({ error: "Failed to delete backup" });
  }
});

// DOWNLOAD backup as JSON
router.get("/api/backups/:id/download", async (req, res) => {
  try {
    const backup = await storage.getBackupById(req.params.id);
    if (!backup) {
      return res.status(404).json({ error: "Backup not found" });
    }

    const filename = `backup-${backup.backupName}-${new Date().getTime()}.json`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/json');
    res.json(backup);
  } catch (err: any) {
    console.error("Download backup error:", err?.message);
    res.status(500).json({ error: "Failed to download backup" });
  }
});

// ======================
// CODE BACKUP SYSTEM - نظام نسخ احتياطية الأكواد
// ======================

// Utility: Recursively read all .ts/.tsx files
const readCodeFiles = (dir: string, fileList: Record<string, string> = {}): Record<string, string> => {
  try {
    const files = fs.readdirSync(dir);
    files.forEach((file) => {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      if (stat.isDirectory() && !file.startsWith('.') && file !== 'node_modules') {
        readCodeFiles(filePath, fileList);
      } else if ((file.endsWith('.ts') || file.endsWith('.tsx')) && !file.startsWith('.')) {
        const relPath = path.relative(process.cwd(), filePath);
        try {
          const content = fs.readFileSync(filePath, 'utf-8');
          fileList[relPath] = content;
        } catch (e) { }
      }
    });
  } catch (e) { }
  return fileList;
};

// GET all code backups
router.get("/api/code-backup/list", async (req, res) => {
  try {
    const backups = await storage.getCodeBackups();
    res.json(backups.map(toCodeBackupSummary));
  } catch (err: any) {
    console.error("Get code backups error:", err?.message);
    res.status(500).json({ error: "Failed to load code backups" });
  }
});

// GET single code backup
router.get("/api/code-backup/:id", async (req, res) => {
  try {
    const backup = await storage.getCodeBackupById(req.params.id);
    if (!backup) {
      return res.status(404).json({ error: "Code backup not found" });
    }
    res.json(backup);
  } catch (err: any) {
    console.error("Get code backup error:", err?.message);
    res.status(500).json({ error: "Failed to load code backup" });
  }
});

// CREATE code backup - نسخة احتياطية من الأكواد
router.post("/api/code-backup/create", async (req, res) => {
  try {
    const files: Record<string, string> = {};

    // Read all code files
    readCodeFiles("client/src", files);
    readCodeFiles("server", files);
    readCodeFiles("shared", files);

    const fileCount = Object.keys(files).length;
    let totalSize = 0;
    Object.values(files).forEach((content) => {
      totalSize += JSON.stringify(content).length / (1024 * 1024);
    });

    const backup = await storage.createCodeBackup({
      backupName: `نسخة احتياطية كاملة - ${new Date().toLocaleString("ar-SA")}`,
      timestamp: new Date().toISOString(),
      files,
      fileCount,
      totalSize: parseFloat(totalSize.toFixed(2)),
    });

    console.log(`✅ Code backup created: ${backup.id} (${fileCount} files, ${backup.totalSize}MB)`);
    res.json(toCodeBackupSummary(backup));
  } catch (err: any) {
    console.error("Create code backup error:", err?.message);
    res.status(500).json({ error: "Failed to create code backup" });
  }
});

// RESTORE code backup - استعادة نسخة احتياطية من الأكواد
router.post("/api/code-backup/:id/restore", async (req, res) => {
  try {
    const backup = await storage.getCodeBackupById(req.params.id);
    if (!backup) {
      return res.status(404).json({ error: "Code backup not found" });
    }

    // Write files back to disk
    let restoredCount = 0;
    for (const [filePath, content] of Object.entries(backup.files)) {
      try {
        const fullPath = path.join(process.cwd(), filePath);
        const dir = path.dirname(fullPath);

        // Create directories if they don't exist
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }

        fs.writeFileSync(fullPath, content, 'utf-8');
        restoredCount++;
      } catch (e) {
        console.error(`Failed to restore ${filePath}:`, e);
      }
    }

    console.log(`✅ Code backup restored: ${backup.id} (${restoredCount}/${backup.fileCount} files)`);
    res.json({
      ok: true,
      message: `تم استعادة ${restoredCount} ملف من أصل ${backup.fileCount}`,
      restoredCount,
      totalCount: backup.fileCount
    });
  } catch (err: any) {
    console.error("Restore code backup error:", err?.message);
    res.status(500).json({ error: "Failed to restore code backup" });
  }
});

// DELETE code backup
router.delete("/api/code-backup/:id", async (req, res) => {
  try {
    const backup = await storage.getCodeBackupById(req.params.id);
    if (!backup) {
      return res.status(404).json({ error: "Code backup not found" });
    }

    await storage.deleteCodeBackup(req.params.id);
    console.log(`✅ Code backup deleted: ${req.params.id}`);
    res.json({ ok: true, message: "تم حذف النسخة الاحتياطية" });
  } catch (err: any) {
    console.error("Delete code backup error:", err?.message);
    res.status(500).json({ error: "Failed to delete code backup" });
  }
});

// DOWNLOAD code backup as JSON
router.get("/api/code-backup/:id/download", async (req, res) => {
  try {
    const backup = await storage.getCodeBackupById(req.params.id);
    if (!backup) {
      return res.status(404).json({ error: "Code backup not found" });
    }

    const filename = `code-backup-${new Date().getTime()}.json`;
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Type', 'application/json');
    res.json(backup);
  } catch (err: any) {
    console.error("Download code backup error:", err?.message);
    res.status(500).json({ error: "Failed to download code backup" });
  }
});

export default router;
