export type PackageAudience = "public" | "owner" | "both";

export const PACKAGE_AUDIENCES: ReadonlyArray<{
  value: PackageAudience;
  label: string;
  description: string;
}> = [
  {
    value: "public",
    label: "عامة فقط",
    description: "تظهر في صفحة الاشتراك العامة فقط.",
  },
  {
    value: "owner",
    label: "للمالك فقط",
    description: "تظهر في صفحة اشتراك المالك فقط.",
  },
  {
    value: "both",
    label: "كلتاهما",
    description: "تظهر في صفحة الاشتراك العامة وصفحة المالك.",
  },
];

/**
 * Legacy packages have no audience field. Treat them as `both` so adding the
 * field never hides an existing package from either page.
 */
export function normalizePackageAudience(value: unknown): PackageAudience {
  return value === "public" || value === "owner" ? value : "both";
}

export function isPackageAudience(value: unknown): value is PackageAudience {
  return value === "public" || value === "owner" || value === "both";
}

export function packageMatchesAudience(
  pkg: { audience?: unknown } | null | undefined,
  audience: Exclude<PackageAudience, "both">,
): boolean {
  const configured = normalizePackageAudience(pkg?.audience);
  return configured === "both" || configured === audience;
}
