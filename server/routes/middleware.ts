/**
 * Auth & Session middleware
 */
import type { Request, Response, NextFunction } from "express";

export const requireOwner = (req: Request, res: Response, next: NextFunction) => {
  if (!(req.session as any).propertyNumber)
    return res.status(401).json({ error: "Login Required" });
  (req as any).propertyNumber = (req.session as any).propertyNumber;
  next();
};

export const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
  if (!(req.session as any).isAdmin)
    return res.status(401).json({ error: "Admin Login Required" });
  next();
};
