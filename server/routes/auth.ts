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
import {
  clearCustomerAccessForPrivilegedLogin,
  regenerateSession,
  saveSession,
} from "../utils/privilegedSession";
import { ownerLoginRateLimiter } from "../services/OwnerLoginRateLimiter";
import { ownerAccountStore } from "../services/OwnerAccountStore";
import { LiveWriteBlockedError } from "../config/dataEnvironment";
import { requireOwner, requireSameOrigin } from "./middleware";

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

/**
 * TRUE only for the expected read-only-LIVE rejection. In LIVE read-only mode
 * the shared Firestore attempt counter cannot be written by design, so the
 * bounded in-process `adminLoginRateLimiter` (consumed before this point) is the
 * effective brute-force bound. Every other failure stays a hard 503 — errors are
 * never broadly swallowed.
 */
function isReadOnlyLiveWrite(error: unknown): boolean {
  return error instanceof LiveWriteBlockedError;
}

// ======================
// OWNER LOGIN/LOGOUT
// ======================
router.post("/api/owner/login", requireSameOrigin, async (req, res) => {
  const { propertyNumber, pin } = req.body;
  let limit;
  try {
    limit = await ownerLoginRateLimiter.consume({
      ipAddress: req.ip || req.socket.remoteAddress,
      propertyNumber,
    });
  } catch (error) {
    console.error("Owner login rate-limit service error:", error);
    return res.status(503).json({ error: "Owner Login Temporarily Unavailable" });
  }
  if (!limit.allowed) {
    res.setHeader("Retry-After", Math.max(1, Math.ceil(limit.retryAfterMs / 1000)));
    return res.status(429).json({ error: "Too Many Login Attempts" });
  }
  const valid = await authService.validateOwnerPin(propertyNumber, pin);
  if (!valid)
    return res.status(401).json({ error: "Invalid Credentials" });

  try {
    await ownerLoginRateLimiter.clear({
      ipAddress: req.ip || req.socket.remoteAddress,
      propertyNumber,
    });
  } catch (error) {
    console.error("Owner login rate-limit cleanup error:", error);
  }

  await clearCustomerAccessForPrivilegedLogin(req, res);
  try {
    await regenerateSession(req);
    (req.session as any).propertyNumber = propertyNumber;
    await saveSession(req);
    return res.json({ ok: true });
  } catch {
    return res.status(500).json({ error: "Session save failed" });
  }
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
    if (!isReadOnlyLiveWrite(error)) {
      console.error("Admin login rate-limit service error:", error);
      return res.status(503).json({ error: "Admin Login Temporarily Unavailable" });
    }
    // Read-only LIVE: the shared counter is intentionally unwritable. Continue
    // with the in-process bound already enforced above.
  }

  const { code, password } = req.body || {};
  if (!authService.validateAdminCredentials(code, password)) {
    return res.status(401).json({ error: "Invalid Admin Credentials" });
  }
  adminLoginRateLimiter.clear(clientKey);
  try {
    await firebaseService.deleteAdminLoginAttemptLimit(clientKey);
  } catch (error) {
    // Read-only LIVE cannot delete the shared counter; that is expected and the
    // in-process limiter was already cleared above. Anything else is an error.
    if (!isReadOnlyLiveWrite(error)) {
      console.error("Admin login rate-limit cleanup error:", error);
    }
  }
  await clearCustomerAccessForPrivilegedLogin(req, res);
  try {
    await regenerateSession(req);
    (req.session as any).isAdmin = true;
    await saveSession(req);
    return res.json({ ok: true });
  } catch {
    return res.status(500).json({ error: "Session save failed" });
  }
});

// ======================
// SESSION CHECKS
// ======================
router.get("/api/owner/session", async (req, res) => {
  const propertyNumber = (req.session as any).propertyNumber as string | undefined;
  const ownerAccountId = (req.session as any).ownerAccountId as string | undefined;
  const authVersion = (req.session as any).authVersion as number | undefined;
  const hasAccountMarkers = ownerAccountId !== undefined || authVersion !== undefined;
  let hasOwnerAccount = false;
  if (hasAccountMarkers) {
    if (
      !propertyNumber ||
      typeof ownerAccountId !== "string" ||
      !Number.isSafeInteger(authVersion) ||
      Number(authVersion) <= 0
    ) {
      return res.json({
        isLoggedIn: false,
        propertyNumber: null,
        hasOwnerAccount: false,
      });
    }
    try {
      hasOwnerAccount = await ownerAccountStore.validateActiveMembership({
        ownerAccountId,
        authVersion: Number(authVersion),
        propertyNumber,
      });
    } catch (error) {
      console.error("Owner session check error:", error);
      return res.status(503).json({ error: "Session validation unavailable" });
    }
  }
  const isLoggedIn = Boolean(propertyNumber) && (!hasAccountMarkers || hasOwnerAccount);
  res.json({
    isLoggedIn,
    propertyNumber: isLoggedIn ? propertyNumber : null,
    hasOwnerAccount,
  });
});

router.get("/api/admin/session", (req, res) => {
  const isAdmin = Boolean((req.session as any).isAdmin);
  res.json({ isAdmin });
});

// ======================
// PASSWORD RESET
// ======================
router.post("/api/auth/send-reset-code", requireSameOrigin, async (req, res) => {
  try {
    const { ownerId } = req.body;
    if (!ownerId || typeof ownerId !== "string") return res.status(400).json({ success: false, message: "رقم العقار مطلوب" });

    let limit;
    try {
      limit = await ownerLoginRateLimiter.consume({
        ipAddress: req.ip || req.socket.remoteAddress,
        propertyNumber: ownerId,
      });
    } catch (error) {
      console.error("Owner password-reset rate-limit service error:", error);
      return res.status(503).json({ success: false, message: "خطأ في النظام" });
    }
    if (!limit.allowed) {
      res.setHeader("Retry-After", Math.max(1, Math.ceil(limit.retryAfterMs / 1000)));
      return res.status(429).json({ success: false, message: "Too Many Login Attempts" });
    }

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

router.post("/api/auth/set-new-password", requireSameOrigin, async (req, res) => {
  try {
    const { ownerId, resetCode, newPassword } = req.body;
    if (!ownerId || typeof ownerId !== "string" || !resetCode || !newPassword) return res.status(400).json({ success: false, message: "البيانات غير مكتملة" });

    let limit;
    try {
      limit = await ownerLoginRateLimiter.consume({
        ipAddress: req.ip || req.socket.remoteAddress,
        propertyNumber: ownerId,
      });
    } catch (error) {
      console.error("Owner password-reset rate-limit service error:", error);
      return res.status(503).json({ success: false, message: "خطأ في النظام" });
    }
    if (!limit.allowed) {
      res.setHeader("Retry-After", Math.max(1, Math.ceil(limit.retryAfterMs / 1000)));
      return res.status(429).json({ success: false, message: "Too Many Login Attempts" });
    }

    try {
      await authService.setNewPassword(ownerId, resetCode, newPassword);
      try {
        await ownerLoginRateLimiter.clear({
          ipAddress: req.ip || req.socket.remoteAddress,
          propertyNumber: ownerId,
        });
      } catch (error) {
        console.error("Owner password-reset rate-limit cleanup error:", error);
      }
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
