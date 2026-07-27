export interface ReservedWhatsAppTab {
  readonly closed: boolean;
  opener: unknown;
  document: {
    open(): void;
    write(content: string): void;
    close(): void;
  };
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

function paintWhatsAppInterstitial(tab: ReservedWhatsAppTab): boolean {
  try {
    tab.document.open();
    tab.document.write(WHATSAPP_INTERSTITIAL_HTML);
    tab.document.close();
    return true;
  } catch {
    return false;
  }
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

  if (!paintWhatsAppInterstitial(tab)) {
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
