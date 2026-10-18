const MAX_ADMIN_OPERATION_TARGET_LENGTH = 256;

type SearchParamReader = Pick<URLSearchParams, "get">;

export function getAdminOperationTarget(
  searchParams: SearchParamReader,
  key: "booking" | "payment" | "property" | "log",
): string {
  const value = searchParams.get(key)?.trim() || "";
  if (!value || value.length > MAX_ADMIN_OPERATION_TARGET_LENGTH) return "";
  return value;
}

export type AdminWhatsAppTab =
  | "workflow"
  | "admin-notifications"
  | "subscription-owner-sends"
  | "activity";

const ADMIN_WHATSAPP_TABS = new Set<AdminWhatsAppTab>([
  "workflow",
  "admin-notifications",
  "subscription-owner-sends",
  "activity",
]);

export function getAdminWhatsAppTab(
  searchParams: SearchParamReader,
): AdminWhatsAppTab {
  const value = searchParams.get("tab")?.trim() as AdminWhatsAppTab | undefined;
  return value && ADMIN_WHATSAPP_TABS.has(value) ? value : "workflow";
}
