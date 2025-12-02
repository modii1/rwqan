import express, { type ErrorRequestHandler } from "express";
import session from "express-session";
import cors from "cors";
import { registerRoutes } from "./routes";
import { setupVite, log } from "./vite";
import path from "path";
import { fileURLToPath } from "url";
import MemoryStore from "memorystore";

const app = express();

// JSON settings
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// ====================================
// 🚀 CORS SETTINGS (مهم جداً)
// ====================================
app.use(
  cors({
    origin: true,          // يسمح لكل الدومينات
    credentials: true,     // يرسل الكوكيز
  })
);

// ====================================
// 🚀 SESSION SETTINGS (المهم جداً لعدم ظهور 401)
// ====================================
const memoryStore = new (MemoryStore(session))({
  checkPeriod: 86400000, // كل 24 ساعة
});

app.set("trust proxy", 1); // Replit uses reverse proxy

app.use(
  session({
    secret: process.env.SESSION_SECRET || "moddy-secret-key-2025",
    resave: false,
    saveUninitialized: false,
    store: memoryStore,
    cookie: {
      httpOnly: true,
      secure: true,        // Replit uses HTTPS
      sameSite: "none",    // ضروري لأن front/back دومين مختلف
      maxAge: 1000 * 60 * 60 * 24 * 7, // أسبوع
    },
  })
);

// =====================================
// Static storage for Object Storage
// =====================================
const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
if (bucketId) {
  app.use("/public", express.static(`${bucketId}/public`));
}

(async () => {
  // Register all API routes
  const server = await registerRoutes(app);

  // Error Handler
  const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    console.error("❌ SERVER ERROR:", err);
    res.status(500).json({ message: "Server Error" });
  };
  app.use(errorHandler);

  // ====== Development: Vite ======
  if (app.get("env") === "development") {
    await setupVite(app, server);
  }

  // ====== Production: React Build ======
  if (app.get("env") !== "development") {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    const publicPath = path.join(__dirname, "public");

    app.use(express.static(publicPath));

    // Any non-API route returns React index.html
    app.get("*", (req, res) => {
      if (!req.path.startsWith("/api"))
        return res.sendFile(path.join(publicPath, "index.html"));

      res.status(404).json({ error: "API Route Not Found" });
    });
  }

  // Start server
  const port = parseInt(process.env.PORT || "5000", 10);
  server.listen({ port, host: "0.0.0.0" }, () => {
    console.log("🚀 Server running on port", port);
  });
})();
