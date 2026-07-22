"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent, RefObject } from "react";
import { Loader2, Phone } from "lucide-react";
import { normalizePhoneDigits, normalizeSaudiMobilePhone } from "@shared/phone";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type ContactPhoneDialogMode = "contact" | "change";

interface ContactPhoneDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (phone: string) => Promise<void> | void;
  isSubmitting?: boolean;
  mode?: ContactPhoneDialogMode;
  currentMaskedPhone?: string | null;
  returnFocusRef?: RefObject<HTMLElement | null>;
}

export function validateContactPhone(value: string): { phone?: string; error?: string } {
  const normalized = normalizeSaudiMobilePhone(value);
  if (normalized) return { phone: normalized };

  let digits = normalizePhoneDigits(value);
  if (digits.startsWith("00966")) digits = digits.slice(5);
  else if (digits.startsWith("966")) digits = digits.slice(3);
  else if (digits.startsWith("0")) digits = digits.slice(1);

  if (!digits) return { error: "رقم الجوال مطلوب" };
  if (!digits.startsWith("5")) return { error: "رقم الجوال السعودي يجب أن يبدأ بـ 5" };
  if (digits.length !== 9) return { error: "أدخل رقم جوال صحيحاً من 9 أرقام بعد حذف الصفر" };
  return { error: "رقم الجوال غير صحيح" };
}

export function ContactPhoneDialog({
  open,
  onOpenChange,
  onSubmit,
  isSubmitting = false,
  mode = "contact",
  currentMaskedPhone,
  returnFocusRef,
}: ContactPhoneDialogProps) {
  const inputId = useId();
  const errorId = `${inputId}-error`;
  const [phone, setPhone] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const wasOpenRef = useRef(open);

  useEffect(() => {
    if (!open) {
      setPhone("");
      setPhoneError("");
    }
  }, [open]);

  useEffect(() => {
    const wasOpen = wasOpenRef.current;
    wasOpenRef.current = open;
    if (!wasOpen || open || !returnFocusRef?.current) return;

    const frame = window.requestAnimationFrame(() => returnFocusRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [open, returnFocusRef]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (isSubmitting) return;
    onOpenChange(nextOpen);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;

    const validation = validateContactPhone(phone);
    if (!validation.phone) {
      setPhoneError(validation.error || "رقم الجوال غير صحيح");
      return;
    }

    setPhoneError("");
    try {
      await onSubmit(validation.phone);
    } catch (error) {
      setPhoneError(error instanceof Error ? error.message : "تعذر حفظ رقم التواصل");
    }
  };

  const isChangeMode = mode === "change";

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent dir="rtl" className="max-w-md border-[#ded3bc] bg-[#fffdf8] text-right">
        <DialogHeader className="text-right sm:text-right">
          <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-lg border border-[#cfe5d6] bg-[#eef8f1] text-[#128c47]">
            <Phone className="h-5 w-5" />
          </div>
          <DialogTitle className="text-xl text-[#2f2a1f]">
            {isChangeMode ? "تغيير رقم التواصل" : "أدخل رقم جوالك للمتابعة"}
          </DialogTitle>
          <DialogDescription className="pt-1 leading-6 text-[#6f6249]">
            {isChangeMode
              ? "أدخل الرقم الجديد الذي تريد استخدامه في طلبات التواصل القادمة."
              : "سنحفظ رقمك على هذا المتصفح والجهاز، ثم نفتح لك واتساب مباشرة دون طلبه في كل مرة."}
          </DialogDescription>
          {isChangeMode && currentMaskedPhone ? (
            <p className="flex items-center gap-1 text-sm font-semibold text-[#5f543f]">
              <span>الرقم الحالي:</span>
              <span dir="ltr">{currentMaskedPhone}</span>
            </p>
          ) : null}
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4" noValidate>
          <div className="space-y-2">
            <Label htmlFor={inputId} className="font-semibold text-[#2f2a1f]">
              رقم الجوال
            </Label>
            <Input
              id={inputId}
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              autoFocus
              dir="ltr"
              value={phone}
              onChange={(event) => {
                setPhone(event.target.value.slice(0, 20));
                if (phoneError) setPhoneError("");
              }}
              placeholder="05XXXXXXXX"
              aria-invalid={Boolean(phoneError)}
              aria-describedby={phoneError ? errorId : undefined}
              className={phoneError ? "border-red-500 focus-visible:ring-red-500" : ""}
              disabled={isSubmitting}
            />
            {phoneError ? (
              <p id={errorId} className="text-sm font-medium text-red-600" role="alert">
                {phoneError}
              </p>
            ) : (
              <p className="text-xs leading-5 text-[#7a705f]">
                يمكنك إدخاله بصيغة 05XXXXXXXX أو 9665XXXXXXXX.
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 pt-1">
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={isSubmitting}>
              إلغاء
            </Button>
            <Button type="submit" className="bg-[#128c47] text-white hover:bg-[#0f783d]" disabled={isSubmitting}>
              {isSubmitting ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {isChangeMode ? "جاري الحفظ..." : "جاري الفتح..."}
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <Phone className="h-4 w-4" />
                  {isChangeMode ? "حفظ الرقم الجديد" : "حفظ والمتابعة لواتساب"}
                </span>
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
