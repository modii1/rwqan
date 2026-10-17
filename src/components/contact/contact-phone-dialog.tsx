"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { FormEvent, RefObject } from "react";
import { Loader2 } from "lucide-react";
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
import {
  useRequestContactIdentityCode,
  useVerifyContactIdentityCode,
  type ContactIdentityChallenge,
} from "@/hooks/use-contact-identity";

export type ContactPhoneDialogMode = "contact" | "change" | "profile";

interface ContactPhoneDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (phone: string) => Promise<void> | void;
  isSubmitting?: boolean;
  mode?: ContactPhoneDialogMode;
  currentMaskedPhone?: string | null;
  returnFocusRef?: RefObject<HTMLElement | null>;
  onBeforeCodeVerification?: () => void;
  onCodeVerificationAborted?: () => void;
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

export function validateContactVerificationCode(value: string): { code?: string; error?: string } {
  const code = normalizePhoneDigits(value);
  if (!code) return { error: "رمز التحقق مطلوب" };
  if (code.length !== 6) return { error: "أدخل رمز التحقق المكون من 6 أرقام" };
  return { code };
}

export function ContactPhoneDialog({
  open,
  onOpenChange,
  onSubmit,
  isSubmitting = false,
  mode = "contact",
  currentMaskedPhone,
  returnFocusRef,
  onBeforeCodeVerification,
  onCodeVerificationAborted,
}: ContactPhoneDialogProps) {
  const inputId = useId();
  const errorId = `${inputId}-error`;
  const codeInputId = `${inputId}-code`;
  const codeErrorId = `${codeInputId}-error`;
  const [phone, setPhone] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState("");
  const [challenge, setChallenge] = useState<ContactIdentityChallenge | null>(null);
  const [isCompleting, setIsCompleting] = useState(false);
  const wasOpenRef = useRef(open);
  const operationInFlightRef = useRef(false);
  const requestCode = useRequestContactIdentityCode();
  const verifyCode = useVerifyContactIdentityCode();
  const isBusy = isSubmitting || isCompleting || requestCode.isPending || verifyCode.isPending;

  useEffect(() => {
    if (!open) {
      setPhone("");
      setPhoneError("");
      setCode("");
      setCodeError("");
      setChallenge(null);
      setIsCompleting(false);
      operationInFlightRef.current = false;
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
    if (isBusy) return;
    onOpenChange(nextOpen);
  };

  const completeVerifiedPhone = async (verifiedPhone: string) => {
    setIsCompleting(true);
    try {
      await onSubmit(verifiedPhone);
    } finally {
      setIsCompleting(false);
    }
  };

  const handlePhoneSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isBusy || operationInFlightRef.current) return;

    const validation = validateContactPhone(phone);
    if (!validation.phone) {
      setPhoneError(validation.error || "رقم الجوال غير صحيح");
      return;
    }

    setPhoneError("");
    operationInFlightRef.current = true;
    try {
      const result = await requestCode.mutateAsync(validation.phone);
      if (result.alreadyVerified) {
        await completeVerifiedPhone(validation.phone);
        return;
      }
      setPhone(validation.phone);
      setChallenge(result);
      setCode("");
      setCodeError("");
    } catch (error) {
      setPhoneError(error instanceof Error ? error.message : "تعذر إرسال رمز التحقق");
    } finally {
      operationInFlightRef.current = false;
    }
  };

  const handleCodeSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isBusy || operationInFlightRef.current || !challenge?.challengeId) return;

    const validation = validateContactVerificationCode(code);
    if (!validation.code) {
      setCodeError(validation.error || "رمز التحقق غير صحيح");
      return;
    }

    setCodeError("");
    operationInFlightRef.current = true;
    let preparedExternalAction = false;
    let verificationCompleted = false;
    try {
      onBeforeCodeVerification?.();
      preparedExternalAction = Boolean(onBeforeCodeVerification);
      await verifyCode.mutateAsync({
        challengeId: challenge.challengeId,
        code: validation.code,
        clientPhone: phone,
      });
      verificationCompleted = true;
      await completeVerifiedPhone(phone);
    } catch (error) {
      if (preparedExternalAction) onCodeVerificationAborted?.();
      const message = error instanceof Error
        ? error.message
        : "رمز التحقق غير صحيح أو منتهي";
      if (verificationCompleted) {
        setChallenge(null);
        setCode("");
        setPhoneError(message);
      } else {
        setCodeError(message);
      }
    } finally {
      operationInFlightRef.current = false;
    }
  };

  const returnToPhoneStep = () => {
    if (isBusy) return;
    setChallenge(null);
    setCode("");
    setCodeError("");
    requestCode.reset();
    verifyCode.reset();
  };

  const isChangeMode = mode === "change";
  const isProfileMode = mode === "profile";
  const isCodeStep = Boolean(challenge?.challengeId);
  const expiryMinutes = challenge?.expiresInSeconds
    ? Math.max(1, Math.ceil(challenge.expiresInSeconds / 60))
    : null;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent dir="rtl" className="max-w-md border-[#ded3bc] bg-[#fffdf8] text-right">
        <DialogHeader className="text-right sm:text-right">
          <DialogTitle className="text-xl text-[#2f2a1f]">
            {isCodeStep
              ? "تحقق من رقم الجوال"
              : isChangeMode
                ? "تغيير رقم التواصل"
                : isProfileMode
                  ? "التحقق من رقم التواصل"
                : "أدخل رقم جوالك للمتابعة"}
          </DialogTitle>
          <DialogDescription className="pt-1 leading-6 text-[#6f6249]">
            {isCodeStep
              ? <>أرسلنا عبر واتساب رمز تحقق من 6 أرقام إلى الرقم <span dir="ltr">{challenge?.maskedPhone}</span>.</>
              : isChangeMode
                ? "أدخل الرقم الجديد وسنرسل إليه رمز تحقق قبل تحديث رقم التواصل."
                : isProfileMode
                  ? "أدخل رقم جوالك وسنرسل إليه رمز تحقق لعرض طلباتك بأمان."
                : "سنرسل رمز تحقق إلى رقمك قبل حفظه على هذا المتصفح والجهاز."}
          </DialogDescription>
          {!isCodeStep && isChangeMode && currentMaskedPhone ? (
            <p className="flex items-center gap-1 text-sm font-semibold text-[#5f543f]">
              <span>الرقم الحالي:</span>
              <span dir="ltr">{currentMaskedPhone}</span>
            </p>
          ) : null}
        </DialogHeader>

        {!isCodeStep ? (
          <form onSubmit={handlePhoneSubmit} className="space-y-4" noValidate aria-busy={isBusy}>
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
                disabled={isBusy}
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
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={isBusy}>
                إلغاء
              </Button>
              <Button type="submit" className="bg-[#128c47] text-white hover:bg-[#0f783d]" disabled={isBusy} data-testid="button-request-contact-code">
                {isBusy ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    جاري الإرسال...
                  </span>
                ) : (
                  <span>إرسال رمز التحقق</span>
                )}
              </Button>
            </div>
          </form>
        ) : (
          <form onSubmit={handleCodeSubmit} className="space-y-4" noValidate aria-busy={isBusy}>
            <div className="space-y-2">
              <Label htmlFor={codeInputId} className="font-semibold text-[#2f2a1f]">
                رمز التحقق
              </Label>
              <Input
                id={codeInputId}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="one-time-code"
                autoFocus
                dir="ltr"
                value={code}
                onChange={(event) => {
                  setCode(normalizePhoneDigits(event.target.value).slice(0, 6));
                  if (codeError) setCodeError("");
                }}
                placeholder="123456"
                maxLength={6}
                aria-invalid={Boolean(codeError)}
                aria-describedby={codeError ? codeErrorId : undefined}
                className={`text-center text-2xl tracking-[0.35em] ${codeError ? "border-red-500 focus-visible:ring-red-500" : ""}`}
                disabled={isBusy}
                data-testid="input-contact-verification-code"
              />
              {codeError ? (
                <p id={codeErrorId} className="text-sm font-medium text-red-600" role="alert">
                  {codeError}
                </p>
              ) : (
                <p className="text-xs leading-5 text-[#7a705f]">
                  {expiryMinutes
                    ? `الرمز صالح لمدة ${expiryMinutes} دقائق.`
                    : "أدخل الرمز المرسل إلى رقمك."}
                </p>
              )}
            </div>

            <button
              type="button"
              onClick={returnToPhoneStep}
              disabled={isBusy}
              className="text-sm font-semibold text-[#77663a] underline-offset-4 hover:underline disabled:opacity-50"
            >
              إعادة إرسال الرمز أو تغيير رقم الجوال
            </button>

            <div className="grid grid-cols-2 gap-3 pt-1">
              <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={isBusy}>
                إلغاء
              </Button>
              <Button type="submit" className="bg-[#128c47] text-white hover:bg-[#0f783d]" disabled={isBusy} data-testid="button-verify-contact-code">
                {isBusy ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    جاري التحقق...
                  </span>
                ) : (
                  <span>تأكيد رقم الجوال</span>
                )}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
