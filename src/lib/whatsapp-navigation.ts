export interface ReservedWhatsAppTab {
  readonly closed: boolean;
  opener: unknown;
  document: {
    readonly readyState: DocumentReadyState;
    open(): unknown;
    write(...content: string[]): void;
    close(): void;
  };
  location: Pick<Location, "assign" | "replace">;
  close(): void;
}

export type WhatsAppTabOpener = (
  url: string,
  target: string,
) => ReservedWhatsAppTab | null;

interface WhatsAppNavigationOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
  now?: () => number;
  wait?: (milliseconds: number) => Promise<void>;
}

export function buildWhatsAppUrl(phone: string, message: string): string {
  const digits = phone.replace(/\D/g, "");
  return `https://wa.me/${digits}?text=${encodeURIComponent(message)}`;
}

export function buildWhatsAppReturnUrl(propertyNumber: string): string {
  return `/property/${encodeURIComponent(propertyNumber)}?contactReturn=1`;
}

export function getCleanWhatsAppReturnUrl(href: string): string | null {
  const url = new URL(href);
  if (url.searchParams.get("contactReturn") !== "1") return null;
  url.searchParams.delete("contactReturn");
  return `${url.pathname}${url.search}${url.hash}`;
}

const WHATSAPP_INTERSTITIAL_HTML = `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>جارٍ فتح واتساب | روقان</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 24px;
      background: #faf8f1;
      color: #2f2a1f;
      font-family: Tahoma, Arial, sans-serif;
    }
    main {
      width: min(100%, 420px);
      padding: 32px 24px;
      border: 1px solid #d8e8dc;
      border-radius: 18px;
      background: #fff;
      box-shadow: 0 18px 45px rgba(47, 42, 31, .12);
      text-align: center;
    }
    .brand { margin: 0 0 20px; color: #128c47; font-size: 24px; font-weight: 800; }
    .spinner {
      width: 38px;
      height: 38px;
      margin: 0 auto 18px;
      border: 4px solid #d9eee1;
      border-top-color: #128c47;
      border-radius: 50%;
      animation: spin .8s linear infinite;
    }
    h1 { margin: 0; font-size: 20px; }
    p { margin: 10px 0 0; color: #6f6249; font-size: 14px; line-height: 1.8; }
    @keyframes spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }
  </style>
</head>
<body>
  <main role="status" aria-live="polite" aria-busy="true">
    <p class="brand">روقان</p>
    <div class="spinner" aria-hidden="true"></div>
    <h1>جارٍ فتح واتساب</h1>
    <p>يتم الآن تسجيل طلب التواصل وتحويلك بأمان إلى واتساب.</p>
  </main>
</body>
</html>`;

function isolateTab(tab: ReservedWhatsAppTab): boolean {
  try {
    tab.opener = null;
    return true;
  } catch {
    closeReservedWhatsAppTab(tab);
    return false;
  }
}

/** Generic reservation retained for admin actions that do not have a property return page. */
export function reserveWhatsAppTab(
  openTab: WhatsAppTabOpener = (url, target) => window.open(url, target),
): ReservedWhatsAppTab | null {
  let tab: ReservedWhatsAppTab | null;
  try {
    tab = openTab("about:blank", "_blank");
  } catch {
    return null;
  }
  if (!tab || !isolateTab(tab)) return null;

  try {
    tab.document.open();
    tab.document.write(WHATSAPP_INTERSTITIAL_HTML);
    tab.document.close();
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

/**
 * Opens the actual property page as the history entry behind WhatsApp. This is
 * used only by the public contact flow so Back never lands on a blank/loader.
 */
export function reservePropertyWhatsAppTab(
  propertyNumber: string,
  openTab: WhatsAppTabOpener = (url, target) => window.open(url, target),
): ReservedWhatsAppTab | null {
  let tab: ReservedWhatsAppTab | null;
  try {
    tab = openTab(buildWhatsAppReturnUrl(propertyNumber), "_blank");
  } catch {
    return null;
  }
  if (!tab || !isolateTab(tab)) return null;
  return tab;
}

export async function navigatePropertyWhatsAppTab(
  tab: ReservedWhatsAppTab,
  url: string,
  options: WhatsAppNavigationOptions = {},
): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? 3_000;
  const pollIntervalMs = options.pollIntervalMs ?? 25;
  const now = options.now ?? Date.now;
  const wait = options.wait ?? ((milliseconds) =>
    new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds)));
  const deadline = now() + timeoutMs;
  let returnPageReady = false;

  while (!tab.closed && now() < deadline) {
    try {
      if (tab.document.readyState === "interactive" || tab.document.readyState === "complete") {
        returnPageReady = true;
        break;
      }
    } catch {
      closeReservedWhatsAppTab(tab);
      return false;
    }
    await wait(pollIntervalMs);
  }

  if (tab.closed || !returnPageReady) {
    closeReservedWhatsAppTab(tab);
    return false;
  }
  try {
    tab.location.assign(url);
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
