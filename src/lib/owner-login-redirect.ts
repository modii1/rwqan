const DEFAULT_OWNER_DESTINATION = "/owner/dashboard";
const ALLOWED_OWNER_DESTINATIONS = new Set([
  "/owner/subscription",
  "/owner/requests",
]);

export function getSafeOwnerLoginDestination(search: string): string {
  const destination = new URLSearchParams(search).get("next") || "";
  return ALLOWED_OWNER_DESTINATIONS.has(destination)
    ? destination
    : DEFAULT_OWNER_DESTINATION;
}

export function getOwnerLoginUrl(destination: string): string {
  return ALLOWED_OWNER_DESTINATIONS.has(destination)
    ? `/owner/login?next=${encodeURIComponent(destination)}`
    : "/owner/login";
}
