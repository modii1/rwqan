import "dotenv/config";
import express, { type ErrorRequestHandler } from "express";
import session from "express-session";
import cors from "cors";
import { registerRoutes } from "./routes/index";
import path from "path";
import { fileURLToPath } from "url";
import MemoryStore from "memorystore";
import { startScheduler } from "./scheduler";
import next from "next";
import cookieParser from "cookie-parser";


const app = express();
const port = parseInt(process.env.PORT || "5000", 10);
const dev = process.env.NODE_ENV !== "production";

// Initialize Next.js
const nextApp = next({ dev });
const handle = nextApp.getRequestHandler();

(async () => {
  console.log("🚀 [Server] Entering main startup IIFE...");
  try {
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
      "SESSION_SECRET"
    ];
    const missingEnv = requiredEnv.filter(k => !process.env[k]);
    if (missingEnv.length > 0) {
      console.warn("⚠️ [Server] Some environment variables are missing:", missingEnv.join(", "));
    }

    // JSON settings
    app.use(express.json({ limit: "10mb" }));
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
    const memoryStore = new (MemoryStore(session))({
      checkPeriod: 86400000,
    });

    app.set("trust proxy", 1);

    app.use(
      session({
        secret: process.env.SESSION_SECRET || "moddy-secret-key-2025",
        resave: false,
        saveUninitialized: false,
        store: memoryStore,
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

      // التشغيل المهام المجدولة
      startScheduler();
    });
  } catch (e) {
    console.error("❌ FATAL STARTUP ERROR:", e);
    if (e instanceof Error) {
      console.error(e.stack);
    }
    process.exit(1);
  }
})();
