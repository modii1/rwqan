import { Router, type Response } from "express";
import { z } from "zod";

import {
  PropertyReviewError,
  propertyReviewService,
} from "../services/PropertyReviewService";
import { requireCustomer } from "./customerMiddleware";
import { requireAdmin, requireSameOrigin } from "./middleware";

const router = Router();

function respondWithReviewError(res: Response, error: unknown): Response {
  if (error instanceof PropertyReviewError) {
    return res.status(error.status).json({ code: error.code, error: error.message });
  }
  if (error instanceof z.ZodError) {
    return res.status(400).json({
      code: "INVALID_REVIEW_INPUT",
      error: "بيانات التقييم غير صحيحة",
      fields: error.flatten().fieldErrors,
    });
  }
  console.error(
    "Property review route error:",
    error instanceof Error ? error.name : "UnknownError",
  );
  return res.status(500).json({
    code: "PROPERTY_REVIEW_ERROR",
    error: "تعذر معالجة التقييم",
  });
}

function verifiedCustomerPhone(request: Express.Request): string {
  const phone = request.customerIdentity?.clientPhone;
  if (!phone) throw new Error("Verified customer identity is missing");
  return phone;
}

router.get("/api/properties/:propertyNumber/reviews", async (req, res) => {
  try {
    const result = await propertyReviewService.listPublicForProperty(
      req.params.propertyNumber,
    );
    res.set("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
    return res.json(result);
  } catch (error) {
    return respondWithReviewError(res, error);
  }
});

router.get(
  "/api/customer/reviews",
  requireSameOrigin,
  requireCustomer,
  async (req, res) => {
    try {
      res.set("Cache-Control", "no-store, private");
      const reviews = await propertyReviewService.listForCustomer(
        verifiedCustomerPhone(req),
      );
      return res.json({ reviews });
    } catch (error) {
      return respondWithReviewError(res, error);
    }
  },
);

router.put(
  "/api/customer/reviews/:bookingId",
  requireSameOrigin,
  requireCustomer,
  async (req, res) => {
    try {
      res.set("Cache-Control", "no-store, private");
      const review = await propertyReviewService.saveForCustomer(
        verifiedCustomerPhone(req),
        req.params.bookingId,
        req.body,
      );
      return res.json({ review });
    } catch (error) {
      return respondWithReviewError(res, error);
    }
  },
);

router.get(
  "/api/admin/property-reviews",
  requireSameOrigin,
  requireAdmin,
  async (req, res) => {
    try {
      res.set("Cache-Control", "no-store, private");
      const reviews = await propertyReviewService.listForAdmin(req.query.status);
      return res.json({ reviews });
    } catch (error) {
      return respondWithReviewError(res, error);
    }
  },
);

router.put(
  "/api/admin/property-reviews/:reviewId/moderation",
  requireSameOrigin,
  requireAdmin,
  async (req, res) => {
    try {
      res.set("Cache-Control", "no-store, private");
      const review = await propertyReviewService.moderate(
        req.params.reviewId,
        req.body,
      );
      return res.json({ review });
    } catch (error) {
      return respondWithReviewError(res, error);
    }
  },
);

export default router;
