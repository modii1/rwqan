"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { Building2, KeyRound, Loader2, Plus, ShieldCheck } from "lucide-react";
import { normalizePhoneDigits } from "@shared/phone";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  ownerAccountApiError,
  parseOwnerAccountChallenge,
  validateOwnerAccountCode,
  validateOwnerAccountPropertyNumber,
  type OwnerAccountChallenge,
  type OwnerSession,
} from "@/lib/owner-account-client";
import { queryClient } from "@/lib/queryClient";
import { cleanPropertyNumber } from "@/lib/validation";

export function OwnerAccountManager() {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [propertyNumber, setPropertyNumber] = useState("");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState<OwnerAccountChallenge | null>(null);
  const [isPropertyConfirmed, setIsPropertyConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const { data: session } = useQuery<OwnerSession>({
    queryKey: ["/api/owner/session"],
    queryFn: async () => {
      const response = await fetch("/api/owner/session", {
        credentials: "include",
        cache: "no-store",
      });
      if (!response.ok) return { isLoggedIn: false };
      return response.json();
    },
    retry: false,
    refetchOnWindowFocus: false,
  });

  const hasOwnerAccount = session?.hasOwnerAccount === true;
  const actionLabel = hasOwnerAccount ? "إضافة عقار" : "توثيق حساب المالك";

  useEffect(() => {
    if (open) return;
    setPropertyNumber("");
    setCode("");
    setChallenge(null);
    setIsPropertyConfirmed(false);
    setError("");
    setIsBusy(false);
  }, [open]);

  if (!session?.isLoggedIn) return null;

  const handleOpenChange = (nextOpen: boolean) => {
    if (isBusy) return;
    setOpen(nextOpen);
  };

  const handlePropertyNumberChange = (value: string) => {
    setPropertyNumber(cleanPropertyNumber(value));
    // Changing the target property invalidates any confirmation and any
    // previously issued challenge/code; the user must start over.
    setIsPropertyConfirmed(false);
    setChallenge(null);
    setCode("");
    if (error) setError("");
  };

  const requestCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isBusy) return;

    let requestedPropertyNumber: string | undefined;
    if (hasOwnerAccount) {
      const validation = validateOwnerAccountPropertyNumber(propertyNumber);
      if (!validation.propertyNumber) {
        setError(validation.error || "رقم العقار غير صحيح");
        return;
      }
      if (!isPropertyConfirmed) {
        setError("أكّد أنك تريد إضافة هذا العقار إلى حسابك أولاً.");
        return;
      }
      requestedPropertyNumber = validation.propertyNumber;
    }

    setError("");
    setIsBusy(true);
    try {
      const response = await fetch(
        hasOwnerAccount
          ? "/api/owner/account/properties/challenge"
          : "/api/owner/account/claim/challenge",
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(hasOwnerAccount ? { propertyNumber: requestedPropertyNumber } : {}),
        },
      );
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(ownerAccountApiError(payload, "تعذر إرسال رمز التحقق"));
      }

      const nextChallenge = parseOwnerAccountChallenge(payload);
      if (!nextChallenge) throw new Error("تعذر تأكيد إرسال رمز التحقق");

      if (requestedPropertyNumber) setPropertyNumber(requestedPropertyNumber);
      setCode("");
      setChallenge(nextChallenge);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "تعذر إرسال رمز التحقق");
    } finally {
      setIsBusy(false);
    }
  };

  const verifyCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isBusy || !challenge) return;

    const validation = validateOwnerAccountCode(code);
    if (!validation.code) {
      setError(validation.error || "رمز التحقق غير صحيح");
      return;
    }

    setError("");
    setIsBusy(true);
    try {
      const response = await fetch(
        hasOwnerAccount
          ? "/api/owner/account/properties/verify"
          : "/api/owner/account/claim/verify",
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            challengeId: challenge.challengeId,
            code: validation.code,
          }),
        },
      );
      const payload = await response.json().catch(() => null) as {
        ok?: unknown;
        code?: unknown;
      } | null;
      if (!response.ok || payload?.ok !== true) {
        const failureCode = typeof payload?.code === "string" ? payload.code : "";
        if (
          failureCode === "CHALLENGE_EXPIRED" ||
          failureCode === "CHALLENGE_USED" ||
          failureCode === "CHALLENGE_CONTEXT_INVALID" ||
          failureCode === "ATTEMPTS_EXHAUSTED"
        ) {
          // The challenge is no longer usable; return to the start so the user
          // explicitly re-confirms the target property before a new attempt.
          setChallenge(null);
          setCode("");
          setIsPropertyConfirmed(false);
        }
        throw new Error(ownerAccountApiError(payload, "رمز التحقق غير صحيح أو منتهي"));
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["/api/owner/session"] }),
        queryClient.invalidateQueries({ queryKey: ["/api/owner/properties"] }),
      ]);
      setOpen(false);
      toast({
        title: hasOwnerAccount ? "تمت إضافة العقار" : "تم توثيق حساب المالك",
        description: hasOwnerAccount
          ? "يمكنك الآن الانتقال إلى العقار من القائمة."
          : "يمكنك الآن الدخول برقم الجوال وإدارة عقاراتك من حساب واحد.",
      });
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : "رمز التحقق غير صحيح أو منتهي");
    } finally {
      setIsBusy(false);
    }
  };

  const returnToStart = () => {
    if (isBusy) return;
    setChallenge(null);
    setCode("");
    setIsPropertyConfirmed(false);
    setError("");
  };

  const expiryMinutes = challenge
    ? Math.max(1, Math.ceil(challenge.expiresInSeconds / 60))
    : null;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => setOpen(true)}
        title={actionLabel}
        aria-label={actionLabel}
        className="h-10 flex-none gap-1.5 border-[#d8c9a8] bg-[#fffdf8] px-2 text-[#654f1d] hover:bg-[#fbf7ee] sm:px-3"
        data-testid="button-owner-account-manager"
      >
        {hasOwnerAccount ? (
          <span className="relative">
            <Building2 className="h-4 w-4" aria-hidden="true" />
            <Plus className="absolute -left-1.5 -top-1.5 h-3 w-3 rounded-full bg-[#fffdf8]" aria-hidden="true" />
          </span>
        ) : (
          <ShieldCheck className="h-4 w-4" aria-hidden="true" />
        )}
        <span className="text-xs sm:hidden">{hasOwnerAccount ? "إضافة" : "توثيق"}</span>
        <span className="hidden sm:inline lg:hidden xl:inline">{actionLabel}</span>
      </Button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          dir="rtl"
          className="max-h-[calc(100svh-1.5rem)] w-[calc(100%-1.5rem)] max-w-md overflow-y-auto rounded-2xl border-[#ded3bc] bg-[#fffdf8] p-5 text-right sm:p-6"
          data-testid="owner-account-dialog"
        >
          <DialogHeader className="pl-7 text-right sm:text-right">
            <DialogTitle className="text-xl text-[#2f2a1f]">
              {challenge
                ? "أدخل رمز التحقق"
                : hasOwnerAccount
                  ? "أضف عقاراً إلى حسابك"
                  : "وثّق حساب المالك"}
            </DialogTitle>
            <DialogDescription className="pt-1 leading-6 text-[#6f6249]">
              {challenge
                ? <>أرسلنا رمزاً من 6 أرقام إلى رقم التواصل <span dir="ltr">{challenge.maskedPhone}</span>.</>
                : hasOwnerAccount
                  ? "أدخل رقم العقار وسنتحقق من رقم التواصل المسجل له قبل إضافته."
                  : "سنرسل رمزاً إلى رقم التواصل المسجل للعقار الحالي، ثم يصبح بإمكانك الدخول برقم الجوال."}
            </DialogDescription>
          </DialogHeader>

          {!challenge ? (
            <form onSubmit={requestCode} className="space-y-4" noValidate aria-busy={isBusy}>
              {hasOwnerAccount ? (
                <div className="space-y-2">
                  <Label htmlFor="owner-account-property-number" className="font-semibold text-[#2f2a1f]">
                    رقم العقار
                  </Label>
                  <Input
                    id="owner-account-property-number"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    autoComplete="off"
                    autoFocus
                    dir="ltr"
                    value={propertyNumber}
                    onChange={(event) => {
                      handlePropertyNumberChange(event.target.value);
                    }}
                    maxLength={5}
                    placeholder="5 أرقام"
                    aria-invalid={Boolean(error)}
                    aria-describedby={error ? "owner-account-manager-error" : undefined}
                    disabled={isBusy}
                    data-testid="input-owner-account-property"
                    className="h-12 rounded-xl border-[#d9cfb8] bg-white text-base focus-visible:ring-[#9a7623]"
                  />

                  {propertyNumber.length === 5 ? (
                    <div
                      className="rounded-xl border border-[#e2d7c1] bg-[#fbf7ee] p-3 text-sm leading-6 text-[#625c4f]"
                      data-testid="owner-account-attach-confirmation"
                    >
                      <p>
                        سيتم إضافة العقار رقم{" "}
                        <span dir="ltr" className="font-bold text-[#29372f]">{propertyNumber}</span>{" "}
                        إلى حسابك الحالي بعد التحقق من رقم التواصل المسجل له.
                      </p>
                      <div className="mt-2 flex items-start gap-2">
                        <Checkbox
                          id="owner-account-confirm-property"
                          checked={isPropertyConfirmed}
                          onCheckedChange={(checked) => {
                            setIsPropertyConfirmed(checked === true);
                            if (error) setError("");
                          }}
                          disabled={isBusy}
                          aria-label={`تأكيد إضافة العقار ${propertyNumber}`}
                          data-testid="checkbox-owner-account-confirm-property"
                          className="mt-0.5 border-[#9a7623] data-[state=checked]:bg-[#29372f] data-[state=checked]:text-[#d8bf76]"
                        />
                        <Label
                          htmlFor="owner-account-confirm-property"
                          className="cursor-pointer text-sm font-semibold leading-6 text-[#2f2a1f]"
                        >
                          أؤكد أنني أريد إضافة العقار رقم{" "}
                          <span dir="ltr">{propertyNumber}</span> إلى حسابي.
                        </Label>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="flex items-start gap-3 rounded-xl border border-[#d8c9a8] bg-[#fbf7ee] p-4 text-sm leading-6 text-[#625c4f]">
                  <ShieldCheck className="mt-0.5 h-5 w-5 flex-none text-[#80621d]" aria-hidden="true" />
                  <p>لن ننشئ الحساب قبل التأكد من امتلاكك رقم التواصل المسجل للعقار.</p>
                </div>
              )}

              {error ? (
                <p id="owner-account-manager-error" className="text-sm font-medium text-red-600" role="alert">
                  {error}
                </p>
              ) : null}

              <div className="grid grid-cols-2 gap-3 pt-1">
                <Button type="button" variant="outline" onClick={() => handleOpenChange(false)} disabled={isBusy}>
                  إلغاء
                </Button>
                <Button
                  type="submit"
                  className="bg-[#29372f] font-bold text-white hover:bg-[#1f2b25]"
                  disabled={
                    isBusy ||
                    (hasOwnerAccount && (!isPropertyConfirmed || propertyNumber.length !== 5))
                  }
                  data-testid="button-owner-account-manager-challenge"
                >
                  {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                  إرسال رمز التحقق
                </Button>
              </div>
            </form>
          ) : (
            <form onSubmit={verifyCode} className="space-y-4" noValidate aria-busy={isBusy}>
              {hasOwnerAccount ? (
                <p className="rounded-lg bg-[#f0ede5] px-3 py-2 text-xs text-[#6f6249]">
                  العقار المستهدف:{" "}
                  <span dir="ltr" className="font-bold text-[#29372f]">{propertyNumber}</span>
                </p>
              ) : null}
              {expiryMinutes ? (
                <p className="rounded-lg bg-[#f0ede5] px-3 py-2 text-xs text-[#6f6249]">
                  ينتهي الرمز خلال {expiryMinutes} دقائق.
                </p>
              ) : null}

              <div className="space-y-2">
                <Label htmlFor="owner-account-manager-code" className="font-semibold text-[#2f2a1f]">
                  رمز التحقق
                </Label>
                <div className="relative">
                  <KeyRound className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8b7140]" aria-hidden="true" />
                  <Input
                    id="owner-account-manager-code"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    autoComplete="one-time-code"
                    autoFocus
                    dir="ltr"
                    value={code}
                    onChange={(event) => {
                      setCode(normalizePhoneDigits(event.target.value).slice(0, 6));
                      if (error) setError("");
                    }}
                    maxLength={6}
                    aria-invalid={Boolean(error)}
                    aria-describedby={error ? "owner-account-manager-error" : undefined}
                    disabled={isBusy}
                    data-testid="input-owner-account-manager-code"
                    className="h-12 rounded-xl border-[#d9cfb8] bg-white pr-10 text-center text-xl tracking-[0.45em] focus-visible:ring-[#9a7623]"
                  />
                </div>
              </div>

              {error ? (
                <p id="owner-account-manager-error" className="text-sm font-medium text-red-600" role="alert">
                  {error}
                </p>
              ) : null}

              <div className="grid grid-cols-2 gap-3 pt-1">
                <Button type="button" variant="outline" onClick={returnToStart} disabled={isBusy}>
                  رجوع
                </Button>
                <Button
                  type="submit"
                  className="bg-[#29372f] font-bold text-white hover:bg-[#1f2b25]"
                  disabled={isBusy}
                  data-testid="button-owner-account-manager-verify"
                >
                  {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
                  تأكيد
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
