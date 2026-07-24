export interface ReservedWhatsAppTab {
  readonly closed: boolean;
  opener: unknown;
  location: Pick<Location, "replace">;
  close(): void;
}

export type WhatsAppTabOpener = (
  url: string,
  target: string,
) => ReservedWhatsAppTab | null;

export function buildWhatsAppUrl(phone: string, message: string): string {
  const digits = phone.replace(/\D/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

export function reserveWhatsAppTab(
  openTab: WhatsAppTabOpener = (url, target) => window.open(url, target),
): ReservedWhatsAppTab | null {
  let tab: ReservedWhatsAppTab | null;
  try {
    tab = openTab("about:blank", "_blank");
  } catch {
    return null;
  }
  if (!tab) return null;

  try {
    tab.opener = null;
  } catch {
    closeReservedWhatsAppTab(tab);
    return null;
  }
  return tab;
}

export function navigateReservedWhatsAppTab(
  tab: ReservedWhatsAppTab,
  url: string,
): boolean {
  if (tab.closed) return false;
  try {
    tab.location.replace(url);
    return true;
  } catch {
    closeReservedWhatsAppTab(tab);
    return false;
  }
}

export function closeReservedWhatsAppTab(
  tab: ReservedWhatsAppTab | null | undefined,
): void {
  if (!tab || tab.closed) return;
  try {
    tab.close();
  } catch {
    // The browser already owns the external context; there is nothing else to clean up.
  }
}
