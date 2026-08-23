import { notificationService } from "./NotificationService";
import { sendOwnerWhatsApp } from "../integrations/whatsapp";
import { paymobService } from "../integrations/paymob";
import { getExactPaymobPaymentMethod } from "../utils/paymobPaymentMethod";
import { normalizeWhatsAppDestination } from "../../shared/phone";
import {
  bookingCommissionStore,
  type ClaimedBookingNotification,
} from "./BookingCommissionStore";
import {
  BOOKING_CUSTOMER_TOKEN_MAX_AGE_MS,
  bookingCommissionService,
} from "./BookingCommissionService";
import {
  createCustomerBookingShortCode,
  createOwnerPaymentShortCode,
  getBookingShortLinkService,
  type BookingShortLinkService,
} from "./BookingShortLinkService";
import type {
  BookingFollowUpDocument,
  BookingNotificationJob,
} from "./BookingCommissionTypes";
import {
  BASIS_POINTS_DENOMINATOR,
  BOOKING_COMMISSION_BASIS_POINTS,
  COMMISSION_PAYMENT_WINDOW_MS,
  DEFAULT_BOOKING_WHATSAPP_TEMPLATES,
  renderBookingWhatsAppTemplate,
  type BookingWhatsAppTemplates,
} from "../../shared/booking";
import {
  formatCalendarMonthNumeric,
  formatCanonicalDayNumeric,
} from "../../shared/booking-calendar";

const ENFORCEMENT_RETRY_MS = 30 * 60 * 1000;

function baseUrl(): string {
  const configured = String(
    process.env.PUBLIC_BASE_URL ||
    process.env.NEXT_PUBLIC_BASE_URL ||
    "https://rwqan.sa",
  ).trim();
  try {
    const parsed = new URL(configured);
    if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") {
      return "https://rwqan.sa";
    }
    return parsed.origin;
  } catch {
    return "https://rwqan.sa";
  }
}

function formatSar(halalas: number | null): string {
  if (!Number.isSafeInteger(halalas) || Number(halalas) < 0) return "0.00";
  return (Number(halalas) / 100).toFixed(Number(halalas) % 100 === 0 ? 0 : 2);
}

function formatDate(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return value;
  return parsed.toLocaleString("ar-SA", {
    timeZone: "Asia/Riyadh",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function timingLabel(value: string): string {
  if (value === "midweek") return "وسط الأسبوع";
  if (value === "weekend") return "نهاية الأسبوع";
  return "وقت آخر";
}

function customerPhoneLabel(value: string): string {
  const destination = normalizeWhatsAppDestination(value);
  return destination ? `+${destination}` : "—";
}

function bookingDateLabel(booking: BookingFollowUpDocument): string {
  const date = booking.confirmationFacts?.bookingDate;
  if (!date) return "—";
  if (date.precision === "month") {
    const calendar = "calendar" in date ? date.calendar : "gregorian";
    return formatCalendarMonthNumeric(date.value, calendar) || date.value;
  }
  return formatCanonicalDayNumeric(date.value, "gregorian") || date.value;
}

function ownerPaymentLink(booking: BookingFollowUpDocument): string {
  const token = bookingCommissionService.issueOwnerPaymentToken(booking);
  return `${baseUrl()}/p/${createOwnerPaymentShortCode(token)}`;
}

function notificationIncludesOwnerPaymentLink(
  job: BookingNotificationJob,
  booking: BookingFollowUpDocument,
): boolean {
  if (job.kind === "owner_booking_confirmed") {
    return booking.commissionStatus !== "not_applicable" &&
      booking.commissionAmountHalalas !== null &&
      Boolean(booking.commissionDueAt);
  }
  return job.kind === "commission_dispute_rejected" ||
    job.kind.startsWith("commission_reminder_") ||
    job.kind === "property_paused";
}

export function buildBookingNotificationMessage(
  job: BookingNotificationJob,
  booking: BookingFollowUpDocument,
  templates: BookingWhatsAppTemplates = DEFAULT_BOOKING_WHATSAPP_TEMPLATES,
): string {
  const propertyName = String(booking.propertyName || "").trim() || "بدون اسم";
  if (job.kind === "customer_followup") {
    const propertyLabel = booking.isFreeProperty || !booking.propertyName
      ? `العقار رقم ${booking.propertyNumber}`
      : `${propertyName} رقم ${booking.propertyNumber}`;
    return renderBookingWhatsAppTemplate(
      "customer_followup",
      templates.customer_followup,
      {
        propertyLabel,
        followUpLink:
          `${baseUrl()}/b/${createCustomerBookingShortCode(booking.id)}`,
      },
    );
  }

  const facts = booking.confirmationFacts;
  if (job.kind === "owner_booking_confirmed") {
    if (
      booking.commissionStatus === "not_applicable" ||
      booking.commissionAmountHalalas === null ||
      !booking.commissionDueAt
    ) {
      return renderBookingWhatsAppTemplate(
        "owner_booking_facts",
        templates.owner_booking_facts,
        {
          propertyName,
          propertyNumber: booking.propertyNumber,
          requestCode: booking.requestCode,
          customerPhone: customerPhoneLabel(booking.customerPhone),
          timing: timingLabel(facts?.timing || "other"),
          bookingDate: bookingDateLabel(booking),
          pricePaidSar: formatSar(facts?.pricePaidHalalas || 0),
        },
      );
    }
    const paymentLink = ownerPaymentLink(booking);
    return renderBookingWhatsAppTemplate(
      "owner_booking_commission",
      templates.owner_booking_commission,
      {
        propertyName,
        propertyNumber: booking.propertyNumber,
        requestCode: booking.requestCode,
        customerPhone: customerPhoneLabel(booking.customerPhone),
        timing: timingLabel(facts?.timing || "other"),
        bookingDate: bookingDateLabel(booking),
        pricePaidSar: formatSar(facts?.pricePaidHalalas || 0),
        commissionPercent:
          BOOKING_COMMISSION_BASIS_POINTS / (BASIS_POINTS_DENOMINATOR / 100),
        commissionAmountSar: formatSar(booking.commissionAmountHalalas),
        paymentWindowDays:
          COMMISSION_PAYMENT_WINDOW_MS / (24 * 60 * 60 * 1_000),
        paymentLink,
      },
    );
  }

  if (job.kind === "commission_dispute_rejected") {
    const paymentLink = ownerPaymentLink(booking);
    return renderBookingWhatsAppTemplate(
      "commission_dispute_rejected",
      templates.commission_dispute_rejected,
      {
        propertyName,
        propertyNumber: booking.propertyNumber,
        commissionAmountSar: formatSar(booking.commissionAmountHalalas),
        commissionDueAt: formatDate(booking.commissionDueAt),
        paymentLink,
      },
    );
  }

  if (job.kind.startsWith("commission_reminder_")) {
    const paymentLink = ownerPaymentLink(booking);
    const day = job.reminderOffsetDays || Number(job.kind.slice(-1));
    return renderBookingWhatsAppTemplate(
      "commission_reminder",
      templates.commission_reminder,
      {
        reminderDay: day,
        propertyName,
        propertyNumber: booking.propertyNumber,
        commissionAmountSar: formatSar(booking.commissionAmountHalalas),
        commissionDueAt: formatDate(booking.commissionDueAt),
        paymentLink,
      },
    );
  }

  if (job.kind === "property_paused") {
    const paymentLink = ownerPaymentLink(booking);
    return renderBookingWhatsAppTemplate(
      "property_paused",
      templates.property_paused,
      {
        propertyName,
        propertyNumber: booking.propertyNumber,
        commissionAmountSar: formatSar(booking.commissionAmountHalalas),
        paymentLink,
      },
    );
  }

  if (booking.commissionStatus === "waived") {
    return renderBookingWhatsAppTemplate(
      "property_released_waived",
      templates.property_released_waived,
      { propertyName, propertyNumber: booking.propertyNumber },
    );
  }

  return renderBookingWhatsAppTemplate(
    "property_released_paid",
    templates.property_released_paid,
    { propertyName, propertyNumber: booking.propertyNumber },
  );
}

async function dispatchClaim(
  job: ClaimedBookingNotification,
  shortLinkService?: Pick<
    BookingShortLinkService,
    "ensureCustomerResponseLink" | "ensureOwnerPaymentLink"
  >,
): Promise<boolean> {
  const prepared = await bookingCommissionStore.prepareNotificationForSend(
    job.id,
    job.leaseToken,
  );
  if (prepared.status === "blocked") {
    if (prepared.reason === "owner_identity_changed") {
      notificationService.sendAdmin(
        `توقفت رسالة الحجز ${job.bookingId} لأن هوية مالك العقار ${job.propertyNumber} تغيرت. يلزم مراجعة إدارية.`,
      ).catch((error) => console.error("Owner identity review alert failed:", error));
    }
    return false;
  }
  let message: string;
  try {
    const settings = await bookingCommissionStore.getFreeWorkflowSettings();
    const sendPrepared = await bookingCommissionStore.prepareNotificationForSend(
      job.id,
      job.leaseToken,
    );
    if (sendPrepared.status === "blocked") return false;
    const sendBooking = sendPrepared.booking;
    if (job.kind === "customer_followup") {
      const links = shortLinkService || getBookingShortLinkService();
      const token = bookingCommissionService.issueCustomerResponseToken(sendBooking);
      await links.ensureCustomerResponseLink({
        bookingId: sendBooking.id,
        token,
        expiresAt:
          Date.parse(sendBooking.createdAt) + BOOKING_CUSTOMER_TOKEN_MAX_AGE_MS,
      });
    } else if (notificationIncludesOwnerPaymentLink(job, sendBooking)) {
      const links = shortLinkService || getBookingShortLinkService();
      const token = bookingCommissionService.issueOwnerPaymentToken(sendBooking);
      await links.ensureOwnerPaymentLink({ token });
    }
    const finalPrepared = await bookingCommissionStore.prepareNotificationForSend(
      job.id,
      job.leaseToken,
    );
    if (finalPrepared.status === "blocked") return false;
    message = buildBookingNotificationMessage(
      job,
      finalPrepared.booking,
      settings.whatsappTemplates,
    );
  } catch (error) {
    await bookingCommissionStore.finishNotificationJob({
      jobId: job.id,
      leaseToken: job.leaseToken,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }

  const result = await sendOwnerWhatsApp(job.recipientPhone, message, 1);
  await bookingCommissionStore.finishNotificationJob({
    jobId: job.id,
    leaseToken: job.leaseToken,
    success: result.success,
    error: result.error,
  });
  return result.success;
}

export async function dispatchDueBookingNotifications(
  now = new Date(),
  options: {
    shortLinkService?: Pick<
      BookingShortLinkService,
      "ensureCustomerResponseLink" | "ensureOwnerPaymentLink"
    >;
  } = {},
): Promise<{ claimed: number; sent: number }> {
  await bookingCommissionStore.recoverExpiredNotificationClaims(now);
  let commissionNotificationsEnabled = false;
  let followUpNotificationsEnabled = false;
  try {
    followUpNotificationsEnabled =
      await bookingCommissionService.isFollowUpEnabled();
    commissionNotificationsEnabled =
      await bookingCommissionService.isCommissionEnforcementEnabled();
  } catch (error) {
    console.error("Booking commission flag lookup failed during dispatch:", error);
  }
  // Keep the batch small and concurrent. Link provisioning may outlive the
  // initial lease, so preparation renews it and the final gate revalidates the
  // same token immediately before the provider call. Transactional recovery
  // then prevents a stale worker from sending after another worker reclaimed
  // the job.
  const claims = await bookingCommissionStore.claimDueNotificationJobs(now, 5, {
    commissionNotificationsEnabled,
    followUpNotificationsEnabled,
  });
  const results = await Promise.all(claims.map(async (claim) => {
    try {
      return await dispatchClaim(claim, options.shortLinkService);
    } catch (error) {
      console.error(`Booking notification ${claim.id} failed:`, error);
      try {
        await bookingCommissionStore.finishNotificationJob({
          jobId: claim.id,
          leaseToken: claim.leaseToken,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      } catch (finishError) {
        console.error(`Booking notification ${claim.id} could not be finalized:`, finishError);
      }
      return false;
    }
  }));
  const sent = results.filter(Boolean).length;
  return { claimed: claims.length, sent };
}

async function providerAllowsEnforcement(
  booking: BookingFollowUpDocument,
  now: Date,
  enforcementLeaseToken: string,
): Promise<boolean> {
  if (!booking.activeAttemptId) return true;
  const attempt = await bookingCommissionStore.getPaymentAttempt(booking.activeAttemptId);
  if (!attempt || attempt.status === "failed") return true;
  if (attempt.status === "paid") return false;
  if (attempt.status === "creating" || attempt.status === "unknown") {
    if (await bookingCommissionStore.expireStaleUnreturnedPaymentAttempt(booking.id, now)) {
      return true;
    }
    await bookingCommissionStore.deferEnforcement(
      booking.id,
      "payment_attempt_identity_incomplete",
      new Date(now.getTime() + ENFORCEMENT_RETRY_MS),
      now,
      enforcementLeaseToken,
    );
    return false;
  }
  if (attempt.status !== "created" || !attempt.checkoutUrl || !attempt.paymobOrderId || !attempt.intentionId) {
    await bookingCommissionStore.deferEnforcement(
      booking.id,
      "payment_attempt_reconciliation_required",
      new Date(now.getTime() + ENFORCEMENT_RETRY_MS),
      now,
      enforcementLeaseToken,
    );
    return false;
  }

  const lookup = await paymobService.retrieveIntention(attempt.checkoutUrl);
  if (!lookup.ok) {
    await bookingCommissionStore.deferEnforcement(
      booking.id,
      `paymob_${lookup.reason}`,
      new Date(now.getTime() + ENFORCEMENT_RETRY_MS),
      now,
      enforcementLeaseToken,
    );
    notificationService.sendAdmin(
      `تعذر التحقق من حالة عمولة الحجز ${booking.id} قبل إيقاف العقار ${booking.propertyNumber}. تم تأجيل الإيقاف مؤقتاً.`,
    ).catch((error) => console.error("Commission enforcement admin alert failed:", error));
    return false;
  }

  const snapshot = lookup.snapshot;
  if (
    snapshot.intentionId !== attempt.intentionId ||
    snapshot.orderId !== attempt.paymobOrderId ||
    snapshot.specialReference !== attempt.merchantAttemptKey ||
    snapshot.amountCents !== attempt.amountCents ||
    snapshot.currency !== "SAR"
  ) {
    await bookingCommissionStore.deferEnforcement(
      booking.id,
      "paymob_identity_mismatch",
      new Date(now.getTime() + ENFORCEMENT_RETRY_MS),
      now,
      enforcementLeaseToken,
    );
    notificationService.sendAdmin(
      `ظهرت مطابقة غير متسقة لعمولة الحجز ${booking.id}. لم يتم إيقاف العقار ${booking.propertyNumber}.`,
    ).catch((error) => console.error("Commission identity alert failed:", error));
    return false;
  }

  if (!snapshot.paid) return true;
  const signed = snapshot.signedTransaction;
  const exactPaymentMethod = signed
    ? getExactPaymobPaymentMethod({
        cardSubType: signed.cardSubType,
        paymentMethod: signed.paymentMethod,
      })
    : null;
  if (
    !signed ||
    !exactPaymentMethod ||
    signed.orderId !== attempt.paymobOrderId ||
    signed.amountCents !== attempt.amountCents ||
    signed.currency !== "SAR"
  ) {
    await bookingCommissionStore.deferEnforcement(
      booking.id,
      "paymob_paid_without_exact_signed_transaction",
      new Date(now.getTime() + ENFORCEMENT_RETRY_MS),
      now,
      enforcementLeaseToken,
    );
    notificationService.sendAdmin(
      `Paymob يعرض عمولة الحجز ${booking.id} كمدفوعة لكن بيانات التسوية غير مكتملة. لم يتم إيقاف العقار ${booking.propertyNumber}.`,
    ).catch((error) => console.error("Commission settlement alert failed:", error));
    return false;
  }

  const settlement = await bookingCommissionStore.settleCommissionCallback({
    paymobOrderId: attempt.paymobOrderId,
    transactionId: signed.transactionId,
    amountCents: signed.amountCents,
    currency: signed.currency,
    success: true,
    exactPaymentMethod,
    providerCreatedAt: signed.createdAt,
    callbackAttemptId: attempt.id,
    callbackBookingId: booking.id,
    callbackMerchantAttemptKey: attempt.merchantAttemptKey,
    callbackSpecialReference: attempt.merchantAttemptKey,
  }, now);
  if (settlement.status === "rejected") {
    await bookingCommissionStore.deferEnforcement(
      booking.id,
      `paymob_settlement_${settlement.reason}`,
      new Date(now.getTime() + ENFORCEMENT_RETRY_MS),
      now,
      enforcementLeaseToken,
    );
    notificationService.sendAdmin(
      `تعذر اعتماد مطابقة عمولة الحجز ${booking.id} رغم ظهورها مدفوعة لدى Paymob. السبب: ${settlement.reason}.`,
    ).catch((error) =>
      console.error("Commission reconciliation rejection alert failed:", error));
  } else if (settlement.status === "duplicate_paid") {
    notificationService.sendAdmin(
      `تم رصد دفعة عمولة مكررة للحجز ${booking.id}. يلزم مراجعة الاسترداد يدوياً.`,
    ).catch((error) =>
      console.error("Duplicate commission reconciliation alert failed:", error));
  }
  return false;
}

export async function enforceOverdueBookingCommissions(
  now = new Date(),
): Promise<{ reviewed: number; paused: number }> {
  if (!await bookingCommissionService.isCommissionEnforcementEnabled()) {
    return { reviewed: 0, paused: 0 };
  }
  const candidates = await bookingCommissionStore.listCommissionEnforcementCandidates(now, 5);
  let reviewed = 0;
  let paused = 0;
  for (const booking of candidates) {
    if (!await bookingCommissionService.isCommissionEnforcementEnabled()) break;
    const claim = await bookingCommissionStore.claimCommissionEnforcement(
      booking.id,
      now,
    );
    if (!claim) continue;
    const { leaseToken, booking: claimedBooking } = claim;
    reviewed++;
    try {
      if (!await providerAllowsEnforcement(claimedBooking, now, leaseToken)) continue;
      if (!await bookingCommissionService.isCommissionEnforcementEnabled()) continue;
      const notice = await bookingCommissionStore.ensurePauseNotice(
        claimedBooking.id,
        now,
        leaseToken,
      );
      if (notice === "blocked") {
        await bookingCommissionStore.deferEnforcement(
          claimedBooking.id,
          "required_owner_notice_not_delivered",
          new Date(now.getTime() + ENFORCEMENT_RETRY_MS),
          now,
          leaseToken,
        );
        continue;
      }
      if (notice !== "ready") continue;
      if (!await bookingCommissionService.isCommissionEnforcementEnabled()) continue;
      const holdResult = await bookingCommissionStore.applyCommissionHold(
        claimedBooking.id,
        now,
        leaseToken,
        claimedBooking.activeAttemptId || null,
      );
      if (holdResult === "owner_identity_changed") {
        notificationService.sendAdmin(
          `لم يتم إيقاف العقار ${claimedBooking.propertyNumber} للحجز ${claimedBooking.id} لأن هوية المالك تغيرت. يلزم مراجعة إدارية.`,
        ).catch((error) => console.error("Owner identity hold alert failed:", error));
        continue;
      }
      if (
        holdResult === "paused"
      ) {
        paused++;
      }
    } catch (error) {
      console.error(`Commission enforcement failed for ${claimedBooking.id}:`, error);
    } finally {
      try {
        await bookingCommissionStore.releaseCommissionEnforcementClaim(
          claimedBooking.id,
          leaseToken,
        );
      } catch (releaseError) {
        console.error(`Commission enforcement lease release failed for ${claimedBooking.id}:`, releaseError);
      }
    }
  }
  return { reviewed, paused };
}

export async function runBookingCommissionWorker(now = new Date()) {
  await bookingCommissionStore.reconcilePausedFreeEligibility(now);
  const firstDispatch = await dispatchDueBookingNotifications(now);
  const firstEnforcement = await enforceOverdueBookingCommissions(now);
  const secondDispatch = await dispatchDueBookingNotifications(now);
  const secondEnforcement = await enforceOverdueBookingCommissions(now);
  return {
    notificationsClaimed: firstDispatch.claimed + secondDispatch.claimed,
    notificationsSent: firstDispatch.sent + secondDispatch.sent,
    enforcementReviewed: firstEnforcement.reviewed + secondEnforcement.reviewed,
    propertiesPaused: firstEnforcement.paused + secondEnforcement.paused,
  };
}

let workerStarted = false;
export const BOOKING_WORKER_INTERVAL_MS = 60 * 1_000;

/**
 * Best-effort in-process safety net. The authenticated worker endpoint is the
 * authoritative production trigger; Firestore leases make concurrent calls
 * from multiple instances safe.
 */
export function startBookingCommissionWorker(): void {
  if (workerStarted) return;
  workerStarted = true;
  setTimeout(() => {
    runBookingCommissionWorker().catch((error) =>
      console.error("Initial booking commission worker failed:", error));
  }, 15_000);
  setInterval(() => {
    runBookingCommissionWorker().catch((error) =>
      console.error("Scheduled booking commission worker failed:", error));
  }, BOOKING_WORKER_INTERVAL_MS);
}
