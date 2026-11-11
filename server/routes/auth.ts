/**
 * Auth Routes - Login, logout, password reset, session checks
 */
import { createHmac, randomBytes } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { authService } from "../services";
import { firebaseService } from "../firebaseService";
import {
  ADMIN_LOGIN_MAX_ATTEMPTS,
  ADMIN_LOGIN_WINDOW_MS,
  AdminLoginRateLimiter,
} from "../services/AdminLoginRateLimiter";
import { isSameOriginRequest } from "../utils/requestOrigin";
import { getContactIdentityCookieToken } from "../utils/contactIdentityRequest";
import {
  CONTACT_IDENTITY_COOKIE_NAME,
  contactIdentityService,
  getContactIdentityClearCookieOptions,
} from "../services/ContactIdentityService";
import { BOOKING_CUSTOMER_SESSION_COOKIE } from "../services/BookingCommissionService";
import { requireOwner } from "./middleware";

const router = Router();

const adminLoginRateLimiter = new AdminLoginRateLimiter();
const adminLoginKeySecret =
  process.env.SESSION_SECRET || randomBytes(32).toString("hex");

function adminLoginClientKey(req: Request): string {
  const clientAddress = req.ip || req.socket.remoteAddress || "unknown";
  return createHmac("sha256", adminLoginKeySecret)
    .update(`admin-login:${clientAddress}`)
    .digest("hex");
}

async function clearCustomerAccessForPrivilegedLogin(
  req: Request,
  res: Response,
): Promise<void> {
  const contactToken = getContactIdentityCookieToken(req);
  res.clearCookie(
    CONTACT_IDENTITY_COOKIE_NAME,
    getContactIdentityClearCookieOptions(),
  );
  res.clearCookie(BOOKING_CUSTOMER_SESSION_COOKIE, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });

  try {
    await contactIdentityService.revoke(contactToken);
  } catch (error) {
    // Privileged login must still succeed if cleanup is temporarily unavailable.
    console.error("Customer identity cleanup during privileged login failed:", error);
  }
}

// ======================
// OWNER LOGIN/LOGOUT
// ======================
router.post("/api/owner/login", async (req, res) => {
  const { propertyNumber, pin } = req.body;
  const valid = await authService.validateOwnerPin(propertyNumber, pin);
  if (!valid)
    return res.status(401).json({ error: "Invalid Credentials" });

  await clearCustomerAccessForPrivilegedLogin(req, res);
  delete (req.session as any).isAdmin;
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
  if (!isSameOriginRequest(req)) {
    return res.status(403).json({
      code: "CROSS_ORIGIN_REQUEST",
      error: "Cross-origin admin login is not allowed",
    });
  }

  const clientKey = adminLoginClientKey(req);
  const limit = adminLoginRateLimiter.consume(clientKey);
  if (!limit.allowed) {
    res.setHeader("Retry-After", Math.max(1, Math.ceil(limit.retryAfterMs / 1000)));
    return res.status(429).json({ error: "Too Many Login Attempts" });
  }

  try {
    const sharedLimit = await firebaseService.consumeAdminLoginAttemptLimit(
      clientKey,
      Date.now(),
      ADMIN_LOGIN_WINDOW_MS,
      ADMIN_LOGIN_MAX_ATTEMPTS,
    );
    if (!sharedLimit.allowed) {
      res.setHeader(
        "Retry-After",
        Math.max(1, Math.ceil(sharedLimit.retryAfterMs / 1000)),
      );
      return res.status(429).json({ error: "Too Many Login Attempts" });
    }
  } catch (error) {
    console.error("Admin login rate-limit service error:", error);
    return res.status(503).json({ error: "Admin Login Temporarily Unavailable" });
  }

  const { code, password } = req.body || {};
  if (!authService.validateAdminCredentials(code, password)) {
    return res.status(401).json({ error: "Invalid Admin Credentials" });
  }
  adminLoginRateLimiter.clear(clientKey);
  try {
    await firebaseService.deleteAdminLoginAttemptLimit(clientKey);
  } catch (error) {
    console.error("Admin login rate-limit cleanup error:", error);
  }
  await clearCustomerAccessForPrivilegedLogin(req, res);
  delete (req.session as any).propertyNumber;
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
