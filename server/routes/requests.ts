import { Router } from "express";
import { storage } from "../storage";
import type { Request, Response } from "express";

const router = Router();

router.post("/api/suggestions", async (req: Request, res: Response) => {
  try {
    const { name, phone, city, suggestion } = req.body;

    if (!suggestion) {
      return res.status(400).json({ error: "Suggestion text required" });
    }

    const created = await storage.createSuggestion({
      name: name || "Unknown",
      phone: phone || "",
      city: city || "",
      suggestion,
    });

    res.json(created);
  } catch (err) {
    console.error("Suggestion error:", err);
    res.status(500).json({ error: "Failed to submit suggestion" });
  }
});

router.post("/api/track-pageview", async (req: Request, res: Response) => {
  try {
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: "Failed to track pageview" });
  }
});

export default router;
