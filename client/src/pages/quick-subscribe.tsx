import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Package } from "@shared/schema";
import { CheckCircle, AlertCircle } from "lucide-react";

type Step = 'verify' | 'select' | 'payment' | 'success';

export default function QuickSubscribePage() {
  const { toast } = useToast();
  const [step, setStep] = useState<Step>('verify');
  const [propertyNumber, setPropertyNumber] = useState("");
  const [pin, setPin] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifiedProperty, setVerifiedProperty] = useState<any>(null);

  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<string | null>(null);
  const [paymentInfo, setPaymentInfo] = useState<any>(null);
  const [isProcessing, setIsProcessing] = useState(false);

  const { data: packages = [] } = useQuery<Package[]>({
    queryKey: ["/api/packages"],
  });

  const selectedPackage = packages.find(p => p.id === selectedPackageId);

  // التحقق من العقار والرقم السري
  const handleVerify = async () => {
    if (!propertyNumber || !pin) {
      toast({
        title: "خطأ",
        description: "أدخل رقم العقار والرقم السري",
        variant: "destructive",
      });
      return;
    }

    setIsVerifying(true);
    try {
      const response = await apiRequest('POST', '/api/public/verify-property', {
        propertyNumber,
        pin,
      });
      const data = await response.json();
      setVerifiedProperty(data);
      setStep('select');
      toast({
        title: "تم التحقق بنجاح",
        description: `مرحباً بك ${data.name}`,
      });
    } catch (error: any) {
      toast({
        title: "خطأ في التحقق",
        description: error.message || "رقم العقار أو الرقم السري غير صحيح",
        variant: "destructive",
      });
    } finally {
      setIsVerifying(false);
    }
  };

  // اختيار الباقة والدفع
  const handleSelectPackage = async () => {
    if (!selectedPackageId) {
      toast({
        title: "خطأ",
        description: "اختر باقة",
        variant: "destructive",
      });
      return;
    }

    const pkg = packages.find(p => p.id === selectedPackageId);
    if (!pkg) return;

    // إذا كانت الباقة مجانية
    if (pkg.price === 0) {
      setIsProcessing(true);
      try {
        await apiRequest('POST', '/api/public/subscribe', {
          propertyNumber,
          packageId: selectedPackageId,
        });
        setStep('success');
        toast({
          title: "نجح",
          description: "تم تفعيل اشتراكك بنجاح",
        });
      } catch (error: any) {
        toast({
          title: "خطأ",
          description: error.message,
          variant: "destructive",
        });
      } finally {
        setIsProcessing(false);
      }
    } else {
      // عرض خيارات الدفع
      setPaymentInfo({
        packageId: selectedPackageId,
        packageName: pkg.name,
        price: pkg.price,
        duration: pkg.duration,
      });
      setStep('payment');
    }
  };

  // تأكيد الدفع والاشتراك
  const handleConfirmPayment = async () => {
    if (!selectedPaymentMethod) {
      toast({
        title: "خطأ",
        description: "اختر طريقة دفع",
        variant: "destructive",
      });
      return;
    }

    setIsProcessing(true);
    try {
      toast({
        title: "جاري الدفع",
        description: `سيتم توجيهك لـ ${selectedPaymentMethod}...`,
      });

      // محاكاة الدفع
      setTimeout(() => {
        // بعد الدفع الناجح
        handleConfirmSubscription();
      }, 1000);
    } catch (error: any) {
      toast({
        title: "خطأ",
        description: error.message,
        variant: "destructive",
      });
      setIsProcessing(false);
    }
  };

  const handleConfirmSubscription = async () => {
    try {
      await apiRequest('POST', '/api/public/subscribe', {
        propertyNumber,
        packageId: selectedPackageId,
      });
      setStep('success');
      toast({
        title: "نجح",
        description: "تم تفعيل اشتراكك بنجاح",
      });
    } catch (error: any) {
      toast({
        title: "خطأ",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <header className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-[#434040] mb-2">اشترك الآن</h1>
          <p className="text-muted-foreground">ارقِ عقارك بدون تسجيل دخول</p>
        </header>

        {/* Step 1: التحقق */}
        {step === 'verify' && (
          <Card className="p-8 border-[#e0c97b]">
            <h2 className="text-2xl font-bold text-[#434040] mb-6">تحقق من عقارك</h2>
            <div className="space-y-4 max-w-md mx-auto">
              <div>
                <label className="block text-sm font-semibold mb-2">رقم العقار (5 أرقام)</label>
                <Input
                  placeholder="00123"
                  value={propertyNumber}
                  onChange={(e) => setPropertyNumber(e.target.value.slice(0, 5))}
                  maxLength={5}
                  data-testid="input-property-number"
                />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-2">الرقم السري</label>
                <Input
                  type="password"
                  placeholder="أدخل الرقم السري"
                  value={pin}
                  onChange={(e) => setPin(e.target.value)}
                  data-testid="input-pin"
                />
              </div>
              <Button
                onClick={handleVerify}
                disabled={isVerifying || !propertyNumber || !pin}
                className="w-full"
                data-testid="button-verify"
              >
                {isVerifying ? 'جاري التحقق...' : 'متابعة'}
              </Button>
            </div>
          </Card>
        )}

        {/* Step 2: اختيار الباقة */}
        {step === 'select' && verifiedProperty && (
          <Card className="p-8 border-[#e0c97b] bg-gradient-to-r from-[#fffdf0] to-background mb-6">
            <div className="flex items-center gap-3 mb-6">
              <CheckCircle className="w-6 h-6 text-green-600" />
              <div>
                <h2 className="text-xl font-bold text-[#434040]">{verifiedProperty.name}</h2>
                <p className="text-sm text-muted-foreground">رقم العقار: {propertyNumber}</p>
              </div>
            </div>

            <div>
              <h3 className="text-lg font-bold text-[#434040] mb-4">اختر الباقة</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                {packages.map(pkg => (
                  <div
                    key={pkg.id}
                    onClick={() => setSelectedPackageId(pkg.id)}
                    className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                      selectedPackageId === pkg.id
                        ? 'border-[#b88d2b] bg-[#fffdf0]'
                        : 'border-border hover:border-[#b88d2b]'
                    }`}
                    data-testid={`card-package-${pkg.id}`}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <h4 className="font-bold text-[#434040]">{pkg.name}</h4>
                      {pkg.type === 'موثوق' && (
                        <Badge className="bg-[#b88d2b] text-white text-xs">موثوق</Badge>
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground mb-2">{pkg.duration} يوم</p>
                    <p className="text-2xl font-bold text-[#b88d2b]">
                      {pkg.price === 0 ? 'مجاني' : `${pkg.price} ر.س`}
                    </p>
                  </div>
                ))}
              </div>

              <div className="flex gap-3">
                <Button
                  onClick={handleSelectPackage}
                  disabled={!selectedPackageId || isProcessing}
                  className="flex-1"
                  data-testid="button-select-package"
                >
                  {isProcessing ? 'جاري المعالجة...' : 'متابعة'}
                </Button>
                <Button
                  onClick={() => {
                    setStep('verify');
                    setSelectedPackageId(null);
                    setVerifiedProperty(null);
                  }}
                  variant="outline"
                  className="flex-1"
                >
                  إلغاء
                </Button>
              </div>
            </div>
          </Card>
        )}

        {/* Step 3: طريقة الدفع */}
        {step === 'payment' && paymentInfo && (
          <Card className="p-8 border-[#b88d2b] bg-[#fffdf0]">
            <h2 className="text-2xl font-bold text-[#434040] mb-6">معلومات الدفع</h2>

            <div className="bg-white p-4 rounded-lg mb-6 border border-[#e0c97b]">
              <div className="flex justify-between mb-3">
                <span className="text-muted-foreground">الباقة:</span>
                <span className="font-bold text-[#434040]">{paymentInfo.packageName}</span>
              </div>
              <div className="flex justify-between mb-3">
                <span className="text-muted-foreground">المدة:</span>
                <span className="font-bold text-[#434040]">{paymentInfo.duration} يوم</span>
              </div>
              <div className="flex justify-between border-t pt-3">
                <span className="text-lg font-bold text-[#434040]">الإجمالي:</span>
                <span className="text-2xl font-bold text-[#b88d2b]">{paymentInfo.price} ر.س</span>
              </div>
            </div>

            <div className="mb-6">
              <h3 className="text-lg font-bold mb-3 text-[#434040]">اختر طريقة الدفع:</h3>
              <div className="space-y-2">
                {['بطاقة', 'Apple Pay', 'تحويل بنكي'].map(method => (
                  <label
                    key={method}
                    className="flex items-center gap-3 p-3 border rounded-lg cursor-pointer hover:bg-gray-50"
                    data-testid={`payment-method-${method}`}
                  >
                    <input
                      type="radio"
                      name="paymentMethod"
                      value={method}
                      checked={selectedPaymentMethod === method}
                      onChange={(e) => setSelectedPaymentMethod(e.target.value)}
                    />
                    <span className="font-medium">{method}</span>
                  </label>
                ))}
              </div>
            </div>

            <div className="flex gap-3">
              <Button
                onClick={handleConfirmPayment}
                disabled={!selectedPaymentMethod || isProcessing}
                className="flex-1"
                data-testid="button-confirm-payment"
              >
                {isProcessing ? 'جاري الدفع...' : 'تأكيد الدفع'}
              </Button>
              <Button
                onClick={() => {
                  setStep('select');
                  setPaymentInfo(null);
                  setSelectedPaymentMethod(null);
                }}
                variant="outline"
                className="flex-1"
              >
                إلغاء
              </Button>
            </div>
          </Card>
        )}

        {/* Step 4: النجاح */}
        {step === 'success' && (
          <Card className="p-8 text-center border-green-300 bg-green-50">
            <CheckCircle className="w-16 h-16 text-green-600 mx-auto mb-4" />
            <h2 className="text-2xl font-bold text-green-700 mb-2">نجح!</h2>
            <p className="text-green-600 mb-6">تم تفعيل اشتراكك بنجاح</p>
            <Button
              onClick={() => window.location.href = '/'}
              className="w-full md:w-auto"
              data-testid="button-back-home"
            >
              العودة للصفحة الرئيسية
            </Button>
          </Card>
        )}
      </div>
    </div>
  );
}
