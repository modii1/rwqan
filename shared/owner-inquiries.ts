import type {
  BookingCalendar,
  BookingDatePrecision,
  BookingTiming,
  ComplianceStatus,
} from "./booking";

export type OwnerInquiryBookingStatus =
  | "contact_only"
  | "awaiting_response"
  | "expired"
  | "declined"
  | "confirmed";

export type OwnerInquiryCommissionStatus =
  | "not_applicable"
  | "pending"
  | "paid"
  | "overdue"
  | "waived";

export type OwnerInquiryRow = {
  id: string;
  contactRequestId: string | null;
  canDelete: boolean;
  requestCode: string;
  propertyNumber: string;
  propertyName: string | null;
  contactedAt: string;
  /** Backward-compatible alias used by existing owner analytics. */
  timestamp: string;
  clientPhoneMasked: string | null;
  deviceType: "mobile" | "desktop" | "tablet" | null;
  dayOfWeek: string | null;
  hourOfDay: number | null;
  bookingStatus: OwnerInquiryBookingStatus;
  commissionStatus: OwnerInquiryCommissionStatus;
  complianceStatus: ComplianceStatus;
  bookingDate: {
    value: string;
    precision: BookingDatePrecision;
    calendar?: BookingCalendar;
    startDate?: string;
    endDate?: string;
  } | null;
  timing: BookingTiming | null;
  pricePaidHalalas: number | null;
  commissionAmountHalalas: number | null;
  commissionDueAt: string | null;
  answeredAt: string | null;
  ownerNote: string | null;
  ownerNoteUpdatedAt: string | null;
  customerOwnerNoResponseReportedAt: string | null;
};

export type OwnerInquirySummary = {
  total: number;
  today: number;
  awaitingResponse: number;
  confirmed: number;
  declined: number;
  commissionAttention: number;
};

export type OwnerInquiryResponse = {
  requests: OwnerInquiryRow[];
  summary: OwnerInquirySummary;
};

export type OwnerPropertyOption = {
  propertyNumber: string;
  name: string | null;
  city: string | null;
  isCurrent: boolean;
  isMain: boolean;
};
