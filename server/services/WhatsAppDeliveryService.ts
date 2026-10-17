import { createHash } from "node:crypto";
import type { BookingNotificationProviderStatus } from "./BookingCommissionTypes";

export type WhatsAppProviderDeliveryEvent = {
  providerMessageId: string;
  status: BookingNotificationProviderStatus;
  occurredAt: string;
  eventId?: string;
  error?: string;
};

export type WhatsAppDeliveryReceiptResult = {
  result: "updated" | "duplicate" | "stale" | "not_found" | "conflict";
  jobId?: string;
  logId?: string;
};

export interface WhatsAppDeliveryReceiptTarget {
  recordProviderDeliveryEvent(
    event: WhatsAppProviderDeliveryEvent,
    now?: Date,
  ): Promise<WhatsAppDeliveryReceiptResult>;
}

const STATUS_ALIASES: Record<string, BookingNotificationProviderStatus> = {
  accepted: "accepted",
  queued: "accepted",
  submitted: "accepted",
  sent: "accepted",
  message_sent: "accepted",
  success: "accepted",
  delivered: "delivered",
  delivery: "delivered",
  message_delivered: "delivered",
  read: "read",
  seen: "read",
  message_read: "read",
  failed: "failed",
  failure: "failed",
  error: "failed",
  rejected: "failed",
  undelivered: "failed",
  message_failed: "failed",
  delivery_failed: "failed",
};

const MESSAGE_ID_KEYS = [
  "message_id",
  "messageId",
  "messageID",
  "whatsapp_message_id",
  "whatsappMessageId",
  "wamid",
  "message_uuid",
  "messageUuid",
  "msg_id",
  "msgId",
] as const;

const STATUS_KEYS = [
  "status",
  "state",
  "delivery_status",
  "deliveryStatus",
  "event_type",
  "eventType",
] as const;

const TIMESTAMP_KEYS = [
  "timestamp",
  "occurred_at",
  "occurredAt",
  "updated_at",
  "updatedAt",
  "created_at",
  "createdAt",
] as const;

const EVENT_ID_KEYS = [
  "event_id",
  "eventId",
  "webhook_id",
  "webhookId",
  "callback_id",
  "callbackId",
] as const;

function boundedString(value: unknown, maximumLength = 512): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim();
  return normalized && normalized.length <= maximumLength ? normalized : null;
}

function firstValue(
  record: Record<string, unknown>,
  keys: readonly string[],
): unknown {
  for (const key of keys) {
    if (record[key] !== undefined && record[key] !== null) return record[key];
  }
  return undefined;
}

function normalizeStatus(value: unknown): BookingNotificationProviderStatus | null {
  const candidate = boundedString(value, 64)?.toLowerCase()
    .replace(/[\s-]+/g, "_");
  if (!candidate) return null;
  return STATUS_ALIASES[candidate] || null;
}

function normalizeTimestamp(value: unknown, fallback: Date): string {
  let milliseconds: number;
  if (typeof value === "number" || (typeof value === "string" && /^\d+$/.test(value.trim()))) {
    const numeric = Number(value);
    milliseconds = numeric < 10_000_000_000 ? numeric * 1_000 : numeric;
  } else {
    milliseconds = Date.parse(String(value || ""));
  }
  const parsed = new Date(milliseconds);
  return Number.isFinite(milliseconds) && Number.isFinite(parsed.getTime())
    ? parsed.toISOString()
    : fallback.toISOString();
}

function messageIdFromRecord(record: Record<string, unknown>): string | null {
  const direct = boundedString(firstValue(record, MESSAGE_ID_KEYS));
  if (direct) return direct;
  const message = record.message;
  if (message && typeof message === "object" && !Array.isArray(message)) {
    const nested = message as Record<string, unknown>;
    const candidate = boundedString(firstValue(nested, [...MESSAGE_ID_KEYS, "id"]));
    if (candidate) return candidate;
  }
  for (const key of ["data", "result", "payload"]) {
    const envelope = record[key];
    if (!envelope || typeof envelope !== "object" || Array.isArray(envelope)) continue;
    const nested = envelope as Record<string, unknown>;
    const candidate = boundedString(firstValue(nested, [...MESSAGE_ID_KEYS, "id"]));
    if (candidate) return candidate;
  }
  return null;
}

function errorFromRecord(record: Record<string, unknown>): string | undefined {
  const errors = Array.isArray(record.errors) ? record.errors : [];
  const firstError = errors[0];
  if (firstError && typeof firstError === "object") {
    const errorRecord = firstError as Record<string, unknown>;
    const detail = errorRecord.error_data;
    const detailText = detail && typeof detail === "object"
      ? boundedString((detail as Record<string, unknown>).details, 500)
      : null;
    const text = detailText || boundedString(
      firstValue(errorRecord, ["message", "title", "reason", "code"]),
      500,
    );
    if (text) return text;
  }
  return boundedString(
    firstValue(record, ["error_message", "errorMessage", "reason", "error"]),
    500,
  ) || undefined;
}

function eventKey(event: WhatsAppProviderDeliveryEvent): string {
  return createHash("sha256").update([
    event.providerMessageId,
    event.status,
    event.occurredAt,
    event.eventId || "",
    event.error || "",
  ].join("\0")).digest("hex");
}

export function whatsappProviderDeliveryEventKey(
  event: WhatsAppProviderDeliveryEvent,
): string {
  return eventKey(event);
}

/**
 * Parses Meta Cloud API status callbacks and the compact status envelopes used
 * by Enjazatik-compatible relays. Unknown events are ignored rather than
 * guessed, so inbound-message webhooks cannot mutate delivery state.
 */
export function parseWhatsAppProviderDeliveryEvents(
  payload: unknown,
  receivedAt = new Date(),
): WhatsAppProviderDeliveryEvent[] {
  if (!Number.isFinite(receivedAt.getTime())) {
    throw new RangeError("Invalid webhook receipt time");
  }
  const parsed: WhatsAppProviderDeliveryEvent[] = [];
  const unique = new Set<string>();

  const add = (record: Record<string, unknown>, allowPlainId: boolean) => {
    const status = normalizeStatus(firstValue(record, STATUS_KEYS));
    if (!status) return;
    const providerMessageId = messageIdFromRecord(record) ||
      (allowPlainId ? boundedString(record.id) : null);
    if (!providerMessageId) return;
    const event: WhatsAppProviderDeliveryEvent = {
      providerMessageId,
      status,
      occurredAt: normalizeTimestamp(firstValue(record, TIMESTAMP_KEYS), receivedAt),
      ...(boundedString(firstValue(record, EVENT_ID_KEYS))
        ? { eventId: boundedString(firstValue(record, EVENT_ID_KEYS))! }
        : {}),
      ...(status === "failed" && errorFromRecord(record)
        ? { error: errorFromRecord(record) }
        : {}),
    };
    const key = eventKey(event);
    if (unique.has(key)) return;
    unique.add(key);
    parsed.push(event);
  };

  // Meta Cloud API wraps statuses under entry[].changes[].value.statuses[].
  const root = payload && typeof payload === "object"
    ? payload as Record<string, unknown>
    : null;
  if (root && Array.isArray(root.entry)) {
    for (const entry of root.entry) {
      if (!entry || typeof entry !== "object") continue;
      const changes = (entry as Record<string, unknown>).changes;
      if (!Array.isArray(changes)) continue;
      for (const change of changes) {
        if (!change || typeof change !== "object") continue;
        const value = (change as Record<string, unknown>).value;
        if (!value || typeof value !== "object") continue;
        const statuses = (value as Record<string, unknown>).statuses;
        if (!Array.isArray(statuses)) continue;
        for (const status of statuses) {
          if (status && typeof status === "object" && !Array.isArray(status)) {
            add(status as Record<string, unknown>, true);
          }
        }
      }
    }
  }

  const visited = new Set<object>();
  const visitRelayEnvelope = (value: unknown, depth: number) => {
    if (!value || typeof value !== "object" || depth > 7 || visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value)) {
      for (const item of value) visitRelayEnvelope(item, depth + 1);
      return;
    }
    const record = value as Record<string, unknown>;
    add(record, true);
    // Relay callbacks may wrap one or more compact status records in these
    // documented envelope fields. Do not recurse through arbitrary metadata:
    // an unrelated nested { id, status } must never mutate delivery state.
    for (const key of ["events", "statuses", "data", "result", "payload"]) {
      visitRelayEnvelope(record[key], depth + 1);
    }
  };
  visitRelayEnvelope(payload, 0);
  return parsed;
}
