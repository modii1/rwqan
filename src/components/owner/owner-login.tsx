"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Home, Lock } from "lucide-react";
import { cleanPropertyNumber, validatePropertyNumber } from "@/lib/validation";

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
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md p-8 glass-premium border-primary/20 shadow-golden-lg hover:shadow-golden transition-shadow duration-300">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center shadow-golden">
              <Home className="w-8 h-8 text-primary" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-primary mb-2" data-testid="text-login-title">
            روقـان
          </h1>
          <p className="text-muted-foreground">تسجيل دخول آمن</p>
        </div>

        <Tabs value={mode} onValueChange={(v) => setMode(v as "owner" | "admin")} className="w-full">
          <TabsList className="grid w-full grid-cols-2 mb-6 bg-muted/50 p-1 rounded-xl">
            <TabsTrigger value="owner" className="gap-2 rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm transition-all duration-200">
              <Home className="w-4 h-4" />
              <span className="hidden sm:inline">صاحب العقار</span>
              <span className="sm:hidden">ملاك</span>
            </TabsTrigger>
            <TabsTrigger value="admin" className="gap-2 rounded-lg data-[state=active]:bg-white data-[state=active]:shadow-sm transition-all duration-200">
              <Lock className="w-4 h-4" />
              <span className="hidden sm:inline">المسؤول</span>
              <span className="sm:hidden">أدمن</span>
            </TabsTrigger>
          </TabsList>

          {/* Owner Login Tab */}
          <TabsContent value="owner">
            <form onSubmit={handleOwnerLogin} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold mb-2 text-foreground">رقم العقار (5 أرقام)</label>
                <Input
                  type="text"
                  placeholder="اخر 5 أرقام من جوالك"
                  value={propertyNumber}
                  onChange={(e) => setPropertyNumber(cleanPropertyNumber(e.target.value))}
                  disabled={isLoading}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={5}
                  data-testid="input-property-number"
                  className="rounded-xl border-border/50 focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all duration-300"
                />
                {propertyNumber && propertyNumber.length !== 5 && (
                  <p className="text-xs text-red-500 mt-1">يجب أن يكون 5 أرقام</p>
                )}
              </div>

              <div>
                <label className="block text-sm font-semibold mb-2 text-foreground">الرقم السري</label>
                <Input
                  type="password"
                  placeholder="••••••"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  disabled={isLoading}
                  data-testid="input-pin"
                  className="rounded-xl border-border/50 focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all duration-300"
                />
              </div>

              <Button
                type="submit"
                className="w-full rounded-xl h-12 text-base font-bold gradient-golden shadow-golden hover:shadow-golden-lg transition-all duration-300"
                disabled={isLoading}
                data-testid="button-login"
              >
                {isLoading ? (
                  <span className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    جاري تسجيل الدخول...
                  </span>
                ) : "تسجيل الدخول"}
              </Button>

              <div className="text-center">
                <Button
                  type="button"
                  variant="link"
                  onClick={() => router.push("/forgot-password")}
                  className="text-sm text-muted-foreground hover:text-primary transition-colors duration-200"
                  data-testid="link-forgot-password"
                >
                  نسيت الرقم السري؟
                </Button>
              </div>
            </form>

            <div className="mt-6 text-center text-sm text-muted-foreground pt-4 border-t border-border/30">
              <p>ليس لديك حساب؟</p>
              <Button
                variant="ghost"
                onClick={() => router.push("/subscription")}
                className="text-primary hover:text-primary/80 transition-colors duration-200"
                data-testid="link-register"
              >
                سجل معنا الآن
              </Button>
            </div>
          </TabsContent>

          {/* Admin Login Tab */}
          <TabsContent value="admin">
            <form onSubmit={handleAdminLogin} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold mb-2 text-foreground">كود المسؤول</label>
                <Input
                  type="text"
                  placeholder="أدخل كود المسؤول"
                  value={adminCode}
                  onChange={(e) => setAdminCode(e.target.value)}
                  disabled={isLoading}
                  data-testid="input-admin-code"
                  className="rounded-xl border-border/50 focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all duration-300"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold mb-2 text-foreground">كلمة المرور</label>
                <Input
                  type="password"
                  placeholder="••••••"
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  disabled={isLoading}
                  data-testid="input-admin-password"
                  className="rounded-xl border-border/50 focus:border-primary/50 focus:ring-2 focus:ring-primary/10 transition-all duration-300"
                />
              </div>

              <Button
                type="submit"
                className="w-full rounded-xl h-12 text-base font-bold gradient-golden shadow-golden hover:shadow-golden-lg transition-all duration-300"
                disabled={isLoading}
                data-testid="button-admin-login"
              >
                {isLoading ? (
                  <span className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    جاري تسجيل الدخول...
                  </span>
                ) : "تسجيل الدخول"}
              </Button>
            </form>
          </TabsContent>
        </Tabs>
      </Card>
    </div>
  );
}
