import type { Request } from "express";

function normalizeOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

/**
 * Reject explicit cross-site browser mutations while retaining support for
 * non-browser/server clients that legitimately omit Origin.
 */
export function isSameOriginRequest(req: Request): boolean {
  if (req.get("sec-fetch-site") === "cross-site") return false;

  const requestOrigin = normalizeOrigin(req.get("origin"));
  if (!requestOrigin) return !req.get("origin");

  const allowedOrigins = new Set<string>();
  const configuredOrigin = normalizeOrigin(process.env.NEXT_PUBLIC_BASE_URL);
  if (configuredOrigin) allowedOrigins.add(configuredOrigin);

  const host = req.get("host");
  const directOrigin = normalizeOrigin(host ? `${req.protocol}://${host}` : undefined);
  if (directOrigin) allowedOrigins.add(directOrigin);

  return allowedOrigins.has(requestOrigin);
}
