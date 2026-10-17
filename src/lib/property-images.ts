export const PROPERTY_IMAGE_PLACEHOLDER =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='300' viewBox='0 0 400 300'%3E%3Crect fill='%23f3f4f6' width='400' height='300'/%3E%3Ctext x='50%25' y='50%25' font-family='Cairo,sans-serif' font-size='18' fill='%239ca3af' text-anchor='middle' dy='.3em'%3Eلا توجد صور%3C/text%3E%3C/svg%3E";

type PropertyImageFetch = (url: string) => Promise<{
  ok: boolean;
  json(): Promise<unknown>;
}>;

interface PropertyImageFetchOptions {
  attempts?: number;
  retryDelayMs?: number;
  wait?: (milliseconds: number) => Promise<void>;
}

export async function fetchPropertyImageUrls(
  propertyNumber: string,
  fetcher: PropertyImageFetch = (url) => fetch(url),
  options: PropertyImageFetchOptions = {},
): Promise<string[]> {
  const attempts = Math.max(1, Math.trunc(options.attempts ?? 3));
  const retryDelayMs = Math.max(0, options.retryDelayMs ?? 150);
  const wait = options.wait ?? ((milliseconds) =>
    new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds)));

  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetcher(
        `/api/public/property-images/${encodeURIComponent(propertyNumber)}`,
      );
      if (!response.ok) throw new Error("Failed to fetch property images");
      const payload = await response.json();
      if (!payload || typeof payload !== "object") return [];
      const images = (payload as Record<string, unknown>).images;
      return Array.isArray(images)
        ? images.filter((image): image is string => typeof image === "string" && image.length > 0)
        : [];
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) {
        await wait(retryDelayMs * 2 ** attempt);
      }
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Failed to fetch property images");
}

export function hasCachedPropertyImages(
  imagesMap: ReadonlyMap<string, readonly string[]>,
  propertyNumber: string,
): boolean {
  return (imagesMap.get(propertyNumber)?.length || 0) > 0;
}

export function getCachedPropertyImage(
  propertyNumber: string,
  index = 0,
  imagesMap?: ReadonlyMap<string, readonly string[]>,
): string {
  const images = imagesMap?.get(propertyNumber) || [];
  return images[index] || images[0] || PROPERTY_IMAGE_PLACEHOLDER;
}

/** A dependency key that changes when property identities change, not only count. */
export function getPropertyImageSetKey(
  propertyNumbers: readonly string[],
): string {
  return propertyNumbers.join("|");
}
