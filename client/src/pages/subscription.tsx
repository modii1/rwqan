import { useState, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Package } from "@shared/schema";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { ChevronRight, Upload } from "lucide-react";
import { PriceDisplay } from "@/components/price-display";

const CITIES = ['بريدة', 'عنيزة', 'الرس', 'البكيرية', 'المذنب'];
const DIRECTIONS = ['شمال', 'جنوب', 'شرق', 'غرب'];
const TYPES = ['قسم', 'قسمين'];

export default function SubscriptionPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [formData, setFormData] = useState({
    propertyNumber: "",
    name: "",
    pin: "",
    city: "",
    direction: "",
    type: "",
    location: "",
    whatsappNumber: "",
  });

  const [facilities, setFacilities] = useState<string[]>([]);
  const [prices, setPrices] = useState({
    weekday: "",
    weekend: "",
    overnight: "",
    holidays: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const [discountCode, setDiscountCode] = useState("");
  const [validatedDiscount, setValidatedDiscount] = useState<any>(null);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'online' | 'bank' | null>(null);

  const { data: packages = [] } = useQuery<Package[]>({
    queryKey: ['/api/packages'],
  });

  const selectedPackage = packages.find(p => p.id === selectedPackageId);
  const isFreePackage = selectedPackage?.price === 0;

  const validateDiscount = async () => {
    if (!discountCode) return;
    try {
      const response = await apiRequest('POST', '/api/discount/validate', { code: discountCode });
      const data = await response.json();
      setValidatedDiscount(data);
      toast({
        title: "كود الخصم صالح",
        description: `سيتم خصم ${data.type === 'نسبة' ? data.value + '%' : data.value + ' ريال'}`,
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPackageId) return;

    setIsSubmitting(true);
    try {
      const registrationResponse = await apiRequest('POST', '/api/properties/register', {
        ...formData,
        facilities,
        prices,
        subscriptionType: selectedPackage?.type || 'عادي',
      });

      toast({
        title: "تم تسجيل العقار بنجاح",
        description: "جاري إكمال عملية الاشتراك...",
      });

      if (isFreePackage) {
        toast({
          title: "نجح! ✓",
          description: "تم تسجيل عقارك بنجاح في الباقة المجانية",
        });
        setTimeout(() => setLocation('/owner/login'), 1500);
      } else {
        if (paymentMethod === 'online') {
          const paymentResponse = await apiRequest('POST', '/api/owner/payment/initiate', {
            packageId: selectedPackageId,
            discountCode: validatedDiscount?.code,
            paymentMethod: 'cards',
          });
          const paymentData = await paymentResponse.json();
          window.location.href = paymentData.checkoutUrl;
        } else if (paymentMethod === 'bank' && receiptFile) {
          const formDataUpload = new FormData();
          formDataUpload.append('packageId', selectedPackageId);
          formDataUpload.append('receipt', receiptFile);
          if (validatedDiscount?.code) {
            formDataUpload.append('discountCode', validatedDiscount.code);
          }
          await fetch('/api/owner/payment/bank-transfer', {
            method: 'POST',
            body: formDataUpload,
          });
          toast({
            title: "تم استقبال طلبك",
            description: "سيتم تفعيل الاشتراك بعد التحقق من التحويل البنكي",
          });
          setTimeout(() => setLocation('/owner/login'), 1500);
        }
      }
    } catch (error: any) {
      toast({
        title: "خطأ",
        description: error.message || "حدث خطأ غير متوقع",
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-card border-b border-border shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <h1 className="text-2xl font-bold text-[#434040]">اشترك معنا</h1>
          <p className="text-sm text-muted-foreground">اختر باقة واملأ بيانات عقارك</p>
        </div>
      </header>
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Packages Strip at Top */}
        <div className="mb-8 pb-8 border-b">
          <h2 className="text-lg font-bold mb-4">الباقات المتاحة</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {packages.map((pkg) => (
              <Card
                key={pkg.id}
                onClick={() => setSelectedPackageId(pkg.id)}
                className={`p-5 cursor-pointer transition-all ${
                  selectedPackageId === pkg.id
                    ? 'ring-2 ring-[#434040] bg-[#434040]/5 shadow-md'
                    : 'hover:shadow-md'
                }`}
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <h3 className="font-bold">{pkg.name}</h3>
                    {pkg.price === 0 ? (
                      <p className="text-2xl font-bold text-[#434040]">مجاني</p>
                    ) : (
                      <PriceDisplay amount={pkg.price} size="lg" />
                    )}
                  </div>
                  {selectedPackageId === pkg.id && (
                    <Badge className="bg-[#434040] text-white">مختار</Badge>
                  )}
                </div>
                <p className="text-muted-foreground mb-2 text-[14px]">{pkg.duration} يوم</p>
                {pkg.type === 'موثوق' && (
                  <Badge className="bg-[#c9951d] border-0 text-xs text-[#fbfaf9]">موثوق</Badge>
                )}
              </Card>
            ))}
          </div>
        </div>


        {/* Step 1: Select Package */}
        {currentStep === 1 && (
          <Card className="p-8">
            <h2 className="text-xl font-bold text-[#434040] mb-6">الخطوة 1: اختر باقة الاشتراك</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
              {packages.map((pkg) => (
                <div
                  key={pkg.id}
                  onClick={() => setSelectedPackageId(pkg.id)}
                  className={`p-5 cursor-pointer transition-all rounded-lg border-2 ${
                    selectedPackageId === pkg.id
                      ? 'ring-2 ring-[#434040] bg-[#434040]/5 border-[#434040]'
                      : 'border-border hover:border-[#434040]/50'
                  }`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="font-bold">{pkg.name}</h3>
                      {pkg.price === 0 ? (
                        <p className="text-2xl font-bold text-[#434040]">مجاني</p>
                      ) : (
                        <PriceDisplay amount={pkg.price} size="lg" />
                      )}
                    </div>
                    {selectedPackageId === pkg.id && (
                      <Badge className="bg-[#434040] text-white">مختار</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mb-2">{pkg.duration} يوم</p>
                  {pkg.type === 'موثوق' && (
                    <Badge className="bg-[#c9951d] border-0 text-xs text-[#fbfaf9]">موثوق</Badge>
                  )}
                </div>
              ))}
            </div>
            <div className="flex justify-end pt-6 border-t">
              <Button
                onClick={() => setCurrentStep(2)}
                disabled={!selectedPackageId}
                className="flex-1 md:flex-none"
              >
                التالي: بيانات العقار
              </Button>
            </div>
          </Card>
        )}

        {/* Step 2: Property Details */}
        {currentStep === 2 && selectedPackageId && (
          <Card className="p-8">
            <h2 className="text-xl font-bold text-[#434040] mb-6">الخطوة 2: بيانات العقار</h2>
            <form onSubmit={(e) => { e.preventDefault(); setCurrentStep(3); }} className="space-y-6">

                {/* Property Info */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold mb-2">رقم العقار (5 أرقام) *</label>
                    <Input
                      placeholder="00123"
                      value={formData.propertyNumber}
                      onChange={(e) => setFormData({ ...formData, propertyNumber: e.target.value })}
                      maxLength={5}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold mb-2">اسم العقار *</label>
                    <Input
                      placeholder="شالية مودي"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold mb-2">الرقم السري *</label>
                    <Input
                      type="password"
                      placeholder="اختر رقماً سرياً"
                      value={formData.pin}
                      onChange={(e) => setFormData({ ...formData, pin: e.target.value })}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold mb-2">رقم الواتساب *</label>
                    <Input
                      placeholder="050xxxxxxx"
                      value={formData.whatsappNumber}
                      onChange={(e) => setFormData({ ...formData, whatsappNumber: e.target.value })}
                      required
                    />
                  </div>
                </div>

                {/* Location */}
                <div className="border-t pt-6">
                  <h3 className="text-lg font-bold mb-4">الموقع</h3>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-semibold mb-2">المدينة *</label>
                      <Select value={formData.city} onValueChange={(value) => setFormData({ ...formData, city: value })}>
                        <SelectTrigger>
                          <SelectValue placeholder="اختر" />
                        </SelectTrigger>
                        <SelectContent>
                          {CITIES.map(city => (
                            <SelectItem key={city} value={city}>{city}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold mb-2">الاتجاه *</label>
                      <Select value={formData.direction} onValueChange={(value) => setFormData({ ...formData, direction: value })}>
                        <SelectTrigger>
                          <SelectValue placeholder="اختر" />
                        </SelectTrigger>
                        <SelectContent>
                          {DIRECTIONS.map(d => (
                            <SelectItem key={d} value={d}>{d}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold mb-2">النوع *</label>
                      <Select value={formData.type} onValueChange={(value) => setFormData({ ...formData, type: value })}>
                        <SelectTrigger>
                          <SelectValue placeholder="اختر" />
                        </SelectTrigger>
                        <SelectContent>
                          {TYPES.map(type => (
                            <SelectItem key={type} value={type}>{type}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="mt-4">
                    <label className="block text-sm font-semibold mb-2">الموقع / الحي</label>
                    <Input
                      placeholder="اكتب اسم الحي أو الموقع"
                      value={formData.location}
                      onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                    />
                  </div>
                </div>

                {/* Prices */}
                <div className="border-t pt-6">
                  <h3 className="text-lg font-bold mb-4">الأسعار (﷼) *</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <label className="block text-sm font-semibold mb-2">وسط الأسبوع</label>
                      <Input type="number" placeholder="500" value={prices.weekday} onChange={(e) => setPrices({...prices, weekday: e.target.value})} required />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold mb-2">نهاية الأسبوع</label>
                      <Input type="number" placeholder="800" value={prices.weekend} onChange={(e) => setPrices({...prices, weekend: e.target.value})} required />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold mb-2">مبيت</label>
                      <Input type="number" placeholder="1200" value={prices.overnight} onChange={(e) => setPrices({...prices, overnight: e.target.value})} required />
                    </div>
                    <div>
                      <label className="block text-sm font-semibold mb-2">إجازات</label>
                      <Input type="number" placeholder="1000" value={prices.holidays} onChange={(e) => setPrices({...prices, holidays: e.target.value})} required />
                    </div>
                  </div>
                </div>

                {/* Submit */}
                <div className="flex gap-3 pt-6 border-t">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setCurrentStep(1)}
                    className="gap-2"
                  >
                    <ChevronRight className="w-4 h-4" />
                    السابق
                  </Button>
                  <Button type="submit" className="flex-1">
                    التالي: طريقة الدفع
                  </Button>
                </div>
              </form>
            </Card>
        )}

        {/* Step 3: Payment Method */}
        {currentStep === 3 && selectedPackageId && (
          <Card className="p-8">
            <h2 className="text-xl font-bold text-[#434040] mb-6">الخطوة 3: طريقة الدفع</h2>
            <form onSubmit={handleSubmit} className="space-y-6">
              {!isFreePackage && (
                <div>
                  <h3 className="text-lg font-bold mb-4">اختر طريقة الدفع</h3>
                  <div className="space-y-3">
                    <div
                      onClick={() => setPaymentMethod('online')}
                      className={`p-4 border-2 rounded-lg cursor-pointer transition ${paymentMethod === 'online' ? 'border-[#434040] bg-[#434040]/5' : 'border-border hover:border-[#434040]/50'}`}
                    >
                      <div className="font-semibold">الدفع الإلكتروني</div>
                      <p className="text-sm text-muted-foreground">بطاقة ائتمان أو Apple Pay</p>
                    </div>
                    <div
                      onClick={() => setPaymentMethod('bank')}
                      className={`p-4 border-2 rounded-lg cursor-pointer transition ${paymentMethod === 'bank' ? 'border-[#434040] bg-[#434040]/5' : 'border-border hover:border-[#434040]/50'}`}
                    >
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

              {/* Free Package Message */}
              {isFreePackage && (
                <div className="p-4 bg-muted/30 rounded-lg">
                  <p className="text-sm font-semibold">هذه باقة مجانية - سيتم تفعيل العقار مباشرة</p>
                </div>
              )}

              {/* Submit */}
              <div className="flex gap-3 pt-6 border-t">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setCurrentStep(2)}
                  className="gap-2"
                >
                  <ChevronRight className="w-4 h-4" />
                  السابق
                </Button>
                <Button
                  type="submit"
                  disabled={isSubmitting || (!isFreePackage && !paymentMethod)}
                  className="flex-1"
                >
                  {isSubmitting ? 'جاري المعالجة...' : isFreePackage ? 'إنهاء التسجيل' : 'متابعة الدفع'}
                </Button>
              </div>
            </form>
          </Card>
        )}
      </div>
    </div>
  );
}
