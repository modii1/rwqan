"use client";

import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SelectContent, SelectTrigger } from "@/components/ui/select";

/**
 * Shared owner design system.
 *
 * These tokens are extracted from the redesigned owner dashboard so every owner
 * page (dashboard, subscription, requests, images, update-property, occasions,
 * login and dialogs) uses the same surfaces, fields, buttons and states.
 */

export const ownerPanelClass =
  "rounded-2xl border border-[#e6ddc9] bg-white shadow-[0_1px_2px_rgba(41,55,47,0.04)]";
export const ownerSoftPanelClass = "rounded-2xl border border-[#efe7d6] bg-[#fffdf8]";
export const ownerInsetClass = "rounded-xl border border-[#f0eadc] bg-[#fffdf8]";

export const ownerPageClass = "min-h-screen bg-[#fafaf7] text-[#293129]";

export const ownerFieldClass =
  "h-12 w-full rounded-xl border border-[#d9cfb8] bg-white px-3 text-sm text-[#293129] shadow-none outline-none transition-colors placeholder:text-[#9c9382] focus-visible:border-[#9a7623] focus-visible:ring-2 focus-visible:ring-[#9a7623]/20 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-60";

export const ownerTextareaClass =
  "min-h-24 w-full resize-y rounded-xl border border-[#d9cfb8] bg-white p-3 text-sm leading-6 text-[#293129] shadow-none outline-none transition-colors placeholder:text-[#9c9382] focus-visible:border-[#9a7623] focus-visible:ring-2 focus-visible:ring-[#9a7623]/20 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-60";

export const ownerLabelClass = "mb-2 block text-xs font-semibold text-[#6f685b]";

export const ownerPrimaryButtonClass =
  "rounded-xl bg-[#29372f] font-bold text-white shadow-none transition-colors hover:bg-[#1f2b25] disabled:opacity-50";

export const ownerSecondaryButtonClass =
  "rounded-xl border border-[#d9cfb8] bg-white font-semibold text-[#29372f] shadow-none transition-colors hover:bg-[#faf7ef] disabled:opacity-50";

export const ownerChipActiveClass = "border-[#29372f] bg-[#29372f] text-white";
export const ownerChipIdleClass =
  "border-[#e6ddc9] bg-white text-[#6f685b] hover:border-[#cbb98d] hover:text-[#293129]";

export const ownerMutedTextClass = "text-[#6f685b]";

export function OwnerInput({ className, ...props }: ComponentProps<typeof Input>) {
  return <Input {...props} className={cn(ownerFieldClass, className)} />;
}

export function OwnerTextarea({ className, ...props }: ComponentProps<typeof Textarea>) {
  return <Textarea {...props} className={cn(ownerTextareaClass, className)} />;
}

export function OwnerSelectTrigger({ className, ...props }: ComponentProps<typeof SelectTrigger>) {
  return <SelectTrigger {...props} className={cn(ownerFieldClass, "justify-between", className)} />;
}

export function OwnerSelectContent({ className, ...props }: ComponentProps<typeof SelectContent>) {
  return (
    <SelectContent
      {...props}
      className={cn("rounded-xl border-[#e6ddc9] bg-[#fffdf8] text-[#293129]", className)}
    />
  );
}

const statTones = {
  gold: "border-[#efe3c6] bg-[#fffdf8] text-[#80621d]",
  green: "border-[#d7e8db] bg-[#f9fcfa] text-[#128c47]",
  blue: "border-[#d9e4ef] bg-[#f9fbfd] text-[#315f92]",
  red: "border-[#f0d6d6] bg-[#fffafa] text-[#b42318]",
  neutral: "border-[#e6ddc9] bg-white text-[#6f685b]",
} as const;

type StatTone = keyof typeof statTones;

interface OwnerStatCardProps {
  icon: ReactNode;
  label: string;
  value: string | number;
  note?: string;
  tone?: StatTone;
  onClick?: () => void;
  testId?: string;
  className?: string;
}

export function OwnerStatCard({
  icon,
  label,
  value,
  note,
  tone = "gold",
  onClick,
  testId,
  className,
}: OwnerStatCardProps) {
  const content = (
    <>
      <span className="inline-flex h-11 w-11 flex-none items-center justify-center rounded-xl border border-black/5 bg-white">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold text-[#6f685b]">{label}</span>
        <span className="mt-0.5 block text-2xl font-bold tabular-nums text-[#293129]">{value}</span>
        {note ? <span className="mt-0.5 block truncate text-[11px] text-[#6f685b]">{note}</span> : null}
      </span>
    </>
  );

  const base = cn(
    "flex w-full items-start gap-3 rounded-2xl border p-4 text-right shadow-[0_1px_2px_rgba(41,55,47,0.04)]",
    statTones[tone],
    className,
  );

  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        data-testid={testId}
        className={cn(base, "transition-colors hover:bg-[#fafaf7]")}
      >
        {content}
      </button>
    );
  }

  return (
    <div data-testid={testId} className={base}>
      {content}
    </div>
  );
}

const alertTones = {
  info: "border-[#e6ddc9] bg-[#faf7ef] text-[#6f685b]",
  success: "border-[#cfe5d6] bg-[#f6fbf7] text-[#126b38]",
  warning: "border-[#e2d3a6] bg-[#fdf6e3] text-[#80621d]",
  danger: "border-[#f1c8c8] bg-[#fff5f5] text-[#b42318]",
} as const;

interface OwnerAlertProps {
  tone?: keyof typeof alertTones;
  icon?: ReactNode;
  title?: string;
  children?: ReactNode;
  className?: string;
}

export function OwnerAlert({ tone = "info", icon, title, children, className }: OwnerAlertProps) {
  return (
    <div className={cn("rounded-xl border p-3 text-sm leading-6 sm:p-4", alertTones[tone], className)}>
      <div className="flex items-start gap-2.5">
        {icon ? <span className="mt-0.5 flex-none">{icon}</span> : null}
        <div className="min-w-0 flex-1">
          {title ? <p className="font-bold">{title}</p> : null}
          {children}
        </div>
      </div>
    </div>
  );
}

interface OwnerEmptyStateProps {
  icon: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  variant?: "dashed" | "plain";
  className?: string;
}

export function OwnerEmptyState({
  icon,
  title,
  description,
  action,
  variant = "dashed",
  className,
}: OwnerEmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center px-5 py-8 text-center",
        variant === "dashed"
          ? "rounded-2xl border border-dashed border-[#e6ddc9] bg-[#fffdf8]"
          : "rounded-2xl border border-[#e6ddc9] bg-white shadow-[0_1px_2px_rgba(41,55,47,0.04)]",
        className,
      )}
    >
      <span className="mb-3 inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[#efe7d6] bg-[#faf7ef] text-[#80621d]">
        {icon}
      </span>
      <p className="text-sm font-bold text-[#293129] sm:text-base">{title}</p>
      {description ? (
        <p className="mt-1 max-w-sm text-xs leading-5 text-[#6f685b] sm:text-sm">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
