import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Package } from "@shared/schema";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { ChevronRight, Upload, CheckCircle2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";

type Step = 1 | 2 | 3;

export default function QuickSubscribePage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [currentStep, setCurrentStep] = useState<Step>(1);
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null);
  const [packageToView, setPackageToView] = useState<Package | null>(null);

  // Step 1: Verify
  const [propertyNumber, setPropertyNumber] = useState("");
  const [pin, setPin] = useState("");
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifiedProperty, setVerifiedProperty] = useState<any>(null);

  // Step 3: Payment
  const [discountCode, setDiscountCode] = useState("");
  const [validatedDiscount, setValidatedDiscount] = useState<any>(null);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'online' | 'bank' | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const { data: packages = [] } = useQuery<Package[]>({
    queryKey: ["/api/packages"],
  });

  const selectedPackage = packages.find(p => p.id === selectedPackageId);
  const isFreePackage = selectedPackage?.price === 0;

  // Verify property
  const handleVerify = async () => {
    if (!propertyNumber || !pin) {
      toast({ title: "خطأ", description: "أدخل رقم العقار والرقم السري", variant: "destructive" });
      return;
    }
    setIsVerifying(true);
    try {
      const response = await apiRequest('POST', '/api/public/verify-property', { propertyNumber, pin });
      const data = await response.json();
      setVerifiedProperty(data);
      setCurrentStep(2);
      toast({ title: "تم التحقق بنجاح", description: `مرحباً بك ${data.name}` });
    } catch (error: any) {
      toast({ title: "خطأ في التحقق", description: error.message || "رقم العقار أو الرقم السري غير صحيح", variant: "destructive" });
    } finally {
      setIsVerifying(false);
    }
  };

  const validateDiscount = async () => {
    if (!discountCode) return;
    try {
      const response = await apiRequest('POST', '/api/discount/validate', { code: discountCode });
      const data = await response.json();
      setValidatedDiscount(data);
      toast({ title: "كود الخصم صالح", description: `سيتم خصم ${data.type === 'نسبة' ? data.value + '%' : data.value + ' ريال'}` });
    } catch (error: any) {
      toast({ title: "كود الخصم غير صالح", description: error.message, variant: "destructive" });
      setValidatedDiscount(null);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPackageId) return;

    setIsSubmitting(true);
    try {
      const subscribeResponse = await apiRequest('POST', '/api/public/subscribe', {
        propertyNumber,
        packageId: selectedPackageId,
      });
      const subscribeData = await subscribeResponse.json();

      if (isFreePackage) {
        toast({ title: "نجح", description: "تم تفعيل اشتراكك بنجاح" });
        setTimeout(() => setLocation('/'), 1500);
      } else {
        if (paymentMethod === 'online') {
          try {
            const paymentResponse = await apiRequest('POST', '/api/owner/payment/initiate', {
              propertyNumber,
              packageId: selectedPackageId,
              discountCode: validatedDiscount?.code,
              paymentMethod: 'cards',
            });
            const paymentData = await paymentResponse.json();
            if (paymentData.checkoutUrl) {
              window.location.href = paymentData.checkoutUrl;
            } else {
              throw new Error("لم يتم الحصول على رابط الدفع");
            }
          } catch (err: any) {
            toast({ title: "خطأ في الدفع الإلكتروني", description: err.message, variant: "destructive" });
            throw err;
          }
        } else if (paymentMethod === 'bank' && receiptFile) {
          const formDataUpload = new FormData();
          formDataUpload.append('propertyNumber', propertyNumber);
          formDataUpload.append('packageId', selectedPackageId);
          formDataUpload.append('receipt', receiptFile);
          if (validatedDiscount?.code) {
            formDataUpload.append('discountCode', validatedDiscount.code);
          }
          await fetch('/api/owner/payment/bank-transfer', { method: 'POST', body: formDataUpload });
          toast({ title: "تم استقبال طلبك", description: "سيتم تفعيل الاشتراك بعد التحقق من التحويل البنكي" });
          setTimeout(() => setLocation('/'), 1500);
        }
      }
    } catch (error: any) {
      toast({ title: "خطأ", description: error.message || "حدث خطأ غير متوقع", variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-card border-b border-border shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <h1 className="text-2xl font-bold text-[#434040]">ترقية الاشتراك</h1>
          <p className="text-sm text-muted-foreground">بدون تسجيل دخول</p>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Progress Bar - 3 Steps */}
        <div className="mb-8">
          <div className="flex items-center justify-between gap-2 mb-4">
            <div className="flex flex-col items-center flex-1">
              <div className={`w-10 h-10 rounded-full font-bold flex items-center justify-center text-white transition ${currentStep >= 1 ? 'bg-[#434040]' : 'bg-muted'}`}>
                {currentStep > 1 ? '✓' : '1'}
              </div>
              <p className="text-xs mt-2 text-center font-semibold">التحقق</p>
            </div>
            <div className={`flex-1 h-1 ${currentStep >= 2 ? 'bg-[#434040]' : 'bg-muted'}`}></div>
            <div className="flex flex-col items-center flex-1">
              <div className={`w-10 h-10 rounded-full font-bold flex items-center justify-center text-white transition ${currentStep >= 2 ? 'bg-[#434040]' : 'bg-muted'}`}>
                {currentStep > 2 ? '✓' : '2'}
              </div>
              <p className="text-xs mt-2 text-center font-semibold">اختيار الباقة</p>
            </div>
            <div className={`flex-1 h-1 ${currentStep >= 3 ? 'bg-[#434040]' : 'bg-muted'}`}></div>
            <div className="flex flex-col items-center flex-1">
              <div className={`w-10 h-10 rounded-full font-bold flex items-center justify-center text-white transition ${currentStep >= 3 ? 'bg-[#434040]' : 'bg-muted'}`}>
                3
              </div>
              <p className="text-xs mt-2 text-center font-semibold">طريقة الدفع</p>
            </div>
          </div>
        </div>

        {/* Step 1: Verify */}
        {currentStep === 1 && (
          <Card className="p-8">
            <h2 className="text-xl font-bold text-[#434040] mb-6">الخطوة 1: تحقق من عقارك</h2>
            <div className="max-w-md mx-auto space-y-4">
              <div>
                <label className="block text-sm font-semibold mb-2">رقم العقار (5 أرقام) *</label>
                <Input placeholder="00123" value={propertyNumber} onChange={(e) => setPropertyNumber(e.target.value.slice(0, 5))} maxLength={5} required />
              </div>
              <div>
                <label className="block text-sm font-semibold mb-2">الرقم السري *</label>
                <Input type="password" placeholder="أدخل الرقم السري" value={pin} onChange={(e) => setPin(e.target.value)} required />
              </div>
              <Button onClick={handleVerify} disabled={isVerifying || !propertyNumber || !pin} className="w-full">
                {isVerifying ? 'جاري التحقق...' : 'التالي: اختيار الباقة'}
              </Button>
            </div>
          </Card>
        )}

        {/* Step 2: Select Package */}
        {currentStep === 2 && verifiedProperty && (
          <Card className="p-8">
            <div className="flex items-center gap-3 mb-6">
              <CheckCircle2 className="w-6 h-6 text-green-600" />
              <div>
                <h2 className="text-xl font-bold text-[#434040]">{verifiedProperty.name}</h2>
                <p className="text-sm text-muted-foreground">رقم العقار: {propertyNumber}</p>
              </div>
            </div>
            <h3 className="text-lg font-bold text-[#434040] mb-6">الخطوة 2: اختر باقة الاشتراك</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
              {packages.map((pkg) => (
                <div
                  key={pkg.id}
                  className={`p-5 rounded-lg border-2 transition-all cursor-pointer ${
                    selectedPackageId === pkg.id
                      ? 'ring-2 ring-[#434040] bg-[#434040]/5 border-[#434040]'
                      : 'border-border hover:border-[#434040]/50'
                  }`}
                  onClick={() => setSelectedPackageId(pkg.id)}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h4 className="font-bold">{pkg.name}</h4>
                      <p className="text-2xl font-bold text-[#434040]">{pkg.price === 0 ? 'مجاني' : `${pkg.price} ر.س`}</p>
                    </div>
                    {selectedPackageId === pkg.id && (
                      <Badge className="bg-[#434040] text-white">مختار</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mb-3">{pkg.duration} يوم</p>
                  {pkg.type === 'موثوق' && (
                    <Badge className="bg-[#c9951d] border-0 text-xs text-[#fbfaf9]">موثوق</Badge>
                  )}
                  <div className="flex gap-2 mt-3">
                    <Button type="button" variant="outline" size="sm" onClick={() => setPackageToView(pkg)} className="flex-1">
                      التفاصيل
                    </Button>
                    <Button type="button" size="sm" onClick={() => setSelectedPackageId(pkg.id)} className={`flex-1 ${selectedPackageId === pkg.id ? 'bg-[#434040]' : ''}`}>
                      اختيار
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex gap-3 pt-6 border-t">
              <Button type="button" variant="outline" onClick={() => { setCurrentStep(1); setVerifiedProperty(null); }} className="gap-2">
                <ChevronRight className="w-4 h-4" />
                السابق
              </Button>
              <Button onClick={() => setCurrentStep(3)} disabled={!selectedPackageId} className="flex-1">
                التالي: طريقة الدفع
              </Button>
            </div>
          </Card>
        )}

        {/* Step 3: Payment */}
        {currentStep === 3 && selectedPackageId && (
          <Card className="p-8">
            <h2 className="text-xl font-bold text-[#434040] mb-6">الخطوة 3: طريقة الدفع</h2>
            <form onSubmit={handleSubmit} className="space-y-6">
              {!isFreePackage && (
                <div>
                  <h3 className="text-lg font-bold mb-4">اختر طريقة الدفع</h3>
                  <div className="space-y-3">
                    <div onClick={() => setPaymentMethod('online')} className={`p-4 border-2 rounded-lg cursor-pointer transition ${paymentMethod === 'online' ? 'border-[#434040] bg-[#434040]/5' : 'border-border hover:border-[#434040]/50'}`}>
                      <div className="font-semibold">الدفع الإلكتروني</div>
                      <p className="text-sm text-muted-foreground">بطاقة ائتمان أو Apple Pay</p>
                    </div>
                    <div onClick={() => setPaymentMethod('bank')} className={`p-4 border-2 rounded-lg cursor-pointer transition ${paymentMethod === 'bank' ? 'border-[#434040] bg-[#434040]/5' : 'border-border hover:border-[#434040]/50'}`}>
                      <div className="font-semibold">تحويل بنكي</div>
                      <p className="text-sm text-muted-foreground">مع تحميل إيصال التحويل</p>
                    </div>

                    {/* Discount Code */}
                    <div className="mt-4 p-4 bg-muted/30 rounded-lg">
                      <label className="block text-sm font-semibold mb-2">كود خصم (اختياري)</label>
                      <div className="flex gap-2">
                        <Input placeholder="أدخل كود الخصم" value={discountCode} onChange={(e) => setDiscountCode(e.target.value)} />
                        <Button type="button" variant="outline" onClick={validateDiscount}>تحقق</Button>
                      </div>
                      {validatedDiscount && (
                        <p className="text-sm text-green-600 mt-2">✓ سيتم خصم {validatedDiscount.type === 'نسبة' ? validatedDiscount.value + '%' : validatedDiscount.value + ' ﷼'}</p>
                      )}
                    </div>

                    {/* Bank Receipt */}
                    {paymentMethod === 'bank' && (
                      <div className="p-4 bg-muted/30 rounded-lg">
                        <label className="block text-sm font-semibold mb-2">إيصال التحويل</label>
                        <input ref={fileInputRef} type="file" accept="image/*" onChange={(e) => setReceiptFile(e.target.files?.[0] || null)} className="hidden" />
                        <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()} className="w-full gap-2">
                          <Upload className="w-4 h-4" />
                          {receiptFile ? receiptFile.name : 'اختر صورة الإيصال'}
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {isFreePackage && (
                <div className="p-4 bg-muted/30 rounded-lg">
                  <p className="text-sm font-semibold">هذه باقة مجانية - سيتم تفعيل العقار مباشرة</p>
                </div>
              )}

              <div className="flex gap-3 pt-6 border-t">
                <Button type="button" variant="outline" onClick={() => setCurrentStep(2)} className="gap-2">
                  <ChevronRight className="w-4 h-4" />
                  السابق
                </Button>
                <Button type="submit" disabled={isSubmitting || (!isFreePackage && !paymentMethod)} className="flex-1">
                  {isSubmitting ? 'جاري المعالجة...' : isFreePackage ? 'إنهاء التسجيل' : 'متابعة الدفع'}
                </Button>
              </div>
            </form>
          </Card>
        )}

        {/* Package Details Modal */}
        <Dialog open={!!packageToView} onOpenChange={() => setPackageToView(null)}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="text-[#434040]">{packageToView?.name}</DialogTitle>
              <DialogDescription>تفاصيل الباقة الكاملة</DialogDescription>
            </DialogHeader>
            {packageToView && (
              <div className="space-y-4">
                <div>
                  <p className="text-sm text-muted-foreground mb-1">السعر</p>
                  <p className="text-2xl font-bold text-[#434040]">{packageToView.price === 0 ? 'مجاني' : `${packageToView.price} ريال`}</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground mb-1">المدة</p>
                  <p className="text-lg font-bold text-[#434040]">{packageToView.duration} يوم</p>
                </div>
                <div>
                  <p className="text-sm text-muted-foreground mb-1">النوع</p>
                  <Badge className={packageToView.type === 'موثوق' ? 'bg-[#c9951d]' : 'bg-gray-400'}>
                    {packageToView.type}
                  </Badge>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
