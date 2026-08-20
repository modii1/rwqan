import { Router } from "express";
import { bookingCommissionService } from "../../services/BookingCommissionService";
import { bookingRouteError } from "../../services/BookingCommissionService";
import { runBookingCommissionWorker } from "../../services/BookingNotificationWorker";

const router = Router();

router.get("/api/admin/booking-commissions", async (_req, res) => {
  res.set("Cache-Control", "no-store, private");
  try {
    return res.json(await bookingCommissionService.getAdminDashboard());
  } catch (error) {
    const response = bookingRouteError(error);
    return res.status(response.status).json(response.body);
  }
});

router.get("/api/admin/booking-commissions/settings", async (_req, res) => {
  res.set("Cache-Control", "no-store, private");
  try {
    return res.json(
      await bookingCommissionService.getAdminFreeWorkflowSettings(),
    );
  } catch (error) {
    const response = bookingRouteError(error);
    return res.status(response.status).json(response.body);
  }
});

router.put("/api/admin/booking-commissions/settings", async (req, res) => {
  res.set("Cache-Control", "no-store, private");
  try {
    return res.json(
      await bookingCommissionService.updateAdminFreeWorkflowSettings(req.body),
    );
  } catch (error) {
    const response = bookingRouteError(error);
    return res.status(response.status).json(response.body);
  }
});

router.get("/api/admin/booking-commissions/:id/customer-whatsapp", async (req, res) => {
  res.set("Cache-Control", "no-store, private");
  res.set("Referrer-Policy", "no-referrer");
  try {
    const redirectUrl = await bookingCommissionService.getAdminCustomerWhatsAppUrl(
      req.params.id,
    );
    return res.redirect(302, redirectUrl);
  } catch (error) {
    const response = bookingRouteError(error);
    return res.status(response.status).json(response.body);
  }
});

router.post("/api/admin/booking-commissions/run-worker", async (_req, res) => {
  res.set("Cache-Control", "no-store, private");
  try {
    return res.json({ ok: true, ...(await runBookingCommissionWorker()) });
  } catch (error) {
    const response = bookingRouteError(error);
    return res.status(response.status).json(response.body);
  }
});

router.post("/api/admin/booking-commissions/:id/dispute", async (req, res) => {
  res.set("Cache-Control", "no-store, private");
  try {
    return res.json(await bookingCommissionService.resolveAdminDispute(
      req.params.id,
      req.body,
    ));
  } catch (error) {
    const response = bookingRouteError(error);
    return res.status(response.status).json(response.body);
  }
});

router.post("/api/admin/booking-commissions/:id/reversal", async (req, res) => {
  res.set("Cache-Control", "no-store, private");
  try {
    return res.json(await bookingCommissionService.resolveAdminReversal(
      req.params.id,
      req.body,
    ));
  } catch (error) {
    const response = bookingRouteError(error);
    return res.status(response.status).json(response.body);
  }
});

export default router;
