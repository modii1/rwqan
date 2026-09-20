import { Router, type Request, type Response } from "express";
import { z } from "zod";

import {
  CustomerAccountError,
  customerAccountService,
} from "../services/CustomerAccountService";
import { requireCustomer } from "./customerMiddleware";
import { requireSameOrigin } from "./middleware";

const router = Router();

function verifiedCustomerPhone(req: Request): string {
  const phone = req.customerIdentity?.clientPhone;
  if (!phone) throw new Error("Verified customer identity is missing");
  return phone;
}

function respondWithCustomerError(res: Response, error: unknown): Response {
  if (error instanceof CustomerAccountError) {
    return res.status(error.status).json({ code: error.code, error: error.message });
  }
  if (error instanceof z.ZodError) {
    return res.status(400).json({
      code: "INVALID_CUSTOMER_INPUT",
      error: "البيانات المدخلة غير صحيحة",
      fields: error.flatten().fieldErrors,
    });
  }
  console.error(
    "Customer account route error:",
    error instanceof Error ? error.name : "UnknownError",
  );
  return res.status(500).json({
    code: "CUSTOMER_ACCOUNT_ERROR",
    error: "تعذر تحميل بيانات الحساب",
  });
}

router.get(
  "/api/customer/profile",
  requireSameOrigin,
  requireCustomer,
  async (req, res) => {
    try {
      const profile = await customerAccountService.getProfile(
        verifiedCustomerPhone(req),
      );
      return res.json({ profile });
    } catch (error) {
      return respondWithCustomerError(res, error);
    }
  },
);

router.patch(
  "/api/customer/profile",
  requireSameOrigin,
  requireCustomer,
  async (req, res) => {
    try {
      const profile = await customerAccountService.updateProfile(
        verifiedCustomerPhone(req),
        req.body,
      );
      return res.json({ profile });
    } catch (error) {
      return respondWithCustomerError(res, error);
    }
  },
);

router.get(
  "/api/customer/history",
  requireSameOrigin,
  requireCustomer,
  async (req, res) => {
    try {
      const history = await customerAccountService.getHistory(
        verifiedCustomerPhone(req),
      );
      return res.json({ history });
    } catch (error) {
      return respondWithCustomerError(res, error);
    }
  },
);

router.get(
  "/api/customer/favorites",
  requireSameOrigin,
  requireCustomer,
  async (req, res) => {
    try {
      const favoritePropertyNumbers =
        await customerAccountService.getFavoritePropertyNumbers(
          verifiedCustomerPhone(req),
        );
      return res.json({ favoritePropertyNumbers });
    } catch (error) {
      return respondWithCustomerError(res, error);
    }
  },
);

router.put(
  "/api/customer/favorites/:propertyNumber",
  requireSameOrigin,
  requireCustomer,
  async (req, res) => {
    try {
      const favoritePropertyNumbers = await customerAccountService.setFavorite(
        verifiedCustomerPhone(req),
        req.params.propertyNumber,
        true,
      );
      return res.json({ favoritePropertyNumbers });
    } catch (error) {
      return respondWithCustomerError(res, error);
    }
  },
);

router.delete(
  "/api/customer/favorites/:propertyNumber",
  requireSameOrigin,
  requireCustomer,
  async (req, res) => {
    try {
      const favoritePropertyNumbers = await customerAccountService.setFavorite(
        verifiedCustomerPhone(req),
        req.params.propertyNumber,
        false,
      );
      return res.json({ favoritePropertyNumbers });
    } catch (error) {
      return respondWithCustomerError(res, error);
    }
  },
);

export default router;
