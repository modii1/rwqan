"use client";
import { useState, useRef, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Package } from "@shared/schema";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useRouter } from "next/navigation";
import { ChevronRight, Upload, Clock, CheckCircle2, Home, Phone, Lock, ArrowLeft, RefreshCw, CreditCard } from "lucide-react";
import { PriceDisplay } from "@/components/price-display";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Progress } from "@/components/ui/progress";
import { formatPrice, formatDiscount, getCurrencyLabel } from "@/lib/currency";
import { validatePhoneNumber, validatePropertyNumber, validatePin, cleanName, validateTextInput, validateNumericInput, validateWhatsAppInput, validatePropertyNumberInput, validatePinInput } from "@/lib/validation";

// ─── Visual Captcha helpers ───
const CAPTCHA_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateCaptchaText(length = 5): string {
  let text = '';
  for (let i = 0; i < length; i++) {
    text += CAPTCHA_CHARS[Math.floor(Math.random() * CAPTCHA_CHARS.length)];
  }
  return text;
}

function drawCaptcha(canvas: HTMLCanvasElement, text: string) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width, h = canvas.height;

  // background
  const bg = ctx.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, '#f0f4f8'); bg.addColorStop(0.5, '#e8edf2'); bg.addColorStop(1, '#dce3ea');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, w, h);

  // noise dots
  for (let i = 0; i < 80; i++) {
    ctx.beginPath();
    ctx.arc(Math.random() * w, Math.random() * h, Math.random() * 2 + 0.5, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(${Math.random()*150+50},${Math.random()*150+50},${Math.random()*150+50},${Math.random()*0.5+0.2})`;
    ctx.fill();
  }

  // interference lines
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.moveTo(Math.random()*w, Math.random()*h);
    ctx.bezierCurveTo(Math.random()*w,Math.random()*h,Math.random()*w,Math.random()*h,Math.random()*w,Math.random()*h);
    ctx.strokeStyle = `rgba(${Math.random()*120+80},${Math.random()*120+80},${Math.random()*120+80},${Math.random()*0.4+0.15})`;
    ctx.lineWidth = Math.random()*1.5+0.5; ctx.stroke();
  }

  // characters
  const cw = w / (text.length + 1.5);
  const colors = ['#2563eb','#7c3aed','#059669','#d97706','#dc2626','#0891b2'];
  for (let i = 0; i < text.length; i++) {
    ctx.save();
    const x = cw*(i+0.8), y = h/2+(Math.random()*12-6);
    ctx.translate(x, y); ctx.rotate((Math.random()-0.5)*0.5); ctx.scale(0.85+Math.random()*0.35, 0.85+Math.random()*0.35);
    ctx.font = `bold ${28+Math.floor(Math.random()*8)}px 'Courier New', monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(0,0,0,0.08)'; ctx.fillText(text[i], 2, 2);
    ctx.fillStyle = colors[i%colors.length]; ctx.fillText(text[i], 0, 0);
    ctx.restore();
  }

  ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 1; ctx.strokeRect(0,0,w,h);
}

const CITIES = ['بريدة', 'عنيزة', 'الرس', 'البكيرية', 'المذنب'];
const DIRECTIONS = ['شمال', 'جنوب', 'شرق', 'غرب'];
const TYPES = ['قسم', 'قسمين'];

export default function SubscriptionPage() {
  const router = useRouter();
  const { toast } = useToast();

  const [currentStep, setCurrentStep] = useState<1 | 2 | 3>(1);
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null);
  const [packageToView, setPackageToView] = useState<Package | null>(null);
  const [showAllPackages, setShowAllPackages] = useState(true);
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
  const [registeredPropertyNumber, setRegisteredPropertyNumber] = useState<string | null>(null);
  const [registrationSuccess, setRegistrationSuccess] = useState(false);

  const [discountCode, setDiscountCode] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  const validateForm = () => {
    const newErrors: Record<string, string> = {};
    
    const propNum = validatePropertyNumber(formData.propertyNumber);
    if (!propNum.valid) {
      newErrors.propertyNumber = propNum.error || "رقم العقار غير صالح";
    }
    
    const name = cleanName(formData.name);
    if (!name || name.length < 2) {
      newErrors.name = "اسم العقار مطلوب";
    }
    
    const pin = validatePin(formData.pin);
    if (!pin.valid) {
      newErrors.pin = pin.error || "الرقم السري غير صالح";
    }
    
    const phone = validatePhoneNumber(formData.whatsappNumber);
    if (!phone.valid) {
      newErrors.whatsappNumber = phone.error || "رقم الواتساب غير صالح";
    }
    
    if (!formData.city) {
      newErrors.city = "المدينة مطلوبة";
    }
    if (!formData.direction) {
      newErrors.direction = "الاتجاه مطلوب";
    }
    if (!formData.type) {
      newErrors.type = "النوع مطلوب";
    }
    
    if (!prices.weekday || parseInt(prices.weekday) < 1) {
      newErrors.weekday = "سعر وسط الأسبوع مطلوب";
    }
    if (!prices.weekend || parseInt(prices.weekend) < 1) {
      newErrors.weekend = "سعر نهاية الأسبوع مطلوب";
    }
    if (!prices.overnight || parseInt(prices.overnight) < 1) {
      newErrors.overnight = "سعر المبيت مطلوب";
    }
    if (!prices.holidays || parseInt(prices.holidays) < 1) {
      newErrors.holidays = "سعر الإجازات مطلوب";
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };
  const [validatedDiscount, setValidatedDiscount] = useState<any>(null);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [paymentMethod, setPaymentMethod] = useState<'online' | 'bank' | null>(null);
  const [aiScanResult, setAiScanResult] = useState<any>(null);

  // Visual captcha state
  const captchaCanvasRef = useRef<HTMLCanvasElement>(null);
  const captchaTextRef = useRef("");
  const [captchaInput, setCaptchaInput] = useState("");
  const [captchaKey, setCaptchaKey] = useState(0); // force re-render

  const refreshCaptcha = useCallback(() => {
    const newText = generateCaptchaText(5);
    captchaTextRef.current = newText;
    setCaptchaInput("");
    setCaptchaKey(k => k + 1);
    setTimeout(() => {
      if (captchaCanvasRef.current) drawCaptcha(captchaCanvasRef.current, newText);
    }, 50);
  }, []);

  // Redraw captcha when step 3 becomes visible (canvas is now in DOM)
  useEffect(() => {
    if (currentStep === 3) {
      // If captcha text exists but canvas wasn't drawn yet, draw it
      if (captchaTextRef.current) {
        setTimeout(() => {
          if (captchaCanvasRef.current) drawCaptcha(captchaCanvasRef.current, captchaTextRef.current);
        }, 50);
      } else {
        refreshCaptcha();
      }
    }
  }, [currentStep, refreshCaptcha]);

  useEffect(() => { refreshCaptcha(); }, [refreshCaptcha]);

  const { data: rawPackages = [] } = useQuery<Package[]>({
    queryKey: ['/api/packages'],
  });

  // التأكد من عدم تكرار الباقات (حل لمشكلة Duplicate Keys)
  const packages = Array.from(new Map(rawPackages.map(pkg => [pkg.id, pkg])).values());

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
        description: `سيتم خصم ${formatDiscount(data.value, data.type)}`,
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

    // Captcha validation
    const userInput = captchaInput.trim().toUpperCase();
    const expected = captchaTextRef.current;
    if (userInput !== expected) {
      toast({
        title: "خطأ في التحقق",
        description: `الرمز المدخل غير صحيح، حاول مرة أخرى`,
        variant: "destructive",
      });
      refreshCaptcha();
      return;
    }

    setIsSubmitting(true);
    console.log('Starting submission...', { paymentMethod, isFreePackage });
    try {
      const payload = {
        ...formData,
        facilities,
        prices,
        subscriptionType: selectedPackage?.type || 'عادي',
      };

      console.log('Registering property...');
      const registrationResponse = await apiRequest('POST', '/api/properties/register', payload);

      const registrationData = await registrationResponse.json();
      console.log('Registration response:', registrationData);
      
      const propertyNumber = registrationData.propertyNumber;
      setRegisteredPropertyNumber(propertyNumber);

      toast({
        title: "تم تسجيل العقار بنجاح",
        description: "جاري إكمال عملية الاشتراك...",
      });

      if (isFreePackage) {
        setRegistrationSuccess(true);
      } else {
        if (paymentMethod === 'online') {
          console.log('Starting payment for property:', propertyNumber);
          try {
            const paymentResponse = await apiRequest('POST', '/api/owner/payment/initiate', {
              propertyNumber,
              packageId: selectedPackageId,
              discountCode: validatedDiscount?.code,
              paymentMethod: 'cards',
            });
            const paymentData = await paymentResponse.json();
            console.log('Payment response:', paymentData);
            
            if (paymentData.redirectUrl) {
              toast({
                title: "جاري توجيهك للدفع",
                description: "سيتم فتح صفحة الدفع في نافذة جديدة",
              });
              const paymentWindow = window.open(paymentData.redirectUrl, '_blank');
              if (!paymentWindow) {
                window.location.href = paymentData.redirectUrl;
              }
            } else if (paymentData.checkoutUrl) {
              toast({
                title: "جاري توجيهك للدفع",
                description: "سيتم فتح صفحة الدفع في نافذة جديدة",
              });
              const paymentWindow = window.open(paymentData.checkoutUrl, '_blank');
              if (!paymentWindow) {
                window.location.href = paymentData.checkoutUrl;
              }
            } else {
              throw new Error("لم يتم الحصول على رابط الدفع");
            }
          } catch (err: any) {
            toast({
              title: "خطأ في الدفع الإلكتروني",
              description: err.message || "يرجى استخدام التحويل البنكي بدلاً من ذلك أو إعادة المحاولة لاحقاً",
              variant: "destructive",
            });
            setPaymentMethod(null);
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
          const bankResponse = await fetch('/api/owner/payment/bank-transfer', {
            method: 'POST',
            body: formDataUpload,
          });
          const bankData = await bankResponse.json();
          if (bankData.aiScan) {
            setAiScanResult(bankData.aiScan);
          }
          setRegistrationSuccess(true);
        }
      }
    } catch (error: any) {
      let errorMessage = error.message || "حدث خطأ غير متوقع";
      try {
        const jsonPart = errorMessage.substring(errorMessage.indexOf('{'));
        if (jsonPart) {
          const parsed = JSON.parse(jsonPart);
          errorMessage = parsed.error || parsed.message || errorMessage;
        }
      } catch { /* keep original message */ }
      toast({
        title: "خطأ",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // عرض صفحة النجاح "قيد المراجعة"
  if (registrationSuccess) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4" dir="rtl">
        <Card className="max-w-lg w-full p-8 text-center space-y-6">
          {/* أيقونة النجاح */}
          <div className="flex justify-center">
            <div className="w-20 h-20 rounded-full bg-amber-100 flex items-center justify-center">
              <Clock className="w-10 h-10 text-[#c9951d]" />
            </div>
          </div>

          {/* العنوان */}
          <div>
            <h1 className="text-2xl font-bold text-[#434040] mb-2">
              تم استلام طلبك بنجاح!
            </h1>
            <p className="text-muted-foreground">
              عقارك قيد المراجعة من فريقنا
            </p>
          </div>

          {/* تفاصيل العقار */}
          <div className="bg-muted/30 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground flex items-center gap-2">
                <Home className="w-4 h-4" />
                رقم العقار
              </span>
              <span className="font-bold text-lg">{registeredPropertyNumber}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground flex items-center gap-2">
                <Lock className="w-4 h-4" />
                الرقم السري
              </span>
              <span className="font-mono text-lg">****</span>
            </div>
            {selectedPackage && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">الباقة</span>
                <Badge className="bg-[#c9951d] text-white">{selectedPackage.name}</Badge>
              </div>
            )}
          </div>

          {/* رسالة المراجعة */}
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
              <div className="text-right">
                <p className="font-semibold text-amber-800 mb-1">قيد المراجعة</p>
                <p className="text-sm text-amber-700">
                  {isFreePackage
                    ? "سيتم مراجعة عقارك من قبل الإدارة خلال 24 ساعة. ستتمكن من تسجيل الدخول فور قبول العقار."
                    : "تم استلام إيصال الدفع. سيتم تفعيل الاشتراك بعد التحقق من التحويل البنكي خلال 24 ساعة."
                  }
                </p>
              </div>
            </div>
          </div>

          {/* AI Scan Results */}
          {aiScanResult && (
            <div className={`p-4 rounded-lg border ${
              aiScanResult.recommendation === 'تفعيل_تلقائي' 
                ? 'bg-emerald-50 border-emerald-300' 
                : aiScanResult.recommendation === 'رفض'
                ? 'bg-red-50 border-red-300'
                : 'bg-amber-50 border-amber-300'
            }`}>
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-bold text-sm">نتيجة الفحص الذكي</h4>
                <Badge variant="outline" className={
                  aiScanResult.recommendation === 'تفعيل_تلقائي' 
                    ? 'border-emerald-500 text-emerald-600' 
                    : aiScanResult.recommendation === 'رفض'
                    ? 'border-red-500 text-red-600'
                    : 'border-amber-500 text-amber-600'
                }>
                  {aiScanResult.recommendation === 'تفعيل_تلقائي' && 'مطابق - جاهز للتفعيل'}
                  {aiScanResult.recommendation === 'مراجعة_يدوية' && 'يحتاج مراجعة'}
                  {aiScanResult.recommendation === 'رفض' && 'غير مطابق'}
                </Badge>
              </div>
              
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">نسبة الأصالة</span>
                    <span className="font-bold">{aiScanResult.authenticityScore}%</span>
                  </div>
                  <Progress value={aiScanResult.authenticityScore} className="h-2" />
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">نسبة التطابق</span>
                    <span className="font-bold">{aiScanResult.matchScore}%</span>
                  </div>
                  <Progress value={aiScanResult.matchScore} className="h-2" />
                </div>
              </div>

              {aiScanResult.summary && (
                <p className="text-xs text-muted-foreground bg-white/50 rounded p-2">
                  {aiScanResult.summary}
                </p>
              )}

              <div className="text-xs text-muted-foreground mt-2 pt-2 border-t border-current/20">
                مستوى الثقة: {aiScanResult.confidence}%
              </div>
            </div>
          )}

          {/* معلومات التواصل */}
          <div className="text-sm text-muted-foreground">
            <p className="flex items-center justify-center gap-2">
              <Phone className="w-4 h-4" />
              للاستفسار: 0533220646
            </p>
          </div>

          {/* الأزرار */}
          <div className="flex flex-col gap-3">
            <Button
              onClick={() => router.push('/owner/login')}
              className="w-full bg-[#434040] hover:bg-[#333]"
              data-testid="button-go-login"
            >
              الذهاب لتسجيل الدخول
            </Button>
            <Button
              variant="outline"
              onClick={() => router.push('/')}
              className="w-full"
              data-testid="button-go-home"
            >
              <ArrowLeft className="w-4 h-4 ml-2" />
              العودة للرئيسية
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-card border-b border-border shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <h1 className="text-2xl font-bold text-[#434040]">اشترك معنا</h1>
          <p className="text-sm text-muted-foreground">اختر باقة واملأ بيانات عقارك</p>
        </div>
      </header>
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Progress Bar - 3 Steps */}
        <div className="mb-8">
          <div className="flex items-center justify-between gap-2 mb-4">
            {/* Step 1 */}
            <div className="flex flex-col items-center flex-1">
              <div className={`w-10 h-10 rounded-full font-bold flex items-center justify-center text-white transition ${currentStep >= 1 ? 'bg-[#434040]' : 'bg-muted'}`}>
                {currentStep > 1 ? '✓' : '1'}
              </div>
              <p className="text-xs mt-2 text-center font-semibold">اختيار الباقة</p>
            </div>

            {/* Line 1-2 */}
            <div className={`flex-1 h-1 ${currentStep >= 2 ? 'bg-[#434040]' : 'bg-muted'}`}></div>

            {/* Step 2 */}
            <div className="flex flex-col items-center flex-1">
              <div className={`w-10 h-10 rounded-full font-bold flex items-center justify-center text-white transition ${currentStep >= 2 ? 'bg-[#434040]' : 'bg-muted'}`}>
                {currentStep > 2 ? '✓' : '2'}
              </div>
              <p className="text-xs mt-2 text-center font-semibold">بيانات العقار</p>
            </div>

            {/* Line 2-3 */}
            <div className={`flex-1 h-1 ${currentStep >= 3 ? 'bg-[#434040]' : 'bg-muted'}`}></div>

            {/* Step 3 */}
            <div className="flex flex-col items-center flex-1">
              <div className={`w-10 h-10 rounded-full font-bold flex items-center justify-center text-white transition ${currentStep >= 3 ? 'bg-[#434040]' : 'bg-muted'}`}>
                3
              </div>
              <p className="text-xs mt-2 text-center font-semibold">طريقة الدفع</p>
            </div>
          </div>
        </div>

        {/* Step 1: Select Package */}
        {currentStep === 1 && (
          <Card className="p-8">
            <h2 className="text-xl font-bold text-[#434040] mb-6">الخطوة 1: اختر باقة الاشتراك</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
              {(showAllPackages ? packages : packages.slice(0, 4)).map((pkg) => (
                <div
                  key={pkg.id}
                  className={`p-5 rounded-lg border-2 transition-all ${selectedPackageId === pkg.id
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
                  <p className="text-xs text-muted-foreground mb-3">{pkg.duration} يوم</p>
                  {pkg.type === 'مميز' && (
                    <Badge className="bg-[#c9951d] border-0 text-xs text-[#fbfaf9] mb-3">مميز</Badge>
                  )}
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setPackageToView(pkg)}
                      className="flex-1"
                    >
                      التفاصيل
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => {
                        setSelectedPackageId(pkg.id);
                        setCurrentStep(2);
                      }}
                      className={`flex-1 ${selectedPackageId === pkg.id ? 'bg-[#434040]' : ''}`}
                    >
                      اختيار
                    </Button>
                  </div>
                </div>
              ))}
            </div>
            {packages.length > 4 && (
              <div className="text-center mb-6">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setShowAllPackages(!showAllPackages)}
                  className="border-2 border-[#434040] hover:bg-[#434040] hover:text-white"
                >
                  {showAllPackages ? `عرض أقل` : `عرض المزيد (${packages.length} باقة)`}
                </Button>
              </div>
            )}
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
            <form onSubmit={(e) => { 
              e.preventDefault(); 
              if (validateForm()) {
                setCurrentStep(3); 
              }
            }} className="space-y-6">

              {/* Property Info */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold mb-2">رقم العقار (5 أرقام) *</label>
                  <Input
                    placeholder="أخر 5 أرقام من جوالك "
                    value={formData.propertyNumber}
                    onChange={(e) => {
                      const result = validatePropertyNumberInput(e.target.value);
                      setFormData({ ...formData, propertyNumber: result.cleaned });
                      setErrors({...errors, propertyNumber: result.error || ""});
                    }}
                    maxLength={5}
                    className={errors.propertyNumber ? "border-red-500" : ""}
                  />
                  {errors.propertyNumber && <p className="text-xs text-red-500 mt-1">{errors.propertyNumber}</p>}
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-2">اسم العقار *</label>
                  <Input
                    placeholder="شالية مودي"
                    value={formData.name}
                    onChange={(e) => {
                      const cleaned = validateTextInput(e.target.value);
                      setFormData({ ...formData, name: cleaned });
                      setErrors({...errors, name: ""});
                    }}
                    className={errors.name ? "border-red-500" : ""}
                  />
                  {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name}</p>}
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-2">الرقم السري *</label>
                  <Input
                    type="password"
                    placeholder="اختر رقماً سرياً"
                    value={formData.pin}
                    onChange={(e) => {
                      const result = validatePinInput(e.target.value);
                      setFormData({ ...formData, pin: result.cleaned });
                      setErrors({...errors, pin: result.error || ""});
                    }}
                    className={errors.pin ? "border-red-500" : ""}
                  />
                  {errors.pin && <p className="text-xs text-red-500 mt-1">{errors.pin}</p>}
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-2">رقم الواتساب *</label>
                  <Input
                    placeholder="050xxxxxxx"
                    value={formData.whatsappNumber}
                    onChange={(e) => {
                      const result = validateWhatsAppInput(e.target.value);
                      setFormData({ ...formData, whatsappNumber: result.cleaned });
                      setErrors({...errors, whatsappNumber: result.error || ""});
                    }}
                    className={errors.whatsappNumber ? "border-red-500" : ""}
                  />
                  {errors.whatsappNumber && <p className="text-xs text-red-500 mt-1">{errors.whatsappNumber}</p>}
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
                    onChange={(e) => {
                      const cleaned = validateTextInput(e.target.value);
                      setFormData({ ...formData, location: cleaned });
                    }}
                  />
                </div>
              </div>

              {/* Prices */}
              <div className="border-t pt-6">
                <h3 className="text-lg font-bold mb-4">الأسعار {getCurrencyLabel()} *</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <label className="block text-sm font-semibold mb-2">وسط الأسبوع</label>
                    <Input type="number" placeholder="500" value={prices.weekday} onChange={(e) => setPrices({ ...prices, weekday: validateNumericInput(e.target.value) })} required />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold mb-2">نهاية الأسبوع</label>
                    <Input type="number" placeholder="800" value={prices.weekend} onChange={(e) => setPrices({ ...prices, weekend: validateNumericInput(e.target.value) })} required />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold mb-2">مبيت</label>
                    <Input type="number" placeholder="1200" value={prices.overnight} onChange={(e) => setPrices({ ...prices, overnight: validateNumericInput(e.target.value) })} required />
                  </div>
                  <div>
                    <label className="block text-sm font-semibold mb-2">إجازات</label>
                    <Input type="number" placeholder="1000" value={prices.holidays} onChange={(e) => setPrices({ ...prices, holidays: validateNumericInput(e.target.value) })} required />
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
                        <p className="text-sm text-green-600 mt-2">✓ سيتم خصم {formatDiscount(validatedDiscount.value, validatedDiscount.type)}</p>
                      )}
                    </div>

                    {/* Bank Receipt */}
                    {paymentMethod === 'bank' && (
                      <div className="p-4 bg-muted/30 rounded-lg space-y-3">
                        <div className="p-5 bg-gradient-to-br from-blue-50 to-indigo-50 border-2 border-blue-300 rounded-xl space-y-3">
                          <div className="flex items-center gap-2 mb-3">
                            <CreditCard className="w-6 h-6 text-blue-700" />
                            <p className="font-bold text-lg text-blue-800">معلومات التحويل البنكي</p>
                          </div>
                          <div className="space-y-3">
                            <div className="flex items-center justify-between p-3 bg-white/70 rounded-lg">
                              <span className="text-sm font-semibold text-blue-700">البنك</span>
                              <span className="text-base font-bold text-blue-900">البنك الأهلي</span>
                            </div>
                            <div className="flex items-center justify-between p-3 bg-white/70 rounded-lg">
                              <span className="text-sm font-semibold text-blue-700">اسم المستفيد</span>
                              <span className="text-base font-bold text-blue-900">شركة روقان للعقارات</span>
                            </div>
                            <div className="flex items-center justify-between p-3 bg-white/70 rounded-lg">
                              <span className="text-sm font-semibold text-blue-700">IBAN</span>
                              <span className="text-base font-bold text-blue-900 tracking-wide font-mono" dir="ltr">SA0610000012345678901234</span>
                            </div>
                            <div className="mt-4 p-3 bg-white/70 rounded-lg text-center">
                              <p className="text-sm font-semibold text-blue-700 mb-2">QR Code للدفع</p>
                              <img 
                                src="/assets/bank-qr.png" 
                                alt="QR Code للدفع" 
                                className="max-w-[180px] mx-auto rounded-lg cursor-pointer hover:scale-105 transition-transform"
                                onClick={() => window.open('/assets/bank-qr.png', '_blank')}
                              />
                            </div>
                          </div>
                          <div className="mt-3 p-3 bg-amber-50 border border-amber-300 rounded-lg">
                            <p className="text-sm font-semibold text-amber-800">⚠ يرجى كتابة رقم العقار في ملاحظات التحويل</p>
                          </div>
                        </div>
                        <div>
                          <label className="block text-sm font-semibold mb-2">إيصال التحويل</label>
                          <input ref={fileInputRef} type="file" accept="image/*" onChange={(e) => setReceiptFile(e.target.files?.[0] || null)} className="hidden" />
                          <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()} className="w-full gap-2 border-blue-400 text-blue-700 hover:bg-blue-50">
                            <Upload className="w-4 h-4" />
                            {receiptFile ? receiptFile.name : 'اختر صورة الإيصال'}
                          </Button>
                        </div>
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

              {/* Visual Captcha */}
              <div>
                <label className="block text-sm font-semibold mb-2">رمز التحقق</label>
                <div className="flex items-center gap-3 mb-2">
                  <canvas
                    ref={captchaCanvasRef}
                    width={220}
                    height={60}
                    className="rounded-lg border border-border select-none"
                    style={{ imageRendering: 'auto' }}
                  />
                  <Button type="button" variant="outline" size="icon" onClick={refreshCaptcha} title="تحديث الرمز" className="shrink-0">
                    <RefreshCw className="h-4 w-4" />
                  </Button>
                </div>
                <Input
                  placeholder="أدخل الأحرف الظاهرة أعلاه"
                  value={captchaInput}
                  onChange={(e) => setCaptchaInput(e.target.value)}
                  maxLength={5}
                  className="tracking-widest text-center font-mono text-lg"
                  autoComplete="off"
                  spellCheck={false}
                  required
                />
                <p className="text-xs text-muted-foreground mt-1">أدخل الأحرف والأرقام كما تظهر في الصورة (لا يُفرّق بين الحروف الكبيرة والصغيرة)</p>
              </div>

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

        {/* Package Details Modal */}
        <Dialog open={!!packageToView} onOpenChange={() => setPackageToView(null)}>
          <DialogContent className="max-w-md" dir="rtl">
            <DialogHeader>
              <DialogTitle className="text-[#434040]">{packageToView?.name}</DialogTitle>
              <DialogDescription>تفاصيل الباقة الكاملة</DialogDescription>
            </DialogHeader>
            {packageToView && (
              <div className="space-y-4">
                <div>
                  <p className="text-sm text-muted-foreground mb-1">السعر</p>
                  {packageToView.price === 0 ? (
                    <p className="text-2xl font-bold text-[#434040]">مجاني</p>
                  ) : (
                    <PriceDisplay amount={packageToView.price} size="lg" />
                  )}
                </div>
                <div>
                  <p className="text-sm text-muted-foreground mb-1">مدة الاشتراك</p>
                  <p className="font-semibold">{packageToView.duration} يوم</p>
                </div>
                {packageToView.features && packageToView.features.length > 0 && (
                  <div>
                    <p className="text-sm text-muted-foreground mb-2">الميزات:</p>
                    <ul className="space-y-1">
                      {packageToView.features.map((feature, idx) => (
                        <li key={idx} className="text-sm flex items-start gap-2">
                          <span className="text-[#434040] font-bold mt-0.5">✓</span>
                          <span>{feature}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {packageToView.type === 'مميز' && (
                  <Badge className="bg-[#c9951d] border-0 text-xs text-[#fbfaf9] w-fit">
                    مميز
                  </Badge>
                )}
                <div className="flex gap-2 pt-4">
                  <Button
                    variant="outline"
                    onClick={() => setPackageToView(null)}
                    className="flex-1"
                  >
                    إغلاق
                  </Button>
                  <Button
                    onClick={() => {
                      setSelectedPackageId(packageToView.id);
                      setPackageToView(null);
                    }}
                    className="flex-1 bg-[#434040]"
                  >
                    اختيار
                  </Button>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
