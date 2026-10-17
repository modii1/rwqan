/**
 * Auth & Session middleware
 */
import type { Request, Response, NextFunction } from "express";
import { isSameOriginRequest } from "../utils/requestOrigin";
import { ownerAccountStore } from "../services/OwnerAccountStore";

declare module "express-session" {
  interface SessionData {
    propertyNumber?: string;
    ownerAccountId?: string;
    authVersion?: number;
    isAdmin?: boolean;
  }
}

export const requireOwner = async (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  const propertyNumber = req.session.propertyNumber;
  const ownerAccountId = req.session.ownerAccountId;
  const authVersion = req.session.authVersion;
  if (!propertyNumber) {
    return res.status(401).json({ error: "Login Required" });
  }

  // Any account marker makes this an account session. Partial, revoked, or
  // stale account sessions must never silently downgrade to legacy PIN access.
  if (ownerAccountId !== undefined || authVersion !== undefined) {
    if (
      typeof ownerAccountId !== "string" ||
      !Number.isSafeInteger(authVersion) ||
      Number(authVersion) <= 0
    ) {
      return res.status(401).json({ error: "Login Required" });
    }
    try {
      const valid = await ownerAccountStore.validateActiveMembership({
        ownerAccountId,
        authVersion: Number(authVersion),
        propertyNumber,
      });
      if (!valid) return res.status(401).json({ error: "Login Required" });
    } catch (error) {
      console.error("Owner account session validation error:", error);
      return res.status(503).json({ error: "Session validation unavailable" });
    }
  }

  (req as any).propertyNumber = propertyNumber;
  return next();
};

export const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
  if (!req.session.isAdmin)
    return res.status(401).json({ error: "Admin Login Required" });
  next();
};

export const requireOwnerOrAdmin = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (req.session.isAdmin) return next();
  return requireOwner(req, res, next);
};

export const requireSameOrigin = (
  req: Request,
  res: Response,
  next: NextFunction,
) => {
  if (!isSameOriginRequest(req)) {
    return res.status(403).json({
      code: "CROSS_ORIGIN_REQUEST",
      error: "Cross-origin request is not allowed",
    });
  }
  next();
};
