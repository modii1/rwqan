import "./config/loadEnv";
import express, { type ErrorRequestHandler } from "express";
import session from "express-session";
import cors from "cors";
import { registerRoutes } from "./routes/index";
import path from "path";
import { fileURLToPath } from "url";
import MemoryStore from "memorystore";
import { startSmartScheduler } from "./smartScheduler";
import { startScheduler } from "./scheduler";
import { startBookingCommissionWorker } from "./services/BookingNotificationWorker";
import { assertR2DevIsolation } from "./utils/r2";
import next from "next";
import cookieParser from "cookie-parser";
import { randomBytes } from "node:crypto";
import {
  assertDevelopmentIsolation,
  assertDevOnlyAdminCredentialsIsolation,
  assertFirebaseDevIsolation,
  assertPaymobKeyEnvironmentMatch,
  assertProductionFirestoreAvailable,
  assertProductionSecurityEnvironment,
} from "./config/runtimeEnvironment";
import { captureWhatsAppWebhookRawBody } from "./routes/whatsapp-delivery-webhook";
import {
  activeFirestore,
  getActiveDataEnvironment,
  getActiveFirestoreProjectId,
} from "./config/dataEnvironment";
import { syncR2Environment } from "./utils/r2";
import { FirestoreSessionStore } from "./services/FirestoreSessionStore";


const app = express();
const port = parseInt(process.env.PORT || "5000", 10);
const dev = process.env.NODE_ENV !== "production";

// Initialize Next.js
const nextApp = next(dev ? { dev, webpack: true } : { dev });
const handle = nextApp.getRequestHandler();

(async () => {
  console.log("🚀 [Server] Entering main startup IIFE...");
  try {
    assertProductionSecurityEnvironment();
    assertDevelopmentIsolation();
    assertFirebaseDevIsolation();
    assertDevOnlyAdminCredentialsIsolation();
    assertPaymobKeyEnvironmentMatch();
    assertR2DevIsolation();
    syncR2Environment();
    assertProductionFirestoreAvailable(activeFirestore);
    console.log(
      `[RWQAN] بيئة البيانات النشطة: ${getActiveDataEnvironment()} · مشروع Firestore الفعلي: ${getActiveFirestoreProjectId() ?? "غير محدد"}`,
    );
    await nextApp.prepare();
    console.log("✅ [Server] Next.js prepared successfully.");

    // ====================================
    // ⚙️ ENVIRONMENT VALIDATION
    // ====================================
    const requiredEnv = [
      "FIREBASE_SERVICE_ACCOUNT",
      "PAYMOB_API_KEY",
      "PAYMOB_PUBLIC_KEY",
      "PAYMOB_HMAC_SECRET",
      "SESSION_SECRET",
      "ADMIN_CODE",
      "ADMIN_PASSWORD"
    ];
    const missingEnv = requiredEnv.filter(k => !process.env[k]);
    if (missingEnv.length > 0) {
      console.warn("⚠️ [Server] Some environment variables are missing:", missingEnv.join(", "));
    }

    // JSON settings
    app.use(express.json({
      limit: "10mb",
      verify: captureWhatsAppWebhookRawBody,
    }));
    app.use(express.urlencoded({ extended: true }));
    app.use(cookieParser());

    // ====================================
    // 🚀 CORS SETTINGS
    // ====================================
    app.use(
      cors({
        origin: true,
        credentials: true,
      }),
    );

    // ====================================
    // 🚀 SESSION SETTINGS
    // ====================================
    const sessionStore = dev
      ? new (MemoryStore(session))({ checkPeriod: 86400000 })
      : new FirestoreSessionStore(activeFirestore);

    app.set("trust proxy", 1);

    const sessionSecret =
      process.env.SESSION_SECRET || randomBytes(32).toString("hex");

    app.use(
      session({
        secret: sessionSecret,
        resave: false,
        saveUninitialized: false,
        store: sessionStore,
        cookie: {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax", // Changed to lax for better Next.js compatibility in some cases, or keep 'none' if cross-site needed
          maxAge: 1000 * 60 * 60 * 24 * 7,
        },
      }),
    );

    // =====================================
    // Static storage for Object Storage
    // =====================================
    const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
    if (bucketId) {
      app.use("/public", express.static(`${bucketId}/public`));
    }

    // Register API Routes (Express)
    // We pass 'app' to registerRoutes. 
    // IMPORTANT: registerRoutes might try to setup Vite. We need to check that.
    const server = await registerRoutes(app);

    // Error Handler
    const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
      // Multer file-upload errors (e.g. exceeding the size cap) are thrown by
      // route middleware and never reach the route handler's own try/catch.
      // Surface them as an explicit 4xx instead of an opaque 500.
      if (err && (err as { name?: string }).name === "MulterError") {
        const isTooLarge = (err as { code?: string }).code === "LIMIT_FILE_SIZE";
        res.status(isTooLarge ? 413 : 400).json({
          error: isTooLarge
            ? "حجم الملف كبير جداً. الحجم الأقصى المسموح به هو 2 ميجابايت"
            : "حدث خطأ أثناء رفع الملف. يرجى التحقق من الملف والمحاولة مرة أخرى",
        });
        return;
      }
      console.error("❌ SERVER ERROR:", err);
      res.status(500).json({ message: "Server Error" });
    };
    app.use("/api", errorHandler); // Only apply explicit error handler to API routes generally

    // Handover to Next.js for all other routes
    app.all("*", (req, res) => {
      return handle(req, res);
    });

    // Start server
    server.listen({ port, host: "0.0.0.0" }, () => {
      console.log(`🚀 Server running on port ${port}`);

      // Daily scheduler (noon: 3/3 cycle notifications, remaining days, payment expiry)
      startScheduler();

      // Booking follow-ups/commission reminders use Firestore leases and can
      // also be triggered by the authenticated external worker endpoint.
      startBookingCommissionWorker();

      // Smart non-spam scheduler (twice weekly with staggered batches - safety net)
      startSmartScheduler();
    });
  } catch (e) {
    console.error("❌ FATAL STARTUP ERROR:", e);
    if (e instanceof Error) {
      console.error(e.stack);
    }
    process.exit(1);
  }
})();
