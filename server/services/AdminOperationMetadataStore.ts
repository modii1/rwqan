import { createHash, randomUUID } from "node:crypto";
import type { Firestore } from "firebase-admin/firestore";
import { db } from "../config/firebase";
import type {
  AdminOperationAuditEntry,
  AdminOperationCategory,
  AdminOperationMetadata,
  AdminOperationNote,
  AdminOperationPriority,
  AdminOperationSnapshot,
  AdminOperationState,
} from "../../shared/adminOperations";

const COLLECTION = "admin_operation_metadata";
const MAX_NOTES = 50;
const MAX_AUDIT_ENTRIES = 100;
const AUDIT_ACTIONS = new Set<AdminOperationAuditEntry["action"]>([
  "assigned",
  "unassigned",
  "resolved",
  "reopened",
  "note_added",
]);
const OPERATION_CATEGORIES = new Set<AdminOperationCategory>([
  "property_approval",
  "whatsapp_failure",
  "bank_receipt",
  "dispute",
  "overdue_commission",
  "suspended_property",
  "expiring_subscription",
]);
const OPERATION_PRIORITIES = new Set<AdminOperationPriority>([
  "critical",
  "high",
  "medium",
]);

export const ADMIN_OPERATION_ID_MAX_LENGTH = 240;
export const ADMIN_OPERATION_ASSIGNEE_MAX_LENGTH = 80;
export const ADMIN_OPERATION_NOTE_MAX_LENGTH = 1_000;

export interface AdminOperationMetadataPatch {
  assignee?: string | null;
  state?: AdminOperationState;
  snapshot?: AdminOperationSnapshot;
}

export interface AdminOperationMetadataStoreContract {
  list(): Promise<AdminOperationMetadata[]>;
  update(
    operationId: string,
    patch: AdminOperationMetadataPatch,
    now?: Date,
  ): Promise<AdminOperationMetadata>;
  addNote(
    operationId: string,
    body: string,
    now?: Date,
    snapshot?: AdminOperationSnapshot,
  ): Promise<AdminOperationMetadata>;
}

export class AdminOperationMetadataValidationError extends Error {
  constructor(
    message: string,
    readonly code:
      | "INVALID_OPERATION_ID"
      | "INVALID_ASSIGNEE"
      | "INVALID_STATE"
      | "INVALID_PATCH"
      | "INVALID_NOTE",
  ) {
    super(message);
    this.name = "AdminOperationMetadataValidationError";
  }
}

export function adminOperationDocumentId(operationId: string): string {
  return createHash("sha256").update(operationId).digest("hex");
}

function validateOperationId(value: unknown): string {
  const operationId = typeof value === "string" ? value.trim() : "";
  if (!operationId || operationId.length > ADMIN_OPERATION_ID_MAX_LENGTH) {
    throw new AdminOperationMetadataValidationError(
      "معرف العملية غير صالح",
      "INVALID_OPERATION_ID",
    );
  }
  return operationId;
}

function validateAssignee(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new AdminOperationMetadataValidationError(
      "اسم المسؤول غير صالح",
      "INVALID_ASSIGNEE",
    );
  }
  const assignee = value.trim();
  if (!assignee) return null;
  if (assignee.length > ADMIN_OPERATION_ASSIGNEE_MAX_LENGTH) {
    throw new AdminOperationMetadataValidationError(
      "اسم المسؤول طويل جداً",
      "INVALID_ASSIGNEE",
    );
  }
  return assignee;
}

function validateState(value: unknown): AdminOperationState {
  if (value !== "open" && value !== "resolved") {
    throw new AdminOperationMetadataValidationError(
      "حالة العملية غير صالحة",
      "INVALID_STATE",
    );
  }
  return value;
}

function validateNote(value: unknown): string {
  const body = typeof value === "string" ? value.trim() : "";
  if (!body || body.length > ADMIN_OPERATION_NOTE_MAX_LENGTH) {
    throw new AdminOperationMetadataValidationError(
      "الملاحظة مطلوبة ويجب ألا تتجاوز 1000 حرف",
      "INVALID_NOTE",
    );
  }
  return body;
}

function boundedSnapshotString(
  value: unknown,
  maximumLength: number,
  required = true,
): string | null {
  if (value === null || value === undefined) return required ? null : null;
  if (typeof value !== "string") return null;
  const result = value.trim();
  if ((required && !result) || result.length > maximumLength) return null;
  return result;
}

function validateSnapshot(value: unknown): AdminOperationSnapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AdminOperationMetadataValidationError(
      "بيانات العملية غير صالحة",
      "INVALID_PATCH",
    );
  }
  const raw = value as Record<string, unknown>;
  const category = raw.category as AdminOperationCategory;
  const priority = raw.priority as AdminOperationPriority;
  const title = boundedSnapshotString(raw.title, 200);
  const description = boundedSnapshotString(raw.description, 500);
  const reference = boundedSnapshotString(raw.reference, 240);
  const statusLabel = boundedSnapshotString(raw.statusLabel, 160);
  const actionLabel = boundedSnapshotString(raw.actionLabel, 120);
  const href = boundedSnapshotString(raw.href, 500);
  const occurredAt = raw.occurredAt === null || raw.occurredAt === undefined
    ? null
    : isIsoDate(raw.occurredAt) ? raw.occurredAt : null;
  const propertyNumber = boundedSnapshotString(raw.propertyNumber, 100, false);
  const propertyName = boundedSnapshotString(raw.propertyName, 200, false);
  if (
    !OPERATION_CATEGORIES.has(category)
    || !OPERATION_PRIORITIES.has(priority)
    || !title
    || !description
    || !reference
    || !statusLabel
    || !actionLabel
    || !href
    || !href.startsWith("/admin")
    || (raw.occurredAt !== null && raw.occurredAt !== undefined && !occurredAt)
    || (raw.propertyNumber !== null && raw.propertyNumber !== undefined && !propertyNumber)
    || (raw.propertyName !== null && raw.propertyName !== undefined && !propertyName)
  ) {
    throw new AdminOperationMetadataValidationError(
      "بيانات العملية غير صالحة",
      "INVALID_PATCH",
    );
  }
  return {
    category,
    priority,
    title,
    description,
    reference,
    propertyNumber,
    propertyName,
    occurredAt,
    statusLabel,
    href,
    actionLabel,
  };
}

function normalizeSnapshot(value: unknown): AdminOperationSnapshot | undefined {
  try {
    return validateSnapshot(value);
  } catch {
    return undefined;
  }
}

function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(new Date(value).getTime());
}

function normalizeMetadata(
  operationId: string,
  raw: Record<string, unknown> | undefined,
  fallbackNow: string,
): AdminOperationMetadata {
  const rawState = raw?.state;
  const state: AdminOperationState = rawState === "resolved" ? "resolved" : "open";
  const assignee = typeof raw?.assignee === "string"
    ? raw.assignee.trim().slice(0, ADMIN_OPERATION_ASSIGNEE_MAX_LENGTH) || null
    : null;
  const notes = Array.isArray(raw?.notes)
    ? raw.notes.filter((note): note is AdminOperationNote => Boolean(
      note
      && typeof note === "object"
      && typeof (note as AdminOperationNote).id === "string"
      && typeof (note as AdminOperationNote).body === "string"
      && (note as AdminOperationNote).body.length <= ADMIN_OPERATION_NOTE_MAX_LENGTH
      && (note as AdminOperationNote).actor === "admin"
      && isIsoDate((note as AdminOperationNote).createdAt),
    )).slice(-MAX_NOTES)
    : [];
  const audit = Array.isArray(raw?.audit)
    ? raw.audit.filter((entry): entry is AdminOperationAuditEntry => Boolean(
      entry
      && typeof entry === "object"
      && typeof (entry as AdminOperationAuditEntry).id === "string"
      && AUDIT_ACTIONS.has((entry as AdminOperationAuditEntry).action)
      && (entry as AdminOperationAuditEntry).actor === "admin"
      && isIsoDate((entry as AdminOperationAuditEntry).at),
    )).slice(-MAX_AUDIT_ENTRIES)
    : [];

  const operationSnapshot = normalizeSnapshot(raw?.snapshot);
  return {
    operationId,
    state,
    assignee,
    createdAt: isIsoDate(raw?.createdAt) ? raw.createdAt : fallbackNow,
    updatedAt: isIsoDate(raw?.updatedAt) ? raw.updatedAt : fallbackNow,
    resolvedAt: state === "resolved" && isIsoDate(raw?.resolvedAt)
      ? raw.resolvedAt
      : null,
    resolvedBy: state === "resolved" && raw?.resolvedBy === "admin"
      ? "admin"
      : null,
    notes,
    audit,
    ...(operationSnapshot
      ? { snapshot: operationSnapshot }
      : {}),
  };
}

function appendAudit(
  current: AdminOperationAuditEntry[],
  entries: AdminOperationAuditEntry[],
): AdminOperationAuditEntry[] {
  return [...current, ...entries].slice(-MAX_AUDIT_ENTRIES);
}

export class AdminOperationMetadataStore
implements AdminOperationMetadataStoreContract {
  constructor(
    private readonly database: Firestore,
    private readonly collectionName = COLLECTION,
  ) {}

  async list(): Promise<AdminOperationMetadata[]> {
    const snapshot = await this.database.collection(this.collectionName).get();
    const now = new Date().toISOString();
    return snapshot.docs
      .map((document) => {
        const raw = document.data() as Record<string, unknown>;
        const operationId = typeof raw.operationId === "string"
          ? raw.operationId
          : "";
        if (!operationId) return null;
        return normalizeMetadata(operationId, raw, now);
      })
      .filter((value): value is AdminOperationMetadata => Boolean(value));
  }

  async update(
    operationIdValue: string,
    patch: AdminOperationMetadataPatch,
    now = new Date(),
  ): Promise<AdminOperationMetadata> {
    const operationId = validateOperationId(operationIdValue);
    if (patch.assignee === undefined && patch.state === undefined) {
      throw new AdminOperationMetadataValidationError(
        "لا يوجد تغيير للحفظ",
        "INVALID_PATCH",
      );
    }
    const assignee = patch.assignee === undefined
      ? undefined
      : validateAssignee(patch.assignee);
    const state = patch.state === undefined ? undefined : validateState(patch.state);
    const operationSnapshot = patch.snapshot === undefined
      ? undefined
      : validateSnapshot(patch.snapshot);
    const at = now.toISOString();
    const reference = this.database
      .collection(this.collectionName)
      .doc(adminOperationDocumentId(operationId));

    return this.database.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const current = normalizeMetadata(
        operationId,
        snapshot.exists
          ? snapshot.data() as Record<string, unknown>
          : undefined,
        at,
      );
      const next: AdminOperationMetadata = { ...current };
      const auditEntries: AdminOperationAuditEntry[] = [];

      const occurrenceAt = Date.parse(operationSnapshot?.occurredAt || "");
      const resolvedAt = Date.parse(current.resolvedAt || "");
      if (
        current.state === "resolved"
        && Number.isFinite(occurrenceAt)
        && Number.isFinite(resolvedAt)
        && occurrenceAt > resolvedAt
      ) {
        next.state = "open";
        next.resolvedAt = null;
        next.resolvedBy = null;
        auditEntries.push({
          id: randomUUID(),
          action: "reopened",
          actor: "admin",
          at,
        });
      }

      if (operationSnapshot !== undefined) next.snapshot = operationSnapshot;

      if (assignee !== undefined && assignee !== current.assignee) {
        next.assignee = assignee;
        auditEntries.push({
          id: randomUUID(),
          action: assignee ? "assigned" : "unassigned",
          actor: "admin",
          at,
          assignee,
        });
      }

      if (state !== undefined && state !== next.state) {
        next.state = state;
        next.resolvedAt = state === "resolved" ? at : null;
        next.resolvedBy = state === "resolved" ? "admin" : null;
        auditEntries.push({
          id: randomUUID(),
          action: state === "resolved" ? "resolved" : "reopened",
          actor: "admin",
          at,
        });
      }

      if (auditEntries.length > 0 || !snapshot.exists || patch.snapshot !== undefined) {
        next.updatedAt = at;
        next.audit = appendAudit(current.audit, auditEntries);
        transaction.set(reference, next);
      }
      return next;
    });
  }

  async addNote(
    operationIdValue: string,
    bodyValue: string,
    now = new Date(),
    snapshotValue?: AdminOperationSnapshot,
  ): Promise<AdminOperationMetadata> {
    const operationId = validateOperationId(operationIdValue);
    const body = validateNote(bodyValue);
    const operationSnapshot = snapshotValue === undefined
      ? undefined
      : validateSnapshot(snapshotValue);
    const at = now.toISOString();
    const reference = this.database
      .collection(this.collectionName)
      .doc(adminOperationDocumentId(operationId));

    return this.database.runTransaction(async (transaction) => {
      const snapshot = await transaction.get(reference);
      const current = normalizeMetadata(
        operationId,
        snapshot.exists
          ? snapshot.data() as Record<string, unknown>
          : undefined,
        at,
      );
      const occurrenceAt = Date.parse(operationSnapshot?.occurredAt || "");
      const resolvedAt = Date.parse(current.resolvedAt || "");
      const reopened = current.state === "resolved"
        && Number.isFinite(occurrenceAt)
        && Number.isFinite(resolvedAt)
        && occurrenceAt > resolvedAt;
      const note: AdminOperationNote = {
        id: randomUUID(),
        body,
        actor: "admin",
        createdAt: at,
      };
      const auditEntry: AdminOperationAuditEntry = {
        id: randomUUID(),
        action: "note_added",
        actor: "admin",
        at,
        noteId: note.id,
      };
      const reopenedAudit: AdminOperationAuditEntry[] = reopened
        ? [{
            id: randomUUID(),
            action: "reopened",
            actor: "admin",
            at,
          }]
        : [];
      const next: AdminOperationMetadata = {
        ...current,
        ...(reopened
          ? { state: "open", resolvedAt: null, resolvedBy: null }
          : {}),
        ...(operationSnapshot ? { snapshot: operationSnapshot } : {}),
        updatedAt: at,
        notes: [...current.notes, note].slice(-MAX_NOTES),
        audit: appendAudit(current.audit, [...reopenedAudit, auditEntry]),
      };
      transaction.set(reference, next);
      return next;
    });
  }
}

class UnavailableAdminOperationMetadataStore
implements AdminOperationMetadataStoreContract {
  private unavailable(): never {
    throw new Error("Admin operation metadata storage is unavailable");
  }

  async list(): Promise<AdminOperationMetadata[]> {
    return this.unavailable();
  }

  async update(): Promise<AdminOperationMetadata> {
    return this.unavailable();
  }

  async addNote(): Promise<AdminOperationMetadata> {
    return this.unavailable();
  }
}

export const adminOperationMetadataStore: AdminOperationMetadataStoreContract = db
  ? new AdminOperationMetadataStore(db)
  : new UnavailableAdminOperationMetadataStore();
