import assert from "node:assert/strict";
import test from "node:test";
import {
  generalWhatsAppStatusMeta,
  summarizeBookingWorkflowNotifications,
} from "./whatsapp-delivery-presentation";

test("workflow statistics count provider acceptance as pending until delivery", () => {
  const summary = summarizeBookingWorkflowNotifications({
    bookings: [{
      notificationJobs: [
        { status: "sent", providerDeliveryStatus: "accepted" },
        { status: "sent" },
        { status: "sent", providerDeliveryStatus: "delivered" },
        { status: "sent", providerDeliveryStatus: "read" },
        { status: "sent", providerDeliveryStatus: "failed" },
      ],
    }],
  });

  assert.deepEqual(summary, {
    sent: 2,
    pending: 2,
    failed: 1,
    suppressed: 0,
    deferred: 0,
  });
});

test("general log status exposes callback failure after transport acceptance", () => {
  assert.deepEqual(generalWhatsAppStatusMeta({
    status: "success",
    providerDeliveryStatus: "accepted",
  }), { label: "قيد الإرسال", tone: "blue" });
  assert.deepEqual(generalWhatsAppStatusMeta({
    status: "success",
    providerDeliveryStatus: "delivered",
  }), { label: "تم الإرسال", tone: "green" });
  assert.deepEqual(generalWhatsAppStatusMeta({
    status: "success",
    providerDeliveryStatus: "failed",
  }), { label: "فشل الإرسال", tone: "red" });
});
