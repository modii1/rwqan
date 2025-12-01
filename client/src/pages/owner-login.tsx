import { useState } from "react";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Home, Lock } from "lucide-react";

export default function OwnerLogin() {
  const [, setLocation] = useLocation();
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
      <Card className="w-full max-w-md p-8">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
              <Home className="w-8 h-8 text-primary" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-primary mb-2" data-testid="text-login-title">
            مودي الذكي
          </h1>
          <p className="text-muted-foreground">تسجيل دخول آمن</p>
        </div>

        <Tabs value={mode} onValueChange={(v) => setMode(v as "owner" | "admin")} className="w-full">
          <TabsList className="grid w-full grid-cols-2 mb-6">
            <TabsTrigger value="owner" className="gap-2">
              <Home className="w-4 h-4" />
              <span className="hidden sm:inline">صاحب العقار</span>
              <span className="sm:hidden">ملاك</span>
            </TabsTrigger>
            <TabsTrigger value="admin" className="gap-2">
              <Lock className="w-4 h-4" />
              <span className="hidden sm:inline">المسؤول</span>
              <span className="sm:hidden">أدمن</span>
            </TabsTrigger>
          </TabsList>

          {/* Owner Login Tab */}
          <TabsContent value="owner">
            <form onSubmit={handleOwnerLogin} className="space-y-4">
              <div>
                <label className="block text-sm font-semibold mb-2">رقم العقار</label>
                <Input
                  type="text"
                  placeholder="00123"
                  value={propertyNumber}
                  onChange={(e) => setPropertyNumber(e.target.value)}
                  disabled={isLoading}
                  data-testid="input-property-number"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold mb-2">الرقم السري</label>
                <Input
                  type="password"
                  placeholder="••••••"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  disabled={isLoading}
                  data-testid="input-pin"
                />
              </div>

              <Button
                type="submit"
                className="w-full gradient-golden"
                disabled={isLoading}
                data-testid="button-login"
              >
                {isLoading ? "جاري تسجيل الدخول..." : "تسجيل الدخول"}
              </Button>
            </form>

            <div className="mt-6 text-center text-sm text-muted-foreground">
              <p>ليس لديك حساب؟</p>
              <Button
                variant="link"
                onClick={() => setLocation("/subscription")}
                className="text-primary"
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
                <label className="block text-sm font-semibold mb-2">كود المسؤول</label>
                <Input
                  type="text"
                  placeholder="أدخل كود المسؤول"
                  value={adminCode}
                  onChange={(e) => setAdminCode(e.target.value)}
                  disabled={isLoading}
                  data-testid="input-admin-code"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold mb-2">كلمة المرور</label>
                <Input
                  type="password"
                  placeholder="••••••"
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  disabled={isLoading}
                  data-testid="input-admin-password"
                />
              </div>

              <Button
                type="submit"
                className="w-full gradient-golden"
                disabled={isLoading}
                data-testid="button-admin-login"
              >
                {isLoading ? "جاري تسجيل الدخول..." : "تسجيل الدخول"}
              </Button>
            </form>
          </TabsContent>
        </Tabs>
      </Card>
    </div>
  );
}
