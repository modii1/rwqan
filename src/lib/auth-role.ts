export type AuthRole = "customer" | "owner" | "admin";

export function parseAuthRole(value: unknown): AuthRole {
  const role = Array.isArray(value) ? value[0] : value;
  return role === "customer" || role === "admin" ? role : "owner";
}

export function ownerLoginRoleHref(
  role: AuthRole,
  currentSearch: string | URLSearchParams = "",
): string {
  const params = new URLSearchParams(currentSearch);
  params.set("mode", role);
  return `/owner/login?${params.toString()}`;
}
