import type { Request, Response, NextFunction } from "express";
import type { Express } from "express";

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

export const ADMIN_CODE = process.env.ADMIN_CODE || "admin";
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin123";
