const PROPERTY_NUMBER_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function safeCustomerReturnPath(
  value: string | null | undefined,
  fallback = "/profile",
): string {
  const candidate = String(value || "").trim();
  if (!candidate.startsWith("/") || candidate.startsWith("//") || candidate.includes("\\")) {
    return fallback;
  }

  try {
    const parsed = new URL(candidate, "https://rwqan.local");
    if (parsed.origin !== "https://rwqan.local") return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

export function safePendingFavorite(value: string | null | undefined): string | null {
  const candidate = String(value || "").trim();
  return PROPERTY_NUMBER_PATTERN.test(candidate) ? candidate : null;
}

export function customerLoginHref(returnTo: string, propertyNumber?: string): string {
  const params = new URLSearchParams({
    returnTo: safeCustomerReturnPath(returnTo),
  });
  const favorite = safePendingFavorite(propertyNumber);
  if (favorite) params.set("favorite", favorite);
  return `/customer/login?${params.toString()}`;
}
