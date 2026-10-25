"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, LogIn } from "lucide-react";
import { AuthGateway } from "@/components/auth/auth-gateway";
import CustomerAuthPage, { CustomerAuthPageFallback } from "@/components/customer/customer-auth-page";
import { OwnerAccountLogin } from "@/components/owner/owner-account-login";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import type { AuthRole } from "@/lib/auth-role";
import { getSafeOwnerLoginDestination } from "@/lib/owner-login-redirect";
import { cleanPropertyNumber } from "@/lib/validation";

interface OwnerLoginProps {
  initialMode?: AuthRole;
}

const authCopy: Record<AuthRole, {
  contextLabel: string;
  heading: string;
  description: string;
}> = {
  customer: {
    contextLabel: "حساب العميل",
    heading: "تسجيل الدخول",
    description: "ادخل برقم جوالك الموثق للوصول إلى حسابك ومفضّلتك وسجل حجوزاتك.",
  },
  owner: {
    contextLabel: "مالك العقار",
    heading: "دخول مالك العقار",
    description: "أدخل بيانات حسابك للمتابعة",
  },
  admin: {
    contextLabel: "المسؤول",
    heading: "دخول المسؤول",
    description: "أدخل بيانات حسابك للمتابعة",
  },
};

const authPageTitles: Record<AuthRole, string> = {
  customer: "تسجيل دخول العميل | روقان",
  owner: "تسجيل الدخول | مالك العقار",
  admin: "دخول المسؤول | روقان",
};

export default function OwnerLogin({ initialMode = "owner" }: OwnerLoginProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [mode, setMode] = useState<AuthRole>(initialMode);
  const [propertyNumber, setPropertyNumber] = useState("");
  const [pin, setPin] = useState("");
  const [adminCode, setAdminCode] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isCustomerBusy, setIsCustomerBusy] = useState(false);
  const [isOwnerAccountBusy, setIsOwnerAccountBusy] = useState(false);
  const [ownerLoginMethod, setOwnerLoginMethod] = useState<"account" | "legacy">("account");

  useEffect(() => {
    document.title = authPageTitles[mode];
  }, [mode]);

  const handleRoleChange = (nextMode: AuthRole) => {
    if (isLoading || isCustomerBusy) return;
    setMode(nextMode);
    const nextUrl = new URL(window.location.href);
    nextUrl.searchParams.set("mode", nextMode);
    window.history.replaceState(window.history.state, "", nextUrl);
  };

  const handleOwnerLogin = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!propertyNumber || !pin) {
      toast({
        title: "خطأ",
        description: "الرجاء إدخال رقم العقار والرقم السري",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch("/api/owner/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ propertyNumber, pin }),
      });

      const data = await response.json();

      if (!response.ok) {
        toast({
          title: "فشل تسجيل الدخول",
          description: data.error || "رقم العقار أو الرقم السري غير صحيح",
          variant: "destructive",
        });
        setIsLoading(false);
        return;
      }

      toast({
        title: "تم تسجيل الدخول",
        description: "مرحباً بك في لوحة التحكم",
      });

      window.location.href = getSafeOwnerLoginDestination(window.location.search);
    } catch (error) {
      console.error("Login error:", error);
      toast({
        title: "خطأ غير متوقع",
        description: "تعذر الاتصال بالخادم",
        variant: "destructive",
      });
      setIsLoading(false);
    }
  };

  const handleAdminLogin = async (event: React.FormEvent) => {
    event.preventDefault();

    if (!adminCode || !adminPassword) {
      toast({
        title: "خطأ",
        description: "الرجاء إدخال كود الأدمن وكلمة المرور",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ code: adminCode, password: adminPassword }),
      });

      const data = await response.json();

      if (!response.ok) {
        toast({
          title: "فشل تسجيل الدخول",
          description: data.error || "كود الأدمن أو كلمة المرور غير صحيحة",
          variant: "destructive",
        });
        setIsLoading(false);
        return;
      }

      toast({
        title: "تم تسجيل الدخول",
        description: "مرحباً بك في لوحة الإدارة",
      });

      window.location.href = "/admin";
    } catch (error) {
      console.error("Admin login error:", error);
      toast({
        title: "خطأ غير متوقع",
        description: "تعذر الاتصال بالخادم",
        variant: "destructive",
      });
      setIsLoading(false);
    }
  };

  const handleOwnerAccountAuthenticated = () => {
    toast({
      title: "تم تسجيل الدخول",
      description: "مرحباً بك في لوحة التحكم",
    });
    window.location.href = getSafeOwnerLoginDestination(window.location.search);
  };

  const copy = authCopy[mode];

  return (
    <AuthGateway
      activeRole={mode}
      contextLabel={copy.contextLabel}
      heading={copy.heading}
      description={copy.description}
      onRoleChange={handleRoleChange}
      disabled={isLoading || isCustomerBusy || isOwnerAccountBusy}
      titleTestId="text-login-title"
    >
      {mode === "customer" ? (
        <Suspense fallback={<CustomerAuthPageFallback variant="login" embedded />}>
          <CustomerAuthPage
            variant="login"
            embedded
            onBusyChange={setIsCustomerBusy}
          />
        </Suspense>
      ) : mode === "owner" ? (
        <div className="mx-auto w-full max-w-xl" data-testid="auth-panel-owner">
          <Tabs
            value={ownerLoginMethod}
            onValueChange={(value) => setOwnerLoginMethod(value as "account" | "legacy")}
            dir="rtl"
          >
            <TabsList
              aria-label="طريقة دخول مالك العقار"
              className="mb-6 grid h-auto w-full grid-cols-2 rounded-xl border border-[#ded5c2] bg-[#f0ede5] p-1"
            >
              <TabsTrigger
                value="account"
                disabled={isLoading || isOwnerAccountBusy}
                className="min-h-11 rounded-lg font-bold data-[state=active]:bg-white data-[state=active]:text-[#29372f]"
                data-testid="owner-login-method-account"
              >
                رقم الجوال
              </TabsTrigger>
              <TabsTrigger
                value="legacy"
                disabled={isLoading || isOwnerAccountBusy}
                className="min-h-11 rounded-lg font-bold data-[state=active]:bg-white data-[state=active]:text-[#29372f]"
                data-testid="owner-login-method-legacy"
              >
                رقم العقار
              </TabsTrigger>
            </TabsList>

            <TabsContent value="account" className="mt-0">
              <OwnerAccountLogin
                onAuthenticated={handleOwnerAccountAuthenticated}
                onBusyChange={setIsOwnerAccountBusy}
              />
            </TabsContent>

            <TabsContent value="legacy" className="mt-0">
              <form onSubmit={handleOwnerLogin} className="space-y-5">
                <div>
                  <label className="mb-2 block text-sm font-semibold text-[#242822]" htmlFor="owner-property-number">رقم العقار</label>
                  <Input
                    id="owner-property-number"
                    type="text"
                    placeholder="5 أرقام"
                    value={propertyNumber}
                    onChange={(event) => setPropertyNumber(cleanPropertyNumber(event.target.value))}
                    disabled={isLoading}
                    inputMode="numeric"
                    pattern="[0-9]*"
                    dir="ltr"
                    autoComplete="username"
                    maxLength={5}
                    data-testid="input-property-number"
                    className="h-12 rounded-xl border-[#d9cfb8] bg-white text-base focus-visible:ring-[#9a7623]"
                  />
                  {propertyNumber && propertyNumber.length !== 5 && (
                    <p className="mt-1 text-xs text-red-500">يجب أن يكون 5 أرقام</p>
                  )}
                </div>

                <div>
                  <label className="mb-2 block text-sm font-semibold text-[#242822]" htmlFor="owner-pin">الرقم السري</label>
                  <Input
                    id="owner-pin"
                    type="password"
                    placeholder="••••••"
                    value={pin}
                    onChange={(event) => setPin(event.target.value)}
                    autoComplete="current-password"
                    dir="ltr"
                    disabled={isLoading}
                    data-testid="input-pin"
                    className="h-12 rounded-xl border-[#d9cfb8] bg-white text-base focus-visible:ring-[#9a7623]"
                  />
                </div>

                <Button
                  type="submit"
                  className="h-12 w-full rounded-xl bg-[#29372f] text-base font-bold text-white hover:bg-[#1f2b25]"
                  disabled={isLoading}
                  data-testid="button-login"
                >
                  {isLoading ? (
                    <span className="flex items-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      جاري تسجيل الدخول...
                    </span>
                  ) : (
                    <span className="flex items-center gap-2">
                      <LogIn className="h-4 w-4" />
                      تسجيل الدخول
                    </span>
                  )}
                </Button>

                <div className="text-center">
                  <Button
                    type="button"
                    variant="link"
                    onClick={() => router.push("/forgot-password")}
                    className="h-auto text-sm text-[#687064] hover:text-[#242822]"
                    data-testid="link-forgot-password"
                  >
                    نسيت الرقم السري؟
                  </Button>
                </div>
              </form>
            </TabsContent>
          </Tabs>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-1 border-t border-[#e9dfca] pt-5 text-sm text-[#687064]">
            <span>ليس لديك حساب؟</span>
            <Button
              variant="link"
              onClick={() => router.push("/subscription")}
              className="h-auto gap-1 px-1 font-bold text-[#80621d]"
              data-testid="link-register"
            >
              سجل معنا الآن
              <ArrowLeft className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      ) : (
        <div className="mx-auto w-full max-w-xl" data-testid="auth-panel-admin">
          <form onSubmit={handleAdminLogin} className="space-y-5">
            <div>
              <label className="mb-2 block text-sm font-semibold text-[#242822]" htmlFor="admin-code">اسم المستخدم</label>
              <Input
                id="admin-code"
                type="text"
                placeholder="أدخل كود المسؤول"
                value={adminCode}
                onChange={(event) => setAdminCode(event.target.value)}
                autoComplete="username"
                dir="ltr"
                disabled={isLoading}
                data-testid="input-admin-code"
                className="h-12 rounded-xl border-[#d9cfb8] bg-white text-base focus-visible:ring-[#9a7623]"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-semibold text-[#242822]" htmlFor="admin-password">كلمة المرور</label>
              <Input
                id="admin-password"
                type="password"
                placeholder="••••••"
                value={adminPassword}
                onChange={(event) => setAdminPassword(event.target.value)}
                autoComplete="current-password"
                dir="ltr"
                disabled={isLoading}
                data-testid="input-admin-password"
                className="h-12 rounded-xl border-[#d9cfb8] bg-white text-base focus-visible:ring-[#9a7623]"
              />
            </div>

            <Button
              type="submit"
              className="h-12 w-full rounded-xl bg-[#29372f] text-base font-bold text-white hover:bg-[#1f2b25]"
              disabled={isLoading}
              data-testid="button-admin-login"
            >
              {isLoading ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  جاري تسجيل الدخول...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <LogIn className="h-4 w-4" />
                  تسجيل الدخول
                </span>
              )}
            </Button>
          </form>
        </div>
      )}
    </AuthGateway>
  );
}
