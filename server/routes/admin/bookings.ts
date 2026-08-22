import { Router } from "express";
import { bookingCommissionService } from "../../services/BookingCommissionService";
import { bookingRouteError } from "../../services/BookingCommissionService";
import { runBookingCommissionWorker } from "../../services/BookingNotificationWorker";
import { BookingWorkflowError } from "../../services/BookingCommissionStore";

const router = Router();

function kickBookingWorker(context: string): void {
  setImmediate(() => {
    runBookingCommissionWorker().catch((error) =>
      console.error(`${context} booking worker failed:`, error));
  });
}

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

router.post("/api/admin/booking-commissions/:id/customer-whatsapp", async (req, res) => {
  res.set("Cache-Control", "no-store, private");
  res.set("Referrer-Policy", "no-referrer");
  try {
    const handoffUrl = await bookingCommissionService.issueAdminCustomerWhatsAppHandoff(
      req.params.id,
      req.body,
    );
    return res.json({ handoffUrl });
  } catch (error) {
    if (
      error instanceof BookingWorkflowError &&
      error.code === "ADMIN_CUSTOMER_WHATSAPP_RATE_LIMITED" &&
      error.retryAfterSeconds
    ) {
      res.set("Retry-After", String(error.retryAfterSeconds));
    }
    const response = bookingRouteError(error);
    return res.status(response.status).json(response.body);
  }
});

router.get("/api/admin/booking-commissions/:id/customer-whatsapp/open", async (req, res) => {
  res.set("Cache-Control", "no-store, private");
  res.set("Referrer-Policy", "no-referrer");
  try {
    const redirectUrl = await bookingCommissionService
      .resolveAdminCustomerWhatsAppHandoff(
        req.params.id,
        req.query.token,
        req.query.templateVariant,
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

router.post("/api/admin/booking-commissions/:id/notifications/resend", async (req, res) => {
  res.set("Cache-Control", "no-store, private");
  try {
    const result = await bookingCommissionService.resendAdminNotification(
      req.params.id,
      req.body,
    );
    kickBookingWorker("Manual notification resend");
    return res.json(result);
  } catch (error) {
    const response = bookingRouteError(error);
    return res.status(response.status).json(response.body);
  }
});

router.post("/api/admin/booking-commissions/:id/dispute", async (req, res) => {
  res.set("Cache-Control", "no-store, private");
  try {
    const result = await bookingCommissionService.resolveAdminDispute(
      req.params.id,
      req.body,
    );
    if (result.ownerNotificationScheduled) {
      kickBookingWorker("Dispute resolution notification");
    }
    return res.json(result);
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
