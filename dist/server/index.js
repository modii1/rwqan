"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const express_session_1 = __importDefault(require("express-session"));
const cors_1 = __importDefault(require("cors"));
const routes_1 = require("./routes");
const memorystore_1 = __importDefault(require("memorystore"));
const scheduler_1 = require("./scheduler");
const next_1 = __importDefault(require("next"));
const app = (0, express_1.default)();
const port = parseInt(process.env.PORT || "5000", 10);
const dev = process.env.NODE_ENV !== "production";
// Initialize Next.js
const nextApp = (0, next_1.default)({ dev });
const handle = nextApp.getRequestHandler();
(async () => {
    console.log("🚀 [Server] Entering main startup IIFE...");
    try {
        await nextApp.prepare();
        console.log("✅ [Server] Next.js prepared successfully.");
        // JSON settings
        app.use(express_1.default.json({ limit: "10mb" }));
        app.use(express_1.default.urlencoded({ extended: true }));
        // ====================================
        // 🚀 CORS SETTINGS
        // ====================================
        app.use((0, cors_1.default)({
            origin: true,
            credentials: true,
        }));
        // ====================================
        // 🚀 SESSION SETTINGS
        // ====================================
        const memoryStore = new ((0, memorystore_1.default)(express_session_1.default))({
            checkPeriod: 86400000,
        });
        app.set("trust proxy", 1);
        app.use((0, express_session_1.default)({
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
        }));
        // =====================================
        // Static storage for Object Storage
        // =====================================
        const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
        if (bucketId) {
            app.use("/public", express_1.default.static(`${bucketId}/public`));
        }
        // Register API Routes (Express)
        // We pass 'app' to registerRoutes. 
        // IMPORTANT: registerRoutes might try to setup Vite. We need to check that.
        const server = await (0, routes_1.registerRoutes)(app);
        // Error Handler
        const errorHandler = (err, _req, res, _next) => {
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
            (0, scheduler_1.startScheduler)();
        });
    }
    catch (e) {
        console.error("❌ FATAL STARTUP ERROR:", e);
        if (e instanceof Error) {
            console.error(e.stack);
        }
        process.exit(1);
    }
})();
