import { useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Package } from "@shared/schema";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Check, CreditCard, Upload, FileText } from "lucide-react";
import { useLocation } from "wouter";

export default function SubscriptionPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [selectedPackage, setSelectedPackage] = useState<string | null>(null);
  const [discountCode, setDiscountCode] = useState("");
  const [validatedDiscount, setValidatedDiscount] = useState<any>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<'online' | 'bank' | null>(null);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { data: packages = [] } = useQuery<Package[]>({
    queryKey: ['/api/packages'],
  });

  const validateDiscount = async () => {
    if (!discountCode) return;

    try {
      const response = await apiRequest('/api/discount/validate', {
        method: 'POST',
        body: JSON.stringify({ code: discountCode }),
      });
      setValidatedDiscount(response);
      toast({
        title: "كود الخصم صالح ✓",
        description: `سيتم خصم ${response.type === 'نسبة' ? response.value + '%' : response.value + ' ريال'}`,
      });
    } catch (error: any) {
      toast({
        title: "كود الخصم غير صالح",
        description: error.message,
        variant: "destructive",
      });
      setValidatedDiscount(null);
    }
  };

  const handleOnlinePayment = async () => {
    if (!selectedPackage) return;

    setIsProcessing(true);
    try {
      const response = await apiRequest('/api/owner/payment/initiate', {
        method: 'POST',
        body: JSON.stringify({
          packageId: selectedPackage,
          discountCode: validatedDiscount?.code,
          paymentMethod: 'cards',
        }),
      });

      // Open Paymob iframe
      window.open(response.iframeUrl, '_blank');
      
      toast({
        title: "جاري معالجة الدفع",
        description: "يرجى إكمال عملية الدفع في النافذة الجديدة",
      });
    } catch (error: any) {
      if (error.message?.includes('تسجيل الدخول')) {
        toast({
          title: "يجب تسجيل الدخول أولاً",
          description: "يرجى تسجيل الدخول كمالك عقار للمتابعة",
          variant: "destructive",
        });
        setTimeout(() => setLocation('/owner/login'), 2000);
      } else {
        toast({
          title: "خطأ في بدء عملية الدفع",
          description: error.message,
          variant: "destructive",
        });
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const handleBankTransfer = async () => {
    if (!selectedPackage || !receiptFile) {
      toast({
        title: "خطأ",
        description: "الرجاء رفع إيصال الدفع أولاً",
        variant: "destructive",
      });
      return;
    }

    setIsProcessing(true);
    try {
      // Convert file to base64
      const reader = new FileReader();
      const base64 = await new Promise<string>((resolve) => {
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(',')[1]);
        };
        reader.readAsDataURL(receiptFile);
      });

      const response = await apiRequest('/api/owner/payment/bank-transfer', {
        method: 'POST',
        body: JSON.stringify({
          packageId: selectedPackage,
          discountCode: validatedDiscount?.code,
          receiptFile: {
            name: receiptFile.name,
            type: receiptFile.type,
            data: base64,
          },
        }),
      });

      toast({
        title: "تم إرسال الطلب بنجاح ✅",
        description: "سيتم مراجعة الدفع وتفعيل الاشتراك خلال 24 ساعة",
      });

      // Reset file and payment method, but keep package selected
      setReceiptFile(null);
      setPaymentMethod(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
      
    } catch (error: any) {
      if (error.message?.includes('تسجيل الدخول')) {
        toast({
          title: "يجب تسجيل الدخول أولاً",
          description: "يرجى تسجيل الدخول كمالك عقار للمتابعة",
          variant: "destructive",
        });
        setTimeout(() => setLocation('/owner/login'), 2000);
      } else {
        toast({
          title: "خطأ في إرسال الطلب",
          description: error.message,
          variant: "destructive",
        });
      }
    } finally {
      setIsProcessing(false);
    }
  };

  const calculateFinalPrice = (price: number) => {
    if (!validatedDiscount) return price;
    
    if (validatedDiscount.type === 'نسبة') {
      return price - (price * validatedDiscount.value / 100);
    } else {
      return Math.max(0, price - validatedDiscount.value);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-card border-b border-border shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <h1 className="text-2xl font-bold text-primary">إدارة الاشتراك</h1>
          <p className="text-sm text-muted-foreground">اختر الباقة المناسبة لعقارك</p>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Discount Code */}
        <Card className="p-6 mb-8">
          <h2 className="text-lg font-bold mb-4">كود الخصم (اختياري)</h2>
          <div className="flex gap-2">
            <Input
              placeholder="أدخل كود الخصم"
              value={discountCode}
              onChange={(e) => setDiscountCode(e.target.value)}
              data-testid="input-discount-code"
            />
            <Button onClick={validateDiscount} data-testid="button-validate-discount">
              تحقق
            </Button>
          </div>
          {validatedDiscount && (
            <Badge className="mt-2" variant="default">
              خصم نشط: {validatedDiscount.type === 'نسبة' ? validatedDiscount.value + '%' : validatedDiscount.value + ' ريال'}
            </Badge>
          )}
        </Card>

        {/* Packages */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {packages.map(pkg => {
            const isSelected = selectedPackage === pkg.id;
            const originalPrice = pkg.price;
            const finalPrice = calculateFinalPrice(originalPrice);
            const hasDiscount = originalPrice !== finalPrice;

            return (
              <Card
                key={pkg.id}
                className={`p-6 cursor-pointer transition-all ${
                  isSelected
                    ? 'border-2 border-primary shadow-lg scale-105'
                    : 'hover:shadow-md hover:scale-102'
                }`}
                onClick={() => setSelectedPackage(pkg.id)}
                data-testid={`card-package-${pkg.id}`}
              >
                <div className="text-center mb-4">
                  <h3 className="text-xl font-bold text-primary mb-2">{pkg.name}</h3>
                  <Badge variant={pkg.type === 'موثوق' ? 'default' : 'secondary'}>
                    {pkg.type}
                  </Badge>
                </div>

                <div className="text-center mb-4">
                  <div className="text-3xl font-bold text-foreground">
                    {finalPrice} ريال
                  </div>
                  {hasDiscount && (
                    <div className="text-sm text-muted-foreground line-through">
                      {originalPrice} ريال
                    </div>
                  )}
                  <div className="text-sm text-muted-foreground mt-1">
                    المدة: {pkg.duration} يوم
                  </div>
                </div>

                {pkg.features.length > 0 && (
                  <div className="space-y-2 mb-4">
                    {pkg.features.map((feature, idx) => (
                      <div key={idx} className="flex items-center gap-2 text-sm">
                        <Check className="w-4 h-4 text-primary" />
                        <span>{feature}</span>
                      </div>
                    ))}
                  </div>
                )}

                {isSelected && (
                  <div className="absolute top-2 left-2">
                    <Badge variant="default">✓ محدد</Badge>
                  </div>
                )}
              </Card>
            );
          })}
        </div>

        {/* Payment Methods */}
        {selectedPackage && (
          <div className="mt-8">
            <Card className="p-6">
              <h2 className="text-xl font-bold mb-6 text-center">اختر طريقة الدفع</h2>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                {/* Online Payment */}
                <Card
                  className={`p-6 cursor-pointer transition-all hover:shadow-lg ${
                    paymentMethod === 'online'
                      ? 'border-2 border-primary shadow-lg bg-primary/5'
                      : 'border hover:border-primary/50'
                  }`}
                  onClick={() => setPaymentMethod('online')}
                  data-testid="card-payment-online"
                >
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                      <CreditCard className="w-8 h-8 text-primary" />
                    </div>
                    <h3 className="font-bold text-lg">الدفع عبر البوابة الإلكترونية</h3>
                    <p className="text-sm text-muted-foreground text-center">
                      بطاقات الائتمان • Apple Pay • مدى
                    </p>
                    {paymentMethod === 'online' && (
                      <Badge className="mt-2">✓ محدد</Badge>
                    )}
                  </div>
                </Card>

                {/* Bank Transfer */}
                <Card
                  className={`p-6 cursor-pointer transition-all hover:shadow-lg ${
                    paymentMethod === 'bank'
                      ? 'border-2 border-primary shadow-lg bg-primary/5'
                      : 'border hover:border-primary/50'
                  }`}
                  onClick={() => setPaymentMethod('bank')}
                  data-testid="card-payment-bank"
                >
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center">
                      <FileText className="w-8 h-8 text-primary" />
                    </div>
                    <h3 className="font-bold text-lg">الدفع عبر التحويل البنكي</h3>
                    <p className="text-sm text-muted-foreground text-center">
                      تحويل بنكي + رفع الإيصال
                    </p>
                    {paymentMethod === 'bank' && (
                      <Badge className="mt-2">✓ محدد</Badge>
                    )}
                  </div>
                </Card>
              </div>

              {/* Bank Transfer Upload */}
              {paymentMethod === 'bank' && (
                <Card className="p-4 bg-muted/50 mb-4">
                  <label className="block text-sm font-semibold mb-2">
                    📤 رفع إيصال الدفع (صورة أو PDF)
                  </label>
                  <Input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*,.pdf"
                    onChange={(e) => setReceiptFile(e.target.files?.[0] || null)}
                    data-testid="input-receipt-file"
                  />
                  {receiptFile && (
                    <p className="text-sm text-muted-foreground mt-2">
                      ✓ تم اختيار: {receiptFile.name}
                    </p>
                  )}
                </Card>
              )}

              {/* Payment Buttons */}
              <div className="flex flex-col gap-3">
                {paymentMethod === 'online' && (
                  <Button
                    size="lg"
                    className="gradient-golden w-full"
                    onClick={handleOnlinePayment}
                    disabled={isProcessing}
                    data-testid="button-pay-online"
                  >
                    <CreditCard className="w-5 h-5 ml-2" />
                    {isProcessing ? 'جاري المعالجة...' : 'متابعة إلى الدفع الإلكتروني'}
                  </Button>
                )}

                {paymentMethod === 'bank' && (
                  <Button
                    size="lg"
                    className="gradient-golden w-full"
                    onClick={handleBankTransfer}
                    disabled={isProcessing || !receiptFile}
                    data-testid="button-pay-bank"
                  >
                    <Upload className="w-5 h-5 ml-2" />
                    {isProcessing ? 'جاري الإرسال...' : 'إرسال الطلب'}
                  </Button>
                )}
              </div>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
