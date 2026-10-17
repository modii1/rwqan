"use client";

import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { KeyRound, Loader2, ShieldCheck, Smartphone } from "lucide-react";
import { normalizePhoneDigits } from "@shared/phone";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ownerAccountApiError,
  parseOwnerAccountChallenge,
  validateOwnerAccountCode,
  validateOwnerAccountPhone,
  type OwnerAccountChallenge,
} from "@/lib/owner-account-client";

interface OwnerAccountLoginProps {
  onAuthenticated: () => void;
  onBusyChange?: (busy: boolean) => void;
}

export function OwnerAccountLogin({
  onAuthenticated,
  onBusyChange,
}: OwnerAccountLoginProps) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState<OwnerAccountChallenge | null>(null);
  const [error, setError] = useState("");
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    onBusyChange?.(isBusy);
  }, [isBusy, onBusyChange]);

  const requestCode = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isBusy) return;

    const validation = validateOwnerAccountPhone(phone);
    if (!validation.phone) {
      setError(validation.error || "رقم الجوال غير صحيح");
      return;
    }

    setError("");
    setIsBusy(true);
    try {
      const response = await fetch("/api/owner/account/login/challenge", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: validation.phone }),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(ownerAccountApiError(payload, "تعذر إرسال رمز التحقق"));
      }

      const nextChallenge = parseOwnerAccountChallenge(payload);
      if (!nextChallenge) throw new Error("تعذر تأكيد إرسال رمز التحقق");

      setPhone(validation.phone);
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
      const response = await fetch("/api/owner/account/login/verify", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          challengeId: challenge.challengeId,
          phone,
          code: validation.code,
        }),
      });
      const payload = await response.json().catch(() => null) as { ok?: unknown } | null;
      if (!response.ok || payload?.ok !== true) {
        throw new Error(ownerAccountApiError(payload, "رمز التحقق غير صحيح أو منتهي"));
      }

      onAuthenticated();
    } catch (verifyError) {
      setError(verifyError instanceof Error ? verifyError.message : "رمز التحقق غير صحيح أو منتهي");
    } finally {
      setIsBusy(false);
    }
  };

  const returnToPhone = () => {
    if (isBusy) return;
    setChallenge(null);
    setCode("");
    setError("");
  };

  const expiryMinutes = challenge
    ? Math.max(1, Math.ceil(challenge.expiresInSeconds / 60))
    : null;

  return (
    <div data-testid="owner-account-login" className="space-y-5">
      <div className="flex items-start gap-3 rounded-xl border border-[#d8c9a8] bg-[#fbf7ee] p-4">
        <span className="inline-flex h-10 w-10 flex-none items-center justify-center rounded-lg bg-[#29372f] text-[#d8bf76]">
          <ShieldCheck className="h-5 w-5" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="font-bold text-[#293129]">حساب واحد لكل عقاراتك</p>
          <p className="mt-1 text-sm leading-6 text-[#6f685b]">
            ادخل برقم الجوال الموثق وانتقل بين عقاراتك من لوحة واحدة.
          </p>
        </div>
      </div>

      {!challenge ? (
        <form onSubmit={requestCode} className="space-y-4" noValidate aria-busy={isBusy}>
          <div className="space-y-2">
            <Label htmlFor="owner-account-phone" className="font-semibold text-[#242822]">
              رقم الجوال
            </Label>
            <div className="relative">
              <Smartphone className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8b7140]" aria-hidden="true" />
              <Input
                id="owner-account-phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                dir="ltr"
                value={phone}
                onChange={(event) => {
                  setPhone(event.target.value.slice(0, 20));
                  if (error) setError("");
                }}
                placeholder="05XXXXXXXX"
                aria-invalid={Boolean(error)}
                aria-describedby={error ? "owner-account-login-error" : "owner-account-phone-help"}
                disabled={isBusy}
                data-testid="input-owner-account-phone"
                className="h-12 rounded-xl border-[#d9cfb8] bg-white pl-3 pr-10 text-base focus-visible:ring-[#9a7623]"
              />
            </div>
            {!error ? (
              <p id="owner-account-phone-help" className="text-xs leading-5 text-[#7a705f]">
                يمكنك إدخاله بصيغة 05XXXXXXXX أو 9665XXXXXXXX.
              </p>
            ) : null}
          </div>

          {error ? (
            <p id="owner-account-login-error" className="text-sm font-medium text-red-600" role="alert">
              {error}
            </p>
          ) : null}

          <Button
            type="submit"
            className="h-12 w-full rounded-xl bg-[#29372f] text-base font-bold text-white hover:bg-[#1f2b25]"
            disabled={isBusy}
            data-testid="button-owner-account-challenge"
          >
            {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Smartphone className="h-4 w-4" />}
            إرسال رمز التحقق
          </Button>
        </form>
      ) : (
        <form onSubmit={verifyCode} className="space-y-4" noValidate aria-busy={isBusy}>
          <div className="rounded-xl border border-[#e9dfca] bg-white p-4 text-sm leading-6 text-[#625c4f]">
            أرسلنا رمز التحقق إلى الرقم <span dir="ltr" className="font-bold text-[#293129]">{challenge.maskedPhone}</span>.
            {expiryMinutes ? <span> ينتهي خلال {expiryMinutes} دقائق.</span> : null}
          </div>

          <div className="space-y-2">
            <Label htmlFor="owner-account-code" className="font-semibold text-[#242822]">
              رمز التحقق
            </Label>
            <div className="relative">
              <KeyRound className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8b7140]" aria-hidden="true" />
              <Input
                id="owner-account-code"
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="one-time-code"
                dir="ltr"
                value={code}
                onChange={(event) => {
                  setCode(normalizePhoneDigits(event.target.value).slice(0, 6));
                  if (error) setError("");
                }}
                maxLength={6}
                aria-invalid={Boolean(error)}
                aria-describedby={error ? "owner-account-login-error" : undefined}
                disabled={isBusy}
                data-testid="input-owner-account-code"
                className="h-12 rounded-xl border-[#d9cfb8] bg-white pl-3 pr-10 text-center text-xl tracking-[0.45em] focus-visible:ring-[#9a7623]"
              />
            </div>
          </div>

          {error ? (
            <p id="owner-account-login-error" className="text-sm font-medium text-red-600" role="alert">
              {error}
            </p>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            <Button type="button" variant="outline" onClick={returnToPhone} disabled={isBusy}>
              تغيير رقم الجوال
            </Button>
            <Button
              type="submit"
              className="bg-[#29372f] font-bold text-white hover:bg-[#1f2b25]"
              disabled={isBusy}
              data-testid="button-owner-account-verify"
            >
              {isBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
              دخول آمن
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}
