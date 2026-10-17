import { Router } from "express";
import {
  bookingCommissionService,
  bookingRouteError,
} from "../../services/BookingCommissionService";
import { runBookingCommissionWorker } from "../../services/BookingNotificationWorker";

const router = Router();

router.post(
  "/api/admin/booking-commissions/:id/bank-transfer-review",
  async (req, res) => {
    res.set("Cache-Control", "no-store, private");
    try {
      const result = await bookingCommissionService.resolveAdminBankTransfer(
        req.params.id,
        req.body,
      );
      if (result.status === "approved" || result.status === "rejected") {
        setImmediate(() => {
          runBookingCommissionWorker().catch((error) =>
            console.error("Post-bank-commission booking worker failed:", error));
        });
      }
      return res.json(result);
    } catch (error) {
      const response = bookingRouteError(error);
      return res.status(response.status).json(response.body);
    }
  },
);

export default router;
