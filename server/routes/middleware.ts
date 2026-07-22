/**
 * Auth & Session middleware
 */
import type { Request, Response, NextFunction } from "express";
import { isSameOriginRequest } from "../utils/requestOrigin";

declare module "express-session" {
  interface SessionData {
    propertyNumber?: string;
    isAdmin?: boolean;
  }
}

export const requireOwner = (req: Request, res: Response, next: NextFunction) => {
  if (!req.session.propertyNumber)
    return res.status(401).json({ error: "Login Required" });
  (req as any).propertyNumber = req.session.propertyNumber;
  next();
};

export const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
  if (!req.session.isAdmin)
    return res.status(401).json({ error: "Admin Login Required" });
  next();
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
