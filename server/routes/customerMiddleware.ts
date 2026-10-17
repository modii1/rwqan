import type { NextFunction, Request, Response } from "express";

import {
  CUSTOMER_SESSION_REVISION_HEADER,
  customerSessionRevisionSchema,
} from "../../shared/customer";

import {
  CONTACT_IDENTITY_COOKIE_NAME,
  contactIdentityService,
  getContactIdentityClearCookieOptions,
  type RememberedContactIdentity,
} from "../services/ContactIdentityService";
import { getContactIdentityCookieToken } from "../utils/contactIdentityRequest";

// Kept local to avoid importing the booking service into authentication
// middleware. The verified customer account never uses this legacy token for
// authorization, but invalid identities clear it defensively.
const BOOKING_CUSTOMER_SESSION_COOKIE_NAME = "rwqan_booking_customer_session";

declare global {
  namespace Express {
    interface Request {
      customerIdentity?: RememberedContactIdentity;
    }
  }
}

export const requireCustomer = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  res.set("Cache-Control", "no-store, private");
  if (req.session?.propertyNumber || req.session?.isAdmin) {
    return res.status(401).json({
      code: "CUSTOMER_SESSION_REQUIRED",
      error: "يلزم التحقق من رقم التواصل",
    });
  }

  const token = getContactIdentityCookieToken(req);
  if (!token) {
    return res.status(401).json({
      code: "CUSTOMER_SESSION_REQUIRED",
      error: "يلزم التحقق من رقم التواصل",
    });
  }

  try {
    const identity = await contactIdentityService.resolve(token);
    if (!identity) {
      res.clearCookie(
        CONTACT_IDENTITY_COOKIE_NAME,
        getContactIdentityClearCookieOptions(),
      );
      res.clearCookie(BOOKING_CUSTOMER_SESSION_COOKIE_NAME, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
      });
      return res.status(401).json({
        code: "CUSTOMER_SESSION_REQUIRED",
        error: "يلزم التحقق من رقم التواصل",
      });
    }
    req.customerIdentity = identity;

    const expectedRevision = customerSessionRevisionSchema.safeParse(
      req.get(CUSTOMER_SESSION_REVISION_HEADER),
    );
    if (!expectedRevision.success || expectedRevision.data !== identity.sessionId) {
      return res.status(409).json({
        code: "CUSTOMER_SESSION_CHANGED",
        error: "تغيّر حساب العميل، يرجى تحديث الصفحة والمحاولة مرة أخرى",
      });
    }

    next();
  } catch (error) {
    console.error("Customer session resolution error:", error);
    return res.status(503).json({
      code: "CUSTOMER_SESSION_UNAVAILABLE",
      error: "تعذر التحقق من رقم التواصل المحفوظ",
    });
  }
};
