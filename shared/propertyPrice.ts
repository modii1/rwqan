type PropertyPrices = {
  weekday?: unknown;
  weekend?: unknown;
} | null | undefined;

type PropertyWithPrices = {
  prices?: PropertyPrices;
};

function parsePositivePrice(value: unknown): { display: string; value: number } | null {
  const display = String(value ?? "").trim();
  if (!display) return null;
  const numeric = Number(display.replace(/,/g, ""));
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return { display, value: numeric };
}

/** The price shown on public cards and used by the maximum-price filter. */
export function getPrimaryPropertyPrice(prices: PropertyPrices): number {
  return parsePositivePrice(prices?.weekday)?.value
    ?? parsePositivePrice(prices?.weekend)?.value
    ?? 0;
}

export function getPrimaryPropertyPriceDisplay(prices: PropertyPrices): string {
  return parsePositivePrice(prices?.weekday)?.display
    ?? parsePositivePrice(prices?.weekend)?.display
    ?? "0";
}

export function getMaximumPrimaryPropertyPrice(
  properties: readonly PropertyWithPrices[] | null | undefined,
  fallback = 500,
): number {
  const prices = (properties ?? [])
    .map((property) => getPrimaryPropertyPrice(property.prices))
    .filter((price) => price > 0);
  return prices.length > 0 ? Math.ceil(Math.max(...prices)) : fallback;
}
