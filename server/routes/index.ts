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
import ownerAccountRoutes from "./owner-accounts";
import ownerRoutes from "./owner";
import propertiesRoutes from "./properties";
import publicRoutes from "./public";
import deployVersionRoutes from "./deploy-version";
import trackingRoutes from "./tracking";
import contactIdentityRoutes from "./contactIdentity";
import customerRoutes from "./customer";
import propertyReviewRoutes from "./property-reviews";
import webhookRoutes from "./webhooks";
import whatsappDeliveryWebhookRoutes from "./whatsapp-delivery-webhook";
import bookingRoutes from "./bookings";
import adminLiveDataRoutes from "./admin/live";
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
import adminBookingPaymentsRoutes from "./admin/booking-payments";
import adminOperationsRoutes from "./admin/operations";
import adminDeployRoutes from "./admin/deploy";
import adminDeployAuthRoutes from "./admin/deploy-auth";
import { setDeploySystemStoreFactory } from "../services/DeploySystemStore";
import { createFirestoreDeploySystemStore } from "../services/FirestoreDeploySystemStore";

export async function registerRoutes(app: Express): Promise<Server> {
  // RWQAN DEPLOY: bind the DEV-only durable release registry. The factory fails
  // closed if the isolated DEV project cannot be proven (see the resolver).
  setDeploySystemStoreFactory(createFirestoreDeploySystemStore);

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

  // RWQAN DEPLOY: public read-only running-version probe for the DEV backend.
  // Serves only on the isolated DEV project (404 elsewhere, incl. production).
  app.use(deployVersionRoutes);

  // Auth routes (login, logout, session, password reset)
  app.use(authRoutes);

  // RWQAN DEPLOY AUTH: OAuth start/status/revoke require admin session (applied
  // per-route inside the router); the OAuth callback is intentionally NOT behind
  // requireAdmin because Google's redirect does not carry the admin session.
  // CSRF protection is via single-use state + nonce in deployAuth.
  app.use(adminDeployAuthRoutes);

  // Additive verified owner accounts; legacy property-number/PIN login remains.
  app.use(ownerAccountRoutes);

  // Remembered public-client contact phone (separate from owner/admin auth)
  app.use(contactIdentityRoutes);

  // Verified customer account, profile, favorites, and complete contact history.
  app.use(customerRoutes);

  // Verified-stay reviews: public summaries plus authenticated customer/admin actions.
  app.use(propertyReviewRoutes);

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

  // Authenticated WhatsApp provider delivery receipts.
  app.use(whatsappDeliveryWebhookRoutes);

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
  app.use(adminBookingPaymentsRoutes);
  app.use(adminOperationsRoutes);

  // RWQAN DEPLOY (DEV-only prototype). Guarded by the central /api/admin
  // boundary above plus its own requireSameOrigin/requireAdmin/DEV gate.
  app.use(adminDeployRoutes);

  // RWQAN LIVE DATA (DEV-only, read-only preview). Guarded by the central
  // /api/admin boundary plus its own requireSameOrigin/requireAdmin/DEV gate.
  app.use(adminLiveDataRoutes);

  return createServer(app);
}
