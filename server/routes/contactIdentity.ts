import { Router, type Request, type Response } from "express";
import {
  CONTACT_IDENTITY_COOKIE_NAME,
  ContactIdentityRateLimitError,
  contactIdentityService,
  getContactIdentityClearCookieOptions,
  getContactIdentityCookieOptions,
  maskContactPhone,
} from "../services/ContactIdentityService";
import {
  getContactIdentityCookieToken,
  getContactIdentityIssueLimitKeyForRequest,
  getOwnerContactPhone,
} from "../utils/contactIdentityRequest";
import { isSameOriginRequest } from "../utils/requestOrigin";
import { BOOKING_CUSTOMER_SESSION_COOKIE } from "../services/BookingCommissionService";

const router = Router();

function setNoStore(res: Response): void {
  res.set("Cache-Control", "no-store, private");
}

function clearCustomerBookingSession(res: Response): void {
  res.clearCookie(BOOKING_CUSTOMER_SESSION_COOKIE, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
  });
}

function rejectCrossOriginMutation(req: Request, res: Response): boolean {
  if (isSameOriginRequest(req)) return false;
  res.status(403).json({ code: "CROSS_ORIGIN_REQUEST", error: "الطلب غير مسموح" });
  return true;
}

router.get("/api/contact-identity", async (req, res) => {
  setNoStore(res);

  try {
    const ownerPropertyNumber = String((req.session as any)?.propertyNumber || "").trim();
    if (ownerPropertyNumber) {
      const ownerPhone = await getOwnerContactPhone(ownerPropertyNumber);
      return res.json({
        kind: "owner",
        maskedPhone: maskContactPhone(ownerPhone),
      });
    }

    if ((req.session as any)?.isAdmin) {
      return res.json({ kind: "admin", maskedPhone: null });
    }

    const token = getContactIdentityCookieToken(req);
    const identity = await contactIdentityService.resolve(token);
    if (!identity) {
      if (token) {
        res.clearCookie(CONTACT_IDENTITY_COOKIE_NAME, getContactIdentityClearCookieOptions());
      }
      return res.json({ kind: "none", maskedPhone: null });
    }

    return res.json({
      kind: "client",
      maskedPhone: maskContactPhone(identity.clientPhone),
    });
  } catch (error) {
    console.error("Contact identity status error:", error);
    return res.status(500).json({ error: "تعذر التحقق من رقم التواصل المحفوظ" });
  }
});

router.post("/api/contact-identity", async (req, res) => {
  setNoStore(res);
  if (rejectCrossOriginMutation(req, res)) return;

  if ((req.session as any)?.propertyNumber) {
    return res.status(403).json({
      code: "OWNER_CONTACT_MANAGED",
      error: "يتم استخدام رقم الجوال المسجل للعقار تلقائياً",
    });
  }

  if ((req.session as any)?.isAdmin) {
    return res.status(403).json({
      code: "ADMIN_CONTACT_NOT_REMEMBERED",
      error: "لا يتم حفظ رقم تواصل مستقل أثناء جلسة الإدارة",
    });
  }

  try {
    const previousToken = getContactIdentityCookieToken(req);
    const issued = await contactIdentityService.issue(
      req.body?.clientPhone,
      previousToken,
      getContactIdentityIssueLimitKeyForRequest(req),
    );
    res.cookie(CONTACT_IDENTITY_COOKIE_NAME, issued.token, getContactIdentityCookieOptions());
    clearCustomerBookingSession(res);
    return res.json({
      kind: "client",
      maskedPhone: maskContactPhone(issued.clientPhone),
    });
  } catch (error) {
    if (error instanceof RangeError) {
      return res.status(400).json({ code: "INVALID_CONTACT_PHONE", error: error.message });
    }
    if (error instanceof ContactIdentityRateLimitError) {
      const retryAfterSeconds = Math.ceil(error.retryAfterMs / 1000);
      res.set("Retry-After", String(retryAfterSeconds));
      return res.status(429).json({
        code: "CONTACT_IDENTITY_RATE_LIMIT",
        error: error.message,
        retryAfterSeconds,
      });
    }
    console.error("Save contact identity error:", error);
    return res.status(500).json({ error: "تعذر حفظ رقم التواصل" });
  }
});

router.delete("/api/contact-identity", async (req, res) => {
  setNoStore(res);
  if (rejectCrossOriginMutation(req, res)) return;

  try {
    res.clearCookie(CONTACT_IDENTITY_COOKIE_NAME, getContactIdentityClearCookieOptions());
    clearCustomerBookingSession(res);
    try {
      await contactIdentityService.revoke(getContactIdentityCookieToken(req));
    } catch (error) {
      // The browser is already signed out. The orphaned record is removed by
      // expiry cleanup even if Firebase is temporarily unavailable here.
      console.error("Contact identity revoke cleanup error:", error);
    }
    return res.json({ kind: "none", maskedPhone: null });
  } catch (error) {
    console.error("Delete contact identity error:", error);
    return res.status(500).json({ error: "تعذر تسجيل الخروج من رقم التواصل" });
  }
});
export default router;
