/**
 * Paymob callback endpoint resolution and development isolation.
 *
 * Production endpoints are immutable: they always resolve to the canonical
 * rwqan.sa URLs regardless of any environment variable, so production
 * behaviour can never be changed through configuration.
 *
 * Outside production (development, test, or a missing/unexpected NODE_ENV) the
 * endpoints MUST be supplied through the explicit DEV variables and MUST be
 * well-formed absolute HTTPS URLs that are not a production address. There is
 * no production fallback outside production, so an accidentally unconfigured
 * or misconfigured runtime can never send a Paymob callback to rwqan.sa.
 *
 * This module only resolves URLs and enforces isolation. It does not touch
 * pricing, subscription logic, or HMAC verification.
 */

export const PRODUCTION_PAYMOB_NOTIFICATION_URL =
  "https://rwqan.sa/api/paymob/webhook";
export const PRODUCTION_PAYMOB_REDIRECT_URL =
  "https://rwqan.sa/api/paymob/webhook";

export const DEV_PAYMOB_NOTIFICATION_URL_KEY = "PAYMOB_DEV_NOTIFICATION_URL";
export const DEV_PAYMOB_REDIRECT_URL_KEY = "PAYMOB_DEV_REDIRECT_URL";

const PRODUCTION_HOSTNAMES = ["rwqan.sa", "www.rwqan.sa"] as const;

export interface PaymobEndpoints {
  notificationUrl: string;
  redirectUrl: string;
}

function readOverride(
  environment: NodeJS.ProcessEnv,
  key: string,
): string | null {
  const raw = environment[key];
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** True when the URL host is the production domain (or a subdomain of it). */
export function isProductionPaymobUrl(value: unknown): boolean {
  if (typeof value !== "string" || value.trim().length === 0) return false;
  let hostname: string;
  try {
    hostname = new URL(value.trim()).hostname.trim().toLowerCase();
  } catch {
    return false;
  }
  return PRODUCTION_HOSTNAMES.some(
    (productionHost) =>
      hostname === productionHost || hostname.endsWith(`.${productionHost}`),
  );
}

/**
 * Validate a non-production callback URL: it must be present, a well-formed
 * absolute URL, use HTTPS, and not resolve to a production address.
 */
function requireIsolatedCallbackUrl(value: string | null, key: string): string {
  if (!value) {
    throw new Error(
      `Refusing to start a Paymob payment in development: ${key} is not set ` +
        "to an isolated callback URL.",
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(
      `Refusing to start a Paymob payment in development: ${key} is not a ` +
        "valid absolute URL.",
    );
  }
  if (parsed.protocol !== "https:") {
    throw new Error(
      `Refusing to start a Paymob payment in development: ${key} must use HTTPS.`,
    );
  }
  if (isProductionPaymobUrl(value)) {
    throw new Error(
      `Refusing to start a Paymob payment in development: ${key} must not ` +
        "point at a production address.",
    );
  }
  return value;
}

export function resolvePaymobEndpoints(
  environment: NodeJS.ProcessEnv = process.env,
): PaymobEndpoints {
  if (environment.NODE_ENV === "production") {
    return {
      notificationUrl: PRODUCTION_PAYMOB_NOTIFICATION_URL,
      redirectUrl: PRODUCTION_PAYMOB_REDIRECT_URL,
    };
  }
  return {
    notificationUrl: requireIsolatedCallbackUrl(
      readOverride(environment, DEV_PAYMOB_NOTIFICATION_URL_KEY),
      DEV_PAYMOB_NOTIFICATION_URL_KEY,
    ),
    redirectUrl: requireIsolatedCallbackUrl(
      readOverride(environment, DEV_PAYMOB_REDIRECT_URL_KEY),
      DEV_PAYMOB_REDIRECT_URL_KEY,
    ),
  };
}

/**
 * Refuse to start a Paymob payment whenever the runtime is not unambiguously
 * production: endpoints must be present, valid HTTPS, and non-production.
 * No-op only in production.
 */
export function assertDevPaymobEndpointsAreIsolated(
  environment: NodeJS.ProcessEnv = process.env,
): void {
  if (environment.NODE_ENV === "production") return;
  resolvePaymobEndpoints(environment);
}
