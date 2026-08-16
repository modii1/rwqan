/**
 * Routes Index - Assembles all modular route files
 * 
 * This replaces the legacy monolithic routes.ts (7700+ lines)
 * by composing smaller, domain-specific route modules.
 */
import type { Express } from "express";
import { createServer, type Server } from "http";
import cors from "cors";
import type { CorsOptions } from "cors";
import cookieParser from "cookie-parser";
import { firebaseService } from "../firebaseService";
import { dbContext } from "../config/dbConfig";
import whatsappRoutes from "../integrations/whatsapp";

// Route modules
import authRoutes from "./auth";
import ownerRoutes from "./owner";
import propertiesRoutes from "./properties";
import publicRoutes from "./public";
import trackingRoutes from "./tracking";
import contactIdentityRoutes from "./contactIdentity";
import webhookRoutes from "./webhooks";
import bookingRoutes from "./bookings";
import { requireAdmin, requireSameOrigin } from "./middleware";

// Admin route modules
import adminAnalyticsRoutes from "./admin/analytics";
import adminPropertiesRoutes from "./admin/properties";
import adminSubscriptionsRoutes from "./admin/subscriptions";
import adminPaymentsRoutes from "./admin/payments";
import adminContentRoutes from "./admin/content";
import adminFinanceRoutes from "./admin/finance";
import adminSettingsRoutes from "./admin/settings";
import adminAddonsRoutes from "./admin/addons";
import adminBackupRoutes from "./admin/backup";
import adminImagesRoutes from "./admin/images";
import adminPackagesRoutes from "./admin/packages";
import adminTestingRoutes from "./admin/testing";
import adminLinkedPropertiesRoutes from "./admin/linked-properties";
import adminOccasionsRoutes from "./admin/occasions";
import adminBookingsRoutes from "./admin/bookings";

export async function registerRoutes(app: Express): Promise<Server> {
  // Middleware for cookies
  app.use(cookieParser());

  // Middleware to select database source - Always Firebase
  app.use((req, res, next) => {
    dbContext.run({ dbService: firebaseService }, () => {
      next();
    });
  });

  // CORS
  const corsOptions: CorsOptions = {
    origin: true,
    credentials: true,
  };
  app.use(cors(corsOptions));

  // Initialize DB
  try {
    await firebaseService.initializeSheets();
  } catch (err) {
    console.error("DB Init Error:", err);
  }

  // ============================================
  // Register all route modules
  // ============================================

  // WhatsApp routes (mounted at /api/whatsapp)
  app.use("/api/whatsapp", whatsappRoutes);

  // Public routes (sitemap, developer-guide, packages, suggestions, etc.)
  app.use(publicRoutes);

  // Auth routes (login, logout, session, password reset)
  app.use(authRoutes);

  // Remembered public-client contact phone (separate from owner/admin auth)
  app.use(contactIdentityRoutes);

  // Tracking routes (smart requests, pageview)
  app.use(trackingRoutes);

  // Token-scoped customer booking follow-up and commission collection.
  app.use(bookingRoutes);

  // Owner routes (property management, images, payments, subscriptions, addons)
  app.use(ownerRoutes);

  // Public property routes (list, detail, create, update, delete, register)
  app.use(propertiesRoutes);

  // Webhook routes (Paymob)
  app.use(webhookRoutes);

  // Central privileged boundary. Admin login/session routes are intentionally
  // registered above; every modular /api/admin handler below requires a session.
  app.use("/api/admin", requireSameOrigin, requireAdmin);

  // Admin routes
  app.use(adminAnalyticsRoutes);
  app.use(adminPropertiesRoutes);
  app.use(adminLinkedPropertiesRoutes);
  app.use(adminSubscriptionsRoutes);
  app.use(adminPaymentsRoutes);
  app.use(adminContentRoutes);
  app.use(adminFinanceRoutes);
  app.use(adminSettingsRoutes);
  app.use(adminAddonsRoutes);
  app.use(adminBackupRoutes);
  app.use(adminImagesRoutes);
  app.use(adminPackagesRoutes);
  app.use(adminTestingRoutes);
  app.use(adminOccasionsRoutes);
  app.use(adminBookingsRoutes);

  return createServer(app);
}
