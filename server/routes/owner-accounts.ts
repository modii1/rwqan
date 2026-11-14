import { Router, type Request, type Response } from "express";

import type {
  OwnerAccount,
  OwnerAccountPropertyOption,
  OwnerPropertyMembership,
} from "../../shared/owner-accounts";
import { devOwnerOtpSinkEnabled } from "../config/runtimeEnvironment";
import { firebaseService } from "../firebaseService";
import { sendOwnerWhatsApp } from "../integrations/whatsapp";
import {
  OwnerAccountOtpError,
  OwnerAccountService,
  type OwnerAccountOtpSender,
  type OwnerAccountPropertyReader,
} from "../services/OwnerAccountService";
import { ownerAccountStore } from "../services/OwnerAccountStore";
import {
  clearCustomerAccessForPrivilegedLogin,
  regenerateSession,
  saveSession,
} from "../utils/privilegedSession";
import { requireOwner, requireSameOrigin } from "./middleware";

const router = Router();

/**
 * Claim keeps the existing trusted-owner identity source: properties without a
 * separately persisted owner phone fail closed until that legacy identity has
 * been migrated/backfilled.
 */
const readTrustedOwnerPhone: OwnerAccountPropertyReader = async (propertyNumber) => {
  const [property, trustedOwner] = await Promise.all([
    firebaseService.getPropertyByNumber(propertyNumber),
    firebaseService.getOwnerByPropertyNumber(propertyNumber),
  ]);
  if (!property) return null;
  return {
    propertyNumber: property.propertyNumber,
    whatsappNumber: trustedOwner?.phone || null,
  };
};

/**
 * Attaching an additional property uses the property's own registered WhatsApp
 * number — the original source used across the system. It never requires or
 * creates an `owners/{propertyNumber}` document; that document belongs to the
 * password-reset flow.
 */
export const readPropertyRegisteredPhone: OwnerAccountPropertyReader = async (
  propertyNumber,
) => {
  const property = await firebaseService.getPropertyByNumber(propertyNumber);
  if (!property) return null;
  return {
    propertyNumber: property.propertyNumber,
    whatsappNumber: property.whatsappNumber || null,
  };
};

function maskOwnerOtpPhone(phone: string): string {
  const localPhone = `0${phone}`;
  return `${localPhone.slice(0, 2)}••••${localPhone.slice(-4)}`;
}

/**
 * Owner OTP transport. The LOCAL console sink only substitutes delivery: it
 * never changes code generation, HMAC hashing, TTL, or attempt/issue limits,
 * and it never touches Enjazatik settings or credentials. See
 * devOwnerOtpSinkEnabled for the strict activation conditions.
 */
export function createOwnerOtpSender(dependencies: {
  sinkEnabled: () => boolean;
  send: OwnerAccountOtpSender;
  log: (line: string) => void;
}): OwnerAccountOtpSender {
  return async (phone, message, retries) => {
    if (dependencies.sinkEnabled()) {
      dependencies.log(
        `[DEV OWNER OTP] to=${maskOwnerOtpPhone(phone)} :: ${message}`,
      );
      return { success: true };
    }
    return dependencies.send(phone, message, retries);
  };
}

const ownerOtpSender = createOwnerOtpSender({
  sinkEnabled: devOwnerOtpSinkEnabled,
  send: sendOwnerWhatsApp,
  log: (line) => console.log(line),
});

export const ownerAccountService = new OwnerAccountService(ownerAccountStore, {
  sender: ownerOtpSender,
  propertyReader: readTrustedOwnerPhone,
  attachPropertyReader: readPropertyRegisteredPhone,
});

function requestIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || "";
}

function sendOwnerAccountError(res: Response, error: unknown): Response {
  if (error instanceof OwnerAccountOtpError) {
    if (error.details.retryAfterMs) {
      res.setHeader(
        "Retry-After",
        Math.max(1, Math.ceil(error.details.retryAfterMs / 1000)),
      );
    }
    return res.status(error.status).json({
      code: error.code,
      error: error.message,
      ...(error.details.remainingAttempts !== undefined
        ? { remainingAttempts: error.details.remainingAttempts }
        : {}),
    });
  }
  console.error("Owner account route error:", error);
  return res.status(503).json({
    code: "SERVICE_UNAVAILABLE",
    error: "خدمة التحقق غير متاحة مؤقتاً. حاول مرة أخرى لاحقاً.",
  });
}

async function propertyOptions(
  memberships: OwnerPropertyMembership[],
  currentPropertyNumber: string,
): Promise<OwnerAccountPropertyOption[]> {
  const properties = await Promise.all(memberships.map((membership) =>
    firebaseService.getPropertyByNumber(membership.propertyNumber)));
  return memberships.flatMap((membership, index) => {
    const property = properties[index];
    if (!property || property.propertyNumber !== membership.propertyNumber) return [];
    return [{
      propertyNumber: membership.propertyNumber,
      name: property.name || null,
      city: property.city || null,
      isCurrent: membership.propertyNumber === currentPropertyNumber,
      isMain: membership.isPrimary,
    }];
  });
}

async function establishOwnerAccountSession(input: {
  req: Request;
  res: Response;
  account: OwnerAccount;
  propertyNumber: string;
}): Promise<void> {
  await clearCustomerAccessForPrivilegedLogin(input.req, input.res);
  await regenerateSession(input.req);
  input.req.session.ownerAccountId = input.account.id;
  input.req.session.authVersion = input.account.authVersion;
  input.req.session.propertyNumber = input.propertyNumber;
  await saveSession(input.req);
}

router.post(
  "/api/owner/account/login/challenge",
  requireSameOrigin,
  async (req, res) => {
    try {
      const challenge = await ownerAccountService.issueLogin({
        phone: req.body?.phone,
        ipAddress: requestIp(req),
      });
      res.set("Cache-Control", "no-store, private");
      return res.json(challenge);
    } catch (error) {
      return sendOwnerAccountError(res, error);
    }
  },
);

router.post(
  "/api/owner/account/login/verify",
  requireSameOrigin,
  async (req, res) => {
    try {
      const verified = await ownerAccountService.verifyLogin({
        challengeId: req.body?.challengeId,
        phone: req.body?.phone,
        code: req.body?.code,
      });
      const preferredMemberships = [
        ...verified.memberships.filter((membership) => membership.isPrimary),
        ...verified.memberships.filter((membership) => !membership.isPrimary),
      ];
      const availableProperties = await propertyOptions(preferredMemberships, "");
      const selectedProperty = availableProperties[0];
      if (!selectedProperty) {
        throw new OwnerAccountOtpError(
          "ACCOUNT_SESSION_INVALID",
          401,
          "لا توجد عقارات مرتبطة بحساب المالك.",
        );
      }
      await establishOwnerAccountSession({
        req,
        res,
        account: verified.account,
        propertyNumber: selectedProperty.propertyNumber,
      });
      const properties = availableProperties.map((property) => ({
        ...property,
        isCurrent: property.propertyNumber === selectedProperty.propertyNumber,
      }));
      return res.json({
        ok: true,
        propertyNumber: selectedProperty.propertyNumber,
        properties,
      });
    } catch (error) {
      return sendOwnerAccountError(res, error);
    }
  },
);

router.post(
  "/api/owner/account/claim/challenge",
  requireOwner,
  requireSameOrigin,
  async (req, res) => {
    if (req.session.ownerAccountId !== undefined || req.session.authVersion !== undefined) {
      return res.status(409).json({
        code: "OWNER_ACCOUNT_ALREADY_ACTIVE",
        error: "جلسة المالك مرتبطة بحساب مالك بالفعل.",
      });
    }
    try {
      const challenge = await ownerAccountService.issueClaim({
        propertyNumber: req.session.propertyNumber,
        ipAddress: requestIp(req),
      });
      res.set("Cache-Control", "no-store, private");
      return res.json(challenge);
    } catch (error) {
      return sendOwnerAccountError(res, error);
    }
  },
);

router.post(
  "/api/owner/account/claim/verify",
  requireOwner,
  requireSameOrigin,
  async (req, res) => {
    if (req.session.ownerAccountId !== undefined || req.session.authVersion !== undefined) {
      return res.status(409).json({
        code: "OWNER_ACCOUNT_ALREADY_ACTIVE",
        error: "جلسة المالك مرتبطة بحساب مالك بالفعل.",
      });
    }
    const propertyNumber = req.session.propertyNumber as string;
    try {
      const verified = await ownerAccountService.verifyClaim({
        challengeId: req.body?.challengeId,
        code: req.body?.code,
        propertyNumber,
      });
      await establishOwnerAccountSession({
        req,
        res,
        account: verified.account,
        propertyNumber,
      });
      return res.json({
        ok: true,
        propertyNumber,
        properties: await propertyOptions(verified.memberships, propertyNumber),
      });
    } catch (error) {
      return sendOwnerAccountError(res, error);
    }
  },
);

router.post(
  "/api/owner/account/properties/challenge",
  requireOwner,
  requireSameOrigin,
  async (req, res) => {
    try {
      const challenge = await ownerAccountService.issueAttach({
        ownerAccountId: req.session.ownerAccountId,
        authVersion: req.session.authVersion,
        currentPropertyNumber: req.session.propertyNumber,
        propertyNumber: req.body?.propertyNumber,
        ipAddress: requestIp(req),
      });
      res.set("Cache-Control", "no-store, private");
      return res.json(challenge);
    } catch (error) {
      return sendOwnerAccountError(res, error);
    }
  },
);

router.post(
  "/api/owner/account/properties/verify",
  requireOwner,
  requireSameOrigin,
  async (req, res) => {
    try {
      const currentPropertyNumber = req.session.propertyNumber as string;
      const verified = await ownerAccountService.verifyAttach({
        challengeId: req.body?.challengeId,
        code: req.body?.code,
        ownerAccountId: req.session.ownerAccountId,
        authVersion: req.session.authVersion,
      });
      await establishOwnerAccountSession({
        req,
        res,
        account: verified.account,
        propertyNumber: currentPropertyNumber,
      });
      return res.json({
        ok: true,
        propertyNumber: currentPropertyNumber,
        properties: await propertyOptions(
          verified.memberships,
          currentPropertyNumber,
        ),
      });
    } catch (error) {
      return sendOwnerAccountError(res, error);
    }
  },
);

export default router;
