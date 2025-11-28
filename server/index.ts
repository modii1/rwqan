import express from "express";
import { registerRoutes } from "./routes";
import { setupVite, log } from "./vite";
import path from "path";
import { fileURLToPath } from "url";

const app = express();

// JSON settings
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Object Storage public assets (Replit)
const bucketId = process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID;
if (bucketId) {
  app.use("/public", express.static(`${bucketId}/public`));
}

(async () => {
  // Register all API routes
  const server = await registerRoutes(app);

  // Error Handler
  app.use((err, req, res, next) => {
    console.error("SERVER ERROR:", err);
    res.status(500).json({ message: "Server Error" });
  });

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
  server.listen({ port, host: "0.0.0.0" }, () =>
    console.log(`🚀 Server running on port ${port}`)
  );
})();
