import { createHash } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { activeFirestore as db } from "../config/dataEnvironment";
import {
  whatsappProviderDeliveryEventKey,
  type WhatsAppDeliveryReceiptResult,
  type WhatsAppDeliveryReceiptTarget,
  type WhatsAppProviderDeliveryEvent,
} from "./WhatsAppDeliveryService";

const COLLECTION = "whatsapp_pending_delivery_receipts";
const RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
const MAX_EVENTS_PER_MESSAGE = 20;

type PendingDeliveryEvent = {
  key: string;
  event: WhatsAppProviderDeliveryEvent;
  receivedAt: string;
};

type PendingDeliveryDocument = {
  providerMessageId: string;
  events: PendingDeliveryEvent[];
  createdAt: string;
  updatedAt: string;
  expiresAtTtl: Date;
};

export type PendingDeliveryReconciliation = {
  key: string;
  outcome: WhatsAppDeliveryReceiptResult;
};

export interface WhatsAppPendingDeliveryStoreContract {
  enqueue(
    event: WhatsAppProviderDeliveryEvent,
    now?: Date,
  ): Promise<"stored" | "duplicate">;
  reconcile(
    providerMessageId: string,
    target: WhatsAppDeliveryReceiptTarget,
    now?: Date,
  ): Promise<PendingDeliveryReconciliation[]>;
}

function pendingDocumentId(providerMessageId: string): string {
  return createHash("sha256").update(providerMessageId).digest("hex");
}

function normalizedProviderMessageId(value: unknown): string {
  const providerMessageId = String(value || "").trim();
  return providerMessageId.length <= 512 ? providerMessageId : "";
}

function normalizedPendingEvents(
  value: unknown,
  providerMessageId: string,
): PendingDeliveryEvent[] {
  if (!Array.isArray(value)) return [];
  return value.filter((candidate): candidate is PendingDeliveryEvent => {
    if (!candidate || typeof candidate !== "object") return false;
    const pending = candidate as PendingDeliveryEvent;
    return typeof pending.key === "string"
      && pending.key.length === 64
      && typeof pending.receivedAt === "string"
      && Number.isFinite(Date.parse(pending.receivedAt))
      && Boolean(pending.event)
      && typeof pending.event === "object"
      && pending.event.providerMessageId === providerMessageId;
  }).slice(-MAX_EVENTS_PER_MESSAGE);
}

/**
 * Durable holding area for authenticated delivery receipts that beat the
 * outbound provider-message-id commit. One bounded document is retained per
 * provider message, and Firestore TTL removes receipts that never match.
 */
export class WhatsAppPendingDeliveryStore
implements WhatsAppPendingDeliveryStoreContract {
  constructor(
    private readonly database: Firestore | null = db,
    private readonly collectionName = COLLECTION,
  ) {}

  async enqueue(
    event: WhatsAppProviderDeliveryEvent,
    now = new Date(),
  ): Promise<"stored" | "duplicate"> {
    if (!this.database) throw new Error("Pending delivery storage is unavailable");
    if (!Number.isFinite(now.getTime())) throw new RangeError("Invalid receipt time");
    const providerMessageId = normalizedProviderMessageId(event.providerMessageId);
    if (!providerMessageId) throw new TypeError("Invalid provider message id");

    const key = whatsappProviderDeliveryEventKey(event);
    const reference = this.database
      .collection(this.collectionName)
      .doc(pendingDocumentId(providerMessageId));
    const timestamp = now.toISOString();

    return this.database.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const raw = snapshot.exists
        ? snapshot.data() as Partial<PendingDeliveryDocument>
        : undefined;
      const events = normalizedPendingEvents(raw?.events, providerMessageId);
      if (events.some((candidate) => candidate.key === key)) return "duplicate";

      const pendingEvent: PendingDeliveryEvent = {
        key,
        event,
        receivedAt: timestamp,
      };
      transaction.set(reference, {
        providerMessageId,
        events: [...events, pendingEvent].slice(-MAX_EVENTS_PER_MESSAGE),
        createdAt: typeof raw?.createdAt === "string" ? raw.createdAt : timestamp,
        updatedAt: timestamp,
        expiresAtTtl: new Date(now.getTime() + RETENTION_MS),
      });
      return "stored";
    });
  }

  async reconcile(
    providerMessageIdValue: string,
    target: WhatsAppDeliveryReceiptTarget,
    now = new Date(),
  ): Promise<PendingDeliveryReconciliation[]> {
    if (!this.database) throw new Error("Pending delivery storage is unavailable");
    if (!Number.isFinite(now.getTime())) throw new RangeError("Invalid receipt time");
    const providerMessageId = normalizedProviderMessageId(providerMessageIdValue);
    if (!providerMessageId) return [];

    const reference = this.database
      .collection(this.collectionName)
      .doc(pendingDocumentId(providerMessageId));
    const snapshot = await reference.get();
    if (!snapshot.exists) return [];
    const events = normalizedPendingEvents(
      (snapshot.data() as Partial<PendingDeliveryDocument> | undefined)?.events,
      providerMessageId,
    );
    if (events.length === 0) return [];

    const outcomes: PendingDeliveryReconciliation[] = [];
    const completedKeys = new Set<string>();
    for (const pending of events) {
      const outcome = await target.recordProviderDeliveryEvent(pending.event, now);
      outcomes.push({ key: pending.key, outcome });
      if (outcome.result !== "not_found" && outcome.result !== "conflict") {
        completedKeys.add(pending.key);
      }
    }

    if (completedKeys.size > 0) {
      await this.database.runTransaction(async (transaction) => {
        const currentSnapshot = await transaction.get(reference);
        if (!currentSnapshot.exists) return;
        const raw = currentSnapshot.data() as Partial<PendingDeliveryDocument>;
        const currentEvents = normalizedPendingEvents(raw.events, providerMessageId);
        const remainingEvents = currentEvents.filter(
          (pending) => !completedKeys.has(pending.key),
        );
        if (remainingEvents.length === 0) {
          transaction.delete(reference);
          return;
        }
        transaction.update(reference, {
          events: remainingEvents,
          updatedAt: now.toISOString(),
        });
      });
    }

    return outcomes;
  }
}

export const whatsAppPendingDeliveryStore = new WhatsAppPendingDeliveryStore();
