import { useState } from "react";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Home } from "lucide-react";

export default function OwnerLogin() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [propertyNumber, setPropertyNumber] = useState("");
  const [pin, setPin] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
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
        headers: {
          "Content-Type": "application/json",
        },
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

      // Use full page redirect for production compatibility
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
          <p className="text-muted-foreground">تسجيل دخول أصحاب العقارات</p>
        </div>

        <form onSubmit={handleLogin} className="space-y-4">
          <div>
            <label className="block text-sm font-semibold mb-2">رقم العقار</label>
            <Input
              type="text"
              placeholder="00123"
              value={propertyNumber}
              onChange={(e) => setPropertyNumber(e.target.value)}
              required
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
              required
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
            onClick={() => setLocation("/register")}
            className="text-primary"
            data-testid="link-register"
          >
            سجل عقارك الآن
          </Button>
        </div>
      </Card>
    </div>
  );
}
