"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowRight,
  CreditCard,
  Home,
  Image as ImageIcon,
  Loader2,
  PencilLine,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

export const ownerPanelClass = "rounded-lg border border-[#dfe2dc] bg-white shadow-sm shadow-black/[0.03]";
export const ownerSoftPanelClass = "rounded-lg border border-[#e2e5df] bg-[#f8f9f7]";

const ownerNavigation: Array<{
  href: string;
  label: string;
  shortLabel: string;
  icon: LucideIcon;
}> = [
  { href: "/owner/dashboard", label: "لوحة التحكم", shortLabel: "الرئيسية", icon: Home },
  { href: "/owner/update-property", label: "بيانات العقار", shortLabel: "البيانات", icon: PencilLine },
  { href: "/owner/images", label: "صور العقار", shortLabel: "الصور", icon: ImageIcon },
  { href: "/owner/subscription", label: "الاشتراك", shortLabel: "الاشتراك", icon: CreditCard },
];

function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function OwnerDesktopNavigation() {
  const pathname = usePathname();

  return (
    <nav aria-label="صفحات المالك" className="hidden items-center gap-1 lg:flex">
      {ownerNavigation.map(({ href, label, icon: Icon }) => {
        const active = isActivePath(pathname, href);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-semibold transition-colors",
              active
                ? "bg-[#2f2a1f] text-white"
                : "text-[#687064] hover:bg-[#eef0eb] hover:text-[#242822]",
            )}
          >
            <Icon className="h-4 w-4" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

export function OwnerMobileNavigation() {
  const pathname = usePathname();

  return (
    <nav
      aria-label="صفحات المالك"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-[#dfe2dc] bg-white/95 px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur-xl lg:hidden"
    >
      <div className="mx-auto grid max-w-lg grid-cols-4 gap-1">
        {ownerNavigation.map(({ href, shortLabel, icon: Icon }) => {
          const active = isActivePath(pathname, href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-12 flex-col items-center justify-center gap-1 rounded-lg px-1 text-[11px] font-semibold transition-colors",
                active ? "bg-[#242822] text-white" : "text-[#687064] hover:bg-[#eef0eb]",
              )}
            >
              <Icon className="h-4 w-4" />
              <span className="max-w-full truncate">{shortLabel}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

interface OwnerPageHeaderProps {
  title: string;
  description?: string;
  eyebrow?: string;
  backHref?: string;
  accessory?: ReactNode;
  actions?: ReactNode;
}

export function OwnerPageHeader({
  title,
  description,
  eyebrow,
  backHref,
  accessory,
  actions,
}: OwnerPageHeaderProps) {
  return (
    <header className="sticky top-0 z-30 border-b border-[#dfe2dc] bg-white/95 backdrop-blur-xl">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-3 py-3 sm:px-4 lg:px-6">
        {backHref && (
          <Link
            href={backHref}
            aria-label="العودة إلى لوحة التحكم"
            className="inline-flex h-10 w-10 flex-none items-center justify-center rounded-lg border border-[#dfe2dc] bg-white text-[#687064] transition-colors hover:bg-[#eef0eb]"
          >
            <ArrowRight className="h-5 w-5" />
          </Link>
        )}

        <div className="min-w-0 flex-1">
          {eyebrow && <p className="truncate text-xs font-bold text-[#80621d]">{eyebrow}</p>}
          <div className="flex min-w-0 items-center gap-2">
            <h1 className="truncate text-lg font-bold text-[#242822] sm:text-xl">{title}</h1>
            {accessory}
          </div>
          {description && <p className="mt-0.5 truncate text-xs text-[#687064] sm:text-sm">{description}</p>}
        </div>

        {actions && <div className="flex flex-none items-center gap-1">{actions}</div>}
        <OwnerDesktopNavigation />
      </div>
    </header>
  );
}

interface OwnerPageMainProps {
  children: ReactNode;
  className?: string;
  maxWidth?: "4xl" | "5xl" | "7xl";
}

export function OwnerPageMain({ children, className, maxWidth = "7xl" }: OwnerPageMainProps) {
  const maxWidthClass = {
    "4xl": "max-w-4xl",
    "5xl": "max-w-5xl",
    "7xl": "max-w-7xl",
  }[maxWidth];

  return (
    <main
      className={cn(
        "mx-auto w-full px-3 py-5 pb-28 sm:px-4 sm:py-6 lg:px-6 lg:py-8 lg:pb-10",
        maxWidthClass,
        className,
      )}
    >
      {children}
    </main>
  );
}

export function OwnerLoadingState({ text = "جاري التحميل..." }: { text?: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f5f6f3] px-4 text-center">
      <div>
        <Loader2 className="mx-auto h-7 w-7 animate-spin text-[#80621d]" />
        <p className="mt-3 text-sm font-medium text-[#687064]">{text}</p>
      </div>
    </div>
  );
}

interface OwnerSectionHeadingProps {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
}

export function OwnerSectionHeading({ title, description, icon, action }: OwnerSectionHeadingProps) {
  return (
    <div className="mb-4 flex min-w-0 items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-2.5">
        {icon && (
          <span className="mt-0.5 inline-flex h-8 w-8 flex-none items-center justify-center rounded-lg bg-[#eef0eb] text-[#80621d]">
            {icon}
          </span>
        )}
        <div className="min-w-0">
          <h2 className="text-base font-bold text-[#242822] sm:text-lg">{title}</h2>
          {description && <p className="mt-1 text-xs leading-5 text-[#687064] sm:text-sm">{description}</p>}
        </div>
      </div>
      {action && <div className="flex-none">{action}</div>}
    </div>
  );
}
