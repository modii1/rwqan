import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Package } from "@shared/schema";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { FACILITIES } from "@shared/schema";
import { Check, ChevronLeft, ChevronRight, Upload } from "lucide-react";

const CITIES = ['بريدة', 'عنيزة', 'الرس', 'البكيرية', 'المذنب'];
const DIRECTIONS = ['شمال', 'جنوب', 'شرق', 'غرب'];
const TYPES = ['قسم', 'قسمين'];

export default function RegisterWithPackage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  // Stepper state
  const [currentStep, setCurrentStep] = useState(1);
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Form data
  const [formData, setFormData] = useState({
    propertyNumber: "",
    name: "",
    pin: "",
    city: "",
    direction: "",
    type: "",
    location: "",
    whatsappNumber: "",
    imagesFolderUrl: "",
  });

  const [facilities, setFacilities] = useState<string[]>([]);
  const [prices, setPrices] = useState({
    weekday: "",
    weekend: "",
    overnight: "",
    holidays: "",
  });
  const [facilitySearch, setFacilitySearch] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Payment state
  const [discountCode, setDiscountCode] = useState("");
  const [validatedDiscount, setValidatedDiscount] = useState<any>(null);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'online' | 'bank' | null>(null);

  const { data: packages = [] } = useQuery<Package[]>({
    queryKey: ['/api/packages'],
  });

  const selectedPackage = packages.find(p => p.id === selectedPackageId);
  const isFreePackage = selectedPackage?.price === 0;

  const toggleFacility = (facility: string) => {
    setFacilities(prev =>
      prev.includes(facility)
        ? prev.filter(f => f !== facility)
        : [...prev, facility]
    );
  };

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

  const handleStep1Continue = () => {
    if (!selectedPackageId) {
      toast({
        title: "اختر باقة",
        description: "يجب اختيار باقة اشتراك للمتابعة",
        variant: "destructive",
      });
      return;
    }
    setCurrentStep(2);
  };

  const handleStep2Back = () => {
    setCurrentStep(1);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      // Step 1: Register property
      const registrationResponse = await apiRequest('POST', '/api/properties/register', {
        ...formData,
        facilities,
        prices,
        subscriptionType: selectedPackage?.type || 'عادي',
      });

      const registerData = await registrationResponse.json();
      const propertyNumber = registerData.propertyNumber || formData.propertyNumber;

      toast({
        title: "تم تسجيل العقار بنجاح",
        description: "جاري إكمال عملية الاشتراك...",
      });

      // Step 2: Handle subscription/payment
      if (isFreePackage) {
        // Free package - no payment needed
        toast({
          title: "نجح! ✓",
          description: "تم تسجيل عقارك بنجاح في الباقة المجانية",
        });
        setTimeout(() => setLocation('/owner/login'), 1500);
      } else {
        // Paid package - redirect to payment
        if (paymentMethod === 'online') {
          const paymentResponse = await apiRequest('POST', '/api/owner/payment/initiate', {
            packageId: selectedPackageId,
            discountCode: validatedDiscount?.code,
            paymentMethod: 'cards',
          });

          const paymentData = await paymentResponse.json();
          window.location.href = paymentData.checkoutUrl;
        } else if (paymentMethod === 'bank' && receiptFile) {
          // Handle bank transfer with receipt
          const formDataUpload = new FormData();
          formDataUpload.append('packageId', selectedPackageId || '');
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
          <h1 className="text-2xl font-bold text-primary">اشترك معنا</h1>
          <p className="text-sm text-muted-foreground">
            {currentStep === 1 ? "الخطوة 1: اختر باقة اشتراك" : "الخطوة 2: سجل عقارك"}
          </p>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Progress indicator */}
        <div className="flex items-center gap-4 mb-8">
          <div className={`flex items-center justify-center w-10 h-10 rounded-full text-white font-bold ${currentStep >= 1 ? 'bg-primary' : 'bg-muted'}`}>
            1
          </div>
          <div className={`flex-1 h-1 ${currentStep >= 2 ? 'bg-primary' : 'bg-muted'}`}></div>
          <div className={`flex items-center justify-center w-10 h-10 rounded-full text-white font-bold ${currentStep >= 2 ? 'bg-primary' : 'bg-muted'}`}>
            2
          </div>
        </div>

        {/* Step 1: Choose Package */}
        {currentStep === 1 && (
          <div>
            <h2 className="text-xl font-bold mb-6">اختر باقة الاشتراك</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
              {packages.map((pkg) => (
                <Card
                  key={pkg.id}
                  onClick={() => setSelectedPackageId(pkg.id)}
                  className={`p-6 cursor-pointer transition-all ${
                    selectedPackageId === pkg.id
                      ? 'ring-2 ring-primary bg-primary/5'
                      : 'hover:shadow-md'
                  }`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <h3 className="font-bold text-lg">{pkg.name}</h3>
                    {selectedPackageId === pkg.id && (
                      <Check className="w-5 h-5 text-primary" />
                    )}
                  </div>
                  <div className="space-y-2 mb-4">
                    <p className="text-2xl font-bold text-primary">
                      {pkg.price === 0 ? 'مجاني' : `${pkg.price} ر.س`}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {pkg.duration} يوم
                    </p>
                    {pkg.type === 'موثوق' && (
                      <Badge className="bg-primary/20 text-primary border-0">موثوق</Badge>
                    )}
                  </div>
                  {pkg.features && pkg.features.length > 0 && (
                    <ul className="text-sm space-y-1">
                      {pkg.features.slice(0, 3).map((f, i) => (
                        <li key={i} className="text-muted-foreground">• {f}</li>
                      ))}
                    </ul>
                  )}
                </Card>
              ))}
            </div>
            <Button
              onClick={handleStep1Continue}
              className="w-full gap-2"
              size="lg"
            >
              المتابعة <ChevronLeft className="w-4 h-4" />
            </Button>
          </div>
        )}

        {/* Step 2: Registration & Payment */}
        {currentStep === 2 && (
          <Card className="p-8">
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Property Info */}
              <div>
                <h3 className="text-lg font-bold mb-4">معلومات العقار</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold mb-2">رقم العقار (5 أرقام)</label>
                    <Input
                      placeholder="00123"
                      value={formData.propertyNumber}
                      onChange={(e) => setFormData({ ...formData, propertyNumber: e.target.value })}
                      maxLength={5}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold mb-2">اسم العقار</label>
                    <Input
                      placeholder="شالية مودي"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold mb-2">الرقم السري</label>
                    <Input
                      type="password"
                      placeholder="اختر رقماً سرياً"
                      value={formData.pin}
                      onChange={(e) => setFormData({ ...formData, pin: e.target.value })}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold mb-2">رقم الواتساب</label>
                    <Input
                      placeholder="050xxxxxxx"
                      value={formData.whatsappNumber}
                      onChange={(e) => setFormData({ ...formData, whatsappNumber: e.target.value })}
                      required
                    />
                  </div>
                </div>
              </div>

              {/* Location Info */}
              <div className="border-t pt-6">
                <h3 className="text-lg font-bold mb-4">الموقع والتفاصيل</h3>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-semibold mb-2">المدينة</label>
                    <Select value={formData.city} onValueChange={(value) => setFormData({ ...formData, city: value })}>
                      <SelectTrigger>
                        <SelectValue placeholder="اختر المدينة" />
                      </SelectTrigger>
                      <SelectContent>
                        {CITIES.map(city => (
                          <SelectItem key={city} value={city}>{city}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold mb-2">الاتجاه</label>
                    <Select value={formData.direction} onValueChange={(value) => setFormData({ ...formData, direction: value })}>
                      <SelectTrigger>
                        <SelectValue placeholder="اختر الاتجاه" />
                      </SelectTrigger>
                      <SelectContent>
                        {DIRECTIONS.map(d => (
                          <SelectItem key={d} value={d}>{d}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold mb-2">النوع</label>
                    <Select value={formData.type} onValueChange={(value) => setFormData({ ...formData, type: value })}>
                      <SelectTrigger>
                        <SelectValue placeholder="اختر النوع" />
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
                <h3 className="text-lg font-bold mb-4">الأسعار (ريال)</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-sm font-semibold mb-2">وسط الأسبوع</label>
                    <Input
                      placeholder="500"
                      type="number"
                      value={prices.weekday}
                      onChange={(e) => setPrices({...prices, weekday: e.target.value})}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold mb-2">نهاية الأسبوع</label>
                    <Input
                      placeholder="800"
                      type="number"
                      value={prices.weekend}
                      onChange={(e) => setPrices({...prices, weekend: e.target.value})}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold mb-2">مبيت</label>
                    <Input
                      placeholder="1200"
                      type="number"
                      value={prices.overnight}
                      onChange={(e) => setPrices({...prices, overnight: e.target.value})}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold mb-2">إجازات</label>
                    <Input
                      placeholder="1000"
                      type="number"
                      value={prices.holidays}
                      onChange={(e) => setPrices({...prices, holidays: e.target.value})}
                      required
                    />
                  </div>
                </div>
              </div>

              {/* Payment Section - Only for paid packages */}
              {!isFreePackage && (
                <div className="border-t pt-6">
                  <h3 className="text-lg font-bold mb-4">طريقة الدفع</h3>
                  <div className="space-y-4">
                    <div
                      onClick={() => setPaymentMethod('online')}
                      className={`p-4 border-2 rounded-lg cursor-pointer transition ${
                        paymentMethod === 'online'
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:border-primary/50'
                      }`}
                    >
                      <div className="font-semibold">الدفع الإلكتروني</div>
                      <p className="text-sm text-muted-foreground">بطاقة ائتمان أو Apple Pay</p>
                    </div>
                    <div
                      onClick={() => setPaymentMethod('bank')}
                      className={`p-4 border-2 rounded-lg cursor-pointer transition ${
                        paymentMethod === 'bank'
                          ? 'border-primary bg-primary/5'
                          : 'border-border hover:border-primary/50'
                      }`}
                    >
                      <div className="font-semibold">تحويل بنكي</div>
                      <p className="text-sm text-muted-foreground">مع تحميل إيصال التحويل</p>
                    </div>

                    {/* Discount Code */}
                    <div className="mt-4 p-4 bg-muted/30 rounded-lg">
                      <label className="block text-sm font-semibold mb-2">كود خصم (اختياري)</label>
                      <div className="flex gap-2">
                        <Input
                          placeholder="أدخل كود الخصم"
                          value={discountCode}
                          onChange={(e) => setDiscountCode(e.target.value)}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          onClick={validateDiscount}
                        >
                          تحقق
                        </Button>
                      </div>
                      {validatedDiscount && (
                        <p className="text-sm text-green-600 mt-2">
                          ✓ سيتم خصم {validatedDiscount.type === 'نسبة' ? validatedDiscount.value + '%' : validatedDiscount.value + ' ريال'}
                        </p>
                      )}
                    </div>

                    {/* Bank Transfer Receipt */}
                    {paymentMethod === 'bank' && (
                      <div className="p-4 bg-muted/30 rounded-lg">
                        <label className="block text-sm font-semibold mb-2">إيصال التحويل البنكي</label>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept="image/*"
                          onChange={(e) => setReceiptFile(e.target.files?.[0] || null)}
                          className="hidden"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => fileInputRef.current?.click()}
                          className="w-full gap-2"
                        >
                          <Upload className="w-4 h-4" />
                          {receiptFile ? receiptFile.name : 'اختر صورة الإيصال'}
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Buttons */}
              <div className="flex gap-3 pt-6 border-t">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleStep2Back}
                  className="gap-2"
                >
                  <ChevronRight className="w-4 h-4" />
                  رجوع
                </Button>
                <Button
                  type="submit"
                  disabled={isSubmitting || (!isFreePackage && !paymentMethod)}
                  className="flex-1"
                >
                  {isSubmitting ? 'جاري المعالجة...' : isFreePackage ? 'تسجيل مجاني' : 'متابعة الدفع'}
                </Button>
              </div>
            </form>
          </Card>
        )}
      </div>
    </div>
  );
}
