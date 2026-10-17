"use client";

import { useRef, useState } from "react";
import { CalendarCheck2, ChevronDown, Heart, LogIn, LogOut, Pencil, Settings2, UserRoundCheck } from "lucide-react";
import Link from "next/link";
import type { ContactIdentity } from "@/hooks/use-contact-identity";
import { useDeleteContactIdentity } from "@/hooks/use-contact-identity";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ContactPhoneDialog } from "./contact-phone-dialog";

interface ContactIdentityMenuProps {
  identity: ContactIdentity;
  customerName?: string | null;
}

export function ContactIdentityMenu({
  identity,
  customerName,
}: ContactIdentityMenuProps) {
  const { toast } = useToast();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [isChangeDialogOpen, setIsChangeDialogOpen] = useState(false);
  const deleteIdentity = useDeleteContactIdentity();
  const displayName = customerName?.trim() || null;
  const customerInitial = displayName?.charAt(0) || null;

  const handleChangePhone = async (_clientPhone: string) => {
    setIsChangeDialogOpen(false);
    toast({
      title: "تم تحديث رقم التواصل",
      description: "سيُستخدم الرقم الجديد في طلبات التواصل القادمة.",
    });
  };

  const handleLogout = async () => {
    try {
      await deleteIdentity.mutateAsync();
      toast({
        title: "تم تسجيل الخروج",
        description: "سنطلب رقم التواصل عند محاولتك القادمة.",
      });
    } catch (error) {
      toast({
        title: "تعذر تسجيل الخروج",
        description: error instanceof Error ? error.message : "حاول مرة أخرى.",
        variant: "destructive",
      });
    }
  };

  return (
    <>
      <DropdownMenu dir="rtl">
        <DropdownMenuTrigger asChild>
          <Button
            ref={triggerRef}
            type="button"
            variant="outline"
            title={displayName || "رقم التواصل محفوظ"}
            aria-label={displayName ? `إدارة حساب ${displayName}` : "إدارة رقم التواصل المحفوظ"}
            className="h-10 w-10 rounded-xl border-emerald-200 bg-emerald-50 px-0 text-emerald-700 hover:bg-emerald-100 hover:text-emerald-800 md:w-auto md:max-w-52 md:px-3"
            data-testid="button-contact-identity"
          >
            {customerInitial ? (
              <span className="flex h-6 w-6 flex-none items-center justify-center rounded-full bg-emerald-700 text-sm font-bold text-white" aria-hidden="true">
                {customerInitial}
              </span>
            ) : (
              <UserRoundCheck className="h-5 w-5 flex-none" />
            )}
            <span
              className="hidden min-w-0 truncate whitespace-nowrap font-semibold md:inline"
              dir={displayName ? "rtl" : "ltr"}
            >
              {displayName || identity.maskedPhone || "رقم محفوظ"}
            </span>
            <ChevronDown className="hidden h-4 w-4 flex-none md:block" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuLabel className="space-y-1 text-right">
            <span className="block truncate text-sm font-semibold">
              {displayName || "رقم التواصل محفوظ"}
            </span>
            <span className="block text-xs font-normal text-muted-foreground" dir="ltr">
              {identity.maskedPhone || "رقم محفوظ"}
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {identity.kind === "client" && (
            <>
              <DropdownMenuItem asChild>
                <Link href="/profile">
                  <CalendarCheck2 className="h-4 w-4" />
                  حجوزاتي
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/profile?section=favorites">
                  <Heart className="h-4 w-4" />
                  المفضلة
                </Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href="/profile?section=account">
                  <Settings2 className="h-4 w-4" />
                  بيانات الحساب
                </Link>
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuItem onSelect={() => setIsChangeDialogOpen(true)}>
            <Pencil className="h-4 w-4" />
            تغيير رقم التواصل
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => void handleLogout()}
            disabled={deleteIdentity.isPending}
            className="text-red-600 focus:bg-red-50 focus:text-red-700"
          >
            <LogOut className="h-4 w-4" />
            {deleteIdentity.isPending ? "جاري تسجيل الخروج..." : "تسجيل الخروج"}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <Link href="/owner/login">
              <LogIn className="h-4 w-4" />
              دخول الملاك
            </Link>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <ContactPhoneDialog
        open={isChangeDialogOpen}
        onOpenChange={setIsChangeDialogOpen}
        onSubmit={handleChangePhone}
        mode="change"
        currentMaskedPhone={identity.maskedPhone}
        returnFocusRef={triggerRef}
      />
    </>
  );
}
