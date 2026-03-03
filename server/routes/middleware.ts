/**
 * Auth & Session middleware
 */
import type { Request, Response, NextFunction } from "express";

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
