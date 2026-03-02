import { Router } from "express";
import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";

import cors from "cors";
import type { CorsOptions } from "cors";

import cookieParser from "cookie-parser";

import { firebaseService } from "../firebaseService";
import { googleSheetsService } from "../googleSheets";
import { dbContext } from "../dbConfig";

import whatsappRoutes from "../whatsapp";
import authRoutes from "./auth";
import ownerRoutes from "./owner";
import adminRoutes from "./admin";
import propertiesRoutes from "./properties";
import subscriptionsRoutes from "./subscriptions";
import paymentsRoutes from "./payments";
import requestsRoutes from "./requests";

declare module 'express-session' {
  interface SessionData {
    propertyNumber?: string;
    isAdmin?: boolean;
    otp?: string;
    otpExpiry?: number;
    lastOtpSent?: number;
  }
}

export async function registerRoutes(app: Express): Promise<Server> {
  app.use(cookieParser());

  app.use((req: Request, res: Response, next: NextFunction) => {
    const dbSource = req.headers['x-db-source'] || req.cookies?.['db_source'] || 'firebase';
    const service = dbSource === 'firebase' ? (firebaseService as any) : googleSheetsService;

    dbContext.run({ dbService: service }, () => {
      next();
    });
  });

  const corsOptions: CorsOptions = {
    origin: true,
    credentials: true,
  };
  app.use(cors(corsOptions));

  app.use("/", authRoutes);
  app.use("/", ownerRoutes);
  app.use("/", adminRoutes);
  app.use("/", propertiesRoutes);
  app.use("/", subscriptionsRoutes);
  app.use("/", paymentsRoutes);
  app.use("/", requestsRoutes);
  app.use("/api/whatsapp", whatsappRoutes);

  app.get("/developer-guide", async (_req, res) => {
    res.redirect("https://example.com/developer-guide");
  });

  app.get("/sitemap.xml", async (_req, res) => {
    res.setHeader("Content-Type", "application/xml");
    res.send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://rwqan.sa/</loc>
    <priority>1.0</priority>
  </url>
</urlset>`);
  });

  const server = createServer(app);
  return server;
}
