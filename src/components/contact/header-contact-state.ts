import type { ContactIdentityKind } from "@/hooks/use-contact-identity";

export type HeaderAccountMode = "loading" | "guest" | "client" | "owner" | "admin";

interface HeaderAccountState {
  contactIdentityKind?: ContactIdentityKind;
  contactIdentityPending: boolean;
  ownerLoggedIn: boolean;
  adminLoggedIn: boolean;
}

export function deriveHeaderAccountMode({
  contactIdentityKind,
  contactIdentityPending,
  ownerLoggedIn,
  adminLoggedIn,
}: HeaderAccountState): HeaderAccountMode {
  if (ownerLoggedIn || contactIdentityKind === "owner") return "owner";
  if (adminLoggedIn || contactIdentityKind === "admin") return "admin";
  if (contactIdentityKind === "client") return "client";
  if (contactIdentityPending) return "loading";
  return "guest";
}
