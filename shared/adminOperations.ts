export type AdminOperationState = "open" | "resolved";

export type AdminOperationCategory =
  | "property_approval"
  | "whatsapp_failure"
  | "bank_receipt"
  | "dispute"
  | "overdue_commission"
  | "suspended_property"
  | "expiring_subscription";

export type AdminOperationPriority = "critical" | "high" | "medium";

/**
 * Bounded, non-sensitive presentation data retained when an operation is
 * managed. This keeps completed work visible after the source record no
 * longer belongs in an active queue.
 */
export interface AdminOperationSnapshot {
  category: AdminOperationCategory;
  priority: AdminOperationPriority;
  title: string;
  description: string;
  reference: string;
  propertyNumber?: string | null;
  propertyName?: string | null;
  occurredAt?: string | null;
  statusLabel: string;
  href: string;
  actionLabel: string;
}

export type AdminOperationAuditAction =
  | "assigned"
  | "unassigned"
  | "resolved"
  | "reopened"
  | "note_added";

export interface AdminOperationNote {
  id: string;
  body: string;
  actor: "admin";
  createdAt: string;
}

export interface AdminOperationAuditEntry {
  id: string;
  action: AdminOperationAuditAction;
  actor: "admin";
  at: string;
  assignee?: string | null;
  noteId?: string;
}

export interface AdminOperationMetadata {
  operationId: string;
  state: AdminOperationState;
  assignee: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  resolvedBy: "admin" | null;
  notes: AdminOperationNote[];
  audit: AdminOperationAuditEntry[];
  snapshot?: AdminOperationSnapshot | null;
}

export interface AdminOperationMetadataListResponse {
  metadata: AdminOperationMetadata[];
}

export interface AdminOperationMetadataResponse {
  metadata: AdminOperationMetadata;
}
