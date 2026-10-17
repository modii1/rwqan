import type { Request } from "express";
import { normalizeSaudiMobilePhone } from "../../shared/phone";
import { propertyService } from "../services";
import {
  CONTACT_IDENTITY_COOKIE_NAME,
  createContactIdentityIssueLimitKey,
} from "../services/ContactIdentityService";

export function getContactIdentityCookieToken(req: Request): string | undefined {
  const token = req.cookies?.[CONTACT_IDENTITY_COOKIE_NAME];
  return typeof token === "string" ? token : undefined;
}

export function getContactRequestIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || "unknown";
}

export function getContactIdentityIssueLimitKeyForRequest(req: Request): string {
  return createContactIdentityIssueLimitKey(getContactRequestIp(req));
}

export async function getOwnerContactPhone(propertyNumber: string): Promise<string | null> {
  const property = await propertyService.getByNumber(propertyNumber);
  return normalizeSaudiMobilePhone(property?.whatsappNumber);
}
