import { createHash, timingSafeEqual } from "node:crypto";
import {
  Router,
  type Request,
  type RequestHandler,
  type Response,
} from "express";
import { firebaseService } from "../firebaseService";
import { requireSameOrigin } from "./middleware";
import {
  BOOKING_CUSTOMER_SESSION_COOKIE,
  BOOKING_CUSTOMER_TOKEN_MAX_AGE_MS,
  bookingCheckoutSchema,
  bookingCommissionService,
  bookingDecisionSchema,
  bookingDisputeSchema,
  bookingRouteError,
} from "../services/BookingCommissionService";
import { runBookingCommissionWorker } from "../services/BookingNotificationWorker";
import {
  BookingShortLinkError,
  getBookingShortLinkService,
} from "../services/BookingShortLinkService";
import { BookingTokenError } from "../services/BookingTokenService";
import { parseBookingCommissionReceipt } from "../services/BookingCommissionReceiptService";

const router = Router();
const BOOKING_MUTATION_WINDOW_MS = 10 * 60 * 1000;
const BOOKING_MUTATION_MAX_ATTEMPTS = 30;

function setNoStore(res: Response): void {
  res.set("Cache-Control", "no-store, private");
}

function setShortLinkPrivacyHeaders(res: Response): void {
  setNoStore(res);
  res.set("Referrer-Policy", "no-referrer");
  res.set("X-Robots-Tag", "noindex, nofollow, noarchive");
  res.set("X-Content-Type-Options", "nosniff");
}

function customerSessionCookieOptions(maxAge = BOOKING_CUSTOMER_TOKEN_MAX_AGE_MS) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: Math.max(0, maxAge),
  };
}

function rememberVerifiedCustomerToken(res: Response, token: string, expiresAt: string): void {
  const maxAge = Math.min(
    BOOKING_CUSTOMER_TOKEN_MAX_AGE_MS,
    Math.max(0, Date.parse(expiresAt) - Date.now()),
  );
  res.cookie(
    BOOKING_CUSTOMER_SESSION_COOKIE,
    token,
    customerSessionCookieOptions(maxAge),
  );
}

async function enforceBookingMutationRateLimit(
  req: Request,
  res: Response,
): Promise<boolean> {
  const ip = String(req.ip || req.socket.remoteAddress || "unknown");
  const secret = process.env.SESSION_SECRET || "";
  const key = createHash("sha256")
    .update(`booking-mutation:${secret}:${ip}`)
    .digest("hex");
  const result = await firebaseService.consumeContactRequestAttemptLimit(
    key,
    Date.now(),
    BOOKING_MUTATION_WINDOW_MS,
    BOOKING_MUTATION_MAX_ATTEMPTS,
  );
  if (result.allowed) return true;
  const retryAfterSeconds = Math.ceil(result.retryAfterMs / 1000);
  res.set("Retry-After", String(retryAfterSeconds));
  res.status(429).json({
    code: "BOOKING_RATE_LIMIT",
    error: "تم إجراء محاولات كثيرة. حاول مرة أخرى لاحقاً.",
    retryAfterSeconds,
  });
  return false;
}

function respondWithBookingError(res: Response, error: unknown): void {
  const response = bookingRouteError(error);
  res.status(response.status).json(response.body);
}

export function createBookingShortLinkHandler(
  resolve: (code: string) => Promise<{ token: string; expiresAt: string }> =
    (code) => getBookingShortLinkService().resolveCustomerResponse(code),
): RequestHandler {
  return async (req, res) => {
    setShortLinkPrivacyHeaders(res);
    try {
      const resolved = await resolve(req.params.code);
      const verified = bookingCommissionService.verifyCustomerToken(resolved.token);
      if (verified.expiresAt !== resolved.expiresAt) {
        throw new BookingShortLinkError(
          "SHORT_LINK_INVALID",
          "Booking short-link expiry mismatch",
        );
      }
      return res.redirect(
        302,
        `/booking/${encodeURIComponent(resolved.token)}`,
      );
    } catch (error) {
      if (
        !(error instanceof BookingShortLinkError) &&
        !(error instanceof BookingTokenError)
      ) {
        console.error(
          "Booking short-link resolution failed:",
          error instanceof Error ? error.name : "UnknownError",
        );
      }
      const status = error instanceof BookingShortLinkError &&
          error.code === "SHORT_LINK_EXPIRED"
        ? 410
        : 404;
      return res.status(status).type("text/plain; charset=utf-8").send("الرابط غير متاح");
    }
  };
}

export function createOwnerPaymentShortLinkHandler(
  resolve: (code: string) => Promise<{ token: string; expiresAt: string }> =
    (code) => getBookingShortLinkService().resolveOwnerPayment(code),
): RequestHandler {
  return async (req, res) => {
    setShortLinkPrivacyHeaders(res);
    try {
      const resolved = await resolve(req.params.code);
      const verified = bookingCommissionService.verifyOwnerToken(resolved.token);
      if (verified.expiresAt !== resolved.expiresAt) {
        throw new BookingShortLinkError(
          "SHORT_LINK_INVALID",
          "Booking short-link expiry mismatch",
        );
      }
      return res.redirect(
        302,
        `/booking-commission/${encodeURIComponent(resolved.token)}`,
      );
    } catch (error) {
      if (
        !(error instanceof BookingShortLinkError) &&
        !(error instanceof BookingTokenError)
      ) {
        console.error(
          "Booking short-link resolution failed:",
          error instanceof Error ? error.name : "UnknownError",
        );
      }
      const status = error instanceof BookingShortLinkError &&
          error.code === "SHORT_LINK_EXPIRED"
        ? 410
        : 404;
      return res.status(status).type("text/plain; charset=utf-8").send("الرابط غير متاح");
    }
  };
}

router.get("/b/:code", createBookingShortLinkHandler());
router.get("/p/:code", createOwnerPaymentShortLinkHandler());

router.get("/api/booking-followups/:token", async (req, res) => {
  setNoStore(res);
  try {
    const verified = bookingCommissionService.verifyCustomerToken(req.params.token);
    const booking = await bookingCommissionService.getCustomerFollowUp(req.params.token);
    rememberVerifiedCustomerToken(res, req.params.token, verified.expiresAt);
    return res.json({ booking });
  } catch (error) {
    respondWithBookingError(res, error);
  }
});

router.post("/api/booking-followups/:token/decision", requireSameOrigin, async (req, res) => {
  setNoStore(res);
  try {
    if (!await enforceBookingMutationRateLimit(req, res)) return;
    const verified = bookingCommissionService.verifyCustomerToken(req.params.token);
    const input = bookingDecisionSchema.parse(req.body);
    const booking = await bookingCommissionService.submitDecision(
      req.params.token,
      input.booked,
    );
    rememberVerifiedCustomerToken(res, req.params.token, verified.expiresAt);
    return res.json({ booking });
  } catch (error) {
    respondWithBookingError(res, error);
  }
});

router.post("/api/booking-followups/:token/confirm", requireSameOrigin, async (req, res) => {
  setNoStore(res);
  try {
    if (!await enforceBookingMutationRateLimit(req, res)) return;
    const verified = bookingCommissionService.verifyCustomerToken(req.params.token);
    const booking = await bookingCommissionService.submitQuestionnaire(
      req.params.token,
      req.body,
    );
    rememberVerifiedCustomerToken(res, req.params.token, verified.expiresAt);
    setImmediate(() => {
      runBookingCommissionWorker().catch((error) =>
        console.error("Immediate booking worker failed:", error));
    });
    return res.json({ booking });
  } catch (error) {
    respondWithBookingError(res, error);
  }
});

router.get("/api/customer/bookings", async (req, res) => {
  setNoStore(res);
  if (req.session?.propertyNumber || req.session?.isAdmin) {
    res.clearCookie(BOOKING_CUSTOMER_SESSION_COOKIE, customerSessionCookieOptions(0));
    return res.status(401).json({
      code: "CUSTOMER_BOOKING_SESSION_REQUIRED",
      error: "افتح رابط المتابعة المرسل إلى واتساب لعرض الحجوزات",
    });
  }
  const token = String(req.cookies?.[BOOKING_CUSTOMER_SESSION_COOKIE] || "");
  if (!token) {
    return res.status(401).json({
      code: "CUSTOMER_BOOKING_SESSION_REQUIRED",
      error: "افتح رابط المتابعة المرسل إلى واتساب لعرض الحجوزات",
    });
  }
  try {
    const data = await bookingCommissionService.getCustomerBookingsFromSession(token);
    return res.json(data);
  } catch (error) {
    res.clearCookie(BOOKING_CUSTOMER_SESSION_COOKIE, customerSessionCookieOptions(0));
    respondWithBookingError(res, error);
  }
});

router.get("/api/booking-commissions/:token", async (req, res) => {
  setNoStore(res);
  try {
    const commission = await bookingCommissionService.getOwnerCommission(req.params.token);
    return res.json({ commission });
  } catch (error) {
    respondWithBookingError(res, error);
  }
});

router.post("/api/booking-commissions/:token/checkout", requireSameOrigin, async (req, res) => {
  setNoStore(res);
  try {
    if (!await enforceBookingMutationRateLimit(req, res)) return;
    bookingCheckoutSchema.parse(req.body);
    const result = await bookingCommissionService.createCheckout(req.params.token, req.body);
    return res.json(result);
  } catch (error) {
    respondWithBookingError(res, error);
  }
});

router.post(
  "/api/booking-commissions/:token/bank-transfer",
  requireSameOrigin,
  (req, res, next) => {
    setNoStore(res);
    enforceBookingMutationRateLimit(req, res)
      .then((allowed) => {
        if (allowed) next();
      })
      .catch((error) => respondWithBookingError(res, error));
  },
  parseBookingCommissionReceipt,
  async (req, res) => {
    try {
      const result = await bookingCommissionService.submitBankTransfer(
        req.params.token,
        req.file,
      );
      return res.json(result);
    } catch (error) {
      respondWithBookingError(res, error);
    }
  },
);

router.post("/api/booking-commissions/:token/dispute", requireSameOrigin, async (req, res) => {
  setNoStore(res);
  try {
    if (!await enforceBookingMutationRateLimit(req, res)) return;
    bookingDisputeSchema.parse(req.body);
    const result = await bookingCommissionService.disputeOwnerCommission(
      req.params.token,
      req.body,
    );
    return res.json(result);
  } catch (error) {
    respondWithBookingError(res, error);
  }
});

function hasValidWorkerSecret(req: Request): boolean {
  const expected = String(process.env.BOOKING_WORKER_SECRET || "");
  const suppliedHeader = String(req.headers.authorization || "");
  const supplied = suppliedHeader.startsWith("Bearer ")
    ? suppliedHeader.slice("Bearer ".length)
    : "";
  if (Buffer.byteLength(expected) < 32 || !supplied) return false;
  const expectedBuffer = Buffer.from(expected);
  const suppliedBuffer = Buffer.from(supplied);
  const comparable = suppliedBuffer.length === expectedBuffer.length
    ? suppliedBuffer
    : Buffer.alloc(expectedBuffer.length);
  return timingSafeEqual(expectedBuffer, comparable) &&
    suppliedBuffer.length === expectedBuffer.length;
}

router.post("/api/internal/booking-worker", async (req, res) => {
  setNoStore(res);
  if (!hasValidWorkerSecret(req)) {
    return res.status(401).json({ ok: false, error: "Unauthorized" });
  }
  try {
    const result = await runBookingCommissionWorker();
    return res.json({ ok: true, ...result });
  } catch (error) {
    console.error("Booking worker endpoint failed:", error);
    return res.status(500).json({ ok: false, error: "Worker failed" });
  }
});

export default router;
