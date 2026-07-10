"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Home, Loader2, Lock, LogIn } from "lucide-react";
import { cleanPropertyNumber } from "@/lib/validation";

export default function OwnerLogin() {
  const router = useRouter();
  const { toast } = useToast();
  const [mode, setMode] = useState<"owner" | "admin">("owner");

  // Owner fields
  const [propertyNumber, setPropertyNumber] = useState("");
  const [pin, setPin] = useState("");

  // Admin fields
  const [adminCode, setAdminCode] = useState("");
  const [adminPassword, setAdminPassword] = useState("");

  const [isLoading, setIsLoading] = useState(false);

  const handleOwnerLogin = async (e: React.FormEvent) => {
    e.preventDefault();

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

      window.location.href = "/owner/dashboard";
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

  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();

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

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#f5f6f3] px-3 py-6 sm:px-6">
      <Card className="w-full max-w-md overflow-hidden rounded-lg border border-[#dfe2dc] bg-white shadow-xl shadow-black/[0.05]">
        <div className="border-b border-[#eceee9] bg-[#fbfcfa] px-5 py-5 text-center sm:px-7">
          <img src="/assets/logo-full.png" alt="روقان" className="mx-auto h-14 w-auto object-contain" />
          <h1 className="mt-3 text-xl font-bold text-[#242822]" data-testid="text-login-title">
            {mode === "owner" ? "دخول مالك العقار" : "دخول المسؤول"}
          </h1>
          <p className="mt-1 text-sm text-[#687064]">أدخل بيانات حسابك للمتابعة</p>
        </div>

        <Tabs value={mode} onValueChange={(v) => setMode(v as "owner" | "admin")} className="w-full px-5 py-5 sm:px-7 sm:py-6">
          <TabsList className="mb-6 grid h-11 w-full grid-cols-2 rounded-lg bg-[#eef0eb] p-1">
            <TabsTrigger value="owner" className="h-9 gap-2 rounded-md data-[state=active]:bg-white data-[state=active]:shadow-sm">
              <Home className="w-4 h-4" />
              مالك العقار
            </TabsTrigger>
            <TabsTrigger value="admin" className="h-9 gap-2 rounded-md data-[state=active]:bg-white data-[state=active]:shadow-sm">
              <Lock className="w-4 h-4" />
              المسؤول
            </TabsTrigger>
          </TabsList>

          {/* Owner Login Tab */}
          <TabsContent value="owner">
            <form onSubmit={handleOwnerLogin} className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-semibold text-[#242822]" htmlFor="owner-property-number">رقم العقار</label>
                <Input
                  id="owner-property-number"
                  type="text"
                  placeholder="5 أرقام"
                  value={propertyNumber}
                  onChange={(e) => setPropertyNumber(cleanPropertyNumber(e.target.value))}
                  disabled={isLoading}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={5}
                  data-testid="input-property-number"
                  className="h-11 rounded-lg border-[#dfe2dc] bg-white text-base"
                />
                {propertyNumber && propertyNumber.length !== 5 && (
                  <p className="text-xs text-red-500 mt-1">يجب أن يكون 5 أرقام</p>
                )}
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold text-[#242822]" htmlFor="owner-pin">الرقم السري</label>
                <Input
                  id="owner-pin"
                  type="password"
                  placeholder="••••••"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  disabled={isLoading}
                  data-testid="input-pin"
                  className="h-11 rounded-lg border-[#dfe2dc] bg-white text-base"
                />
              </div>

              <Button
                type="submit"
                className="h-12 w-full rounded-lg bg-[#242822] text-base font-bold text-white hover:bg-[#242822]"
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

            <div className="mt-5 flex items-center justify-center gap-1 border-t border-[#eceee9] pt-5 text-sm text-[#687064]">
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
          </TabsContent>

          {/* Admin Login Tab */}
          <TabsContent value="admin">
            <form onSubmit={handleAdminLogin} className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-semibold text-[#242822]" htmlFor="admin-code">كود المسؤول</label>
                <Input
                  id="admin-code"
                  type="text"
                  placeholder="أدخل كود المسؤول"
                  value={adminCode}
                  onChange={(e) => setAdminCode(e.target.value)}
                  disabled={isLoading}
                  data-testid="input-admin-code"
                  className="h-11 rounded-lg border-[#dfe2dc] bg-white text-base"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-semibold text-[#242822]" htmlFor="admin-password">كلمة المرور</label>
                <Input
                  id="admin-password"
                  type="password"
                  placeholder="••••••"
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  disabled={isLoading}
                  data-testid="input-admin-password"
                  className="h-11 rounded-lg border-[#dfe2dc] bg-white text-base"
                />
              </div>

              <Button
                type="submit"
                className="h-12 w-full rounded-lg bg-[#242822] text-base font-bold text-white hover:bg-[#242822]"
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
          </TabsContent>
        </Tabs>
      </Card>
    </main>
  );
}
