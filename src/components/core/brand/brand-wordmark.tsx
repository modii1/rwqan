import type { ComponentPropsWithoutRef } from "react";

export type BrandWordmarkProps = Omit<ComponentPropsWithoutRef<"img">, "src">;

export function BrandWordmark({ alt = "روقان", ...props }: BrandWordmarkProps) {
  return <img src="/assets/logo-full.png" alt={alt} {...props} />;
}
