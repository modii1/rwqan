import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { whatsappDeliveryWebhookEnabled } from "../config/runtimeEnvironment";
import { bookingCommissionStore } from "../services/BookingCommissionStore";
import {
  parseWhatsAppProviderDeliveryEvents,
  whatsappProviderDeliveryEventKey,
  type WhatsAppDeliveryReceiptTarget,
} from "../services/WhatsAppDeliveryService";
import {
  whatsAppLogDeliveryStore,
} from "../services/WhatsAppLogDeliveryStore";
import {
  whatsAppPendingDeliveryStore,
  type WhatsAppPendingDeliveryStoreContract,
} from "../services/WhatsAppPendingDeliveryStore";

const WHATSAPP_DELIVERY_WEBHOOK_PATH = "/api/webhooks/whatsapp/delivery";

type RequestWithRawBody = Request & {
  rawBody?: Buffer;
};

export interface WhatsAppDeliveryReceiptStore
extends WhatsAppDeliveryReceiptTarget {}

export function createRoutingWhatsAppDeliveryReceiptStore(options: {
  bookingStore: WhatsAppDeliveryReceiptStore;
  generalLogStore: WhatsAppDeliveryReceiptStore;
}): WhatsAppDeliveryReceiptStore {
  return {
    async recordProviderDeliveryEvent(event, now) {
      const bookingResult = await options.bookingStore
        .recordProviderDeliveryEvent(event, now);
      if (bookingResult.result !== "not_found") return bookingResult;
      return options.generalLogStore.recordProviderDeliveryEvent(event, now);
    },
  };
}

function authenticatedSecret(headerValue: string | undefined): string {
  if (!headerValue) return "";
  const match = /^Bearer\s+(.+)$/i.exec(headerValue.trim());
  return match?.[1]?.trim() || "";
}

function secretsEqual(received: string, expected: string): boolean {
  if (!received || !expected) return false;
  const receivedDigest = createHash("sha256").update(received).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(receivedDigest, expectedDigest);
}

/**
 * Meta signs the exact request bytes. Capture those bytes while Express parses
 * JSON; re-serializing req.body would not be signature-safe because whitespace
 * and key ordering are part of the signed payload.
 */
export function captureWhatsAppWebhookRawBody(
  request: Request,
  _response: Response,
  body: Buffer,
): void {
  const requestPath = String(request.originalUrl || request.url || "")
    .split("?", 1)[0];
  if (requestPath === WHATSAPP_DELIVERY_WEBHOOK_PATH) {
    (request as RequestWithRawBody).rawBody = Buffer.from(body);
  }
}

function validMetaSignature(options: {
  signature: string;
  rawBody: Buffer | undefined;
  appSecret: string;
}): boolean {
  const match = /^sha256=([a-f\d]{64})$/i.exec(options.signature.trim());
  if (!match || !options.rawBody || !options.appSecret) return false;

  const received = Buffer.from(match[1], "hex");
  const expected = createHmac("sha256", options.appSecret)
    .update(options.rawBody)
    .digest();
  return received.length === expected.length && timingSafeEqual(received, expected);
}

function queryText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function createWhatsAppDeliveryWebhookRouter(options: {
  secret?: string;
  metaAppSecret?: string;
  metaVerifyToken?: string;
  store?: WhatsAppDeliveryReceiptStore;
  pendingStore?: WhatsAppPendingDeliveryStoreContract;
  now?: () => Date;
  /**
   * When false the endpoint is closed: both GET (verification) and POST
   * (delivery receipts) return 404 and never touch the receipt stores. Only
   * the isolated test backend disables it; production keeps it enabled.
   */
  enabled?: boolean;
} = {}): Router {
  const router = Router();
  if (options.enabled === false) {
    router.all(WHATSAPP_DELIVERY_WEBHOOK_PATH, (_req, res) => {
      res.status(404).json({ ok: false, error: "Not found" });
    });
    return router;
  }
  const store = options.store || createRoutingWhatsAppDeliveryReceiptStore({
    bookingStore: bookingCommissionStore,
    generalLogStore: whatsAppLogDeliveryStore,
  });
  const pendingStore = options.pendingStore || whatsAppPendingDeliveryStore;
  const explicitSecret = options.secret;
  const explicitMetaAppSecret = options.metaAppSecret;
  const explicitMetaVerifyToken = options.metaVerifyToken;
  const now = options.now || (() => new Date());

  router.get(WHATSAPP_DELIVERY_WEBHOOK_PATH, (req, res) => {
    const configuredVerifyToken = String(
      explicitMetaVerifyToken ??
      process.env.META_WHATSAPP_WEBHOOK_VERIFY_TOKEN ??
      "",
    ).trim();
    if (Buffer.byteLength(configuredVerifyToken, "utf8") < 32) {
      return res.status(503).json({ ok: false, error: "Webhook not configured" });
    }

    const mode = queryText(req.query["hub.mode"]);
    const verifyToken = queryText(req.query["hub.verify_token"]);
    const challenge = typeof req.query["hub.challenge"] === "string"
      ? req.query["hub.challenge"]
      : "";
    if (
      mode !== "subscribe" ||
      !challenge ||
      !secretsEqual(verifyToken, configuredVerifyToken)
    ) {
      return res.status(403).json({ ok: false, error: "Verification failed" });
    }

    return res.status(200).type("text/plain").send(challenge);
  });

  router.post(WHATSAPP_DELIVERY_WEBHOOK_PATH, async (req, res) => {
    const configuredSecret = String(
      explicitSecret ?? process.env.WHATSAPP_DELIVERY_WEBHOOK_SECRET ?? "",
    ).trim();
    const configuredMetaAppSecret = String(
      explicitMetaAppSecret ?? process.env.META_WHATSAPP_APP_SECRET ?? "",
    ).trim();
    const relayAuthenticationConfigured =
      Buffer.byteLength(configuredSecret, "utf8") >= 32;
    const metaAuthenticationConfigured =
      Buffer.byteLength(configuredMetaAppSecret, "utf8") >= 32;
    if (!relayAuthenticationConfigured && !metaAuthenticationConfigured) {
      return res.status(503).json({ ok: false, error: "Webhook not configured" });
    }

    const presentedSecrets = [
      authenticatedSecret(req.get("authorization")),
      req.get("x-rwqan-whatsapp-webhook-secret")?.trim() || "",
      req.get("x-webhook-secret")?.trim() || "",
      req.get("x-api-key")?.trim() || "",
    ];
    const relayAuthenticated = relayAuthenticationConfigured &&
      presentedSecrets.some((value) => secretsEqual(value, configuredSecret));
    const metaSignature = req.get("x-hub-signature-256")?.trim() || "";
    const rawBody = (req as RequestWithRawBody).rawBody;
    const metaAuthenticated = metaAuthenticationConfigured && validMetaSignature({
      signature: metaSignature,
      rawBody,
      appSecret: configuredMetaAppSecret,
    });
    if (!relayAuthenticated && !metaAuthenticated) {
      if (metaSignature && metaAuthenticationConfigured && !rawBody) {
        res.set("Retry-After", "2");
        return res.status(500).json({
          ok: false,
          error: "Webhook body verification unavailable",
        });
      }
      return res.status(401).json({ ok: false, error: "Unauthorized" });
    }

    try {
      const receivedAt = now();
      const events = parseWhatsAppProviderDeliveryEvents(req.body, receivedAt);
      const summary = {
        updated: 0,
        duplicate: 0,
        stale: 0,
        not_found: 0,
        conflict: 0,
        queued: 0,
      };
      if (events.length === 0) {
        // Meta sends inbound message notifications to the same subscribed
        // callback. They are authenticated but are not delivery receipts, so
        // acknowledge them to prevent retries without mutating delivery state.
        if (metaAuthenticated) {
          return res.status(200).json({
            ok: true,
            retryable: false,
            received: 0,
            ...summary,
          });
        }
        return res.status(400).json({ ok: false, error: "No delivery events found" });
      }
      if (events.length > 500) {
        return res.status(413).json({ ok: false, error: "Too many delivery events" });
      }

      for (const event of events) {
        let outcome = await store.recordProviderDeliveryEvent(event, receivedAt);
        if (outcome.result === "not_found") {
          await pendingStore.enqueue(event, receivedAt);
          const eventKey = whatsappProviderDeliveryEventKey(event);
          const reconciled = await pendingStore.reconcile(
            event.providerMessageId,
            store,
            receivedAt,
          );
          const replayed = reconciled.find((candidate) => candidate.key === eventKey);
          outcome = replayed?.outcome ||
            await store.recordProviderDeliveryEvent(event, receivedAt);
          if (outcome.result === "not_found" || outcome.result === "conflict") {
            summary.queued++;
          }
        }
        summary[outcome.result]++;
      }
      // An authenticated receipt can beat the outbound provider-id commit.
      // Persisting it before acknowledgment closes that race even when a
      // provider does not retry successful callback responses.
      return res.status(summary.queued > 0 ? 202 : 200).json({
        ok: true,
        retryable: false,
        received: events.length,
        ...summary,
      });
    } catch (error) {
      console.error("WhatsApp delivery webhook processing failed:", error);
      return res.status(500).json({ ok: false, error: "Delivery update failed" });
    }
  });

  return router;
}

export default createWhatsAppDeliveryWebhookRouter({
  enabled: whatsappDeliveryWebhookEnabled(),
});
