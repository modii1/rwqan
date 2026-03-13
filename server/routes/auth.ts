/**
 * Auth Routes - Login, logout, password reset, session checks
 */
import { Router } from "express";
import { authService } from "../services";
import { requireOwner, requireAdmin } from "./middleware";

const router = Router();

// Admin credentials
const ADMIN_CODE = process.env.ADMIN_CODE || "Rwq";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "Qw@123";

// ======================
// OWNER LOGIN/LOGOUT
// ======================
router.post("/api/owner/login", async (req, res) => {
  const { propertyNumber, pin } = req.body;
  const valid = await authService.validateOwnerPin(propertyNumber, pin);
  if (!valid)
    return res.status(401).json({ error: "Invalid Credentials" });

  (req.session as any).propertyNumber = propertyNumber;
  req.session.save((err: any) => {
    if (err) return res.status(500).json({ error: "Session save failed" });
    res.json({ ok: true });
  });
});

router.post("/api/owner/logout", (req, res) => {
  req.session.destroy((err) => {
    if (err) {
      console.error("Logout error:", err);
      return res.status(500).json({ error: "Logout failed" });
    }
    res.clearCookie("connect.sid");
    console.log("✅ Logout successful");
    res.json({ ok: true });
  });
});

// ======================
// ADMIN LOGIN
// ======================
router.post("/api/admin/login", async (req, res) => {
  const { code, password } = req.body;
  if (code !== ADMIN_CODE || password !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "Invalid Admin Credentials" });
  }
  (req.session as any).isAdmin = true;
  req.session.save((err: any) => {
    if (err) return res.status(500).json({ error: "Session save failed" });
    res.json({ ok: true });
  });
});

// ======================
// SESSION CHECKS
// ======================
router.get("/api/owner/session", (req, res) => {
  const isLoggedIn = Boolean((req.session as any).propertyNumber);
  res.json({ isLoggedIn, propertyNumber: (req.session as any).propertyNumber || null });
});

router.get("/api/admin/session", (req, res) => {
  const isAdmin = Boolean((req.session as any).isAdmin);
  res.json({ isAdmin });
});

// ======================
// PASSWORD RESET
// ======================
router.post("/api/auth/send-reset-code", async (req, res) => {
  try {
    const { ownerId } = req.body;
    if (!ownerId) return res.status(400).json({ success: false, message: "رقم العقار مطلوب" });

    try {
      const { maskedPhone, expiresIn } = await authService.sendResetCode(ownerId);
      return res.json({ success: true, message: `تم إرسال رمز التحقق إلى ${maskedPhone}`, expiresIn });
    } catch (err: any) {
      const status = err.code || 500;
      return res.status(status).json({ success: false, message: err.message || "خطأ في النظام" });
    }
  } catch (error: any) {
    console.error("Send reset code error:", error);
    return res.status(500).json({ success: false, message: error.message || "خطأ في النظام" });
  }
});

router.post("/api/auth/set-new-password", async (req, res) => {
  try {
    const { ownerId, resetCode, newPassword } = req.body;
    if (!ownerId || !resetCode || !newPassword) return res.status(400).json({ success: false, message: "البيانات غير مكتملة" });

    try {
      await authService.setNewPassword(ownerId, resetCode, newPassword);
      return res.json({ success: true, message: "تم تغيير الرقم السري بنجاح" });
    } catch (err: any) {
      return res.status(err.code || 400).json({ success: false, message: err.message || "خطأ في النظام" });
    }
  } catch (error: any) {
    console.error("Set new password error:", error);
    return res.status(500).json({ success: false, message: error.message || "خطأ في النظام" });
  }
});

router.post("/api/owner/change-password", requireOwner, async (req, res) => {
  try {
    const propertyNumber = (req.session as any)?.propertyNumber;
    if (!propertyNumber) return res.status(401).json({ success: false, message: "يجب تسجيل الدخول أولاً" });

    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ success: false, message: "البيانات غير مكتملة" });

    try {
      await authService.changePassword(propertyNumber, currentPassword, newPassword);
      return res.json({ success: true, message: "تم تغيير الرقم السري بنجاح" });
    } catch (err: any) {
      return res.status(err.code || 400).json({ success: false, message: err.message || "خطأ في النظام" });
    }
  } catch (error: any) {
    console.error("Change password error:", error);
    return res.status(500).json({ success: false, message: error.message || "خطأ في النظام" });
  }
});

export default router;
