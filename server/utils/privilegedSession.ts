import type { Request, Response } from "express";

import { BOOKING_CUSTOMER_SESSION_COOKIE } from "../services/BookingCommissionService";
import {
  CONTACT_IDENTITY_COOKIE_NAME,
  contactIdentityService,
  getContactIdentityClearCookieOptions,
} from "../services/ContactIdentityService";
import { getContactIdentityCookieToken } from "./contactIdentityRequest";

export function regenerateSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => error ? reject(error) : resolve());
  });
}

export function saveSession(req: Request): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.save((error) => error ? reject(error) : resolve());
  });
}

export async function clearCustomerAccessForPrivilegedLogin(
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
