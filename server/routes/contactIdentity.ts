import { Router, type Request, type Response } from "express";
import {
  CONTACT_IDENTITY_COOKIE_NAME,
  contactIdentityService,
  getContactIdentityClearCookieOptions,
  getContactIdentityCookieOptions,
  maskContactPhone,
} from "../services/ContactIdentityService";
import {
  CustomerPhoneOtpConfigurationError,
  CustomerPhoneOtpError,
  customerPhoneOtpService,
} from "../services/CustomerPhoneOtpService";
import {
  getContactIdentityCookieToken,
  getContactRequestIp,
  getOwnerContactPhone,
} from "../utils/contactIdentityRequest";
import { isSameOriginRequest } from "../utils/requestOrigin";
import { BOOKING_CUSTOMER_SESSION_COOKIE } from "../services/BookingCommissionService";
import { normalizeSaudiMobilePhone } from "../../shared/phone";

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

function rejectManagedContactIdentity(req: Request, res: Response): boolean {
  if ((req.session as any)?.propertyNumber) {
    res.status(403).json({
      code: "OWNER_CONTACT_MANAGED",
      error: "يتم استخدام رقم الجوال المسجل للعقار تلقائياً",
    });
    return true;
  }

  if ((req.session as any)?.isAdmin) {
    res.status(403).json({
      code: "ADMIN_CONTACT_NOT_REMEMBERED",
      error: "لا يتم حفظ رقم تواصل مستقل أثناء جلسة الإدارة",
    });
    return true;
  }

  return false;
}

function respondWithOtpError(res: Response, error: unknown): Response {
  if (error instanceof CustomerPhoneOtpError) {
    if (error.retryAfterMs) {
      res.set("Retry-After", String(Math.max(1, Math.ceil(error.retryAfterMs / 1000))));
    }
    return res.status(error.status).json({
      code: error.code,
      error: error.message,
      ...(typeof error.remainingAttempts === "number"
        ? { remainingAttempts: error.remainingAttempts }
        : {}),
    });
  }
  if (error instanceof CustomerPhoneOtpConfigurationError) {
    console.error("Customer phone OTP configuration error:", error.name);
    return res.status(503).json({
      code: "SERVICE_UNAVAILABLE",
      error: "خدمة التحقق غير متاحة مؤقتاً. حاول مرة أخرى لاحقاً.",
    });
  }
  console.error("Customer phone OTP error:", error instanceof Error ? error.name : "UnknownError");
  return res.status(503).json({
    code: "SERVICE_UNAVAILABLE",
    error: "خدمة التحقق غير متاحة مؤقتاً. حاول مرة أخرى لاحقاً.",
  });
}

router.get("/api/contact-identity", async (req, res) => {
  setNoStore(res);
  if (rejectCrossOriginMutation(req, res)) return;

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
        clearCustomerBookingSession(res);
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

router.post("/api/contact-identity/challenge", async (req, res) => {
  setNoStore(res);
  if (rejectCrossOriginMutation(req, res)) return;
  if (rejectManagedContactIdentity(req, res)) return;

  try {
    const requestedPhone = normalizeSaudiMobilePhone(req.body?.clientPhone);
    if (!requestedPhone) {
      throw new CustomerPhoneOtpError(
        "INVALID_PHONE",
        400,
        "رقم الجوال السعودي غير صحيح.",
      );
    }
    const currentToken = getContactIdentityCookieToken(req);
    const currentIdentity = await contactIdentityService.resolve(currentToken);
    if (currentToken && !currentIdentity) {
      res.clearCookie(
        CONTACT_IDENTITY_COOKIE_NAME,
        getContactIdentityClearCookieOptions(),
      );
      clearCustomerBookingSession(res);
    }
    if (currentIdentity?.clientPhone === requestedPhone) {
      const maskedPhone = maskContactPhone(currentIdentity.clientPhone);
      return res.json({
        alreadyVerified: true,
        maskedPhone,
        identity: { kind: "client", maskedPhone },
      });
    }

    const challenge = await customerPhoneOtpService.issue({
      phone: requestedPhone,
      ipAddress: getContactRequestIp(req),
    });
    return res.json({
      alreadyVerified: false,
      challengeId: challenge.challengeId,
      maskedPhone: challenge.maskedPhone,
      expiresInSeconds: Math.max(
        1,
        Math.ceil((Date.parse(challenge.expiresAt) - Date.now()) / 1000),
      ),
    });
  } catch (error) {
    return respondWithOtpError(res, error);
  }
});

router.post("/api/contact-identity/verify", async (req, res) => {
  setNoStore(res);
  if (rejectCrossOriginMutation(req, res)) return;
  if (rejectManagedContactIdentity(req, res)) return;

  try {
    await customerPhoneOtpService.verify({
      challengeId: req.body?.challengeId,
      phone: req.body?.clientPhone,
      code: req.body?.code,
    });
    const issued = await contactIdentityService.issueVerified(
      req.body?.clientPhone,
      getContactIdentityCookieToken(req),
    );
    res.cookie(
      CONTACT_IDENTITY_COOKIE_NAME,
      issued.token,
      getContactIdentityCookieOptions(),
    );
    clearCustomerBookingSession(res);
    return res.json({
      kind: "client",
      maskedPhone: maskContactPhone(issued.clientPhone),
    });
  } catch (error) {
    return respondWithOtpError(res, error);
  }
});

router.post("/api/contact-identity", async (req, res) => {
  setNoStore(res);
  if (rejectCrossOriginMutation(req, res)) return;
  if (rejectManagedContactIdentity(req, res)) return;
  return res.status(428).json({
    code: "CONTACT_PHONE_VERIFICATION_REQUIRED",
    error: "يجب التحقق من رقم الجوال قبل حفظه",
  });
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
