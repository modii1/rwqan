import { randomUUID } from "node:crypto";
import { activeFirestore as db } from "../config/dataEnvironment";
import type { BookingNotificationProviderStatus } from "./BookingCommissionTypes";
import {
  whatsappProviderDeliveryEventKey,
  type WhatsAppProviderDeliveryEvent,
} from "./WhatsAppDeliveryService";

const WHATSAPP_LOGS_COLLECTION = "whatsapp_logs";
const PROVIDER_DELIVERY_STATUS_RANK: Record<
  BookingNotificationProviderStatus,
  number
> = {
  accepted: 1,
  failed: 2,
  delivered: 3,
  read: 4,
};

export type WhatsAppLogDeliveryResult = {
  result: "updated" | "duplicate" | "stale" | "not_found" | "conflict";
  logId?: string;
};

export type GeneralWhatsAppLogInput = {
  type: string;
  message: string;
  phone: string;
  status: "success" | "error" | "blocked";
  response?: string;
  createdAt?: string;
  propertyNumber?: string;
  propertyName?: string;
  ownerPhone?: string;
  providerMessageId?: string;
  providerStatus?: "accepted";
  source?: string;
};

type GeneralWhatsAppLogDocument = Omit<
  GeneralWhatsAppLogInput,
  "providerMessageId" | "providerStatus" | "createdAt"
> & {
  id: string;
  createdAt: string;
  updatedAt: string;
  providerMessageId: string | null;
  providerDeliveryStatus: BookingNotificationProviderStatus | null;
  providerAcceptedAt: string | null;
  providerDeliveredAt: string | null;
  providerReadAt: string | null;
  providerFailedAt: string | null;
  providerStatusUpdatedAt: string | null;
  providerDeliveryError: string | null;
  providerDeliveryEventKeys: string[];
};

function cleanProviderMessageId(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value).trim();
  return normalized && normalized.length <= 512 ? normalized : null;
}

export function buildGeneralWhatsAppLog(
  input: GeneralWhatsAppLogInput,
  now = new Date(),
): GeneralWhatsAppLogDocument {
  if (!Number.isFinite(now.getTime())) throw new RangeError("Invalid WhatsApp log time");
  const createdAt = Number.isFinite(Date.parse(String(input.createdAt || "")))
    ? new Date(String(input.createdAt)).toISOString()
    : now.toISOString();
  const providerMessageId = cleanProviderMessageId(input.providerMessageId);
  const accepted = input.status === "success" && input.providerStatus === "accepted";

  return {
    ...input,
    id: `WA-${now.getTime()}-${randomUUID()}`,
    createdAt,
    updatedAt: now.toISOString(),
    providerMessageId,
    providerDeliveryStatus: accepted ? "accepted" : null,
    providerAcceptedAt: accepted ? createdAt : null,
    providerDeliveredAt: null,
    providerReadAt: null,
    providerFailedAt: null,
    providerStatusUpdatedAt: accepted ? createdAt : null,
    providerDeliveryError: null,
    providerDeliveryEventKeys: [],
  };
}

export class WhatsAppLogDeliveryStore {
  constructor(private readonly database: FirebaseFirestore.Firestore | null = db) {}

  async recordProviderDeliveryEvent(
    event: WhatsAppProviderDeliveryEvent,
    now = new Date(),
  ): Promise<WhatsAppLogDeliveryResult> {
    if (!Number.isFinite(now.getTime())) throw new RangeError("Invalid delivery update time");
    const providerMessageId = cleanProviderMessageId(event.providerMessageId);
    if (!providerMessageId || !this.database) return { result: "not_found" };

    const candidates = await this.database.collection(WHATSAPP_LOGS_COLLECTION)
      .where("providerMessageId", "==", providerMessageId)
      .limit(2)
      .get();
    if (candidates.empty) return { result: "not_found" };
    if (candidates.size !== 1) return { result: "conflict" };

    const logRef = candidates.docs[0].ref;
    return this.database.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(logRef);
      if (!snapshot.exists) return { result: "not_found" } as const;
      const log = snapshot.data() as GeneralWhatsAppLogDocument;
      const logId = typeof log.id === "string" && log.id.trim()
        ? log.id
        : logRef.id;
      if (log.providerMessageId !== providerMessageId) {
        return { result: "not_found" } as const;
      }

      const key = whatsappProviderDeliveryEventKey(event);
      const priorKeys = Array.isArray(log.providerDeliveryEventKeys)
        ? log.providerDeliveryEventKeys.filter((value) => typeof value === "string")
        : [];
      if (priorKeys.includes(key) || log.providerDeliveryStatus === event.status) {
        return { result: "duplicate", logId } as const;
      }

      const currentRank = log.providerDeliveryStatus
        ? PROVIDER_DELIVERY_STATUS_RANK[log.providerDeliveryStatus]
        : 0;
      if (PROVIDER_DELIVERY_STATUS_RANK[event.status] < currentRank) {
        return { result: "stale", logId } as const;
      }

      const receivedAt = now.toISOString();
      const occurredAt = Number.isFinite(Date.parse(event.occurredAt))
        ? new Date(event.occurredAt).toISOString()
        : receivedAt;
      const timestampField = event.status === "accepted"
        ? { providerAcceptedAt: occurredAt }
        : event.status === "delivered"
          ? { providerDeliveredAt: occurredAt }
          : event.status === "read"
            ? { providerReadAt: occurredAt }
            : { providerFailedAt: occurredAt };

      transaction.update(logRef, {
        providerDeliveryStatus: event.status,
        providerStatusUpdatedAt: occurredAt,
        providerDeliveryError: event.status === "failed"
          ? String(event.error || "provider_failed").slice(0, 500)
          : null,
        providerDeliveryEventKeys: [...priorKeys.slice(-19), key],
        ...timestampField,
        updatedAt: receivedAt,
      });
      return { result: "updated", logId } as const;
    });
  }
}

export const whatsAppLogDeliveryStore = new WhatsAppLogDeliveryStore();
