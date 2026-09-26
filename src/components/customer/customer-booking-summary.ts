export type CustomerBookingSummaryFacts = {
  propertyLabel: string;
  propertyNumber: string;
  requestCode?: string | null;
  contactAt?: string | null;
  bookingTiming?: string | null;
  bookingDate?: string | null;
  reportedAmount?: string | null;
};

export function buildCustomerBookingSummary(
  facts: CustomerBookingSummaryFacts,
): string {
  const lines = [
    "ملخص الحجز",
    "هذا المستند ملخص للبيانات المسجلة وليس إيصال دفع.",
    "",
    `العقار: ${facts.propertyLabel}`,
    `رقم العقار: ${facts.propertyNumber}`,
  ];

  if (facts.requestCode) lines.push(`كود الطلب: ${facts.requestCode}`);
  if (facts.contactAt) lines.push(`وقت التواصل: ${facts.contactAt}`);
  if (facts.bookingTiming) lines.push(`وقت الحجز: ${facts.bookingTiming}`);
  if (facts.bookingDate) lines.push(`تاريخ الحجز: ${facts.bookingDate}`);
  if (facts.reportedAmount) lines.push(`المبلغ المبلغ عنه: ${facts.reportedAmount}`);

  return `${lines.join("\n")}\n`;
}

export function customerBookingSummaryFileName(propertyNumber: string): string {
  const safePropertyNumber = String(propertyNumber || "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "booking";
  return `rwqan-booking-summary-${safePropertyNumber}.txt`;
}
