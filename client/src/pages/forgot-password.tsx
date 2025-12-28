import { useState } from "react";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { KeyRound, ArrowRight, Loader2, CheckCircle } from "lucide-react";
import { cleanPropertyNumber } from "@/lib/validation";

type Step = "request" | "verify" | "success";

export default function ForgotPassword() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  const [step, setStep] = useState<Step>("request");
  const [propertyNumber, setPropertyNumber] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [maskedPhone, setMaskedPhone] = useState("");
  
  const handleSendCode = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!propertyNumber || propertyNumber.length !== 5) {
      toast({
        title: "خطأ",
        description: "الرجاء إدخال رقم العقار (5 أرقام)",
        variant: "destructive",
      });
      return;
    }
    
    setIsLoading(true);
    
    try {
      const response = await fetch("/api/auth/send-reset-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ownerId: propertyNumber }),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        toast({
          title: "خطأ",
          description: data.message || "فشل في إرسال رمز التحقق",
          variant: "destructive",
        });
        setIsLoading(false);
        return;
      }
      
      setMaskedPhone(data.message);
      setStep("verify");
      
      toast({
        title: "تم الإرسال",
        description: data.message,
      });
      
    } catch (error) {
      console.error("Send reset code error:", error);
      toast({
        title: "خطأ",
        description: "تعذر الاتصال بالخادم",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleSetNewPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!resetCode || resetCode.length !== 6) {
      toast({
        title: "خطأ",
        description: "الرجاء إدخال رمز التحقق (6 أرقام)",
        variant: "destructive",
      });
      return;
    }
    
    if (!newPassword || newPassword.length < 4) {
      toast({
        title: "خطأ",
        description: "الرقم السري يجب أن يكون 4 أرقام على الأقل",
        variant: "destructive",
      });
      return;
    }
    
    if (newPassword !== confirmPassword) {
      toast({
        title: "خطأ",
        description: "الرقم السري غير متطابق",
        variant: "destructive",
      });
      return;
    }
    
    setIsLoading(true);
    
    try {
      const response = await fetch("/api/auth/set-new-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          ownerId: propertyNumber, 
          resetCode, 
          newPassword 
        }),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        toast({
          title: "خطأ",
          description: data.message || "فشل في تغيير الرقم السري",
          variant: "destructive",
        });
        setIsLoading(false);
        return;
      }
      
      setStep("success");
      
      toast({
        title: "تم بنجاح",
        description: "تم تغيير الرقم السري بنجاح",
      });
      
    } catch (error) {
      console.error("Set new password error:", error);
      toast({
        title: "خطأ",
        description: "تعذر الاتصال بالخادم",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="w-full max-w-md p-8">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
              <KeyRound className="w-8 h-8 text-primary" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-primary mb-2" data-testid="text-forgot-title">
            استعادة الرقم السري
          </h1>
          <p className="text-muted-foreground">
            {step === "request" && "سنرسل لك رمز تحقق عبر الواتساب"}
            {step === "verify" && maskedPhone}
            {step === "success" && "تم تغيير الرقم السري بنجاح"}
          </p>
        </div>

        {step === "request" && (
          <form onSubmit={handleSendCode} className="space-y-4">
            <div>
              <label className="block text-sm font-semibold mb-2">رقم العقار (5 أرقام)</label>
              <Input
                type="text"
                placeholder="أدخل رقم العقار"
                value={propertyNumber}
                onChange={(e) => setPropertyNumber(cleanPropertyNumber(e.target.value))}
                disabled={isLoading}
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={5}
                data-testid="input-property-number"
              />
              {propertyNumber && propertyNumber.length !== 5 && (
                <p className="text-xs text-red-500 mt-1">يجب أن يكون 5 أرقام</p>
              )}
            </div>

            <Button
              type="submit"
              className="w-full gradient-golden"
              disabled={isLoading || propertyNumber.length !== 5}
              data-testid="button-send-code"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                  جاري الإرسال...
                </>
              ) : (
                "إرسال رمز التحقق"
              )}
            </Button>
            
            <p className="text-xs text-center text-muted-foreground">
              يمكنك إعادة تعيين الرقم السري مرة واحدة كل 30 يوم
            </p>
          </form>
        )}

        {step === "verify" && (
          <form onSubmit={handleSetNewPassword} className="space-y-4">
            <div>
              <label className="block text-sm font-semibold mb-2">رمز التحقق (6 أرقام)</label>
              <Input
                type="text"
                placeholder="أدخل رمز التحقق"
                value={resetCode}
                onChange={(e) => setResetCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                disabled={isLoading}
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                className="text-center text-2xl tracking-widest"
                data-testid="input-reset-code"
              />
              <p className="text-xs text-muted-foreground mt-1 text-center">
                الرمز صالح لمدة 10 دقائق
              </p>
            </div>
            
            <div>
              <label className="block text-sm font-semibold mb-2">الرقم السري الجديد</label>
              <Input
                type="password"
                placeholder="أدخل الرقم السري الجديد"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={isLoading}
                data-testid="input-new-password"
              />
            </div>
            
            <div>
              <label className="block text-sm font-semibold mb-2">تأكيد الرقم السري</label>
              <Input
                type="password"
                placeholder="أعد إدخال الرقم السري"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={isLoading}
                data-testid="input-confirm-password"
              />
            </div>

            <Button
              type="submit"
              className="w-full gradient-golden"
              disabled={isLoading || resetCode.length !== 6 || !newPassword || newPassword !== confirmPassword}
              data-testid="button-set-password"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                  جاري الحفظ...
                </>
              ) : (
                "تغيير الرقم السري"
              )}
            </Button>
          </form>
        )}

        {step === "success" && (
          <div className="text-center space-y-6">
            <div className="flex justify-center">
              <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center">
                <CheckCircle className="w-12 h-12 text-green-600" />
              </div>
            </div>
            
            <p className="text-lg font-semibold text-green-600">
              تم تغيير الرقم السري بنجاح
            </p>
            
            <Button
              onClick={() => setLocation("/owner/login")}
              className="w-full gradient-golden"
              data-testid="button-go-login"
            >
              <ArrowRight className="w-4 h-4 ml-2" />
              تسجيل الدخول
            </Button>
          </div>
        )}

        {step !== "success" && (
          <div className="mt-6 text-center">
            <Button
              variant="ghost"
              onClick={() => setLocation("/owner/login")}
              className="text-muted-foreground"
              data-testid="link-back-login"
            >
              العودة لتسجيل الدخول
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}
