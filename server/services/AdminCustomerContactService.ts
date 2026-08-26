import type { Property, Request as ContactRequest } from "../../shared/schema";
import { maskContactPhone } from "./ContactIdentityService";

export interface AdminCustomerWorkflowSource {
  id: string;
  contactRequestId: string;
  bookingStatus?: string | null;
  customerPhoneMasked?: string | null;
  customerWhatsAppNextAllowedAt?: string | null;
  adminCustomerWhatsAppTemplateVariants?: string[];
  isFreeProperty?: boolean;
}

export interface AdminCustomerContactRow {
  id: string;
  bookingWorkflowId: string | null;
  propertyNumber: string;
  propertyName: string | null;
  requestCode: string;
  contactAt: string;
  customerPhoneMasked: string | null;
  bookingStatus: string;
  customerWhatsAppNextAllowedAt: string | null;
  adminCustomerWhatsAppTemplateVariants: string[];
  isFreeProperty: boolean | null;
}

function normalizedContactAt(value: unknown): string {
  const raw = String(value || "").trim();
  const epoch = Number(raw);
  const date = raw && Number.isFinite(epoch)
    ? new Date(epoch)
    : new Date(raw);
  return Number.isFinite(date.getTime()) ? date.toISOString() : raw;
}

export function buildAdminCustomerContacts(
  requests: ContactRequest[],
  properties: Array<Pick<Property, "propertyNumber" | "name">>,
  workflows: AdminCustomerWorkflowSource[],
): AdminCustomerContactRow[] {
  const propertyNames = new Map(
    properties.map((property) => [property.propertyNumber, property.name || null]),
  );
  const workflowByContactRequest = new Map(
    workflows
      .filter((workflow) => Boolean(workflow.contactRequestId))
      .map((workflow) => [workflow.contactRequestId, workflow]),
  );

  return requests.map((request) => {
    const workflow = workflowByContactRequest.get(request.id);
    return {
      id: request.id,
      bookingWorkflowId: workflow?.id || null,
      propertyNumber: request.propertyNumber,
      propertyName: propertyNames.get(request.propertyNumber) || null,
      requestCode: request.requestCode,
      contactAt: normalizedContactAt(request.timestamp),
      customerPhoneMasked:
        maskContactPhone(request.clientPhone) ||
        workflow?.customerPhoneMasked ||
        null,
      bookingStatus: String(workflow?.bookingStatus || "contact_only"),
      customerWhatsAppNextAllowedAt:
        workflow?.customerWhatsAppNextAllowedAt || null,
      adminCustomerWhatsAppTemplateVariants:
        workflow?.adminCustomerWhatsAppTemplateVariants || [],
      isFreeProperty:
        typeof workflow?.isFreeProperty === "boolean"
          ? workflow.isFreeProperty
          : null,
    };
  }).sort((left, right) => {
    const rightAt = Date.parse(right.contactAt);
    const leftAt = Date.parse(left.contactAt);
    return (Number.isFinite(rightAt) ? rightAt : 0)
      - (Number.isFinite(leftAt) ? leftAt : 0);
  });
}
