import { createHash } from "node:crypto";
import type { CustomerAccount } from "../../shared/customer";
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

export interface AdminCustomerAccountRow {
  id: string;
  fullName: string;
  email: string | null;
  customerPhoneMasked: string | null;
  favoritePropertyNumbers: string[];
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string;
  contactCount: number;
  confirmedBookingCount: number;
  latestContactAt: string | null;
  contacts: AdminCustomerContactRow[];
}

export interface AdminCustomerAccountSummary {
  total: number;
  withProfile: number;
  favoriteProperties: number;
  verifiedContacts: number;
  confirmedBookings: number;
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

function adminCustomerAccountId(customerSubject: string): string {
  return `customer-${createHash("sha256")
    .update(`rwqan-admin-customer-v1:${customerSubject}`)
    .digest("hex")
    .slice(0, 24)}`;
}

function isConfirmedBookingStatus(value: unknown): boolean {
  const status = String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return ["confirmed", "completed", "reported", "booking_confirmed"].includes(status);
}

export function buildAdminCustomerAccounts(
  accounts: CustomerAccount[],
  requests: ContactRequest[],
  contacts: AdminCustomerContactRow[],
): AdminCustomerAccountRow[] {
  const contactsByRequestId = new Map(
    contacts.map((contact) => [contact.id, contact]),
  );
  const contactsBySubject = new Map<string, AdminCustomerContactRow[]>();

  for (const request of requests) {
    if (!request.customerSubject) continue;
    if (request.actorType && request.actorType !== "anonymous") continue;
    const contact = contactsByRequestId.get(request.id);
    if (!contact) continue;
    const subjectContacts = contactsBySubject.get(request.customerSubject) || [];
    subjectContacts.push(contact);
    contactsBySubject.set(request.customerSubject, subjectContacts);
  }

  return accounts.map((account) => {
    const accountContacts = [...(contactsBySubject.get(account.id) || [])]
      .sort((left, right) => {
        const rightAt = Date.parse(right.contactAt);
        const leftAt = Date.parse(left.contactAt);
        return (Number.isFinite(rightAt) ? rightAt : 0)
          - (Number.isFinite(leftAt) ? leftAt : 0);
      });
    return {
      id: adminCustomerAccountId(account.id),
      fullName: account.fullName,
      email: account.email,
      customerPhoneMasked: maskContactPhone(account.phone),
      favoritePropertyNumbers: [...account.favoritePropertyNumbers],
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
      lastLoginAt: account.lastLoginAt,
      contactCount: accountContacts.length,
      confirmedBookingCount: accountContacts.filter((contact) =>
        isConfirmedBookingStatus(contact.bookingStatus)).length,
      latestContactAt: accountContacts[0]?.contactAt || null,
      contacts: accountContacts,
    };
  }).sort((left, right) => {
    const rightAt = Date.parse(right.lastLoginAt);
    const leftAt = Date.parse(left.lastLoginAt);
    return (Number.isFinite(rightAt) ? rightAt : 0)
      - (Number.isFinite(leftAt) ? leftAt : 0);
  });
}

export function summarizeAdminCustomerAccounts(
  accounts: AdminCustomerAccountRow[],
): AdminCustomerAccountSummary {
  return {
    total: accounts.length,
    withProfile: accounts.filter((account) =>
      Boolean(account.fullName.trim() || account.email)).length,
    favoriteProperties: accounts.reduce(
      (total, account) => total + account.favoritePropertyNumbers.length,
      0,
    ),
    verifiedContacts: accounts.reduce(
      (total, account) => total + account.contactCount,
      0,
    ),
    confirmedBookings: accounts.reduce(
      (total, account) => total + account.confirmedBookingCount,
      0,
    ),
  };
}
