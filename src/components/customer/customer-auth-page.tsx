"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowRight, CheckCircle2, Loader2, LockKeyhole, Phone, UserRound } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  validateContactPhone,
  validateContactVerificationCode,
} from "@/components/contact/contact-phone-dialog";
import {
  customerSessionCacheScopeForIdentity,
  hasServerResolvedContactIdentity,
  useContactIdentityQuery,
  useRequestContactIdentityCode,
  useVerifyContactIdentityCode,
  type ContactIdentity,
  type ContactIdentityChallenge,
} from "@/hooks/use-contact-identity";
import {
  CUSTOMER_PROFILE_QUERY_KEY,
  setCustomerFavorite,
  updateCustomerProfile,
} from "@/hooks/use-customer-account";
import {
  safeCustomerReturnPath,
  safePendingFavorite,
} from "@/lib/customer-login-redirect";
import { normalizePhoneDigits } from "@shared/phone";
import { useToast } from "@/hooks/use-toast";

interface CustomerAuthPageProps {
  variant: "login" | "register";
}

export default function CustomerAuthPage({ variant }: CustomerAuthPageProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const identity = useContactIdentityQuery();
  const requestCode = useRequestContactIdentityCode();
  const verifyCode = useVerifyContactIdentityCode();
  const redirectedRef = useRef(false);
  const authFlowStartedRef = useRef(false);
  const [phone, setPhone] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [challenge, setChallenge] = useState<ContactIdentityChallenge | null>(null);
  const [error, setError] = useState("");
  const [isCompleting, setIsCompleting] = useState(false);

  const isRegister = variant === "register";
  const returnTo = safeCustomerReturnPath(searchParams.get("returnTo"));
  const pendingFavorite = safePendingFavorite(searchParams.get("favorite"));
  const switchParams = new URLSearchParams({ returnTo });
  if (pendingFavorite) switchParams.set("favorite", pendingFavorite);
  const switchHref = `${isRegister ? "/customer/login" : "/customer/register"}?${switchParams.toString()}`;
  const isCodeStep = Boolean(challenge?.challengeId);
  const isBusy = requestCode.isPending || verifyCode.isPending || isCompleting;
  const hasResolvedIdentity = hasServerResolvedContactIdentity(identity);

  const completeAuthentication = async (
    applyRegistrationDetails = false,
    authenticatedIdentity: ContactIdentity | undefined = identity.data,
  ) => {
    if (redirectedRef.current) return;
    redirectedRef.current = true;
    setIsCompleting(true);
    try {
      const customerSessionScope = customerSessionCacheScopeForIdentity(
        authenticatedIdentity,
      );
      if (!customerSessionScope) {
        throw new Error("تعذر التحقق من جلسة العميل. حاول تسجيل الدخول مرة أخرى.");
      }
      if (isRegister && applyRegistrationDetails) {
        await updateCustomerProfile({
          fullName: fullName.trim(),
          email: email.trim() || null,
        }, customerSessionScope);
      }
      if (pendingFavorite) {
        try {
          await setCustomerFavorite(
            pendingFavorite,
            true,
            customerSessionScope,
          );
        } catch (favoriteError) {
          toast({
            title: "تم تسجيل الدخول، وتعذر حفظ العقار",
            description: favoriteError instanceof Error
              ? favoriteError.message
              : "حاول إضافته إلى المفضلة مرة أخرى.",
            variant: "destructive",
          });
        }
      }
      await queryClient.invalidateQueries({ queryKey: CUSTOMER_PROFILE_QUERY_KEY });
      router.replace(returnTo);
    } catch (completionError) {
      redirectedRef.current = false;
      authFlowStartedRef.current = false;
      setChallenge(null);
      setError(
        completionError instanceof Error
          ? completionError.message
          : "تعذر إكمال تسجيل الدخول. حاول مرة أخرى.",
      );
    } finally {
      setIsCompleting(false);
    }
  };

  useEffect(() => {
    if (
      hasResolvedIdentity
      && identity.data?.kind === "client"
      && !redirectedRef.current
      && !authFlowStartedRef.current
    ) {
      void completeAuthentication(false, identity.data);
    }
  }, [hasResolvedIdentity, identity.data?.kind]);

  const validateRegistration = (): boolean => {
    if (!isRegister) return true;
    if (fullName.trim().length < 2) {
      setError("أدخل الاسم الكامل.");
      return false;
    }
    if (email.trim() && !/^\S+@\S+\.\S+$/.test(email.trim())) {
      setError("أدخل بريدًا إلكترونيًا صحيحًا.");
      return false;
    }
    return true;
  };

  const handlePhoneSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isBusy || !validateRegistration()) return;
    const validated = validateContactPhone(phone);
    if (!validated.phone) {
      setError(validated.error || "رقم الجوال غير صحيح");
      return;
    }
    setError("");
    authFlowStartedRef.current = true;
    try {
      const result = await requestCode.mutateAsync(validated.phone);
      setPhone(validated.phone);
      if (result.alreadyVerified) {
        await completeAuthentication(isRegister, result.identity);
        return;
      }
      setChallenge(result);
      setCode("");
    } catch (requestError) {
      authFlowStartedRef.current = false;
      setError(requestError instanceof Error ? requestError.message : "تعذر إرسال رمز التحقق");
    }
  };

  const handleCodeSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isBusy || !challenge?.challengeId) return;
    const validated = validateContactVerificationCode(code);
    if (!validated.code) {
      setError(validated.error || "رمز التحقق غير صحيح");
      return;
    }
    setError("");
    try {
      const verifiedIdentity = await verifyCode.mutateAsync({
        challengeId: challenge.challengeId,
        clientPhone: phone,
        code: validated.code,
      });
      await completeAuthentication(isRegister, verifiedIdentity);
    } catch (verificationError) {
      setError(
        verificationError instanceof Error
          ? verificationError.message
          : "رمز التحقق غير صحيح أو منتهي",
      );
    }
  };

  if (!hasResolvedIdentity && (identity.isPending || identity.isFetching)) {
    return (
      <AuthCanvas>
        <div className="flex min-h-[360px] items-center justify-center" role="status" aria-label="جاري التحقق من الحساب">
          <Loader2 className="h-7 w-7 animate-spin text-[#9a7623]" />
        </div>
      </AuthCanvas>
    );
  }

  const privilegedSession = identity.data?.kind === "owner" || identity.data?.kind === "admin";

  return (
    <AuthCanvas>
      <Card className="overflow-hidden border-[#ded3bc] bg-[#fffdf8] shadow-lg">
        <div className="border-b border-[#eadfc8] bg-[#f7eed9] px-5 py-6 sm:px-8">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-2xl bg-[#9a7623] text-white">
              <UserRound className="h-6 w-6" aria-hidden="true" />
            </div>
            <div>
              <p className="text-xs font-bold text-[#8b6b25]">حساب العميل</p>
              <h1 className="mt-1 text-2xl font-bold text-[#2f2a1f]">
                {isRegister ? "إنشاء حساب جديد" : "تسجيل الدخول"}
              </h1>
            </div>
          </div>
          <p className="mt-4 text-sm leading-7 text-[#6f6249]">
            {isRegister
              ? "أنشئ حسابك برقم الجوال لحفظ المفضلة ومتابعة طلبات التواصل والحجوزات."
              : "ادخل برقم جوالك الموثق للوصول إلى حسابك ومفضّلتك وسجل حجوزاتك."}
          </p>
        </div>

        <div className="px-5 py-6 sm:px-8 sm:py-8">
          {privilegedSession ? (
            <div className="text-center">
              <LockKeyhole className="mx-auto h-10 w-10 text-[#9a7623]" />
              <p className="mt-4 font-bold text-[#2f2a1f]">أنت مسجل الدخول بحساب إداري أو حساب مالك</p>
              <p className="mt-2 text-sm leading-6 text-[#6f6249]">سجّل الخروج منه أولاً قبل الدخول بحساب عميل.</p>
              <Button asChild variant="outline" className="mt-5">
                <Link href="/">العودة للرئيسية</Link>
              </Button>
            </div>
          ) : !isCodeStep ? (
            <form onSubmit={handlePhoneSubmit} className="space-y-5" noValidate>
              {isRegister && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="customer-full-name">الاسم الكامل</Label>
                    <Input
                      id="customer-full-name"
                      value={fullName}
                      onChange={(event) => setFullName(event.target.value.slice(0, 100))}
                      autoComplete="name"
                      disabled={isBusy}
                      aria-invalid={Boolean(error)}
                      aria-describedby={error ? "customer-auth-error" : undefined}
                    />
                  </div>
                  <div className="space-y-2 sm:col-span-2">
                    <Label htmlFor="customer-email">البريد الإلكتروني (اختياري)</Label>
                    <Input
                      id="customer-email"
                      type="email"
                      dir="ltr"
                      value={email}
                      onChange={(event) => setEmail(event.target.value.slice(0, 254))}
                      autoComplete="email"
                      disabled={isBusy}
                      aria-invalid={Boolean(error)}
                      aria-describedby={error ? "customer-auth-error" : undefined}
                    />
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="customer-phone">رقم الجوال</Label>
                <div className="relative">
                  <Phone className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#8b7140]" aria-hidden="true" />
                  <Input
                    id="customer-phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    dir="ltr"
                    value={phone}
                    onChange={(event) => setPhone(event.target.value.slice(0, 20))}
                    placeholder="05XXXXXXXX"
                    className="pr-10"
                    disabled={isBusy}
                    aria-invalid={Boolean(error)}
                    aria-describedby={error ? "customer-auth-error" : undefined}
                  />
                </div>
                <p className="text-xs leading-5 text-[#7a705f]">سنرسل رمز تحقق إلى واتساب للتأكد من ملكية الرقم.</p>
              </div>

              {error && <p id="customer-auth-error" role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>}

              <Button type="submit" className="h-12 w-full bg-[#9a7623] text-white hover:bg-[#80601b]" disabled={isBusy} aria-label={isBusy ? "جاري إرسال رمز التحقق" : undefined}>
                {isBusy ? <><Loader2 className="h-5 w-5 animate-spin" /><span className="sr-only">جاري إرسال رمز التحقق</span></> : "إرسال رمز التحقق"}
              </Button>
            </form>
          ) : (
            <form onSubmit={handleCodeSubmit} className="space-y-5" noValidate>
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm leading-6 text-emerald-800">
                <CheckCircle2 className="mb-2 h-5 w-5" aria-hidden="true" />
                أرسلنا عبر واتساب رمز تحقق من 6 أرقام إلى الرقم <span dir="ltr" className="font-bold">{challenge?.maskedPhone}</span>.
              </div>
              <div className="space-y-2">
                <Label htmlFor="customer-code">رمز التحقق</Label>
                <Input
                  id="customer-code"
                  value={code}
                  onChange={(event) => setCode(normalizePhoneDigits(event.target.value).slice(0, 6))}
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  dir="ltr"
                  maxLength={6}
                  className="text-center text-2xl tracking-[0.35em]"
                  disabled={isBusy}
                  autoFocus
                  aria-invalid={Boolean(error)}
                  aria-describedby={error ? "customer-auth-error" : undefined}
                />
              </div>
              {error && <p id="customer-auth-error" role="alert" className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</p>}
              <button
                type="button"
                className="text-sm font-semibold text-[#77663a] underline-offset-4 hover:underline"
                onClick={() => {
                  authFlowStartedRef.current = false;
                  setChallenge(null);
                  setCode("");
                  setError("");
                }}
                disabled={isBusy}
              >
                إعادة إرسال الرمز أو تغيير رقم الجوال
              </button>
              <Button type="submit" className="h-12 w-full bg-[#128c47] text-white hover:bg-[#0f783d]" disabled={isBusy} aria-label={isBusy ? "جاري تأكيد رقم الجوال" : undefined}>
                {isBusy ? <><Loader2 className="h-5 w-5 animate-spin" /><span className="sr-only">جاري تأكيد رقم الجوال</span></> : "تأكيد رقم الجوال"}
              </Button>
            </form>
          )}

          {!privilegedSession && (
            <div className="mt-6 flex flex-col items-center gap-3 border-t border-[#eadfc8] pt-5 text-sm text-[#6f6249] sm:flex-row sm:justify-between">
              <Link
                href={switchHref}
                className="font-bold text-[#80601b] underline-offset-4 hover:underline"
              >
                {isRegister ? "لديك حساب؟ تسجيل الدخول" : "مستخدم جديد؟ إنشاء حساب"}
              </Link>
              <Link href="/owner/login" className="inline-flex items-center gap-1 font-semibold hover:text-[#80601b]">
                دخول الملاك
                <ArrowRight className="h-4 w-4" aria-hidden="true" />
              </Link>
            </div>
          )}
        </div>
      </Card>
    </AuthCanvas>
  );
}

function AuthCanvas({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-[calc(100vh-70px)] bg-[#faf8f1] px-4 py-8 sm:py-14" dir="rtl">
      <div className="mx-auto w-full max-w-xl">{children}</div>
    </div>
  );
}
