/**
 * RWQAN LIVE — read-only production data via the PUBLIC rwqan.sa HTTP API.
 *
 * This is the ONLY available, authorized, READ-ONLY mechanism to read real
 * production data: the production site's own public properties endpoint
 * (`GET {baseUrl}/api/properties`). It does NOT use Firestore credentials and
 * does NOT copy or invent any key.
 *
 * Safety:
 *   - Read-only: issues a single GET; never writes.
 *   - Never follows to a non-HTTPS origin; base URL must be https.
 *   - Surfaces failures as 503; never falls back to the DEV project.
 *   - Returns only public property fields (the endpoint is public by design).
 *
 * Scope: public properties. Subscriptions / private data are NOT exposed by the
 * public API and therefore are NOT available through this source.
 */
import type { Property } from "../../shared/schema";

export class LivePublicApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LivePublicApiError";
  }
}

export interface LivePublicApiSourceOptions {
  /** Public origin of the production site (must be https). */
  baseUrl: string;
  timeoutMs: number;
}

export interface LivePublicApiSource {
  getProperties(): Promise<Property[]>;
}

function assertHttpsBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, "");
  if (!/^https:\/\//i.test(normalized)) {
    throw new LivePublicApiError("عنوان الإنتاج يجب أن يكون https.");
  }
  return normalized;
}

function normaliseProperty(raw: Record<string, unknown>): Property {
  const property = { ...raw } as Property;
  if (typeof property.facilities === "string") {
    const trimmed = (property.facilities as unknown as string).trim();
    if (trimmed.startsWith("[")) {
      try {
        property.facilities = JSON.parse(trimmed);
      } catch {
        property.facilities = [];
      }
    } else {
      property.facilities = trimmed
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
    }
  }
  if (!Array.isArray(property.facilities)) {
    property.facilities = [];
  }
  if (!Array.isArray(property.imageUrls)) {
    property.imageUrls = [];
  }
  return property;
}

export function createLivePublicApiSource(
  options: LivePublicApiSourceOptions,
): LivePublicApiSource {
  const baseUrl = assertHttpsBaseUrl(options.baseUrl);

  return {
    async getProperties(): Promise<Property[]> {
      let response: Response;
      try {
        response = await fetch(`${baseUrl}/api/properties`, {
          method: "GET",
          headers: { Accept: "application/json" },
          signal: AbortSignal.timeout(options.timeoutMs),
        });
      } catch (error) {
        throw new LivePublicApiError(
          `تعذّر الوصول إلى واجهة الإنتاج العامة: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      if (!response.ok) {
        throw new LivePublicApiError(
          `واجهة الإنتاج أعادت حالة غير ناجحة: ${response.status}.`,
        );
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new LivePublicApiError("استجابة الإنتاج ليست JSON صالحًا.");
      }

      const list = Array.isArray(payload)
        ? payload
        : (payload as { properties?: unknown[] })?.properties;
      if (!Array.isArray(list)) {
        throw new LivePublicApiError("استجابة الإنتاج ليست قائمة عقارات.");
      }

      return list
        .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object")
        .map(normaliseProperty);
    },
  };
}
