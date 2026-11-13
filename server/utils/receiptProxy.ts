/**
 * Build the authenticated proxy path for a private receipt object.
 * Keeping this in one place ensures new receipt flows never fall back to a
 * public bucket URL.
 */
export function receiptProxyPath(objectKey: string): string {
  const key = String(objectKey ?? "").trim();
  if (!key) return "";
  return `/api/receipts/view?key=${encodeURIComponent(key)}`;
}
