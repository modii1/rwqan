import type { ComponentPropsWithoutRef } from "react";

export type BrandMarkProps = Omit<ComponentPropsWithoutRef<"img">, "src">;

export function BrandMark({ alt = "روقـان", ...props }: BrandMarkProps) {
  return <img src="/assets/logo-icon.png" alt={alt} {...props} />;
}
