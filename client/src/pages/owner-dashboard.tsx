import { useEffect, useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { Property, AddOnPackage, PropertyAddOn } from "@shared/schema";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CreditCard,
  Image as ImageIcon,
  Home,
  Crown,
  BarChart2,
  MessageCircle,
  Edit3,
  Activity,
  AlertTriangle,
  Eye,
  ChevronDown,
  Eye as EyeIcon,
  EyeOff,
  Clock,
  CheckCircle2,
  XCircle,
  Receipt,
  Loader2,
  Filter,
  Plus,
  Minus,
  ChevronLeft,
  ChevronRight,
  Upload,
  Zap,
  Star,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { PriceDisplay } from "@/components/price-display";
import { formatLiveSaudiTime } from "@/lib/dateUtils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export default function OwnerDashboard() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [showRequestsStats, setShowRequestsStats] = useState(false);
  const [paymentFilter, setPaymentFilter] = useState<'all' | 'completed' | 'pending'>('all');
  const [paymentsExpanded, setPaymentsExpanded] = useState(false);
  
  // التحقق من نجاح الدفع عند الوصول من Paymob
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const paymentStatus = urlParams.get('payment');
    const addonPaymentStatus = urlParams.get('addon_payment');
    
    if (paymentStatus === 'success') {
      toast({
        title: "تم الدفع بنجاح!",
        description: "تم تفعيل اشتراكك بنجاح. شكراً لك!",
      });
      // إزالة query param من URL
      window.history.replaceState({}, '', '/owner/dashboard');
    }
    
    if (addonPaymentStatus === 'success') {
      toast({
        title: "تم الدفع بنجاح!",
        description: "تم استلام طلب الإضافة وهو الآن قيد مراجعة الإدارة. سيتم تفعيله قريباً.",
      });
      // تحديث بيانات الإضافات
      queryClient.invalidateQueries({ queryKey: ["/api/owner/property-addons"] });
      queryClient.invalidateQueries({ queryKey: ["/api/owner/payments"] });
      // إزالة query param من URL
      window.history.replaceState({}, '', '/owner/dashboard');
    }
  }, [toast]);

  // نافذة رفع الإيصال للتحويل البنكي
  const [showReceiptDialog, setShowReceiptDialog] = useState(false);
  const [selectedPaymentForReceipt, setSelectedPaymentForReceipt] = useState<any>(null);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [isUploadingReceipt, setIsUploadingReceipt] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // نتيجة الفحص النهائية
  const [verificationResult, setVerificationResult] = useState<{
    success: boolean;
    summary: string;
    errors: string[];
  } | null>(null);

  // شريط التحقق الذكي - فحص بيانات العقار
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationProgress, setVerificationProgress] = useState(0);
  const [verificationSteps, setVerificationSteps] = useState<{
    step: number;
    name: string;
    status: 'pending' | 'checking' | 'success' | 'error';
    message?: string;
  }[]>([
    { step: 1, name: 'التحقق من رقم العقار', status: 'pending' },
    { step: 2, name: 'التحقق من رقم الجوال', status: 'pending' },
    { step: 3, name: 'التحقق من الموقع والاتجاه', status: 'pending' },
    { step: 4, name: 'التحقق من الصور', status: 'pending' },
    { step: 5, name: 'التحقق من النوع والمرافق', status: 'pending' },
    { step: 6, name: 'التحقق من الأسعار', status: 'pending' },
    { step: 7, name: 'تحديث حالة العقار', status: 'pending' },
  ]);


  // ===================== دالة استخراج فترة الذروة =====================
  function getPeakPeriod(requests: any[]) {
    if (!requests || requests.length === 0) return "غير محدد";

    const dayNames = [
      "الأحد",
      "الإثنين",
      "الثلاثاء",
      "الأربعاء",
      "الخميس",
      "الجمعة",
      "السبت",
    ];

    const dayCount: Record<string, number> = {};
    const hourCount: Record<number, number> = {};

    requests.forEach((req) => {
  const day = req.dayOfWeek || req.day || "غير محدد";
  const hour = req.hourOfDay || req.hour || 0;

  dayCount[day] = (dayCount[day] || 0) + 1;
  hourCount[hour] = (hourCount[hour] || 0) + 1;
});


    const bestDay =
      Object.entries(dayCount).sort(([, a], [, b]) => b - a)[0]?.[0] ||
      "غير محدد";

    const bestHour =
      Number(
        Object.entries(hourCount).sort(([, a], [, b]) => b - a)[0]?.[0]
      ) || 0;

    const suffix = bestHour >= 12 ? "مساءً" : "صباحاً";
    const hour12 = bestHour % 12 || 12;

    return `${bestDay} – ${hour12} ${suffix}`;
  }


  // 1) Session check
  const { data: sessionData, isLoading: isSessionLoading } = useQuery<{
    isLoggedIn: boolean;
    propertyNumber?: string;
  }>({
    queryKey: ["/api/owner/session"],
    retry: false,
    refetchOnWindowFocus: false,
  });

  // 2) Property fetch
  const {
    data: property,
    isLoading: isPropertyLoading,
    error: propertyError,
  } = useQuery<Property>({
    queryKey: ["/api/owner/property"],
    enabled: sessionData?.isLoggedIn === true,
    retry: false,
    refetchOnWindowFocus: false,
  });

  // 3) جلب الإحصائيات
  const {
    data: analytics,
    isLoading: analyticsLoading,
  } = useQuery<any>({
    queryKey: ["/api/owner/analytics"],
    enabled: sessionData?.isLoggedIn === true,
    retry: false,
    refetchOnWindowFocus: false,
  });

  // 4) جلب الطلبات
  // 4) جلب الطلبات
const {
  data: requestsData,
  isLoading: requestsLoading,
} = useQuery<any>({
  queryKey: ["/api/owner/requests"],
  enabled: sessionData?.isLoggedIn === true,
  retry: false,
  refetchOnWindowFocus: false,
});

// 5) جلب المدفوعات
const {
  data: paymentsData,
  isLoading: paymentsLoading,
} = useQuery<any[]>({
  queryKey: ["/api/owner/payments"],
  enabled: sessionData?.isLoggedIn === true,
  retry: false,
  refetchOnWindowFocus: false,
});

// 5.0) جلب بيانات الاشتراك الحالي
const {
  data: currentSubscription,
} = useQuery<any>({
  queryKey: ["/api/owner/current-subscription"],
  enabled: sessionData?.isLoggedIn === true,
  retry: false,
  refetchOnWindowFocus: false,
});

// 5.0.1) جلب باقات الإضافات المتاحة
const { data: addOnPackages = [] } = useQuery<AddOnPackage[]>({
  queryKey: ["/api/owner/addons"],
  enabled: sessionData?.isLoggedIn === true,
  refetchOnWindowFocus: false,
});

// 5.0.2) جلب إضافات العقار الحالية
const { data: propertyAddOns = [] } = useQuery<PropertyAddOn[]>({
  queryKey: ["/api/owner/property-addons"],
  enabled: sessionData?.isLoggedIn === true,
  refetchOnWindowFocus: false,
});

// حالة شراء الإضافة
const [purchasingAddonId, setPurchasingAddonId] = useState<string | null>(null);

// 5.1) التحقق من التحويل البنكي المعلق - نظام ذكي
const {
  data: pendingCheckData,
  isLoading: isPendingCheckLoading,
  refetch: refetchPendingCheck,
} = useQuery<any>({
  queryKey: ["/api/owner/payment/check-pending"],
  enabled: sessionData?.isLoggedIn === true,
  retry: false,
  refetchInterval: 30000, // تحديث كل 30 ثانية
});

// دالة التحقق التدريجي الذكي من بيانات العقار
const startSmartVerification = async () => {
  if (!property) return;

  setIsVerifying(true);
  setVerificationProgress(0);

  const steps = [...verificationSteps];
  let hasErrors = false;
  const propData = property as any;

  try {
    // خطوة 1: التحقق من رقم العقار
    steps[0].status = 'checking';
    setVerificationSteps([...steps]);
    await new Promise(r => setTimeout(r, 600));

    if (property.propertyNumber && property.propertyNumber.length === 5) {
      steps[0].status = 'success';
      steps[0].message = `رقم العقار: ${property.propertyNumber}`;
    } else {
      steps[0].status = 'error';
      steps[0].message = 'رقم العقار غير صحيح (يجب أن يكون 5 أرقام)';
      hasErrors = true;
    }
    setVerificationProgress(14);
    setVerificationSteps([...steps]);
    await new Promise(r => setTimeout(r, 400));

    // خطوة 2: التحقق من رقم الجوال
    steps[1].status = 'checking';
    setVerificationSteps([...steps]);
    await new Promise(r => setTimeout(r, 600));

    const phoneNumber = propData.whatsappNumber || propData.phone || '';
    if (phoneNumber && phoneNumber.length >= 9) {
      steps[1].status = 'success';
      steps[1].message = `رقم الجوال: ${phoneNumber}`;
    } else {
      steps[1].status = 'error';
      steps[1].message = phoneNumber ? 'رقم الجوال غير صحيح' : 'رقم الجوال مفقود';
      hasErrors = true;
    }
    setVerificationProgress(28);
    setVerificationSteps([...steps]);
    await new Promise(r => setTimeout(r, 400));

    // خطوة 3: التحقق من الموقع والاتجاه
    steps[2].status = 'checking';
    setVerificationSteps([...steps]);
    await new Promise(r => setTimeout(r, 600));

    const hasLocation = property.location && property.location.trim();
    const hasDirection = propData.direction && propData.direction.trim();
    const hasCity = property.city && property.city.trim();

    if (hasLocation && hasDirection && hasCity) {
      steps[2].status = 'success';
      steps[2].message = `${property.city} - ${property.location} (${propData.direction})`;
    } else {
      steps[2].status = 'error';
      const missing = [];
      if (!hasCity) missing.push('المدينة');
      if (!hasLocation) missing.push('الموقع');
      if (!hasDirection) missing.push('الاتجاه');
      steps[2].message = `${missing.join(' و ')} مفقود`;
      hasErrors = true;
    }
    setVerificationProgress(42);
    setVerificationSteps([...steps]);
    await new Promise(r => setTimeout(r, 400));

    // خطوة 4: التحقق من الصور (من R2)
    steps[3].status = 'checking';
    setVerificationSteps([...steps]);
    await new Promise(r => setTimeout(r, 600));

    let imagesCount = 0;
    try {
      const imagesResponse = await fetch('/api/owner/r2-images');
      if (imagesResponse.ok) {
        const imagesData = await imagesResponse.json();
        const imagesArray = imagesData.images || imagesData;
        imagesCount = Array.isArray(imagesArray) ? imagesArray.length : 0;
      }
    } catch (e) {
      console.log('لم يتم جلب الصور من R2');
    }

    if (imagesCount >= 3) {
      steps[3].status = 'success';
      steps[3].message = `${imagesCount} صورة`;
    } else {
      steps[3].status = 'error';
      steps[3].message = imagesCount === 0 
        ? 'لا توجد صور مرفوعة' 
        : `${imagesCount} صورة فقط (يجب 3 على الأقل)`;
      hasErrors = true;
    }
    setVerificationProgress(56);
    setVerificationSteps([...steps]);
    await new Promise(r => setTimeout(r, 400));

    // خطوة 5: التحقق من النوع والمرافق
    steps[4].status = 'checking';
    setVerificationSteps([...steps]);
    await new Promise(r => setTimeout(r, 600));

    const facilitiesData = propData.facilities || [];
    let facilitiesCount = 0;
    if (Array.isArray(facilitiesData)) {
      facilitiesCount = facilitiesData.length;
    } else if (typeof facilitiesData === 'string' && facilitiesData.trim()) {
      try {
        const parsed = JSON.parse(facilitiesData);
        facilitiesCount = Array.isArray(parsed) ? parsed.length : 0;
      } catch {
        facilitiesCount = facilitiesData.split(',').filter((s: string) => s.trim()).length;
      }
    }

    const hasType = property.type && property.type.trim();
    if (hasType && facilitiesCount >= 3) {
      steps[4].status = 'success';
      steps[4].message = `${property.type} - ${facilitiesCount} مرفق`;
    } else {
      steps[4].status = 'error';
      if (!hasType) {
        steps[4].message = 'النوع مفقود';
      } else {
        steps[4].message = `${facilitiesCount} مرفق فقط (يجب 3 على الأقل)`;
      }
      hasErrors = true;
    }
    setVerificationProgress(70);
    setVerificationSteps([...steps]);
    await new Promise(r => setTimeout(r, 400));

    // خطوة 6: التحقق من الأسعار
    steps[5].status = 'checking';
    setVerificationSteps([...steps]);
    await new Promise(r => setTimeout(r, 600));

    const pricesObj = propData.prices || {};
    const hasValidPrices = (
      (pricesObj.weekday && Number(pricesObj.weekday) > 0) ||
      (pricesObj.weekend && Number(pricesObj.weekend) > 0) ||
      (pricesObj.overnight && Number(pricesObj.overnight) > 0)
    );

    if (hasValidPrices) {
      steps[5].status = 'success';
      const prices = [];
      if (pricesObj.weekday) prices.push(`وسط الأسبوع: ${pricesObj.weekday}`);
      if (pricesObj.weekend) prices.push(`نهاية الأسبوع: ${pricesObj.weekend}`);
      steps[5].message = prices.join(' | ');
    } else {
      steps[5].status = 'error';
      steps[5].message = 'لا توجد أسعار محددة';
      hasErrors = true;
    }
    setVerificationProgress(84);
    setVerificationSteps([...steps]);
    await new Promise(r => setTimeout(r, 400));

    // خطوة 7: تحديث حالة العقار
    steps[6].status = 'checking';
    setVerificationSteps([...steps]);
    await new Promise(r => setTimeout(r, 600));

    // جمع الأخطاء من الخطوات
    const errorsList = steps
      .filter(s => s.status === 'error')
      .map(s => `${s.name}: ${s.message}`);

    if (!hasErrors) {
      // استدعاء API لتفعيل الاشتراك - سيعطي approved
      const response = await apiRequest('POST', '/api/owner/property/activate', {
        propertyNumber: property.propertyNumber,
        status: 'approved'
      });
      const result = await response.json();

      if (result.success) {
        steps[6].status = 'success';
        steps[6].message = 'تم تفعيل الاشتراك بنجاح! ✅';
        setVerificationProgress(100);
        setVerificationSteps([...steps]);

        setVerificationResult({
          success: true,
          summary: 'تم التحقق من جميع البيانات وتفعيل الاشتراك بنجاح',
          errors: []
        });

        toast({
          title: "✅ تم الاعتماد بنجاح",
          description: "تم اعتماد عقارك بعد نجاح فحص البيانات",
        });

        setTimeout(async () => {
          await queryClient.invalidateQueries({ queryKey: ["/api/owner/property"] });
          setIsVerifying(false);
        }, 2000);
      } else {
        steps[6].status = 'error';
        steps[6].message = result.message || 'فشل الاعتماد';
        setVerificationProgress(100);
        setVerificationSteps([...steps]);

        setVerificationResult({
          success: false,
          summary: result.message || 'فشل اعتماد العقار',
          errors: [result.message || 'فشل الاعتماد']
        });

        setTimeout(() => setIsVerifying(false), 2000);
      }
    } else {
      // استدعاء API لتحديث الحالة إلى rejected
      try {
        await apiRequest('POST', '/api/owner/property/activate', {
          propertyNumber: property.propertyNumber,
          status: 'rejected'
        });
      } catch (e) {
        console.log('فشل تحديث الحالة إلى rejected');
      }

      steps[6].status = 'error';
      steps[6].message = 'تم رفض العقار - يوجد بيانات ناقصة';
      setVerificationProgress(100);
      setVerificationSteps([...steps]);

      setVerificationResult({
        success: false,
        summary: `فشل التحقق - ${errorsList.length} مشكلة تحتاج إصلاح`,
        errors: errorsList
      });

      toast({
        title: "❌ تم رفض العقار",
        description: "يرجى إصلاح الأخطاء في بيانات العقار وإعادة الفحص",
        variant: "destructive",
      });

      setTimeout(async () => {
        await queryClient.invalidateQueries({ queryKey: ["/api/owner/property"] });
        setIsVerifying(false);
      }, 2000);
    }
  } catch (error: any) {
    toast({
      title: "خطأ",
      description: error.message || "حدث خطأ أثناء التحقق",
      variant: "destructive",
    });
    setVerificationResult({
      success: false,
      summary: 'حدث خطأ أثناء التحقق',
      errors: [error.message || 'خطأ غير متوقع']
    });
    setIsVerifying(false);
  }
};

// دالة رفع الإيصال للتحويل البنكي
const handleReceiptUpload = async () => {
  if (!receiptFile || !selectedPaymentForReceipt) return;

  setIsUploadingReceipt(true);

  try {
    const formData = new FormData();
    formData.append('paymentId', selectedPaymentForReceipt.id);
    formData.append('receipt', receiptFile);

    const response = await fetch('/api/owner/payment/upload-receipt', {
      method: 'POST',
      body: formData,
      credentials: 'include',
    });

    const result = await response.json();

    if (response.ok) {
      toast({
        title: "✅ تم رفع الإيصال",
        description: "تم رفع إيصال التحويل بنجاح وسيتم مراجعته",
      });

      // إغلاق النافذة وإعادة تحميل البيانات
      setShowReceiptDialog(false);
      setSelectedPaymentForReceipt(null);
      setReceiptFile(null);
      await queryClient.invalidateQueries({ queryKey: ["/api/owner/payments"] });
    } else {
      throw new Error(result.error || 'فشل رفع الإيصال');
    }
  } catch (error: any) {
    toast({
      title: "خطأ",
      description: error.message || "حدث خطأ في رفع الإيصال",
      variant: "destructive",
    });
  } finally {
    setIsUploadingReceipt(false);
  }
};

// 6) إعادة محاولة الدفع
const retryPaymentMutation = useMutation({
  mutationFn: async (paymentId: string) => {
    const response = await apiRequest('POST', '/api/owner/payment/retry', { paymentId });
    return response.json();
  },
  onSuccess: (data) => {
    if (data.checkoutUrl) {
      window.location.href = data.checkoutUrl;
    }
  },
  onError: (error: any) => {
    toast({
      title: "خطأ",
      description: error.message || "حدث خطأ في إعادة الدفع",
      variant: "destructive",
    });
  },
});

// التحقق من حالة الدفع مباشرة من Paymob
const verifyPaymentMutation = useMutation({
  mutationFn: async (paymentId: string) => {
    const response = await fetch(`/api/payment/verify-status/${encodeURIComponent(paymentId)}`);
    return response.json();
  },
  onSuccess: (data) => {
    if (data.verified) {
      toast({
        title: "تم التحقق بنجاح ✅",
        description: data.message || "تم تأكيد الدفع",
      });
      queryClient.invalidateQueries({ queryKey: ['/api/owner/payments'] });
      queryClient.invalidateQueries({ queryKey: ['/api/owner/current-subscription'] });
    } else {
      toast({
        title: "لم يتم التأكيد",
        description: data.message || "الدفعة لم تكتمل بعد",
        variant: "destructive",
      });
    }
  },
  onError: (error: any) => {
    toast({
      title: "خطأ",
      description: error.message || "حدث خطأ في التحقق",
      variant: "destructive",
    });
  },
});

// ================= DEBUG LOGS =================
console.log("🔍 requestsData:", requestsData);
console.log("🔍 sessionData:", sessionData);
console.log("🔍 isLoggedIn:", sessionData?.isLoggedIn);
console.log("🔍 paymentsData:", paymentsData);


  useEffect(() => {
    if (!isSessionLoading && sessionData) {
      if (!sessionData.isLoggedIn) {
        setLocation("/owner/login");
      } else {
        setIsAuthenticated(true);
      }
    }
  }, [sessionData, isSessionLoading, setLocation]);

  const handleLogout = async () => {
    try {
      await fetch("/api/owner/logout", {
        method: "POST",
        credentials: "include",
      });

      toast({
        title: "تم تسجيل الخروج",
        description: "نراك قريباً!",
      });
      // Force full page reload to clear all state
      window.location.href = "/owner/login";
    } catch (e) {
      console.error(e);
      toast({
        title: "خطأ في تسجيل الخروج",
        description: "حدث خطأ، يرجى المحاولة مرة أخرى",
        variant: "destructive",
      });
    }
  };

  if (isSessionLoading || isAuthenticated === null)
    return <Loader text="جاري التحقق من الجلسة..." />;
  if (isPropertyLoading) return <Loader text="جاري تحميل بيانات العقار..." />;
  if (propertyError || !property) return <ErrorView setLocation={setLocation} />;

  // ================== من هنا يبدأ الذكاء البصري للوحة ==================

  const isVip = property.subscriptionType === "مميز";

  // Calculate subscription progress from actual subscription data
  const calculateRemainingDaysLocal = () => {
    if (!property.subscriptionType || property.subscriptionType === "عادي") {
      return null;
    }

    // استخدام تاريخ الانتهاء من بيانات الاشتراك الحالي
    if (currentSubscription?.endDate) {
      const endDate = new Date(currentSubscription.endDate);
      const startDate = currentSubscription?.startDate ? new Date(currentSubscription.startDate) : null;
      const now = new Date();
      now.setHours(0, 0, 0, 0);
      
      // إذا تاريخ البداية في المستقبل ← أرجع المدة الكاملة للاشتراك
      if (startDate) {
        const startMidnight = new Date(startDate);
        startMidnight.setHours(0, 0, 0, 0);
        if (startMidnight.getTime() > now.getTime()) {
          const endMidnight = new Date(endDate);
          endMidnight.setHours(0, 0, 0, 0);
          const fullDuration = endMidnight.getTime() - startMidnight.getTime();
          return Math.ceil(fullDuration / (1000 * 60 * 60 * 24));
        }
      }
      
      // الحساب العادي: من اليوم لتاريخ الانتهاء
      const diffTime = endDate.getTime() - now.getTime();
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      return Math.max(0, diffDays);
    }

    return null;
  };

  // حساب إجمالي أيام الاشتراك
  const calculateTotalDays = () => {
    if (currentSubscription?.startDate && currentSubscription?.endDate) {
      const start = new Date(currentSubscription.startDate);
      const end = new Date(currentSubscription.endDate);
      const diffTime = end.getTime() - start.getTime();
      return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    }
    return 30; // افتراضي
  };

  const remainingDays = calculateRemainingDaysLocal();
  const totalDays = calculateTotalDays();
  const usedDays =
    remainingDays !== null ? Math.max(totalDays - remainingDays, 0) : null;
  const progressPercent =
    usedDays !== null
      ? Math.max(0, Math.min(100, (usedDays / totalDays) * 100))
      : null;

  const isNearExpiry =
    remainingDays !== null && remainingDays <= 7 && remainingDays > 0;

  // زر واحد ذكي للاشتراك (ترقية / إدارة)
  const subscriptionButtonLabel = isVip ? "إدارة الاشتراك" : "ترقية الاشتراك";

  const handleComingSoon = () => {
    toast({
      title: "قريباً",
      description: "سيتم توفير هذه الميزة في التحديثات القادمة.",
    });
  };

  // شراء إضافة
  const handlePurchaseAddon = async (addonId: string) => {
    if (!property?.propertyNumber) return;
    
    setPurchasingAddonId(addonId);
    
    try {
      const response = await fetch("/api/owner/addons/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          propertyNumber: property.propertyNumber,
          addOnPackageId: addonId,
        }),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        toast({
          title: "خطأ",
          description: data.error || "فشل بدء عملية الدفع",
          variant: "destructive",
        });
        return;
      }
      
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      }
    } catch (error) {
      toast({
        title: "خطأ",
        description: "تعذر الاتصال بالخادم",
        variant: "destructive",
      });
    } finally {
      setPurchasingAddonId(null);
    }
  };

  // التحقق من إضافة نشطة
  const hasActiveAddon = (addonId: string) => {
    return propertyAddOns.some(
      (a) => a.addOnPackageId === addonId && a.status === "active"
    );
  };

  // لون الفئة
  const getCategoryColor = (category: string) => {
    switch (category) {
      case "اعلان": return "bg-amber-500";
      case "ابراز": return "bg-purple-500";
      case "تثبيت": return "bg-blue-500";
      case "توثيق": return "bg-emerald-500";
      default: return "bg-slate-500";
    }
  };

  // ===== حساب الإحصائيات من البيانات الفعلية =====
const calculateAnalytics = () => {
  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  const allRequests = requestsData?.requests || [];

  // طلبات هذا الشهر
  const monthlyRequestsArray = allRequests.filter((req: any) => {
    const d = new Date(req.timestamp);
    return (
      d.getMonth() === currentMonth &&
      d.getFullYear() === currentYear
    );
  });

  const monthlyRequests = monthlyRequestsArray.length;

  // اليوم الأعلى طلباً
  const dayNames = [
    "الأحد",
    "الإثنين",
    "الثلاثاء",
    "الأربعاء",
    "الخميس",
    "الجمعة",
    "السبت",
  ];

  const dayCount: Record<string, number> = {};

  monthlyRequestsArray.forEach((req: any) => {
    const d = new Date(req.timestamp);
    const day = req.dayOfWeek || req.day || "غير محدد";
    dayCount[day] = (dayCount[day] || 0) + 1;
  });

  const highestDemandDay =
    Object.keys(dayCount).length
      ? Object.entries(dayCount).sort(([, a], [, b]) => b - a)[0][0]
      : "لا يوجد بيانات";

  // متوسط الطلبات يومياً
  const uniqueDays = Object.keys(dayCount).length || 1;
  const dailyAverage = Math.round(monthlyRequests / uniqueDays);

  // 🔥 هنا مكان peakPeriod الصحيح
  const peakPeriod = getPeakPeriod(allRequests);

  return {
    monthlyRequests,
    dailyAverage,
    highestDemandDay,
    previousMonthGrowth: 0,
    totalProperties: 1,
    peakPeriod,
    rank: 1,
  };
};



  const stats = calculateAnalytics();

  return (
    <div className="min-h-screen bg-background pb-20">
      {/* ===== تنبيه أعلى الصفحة عند قرب انتهاء الاشتراك ===== */}
      {isNearExpiry && (
        <div className="bg-red-50 dark:bg-red-950/30 border-b border-red-200 dark:border-red-900">
          <div className="max-w-7xl mx-auto px-3 md:px-4 py-3 flex items-center gap-2 text-xs md:text-sm">
            <AlertTriangle className="w-4 md:w-5 h-4 md:h-5 text-red-500 flex-shrink-0" />
            <p className="text-red-700 dark:text-red-400 font-medium">
              اشتراكك ينتهي بـ <span className="font-bold">{remainingDays}</span> أيام – <span className="md:inline hidden">نوصي بتجديده مبكراً</span>
            </p>
          </div>
        </div>
      )}

      {/* ===== الهيدر / رأس الصفحة ===== */}
      <header
        className={
          "border-b border-border shadow-sm sticky top-0 z-10 " +
          (isVip
            ? "bg-gradient-to-l from-yellow-50 via-amber-50 to-white dark:from-amber-950 dark:via-amber-900 dark:to-background"
            : "bg-card")
        }
      >
        <div className="max-w-7xl mx-auto px-3 md:px-4 py-3 md:py-4">
          <div className="flex items-center gap-2 md:gap-3 min-w-0">
            <div
              className={
                "w-10 md:w-12 h-10 md:h-12 rounded-full flex items-center justify-center flex-shrink-0 " +
                (isVip ? "bg-amber-100 border border-amber-300 dark:bg-amber-900 dark:border-amber-700" : "bg-primary/10")
              }
            >
              {isVip ? (
                <Crown className="w-5 md:w-6 h-5 md:h-6 text-amber-500" />
              ) : (
                <Home className="w-5 md:w-6 h-5 md:h-6 text-primary" />
              )}
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-lg md:text-xl font-bold text-primary truncate">لوحة التحكم</h1>
                {isVip && (
                  <Badge className="text-white flex items-center gap-1 px-2 md:px-3 py-0.5 md:py-1 text-xs md:text-sm flex-shrink-0 bg-[#2e2f31]">
                    <Crown className="w-3 h-3" />
                    <span className="hidden md:inline">مميز</span>
                  </Badge>
                )}
              </div>
              <p className="text-xs md:text-sm text-muted-foreground truncate">
                عقار #{property.propertyNumber}
              </p>
            </div>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-3 md:px-4 py-6 md:py-8 space-y-6 md:space-y-8">
        {/* ===== كرت حالة الاشتراك + Progress Bar ===== */}
        <Card className="p-4 md:p-6 !border-primary/15 bg-primary/5">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 md:gap-6">
            <div className="space-y-2 flex-1">
              <h2 className="font-bold text-base md:text-lg text-primary">حالة الاشتراك</h2>
              <div className="flex items-center gap-2 md:gap-3 flex-wrap">
                <Badge
                  variant={isVip ? "default" : "secondary"}
                  className="text-xs md:text-sm px-3 md:px-4 py-1"
                >
                  {property.subscriptionType}
                </Badge>
                {property.subscriptionDate && (
                  <span className="text-xs text-muted-foreground">
                    منذ {(() => {
                      const d = new Date(property.subscriptionDate);
                      return `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${d.getUTCFullYear()}`;
                    })()}
                  </span>
                )}
                {currentSubscription?.linkedProperty && (
                  <Badge variant="outline" className="text-xs px-2 py-0.5 border-blue-400 text-blue-600 bg-blue-50 dark:bg-blue-900/20">
                    <Home className="w-3 h-3 ml-1" />
                    مرتبط: {currentSubscription.linkedProperty}
                  </Badge>
                )}
              </div>

              {remainingDays !== null && (
                <div className="mt-3 space-y-1">
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>التقدم</span>
                    <span>
                      باقي <span className="font-bold text-primary">{remainingDays}</span> يوم
                    </span>
                  </div>
                  <ProgressBar value={progressPercent ?? 0} />
                </div>
              )}
            </div>

            <Button
              className="w-full md:w-auto h-10 md:h-12 text-sm md:text-base font-bold gap-2 bg-primary text-white hover:bg-primary/90 flex-shrink-0"
              onClick={() => setLocation("/owner/subscription")}
              data-testid="button-subscription-manage"
            >
              <CreditCard className="w-4 md:w-5 h-4 md:h-5" />
              <span className="hidden md:inline">{subscriptionButtonLabel}</span>
              <span className="md:hidden">إدارة</span>
            </Button>
          </div>
        </Card>

        {/* ===== قسم الإضافات (عرض دائماً) ===== */}
        <Card className="p-4 md:p-6 border-2 border-violet-200 dark:border-violet-800 bg-gradient-to-r from-violet-50/50 to-purple-50/50 dark:from-violet-950/30 dark:to-purple-950/30">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-violet-600" />
              <h2 className="font-bold text-base md:text-lg text-violet-600">إضافاتك</h2>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="text-violet-600 border-violet-300 hover:bg-violet-100"
              onClick={() => setLocation("/owner/subscription")}
              data-testid="button-go-to-addons"
            >
              <Plus className="w-4 h-4 ml-1" />
              شراء إضافات
            </Button>
          </div>

          {/* عرض الإضافات النشطة فقط */}
          {propertyAddOns.filter(a => a.status === "active").length === 0 ? (
            <div className="text-center py-6">
              <Zap className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
              <p className="text-muted-foreground text-sm">لا توجد إضافات نشطة لعقارك</p>
              <p className="text-xs text-muted-foreground mt-1">
                اذهب لصفحة الاشتراك لشراء إضافات جديدة
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {propertyAddOns.filter(a => a.status === "active").map((addon) => {
                const pkg = addOnPackages.find(p => p.id === addon.addOnPackageId);
                const endDate = addon.endDate ? new Date(addon.endDate) : null;
                const now = new Date();
                const daysLeft = endDate ? Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)) : null;
                
                return (
                  <Card 
                    key={addon.id}
                    className="p-4 relative overflow-hidden border-emerald-300 bg-emerald-50/50 dark:bg-emerald-950/20"
                    data-testid={`addon-active-${addon.id}`}
                  >
                    <div className={`absolute top-0 right-0 left-0 h-1 ${pkg ? getCategoryColor(pkg.category) : 'bg-emerald-500'}`} />
                    
                    <div className="flex items-start justify-between gap-3 mt-1">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 flex-wrap mb-2">
                          <h4 className="font-semibold">{pkg?.name || "إضافة"}</h4>
                          {pkg && (
                            <Badge className={`${getCategoryColor(pkg.category)} text-white text-xs`}>
                              {pkg.category}
                            </Badge>
                          )}
                          <Badge variant="outline" className="text-emerald-600 border-emerald-300 bg-emerald-100 text-xs">
                            <CheckCircle2 className="w-3 h-3 ml-1" />
                            نشط
                          </Badge>
                        </div>
                        
                        {pkg?.description && (
                          <p className="text-xs text-muted-foreground mb-2">{pkg.description}</p>
                        )}
                        
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          <div className="flex items-center gap-1">
                            <Star className="w-3 h-3" />
                            <PriceDisplay amount={pkg?.price || 0} size="sm" />
                          </div>
                          <div className="flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            <span>{pkg?.durationDays === 0 ? "دائم" : `${pkg?.durationDays || 0} يوم`}</span>
                          </div>
                        </div>
                      </div>
                      
                      <div className="text-left shrink-0">
                        {endDate ? (
                          <div className="text-xs">
                            <p className="text-muted-foreground">ينتهي في</p>
                            <p className="font-bold text-foreground">{endDate.toLocaleDateString('en-US')}</p>
                            {daysLeft !== null && daysLeft > 0 && (
                              <p className={`text-xs mt-1 ${daysLeft <= 3 ? 'text-red-500 font-bold' : 'text-emerald-600'}`}>
                                باقي {daysLeft} يوم
                              </p>
                            )}
                          </div>
                        ) : (
                          <Badge className="bg-emerald-500 text-white">دائم</Badge>
                        )}
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}

          {/* عرض الإضافات المعلقة */}
          {propertyAddOns.filter(a => a.status === "pending").length > 0 && (
            <div className="mt-4 pt-4 border-t border-amber-200 dark:border-amber-800">
              <h4 className="font-semibold text-sm mb-3 flex items-center gap-2 text-amber-600">
                <Clock className="w-4 h-4" />
                طلبات معلقة ({propertyAddOns.filter(a => a.status === "pending").length})
              </h4>
              <div className="space-y-3">
                {propertyAddOns.filter(a => a.status === "pending").map((addon) => {
                  const pkg = addOnPackages.find(p => p.id === addon.addOnPackageId);
                  return (
                    <Card 
                      key={addon.id}
                      className="p-4 relative overflow-hidden border-amber-300 bg-amber-50/50 dark:bg-amber-950/20"
                      data-testid={`addon-pending-${addon.id}`}
                    >
                      <div className="absolute top-0 right-0 left-0 h-1 bg-amber-500" />
                      
                      <div className="flex items-start justify-between gap-3 mt-1">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 flex-wrap mb-2">
                            <h4 className="font-semibold">{pkg?.name || "إضافة"}</h4>
                            {pkg && (
                              <Badge className={`${getCategoryColor(pkg.category)} text-white text-xs`}>
                                {pkg.category}
                              </Badge>
                            )}
                            <Badge className="bg-amber-500 text-white text-xs">
                              <Clock className="w-3 h-3 ml-1" />
                              بانتظار الموافقة
                            </Badge>
                          </div>
                          
                          {pkg?.description && (
                            <p className="text-xs text-muted-foreground mb-2">{pkg.description}</p>
                          )}
                          
                          <div className="flex items-center gap-4 text-xs text-muted-foreground">
                            <div className="flex items-center gap-1">
                              <Star className="w-3 h-3" />
                              <PriceDisplay amount={pkg?.price || 0} size="sm" />
                            </div>
                            <div className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              <span>{pkg?.durationDays === 0 ? "دائم" : `${pkg?.durationDays || 0} يوم`}</span>
                            </div>
                          </div>
                          
                          <div className="mt-2 text-xs text-muted-foreground">
                            <span>تاريخ الطلب: </span>
                            <span className="font-medium">
                              {addon.createdAt ? new Date(addon.createdAt).toLocaleDateString('en-US') : "-"}
                            </span>
                          </div>
                        </div>
                        
                        <div className="text-left shrink-0">
                          <div className="text-xs text-center">
                            <p className="text-muted-foreground">بعد التفعيل</p>
                            <p className="font-bold text-amber-600">
                              {pkg?.durationDays === 0 ? "دائم" : `${pkg?.durationDays || 0} يوم`}
                            </p>
                          </div>
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </div>
              <p className="text-xs text-amber-600 mt-3 bg-amber-100 dark:bg-amber-900/30 p-2 rounded-md">
                سيتم تفعيل الإضافات بعد مراجعة الإدارة للإيصال المرفوع
              </p>
            </div>
          )}

          {/* عرض الإضافات المنتهية */}
          {propertyAddOns.filter(a => a.status === "expired").length > 0 && (
            <div className="mt-4 pt-4 border-t border-violet-200 dark:border-violet-800">
              <h4 className="font-semibold text-sm mb-3 flex items-center gap-2 text-muted-foreground">
                <XCircle className="w-4 h-4" />
                إضافات منتهية
              </h4>
              <div className="space-y-2">
                {propertyAddOns.filter(a => a.status === "expired").map((addon) => {
                  const pkg = addOnPackages.find(p => p.id === addon.addOnPackageId);
                  return (
                    <div 
                      key={addon.id}
                      className="flex items-center justify-between p-2 bg-muted/30 rounded-md text-sm border border-muted"
                    >
                      <span className="text-muted-foreground">{pkg?.name || "إضافة"}</span>
                      <span className="text-xs text-muted-foreground">
                        انتهى: {addon.endDate ? new Date(addon.endDate).toLocaleDateString('en-US') : "-"}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </Card>

        {/* ===== شريط التحقق الذكي المتحرك ===== */}
        {property && (
          <Card className="p-4 md:p-6 border-2 border-[#17a2b8] bg-gradient-to-r from-cyan-50/50 to-blue-50/50 dark:from-cyan-900/20 dark:to-blue-900/20">
            <div className="space-y-4">
              {/* العنوان والزر */}
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                <div>
                  <h3 className="font-bold text-lg md:text-xl text-[#17a2b8] flex items-center gap-2">
                    <Activity className="w-6 h-6 animate-pulse" />
                    التحقق الذكي من بيانات العقار
                  </h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    فحص ذكي لجميع بيانات عقارك وتفعيل تلقائي للاشتراك عند النجاح
                  </p>
                </div>
                {!isVerifying && (
                  <Button 
                    onClick={startSmartVerification}
                    className="bg-[#17a2b8] hover:bg-[#138496] text-white flex-shrink-0"
                    data-testid="button-start-verification"
                  >
                    <Activity className="w-4 h-4 ml-2" />
                    بدء التحقق الذكي
                  </Button>
                )}
              </div>

              {/* شريط التقدم والنسبة المئوية */}
              {isVerifying && (
                <div className="space-y-3">
                  {/* النسبة المئوية */}
                  <div className="text-center">
                    <div className="text-4xl font-bold text-[#17a2b8] mb-1">
                      {verificationProgress}%
                    </div>
                    <p className="text-sm text-muted-foreground">جاري التحقق من البيانات...</p>
                  </div>

                  {/* شريط التقدم */}
                  <div className="w-full h-4 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden border-2 border-[#17a2b8]">
                    <div 
                      className="h-full bg-gradient-to-r from-[#17a2b8] to-[#138496] transition-all duration-500 ease-out"
                      style={{ width: `${verificationProgress}%` }}
                    />
                  </div>

                  {/* الخطوات */}
                  <div className="space-y-2 mt-4">
                    {verificationSteps.map((step) => (
                      <div 
                        key={step.step}
                        className={`flex items-center gap-3 p-3 rounded-lg border ${
                          step.status === 'success' ? 'bg-green-50 border-green-200 dark:bg-green-900/20' :
                          step.status === 'error' ? 'bg-red-50 border-red-200 dark:bg-red-900/20' :
                          step.status === 'checking' ? 'bg-blue-50 border-blue-200 dark:bg-blue-900/20' :
                          'bg-gray-50 border-gray-200 dark:bg-gray-800'
                        }`}
                      >
                        {/* الأيقونة */}
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                          step.status === 'success' ? 'bg-green-500' :
                          step.status === 'error' ? 'bg-red-500' :
                          step.status === 'checking' ? 'bg-blue-500' :
                          'bg-gray-300'
                        }`}>
                          {step.status === 'success' ? (
                            <CheckCircle2 className="w-5 h-5 text-white" />
                          ) : step.status === 'error' ? (
                            <XCircle className="w-5 h-5 text-white" />
                          ) : step.status === 'checking' ? (
                            <Loader2 className="w-5 h-5 text-white animate-spin" />
                          ) : (
                            <Clock className="w-5 h-5 text-white" />
                          )}
                        </div>

                        {/* النص */}
                        <div className="flex-1">
                          <div className="font-semibold text-sm">{step.name}</div>
                          {step.message && (
                            <div className="text-xs text-muted-foreground mt-1">{step.message}</div>
                          )}
                        </div>

                        {/* رقم الخطوة */}
                        <div className="text-xs font-bold text-muted-foreground">
                          {step.step}/7
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* نتيجة الفحص الواضحة للعميل */}
              {verificationResult && !isVerifying && (
                <div className={`mt-4 p-4 rounded-lg border-2 ${
                  verificationResult.success 
                    ? 'bg-green-50 border-green-400 dark:bg-green-900/20' 
                    : 'bg-red-50 border-red-400 dark:bg-red-900/20'
                }`}>
                  <div className="flex items-start gap-3">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${
                      verificationResult.success ? 'bg-green-500' : 'bg-red-500'
                    }`}>
                      {verificationResult.success ? (
                        <CheckCircle2 className="w-6 h-6 text-white" />
                      ) : (
                        <XCircle className="w-6 h-6 text-white" />
                      )}
                    </div>
                    <div className="flex-1">
                      <h4 className={`font-bold text-lg ${
                        verificationResult.success ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'
                      }`}>
                        {verificationResult.success ? '✅ نجح الفحص!' : '❌ فشل الفحص'}
                      </h4>
                      <p className={`text-sm mt-1 ${
                        verificationResult.success ? 'text-green-600 dark:text-green-300' : 'text-red-600 dark:text-red-300'
                      }`}>
                        {verificationResult.summary}
                      </p>

                      {/* قائمة الأخطاء */}
                      {verificationResult.errors.length > 0 && (
                        <div className="mt-3 space-y-1">
                          <p className="text-sm font-semibold text-red-700 dark:text-red-400">المشاكل التي تحتاج إصلاح:</p>
                          <ul className="list-disc list-inside text-sm text-red-600 dark:text-red-300 space-y-1">
                            {verificationResult.errors.map((error, idx) => (
                              <li key={idx}>{error}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* زر تعديل البيانات */}
                      {!verificationResult.success && (
                        <Button
                          variant="default"
                          size="sm"
                          className="mt-3 bg-red-600 hover:bg-red-700 text-white gap-2"
                          onClick={() => setLocation("/owner/update-property")}
                        >
                          <Edit3 className="w-4 h-4" />
                          تعديل البيانات
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </div>
          </Card>
        )}

        {/* ===== سجل المدفوعات ===== */}
        <Card className="p-4 md:p-6">
          {/* رأس القسم مع زر التوسيع/الطي */}
          <div className="flex items-center justify-between mb-4">
            <button
              type="button"
              onClick={() => setPaymentsExpanded(!paymentsExpanded)}
              className="flex items-center gap-2 hover:opacity-80 transition"
              data-testid="button-toggle-payments"
            >
              <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                {paymentsExpanded ? (
                  <Minus className="w-4 h-4 text-primary" />
                ) : (
                  <Plus className="w-4 h-4 text-primary" />
                )}
              </div>
              <h2 className="text-lg font-bold text-primary flex items-center gap-2">
                <Receipt className="w-5 h-5" />
                سجل المدفوعات
              </h2>
            </button>
            <Badge variant="outline" className="text-xs">
              {paymentsData?.length || 0} عملية
            </Badge>
          </div>

          {/* أزرار الفلترة */}
          {paymentsExpanded && paymentsData && paymentsData.length > 0 && (
            <div className="flex items-center gap-2 mb-4 flex-wrap">
              <div className="flex items-center gap-1 text-sm text-muted-foreground">
                <Filter className="w-4 h-4" />
                <span>فلترة:</span>
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant={paymentFilter === 'all' ? 'default' : 'outline'}
                  onClick={() => setPaymentFilter('all')}
                  className="text-xs"
                  data-testid="button-filter-all"
                >
                  الكل ({paymentsData.length})
                </Button>
                <Button
                  size="sm"
                  variant={paymentFilter === 'completed' ? 'default' : 'outline'}
                  onClick={() => setPaymentFilter('completed')}
                  className="text-xs"
                  data-testid="button-filter-completed"
                >
                  <CheckCircle2 className="w-3 h-3 ml-1" />
                  مكتمل ({paymentsData.filter((p: any) => p.status === 'مكتمل').length})
                </Button>
                <Button
                  size="sm"
                  variant={paymentFilter === 'pending' ? 'default' : 'outline'}
                  onClick={() => setPaymentFilter('pending')}
                  className="text-xs"
                  data-testid="button-filter-pending"
                >
                  <Clock className="w-3 h-3 ml-1" />
                  معلق ({paymentsData.filter((p: any) => p.status === 'قيد المراجعة' || p.status === 'معلق' || p.status === 'نجح - قيد التحقق').length})
                </Button>
              </div>
            </div>
          )}

          {/* محتوى المدفوعات */}
          {paymentsExpanded && (
            <>
              {paymentsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-primary" />
                  <span className="mr-2 text-muted-foreground">جاري تحميل المدفوعات...</span>
                </div>
              ) : !paymentsData || paymentsData.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Receipt className="w-12 h-12 mx-auto mb-3 opacity-30" />
                  <p>لا توجد مدفوعات حتى الآن</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {paymentsData
                    .filter((payment: any) => {
                      if (paymentFilter === 'all') return true;
                      if (paymentFilter === 'completed') return payment.status === 'مكتمل';
                      if (paymentFilter === 'pending') return payment.status === 'قيد المراجعة' || payment.status === 'معلق' || payment.status === 'نجح - قيد التحقق';
                      return true;
                    })
                    .map((payment: any) => (
                      <PaymentRow 
                        key={payment.id} 
                        payment={payment} 
                        onRetryPayment={(p) => {
                          // إذا كان التحويل بنكي، افتح نافذة رفع الإيصال
                          if (p.paymentMethod === 'تحويل بنكي') {
                            setSelectedPaymentForReceipt(p);
                            setShowReceiptDialog(true);
                          } else {
                            // دفع إلكتروني - إعادة محاولة الدفع
                            retryPaymentMutation.mutate(p.id);
                          }
                        }}
                        isRetrying={retryPaymentMutation.isPending}
                        onVerifyPayment={(p) => verifyPaymentMutation.mutate(p.id)}
                        isVerifying={verifyPaymentMutation.isPending}
                      />
                    ))}

                  {/* رسالة إذا لم توجد نتائج بعد الفلترة */}
                  {paymentsData.filter((payment: any) => {
                    if (paymentFilter === 'all') return true;
                    if (paymentFilter === 'completed') return payment.status === 'مكتمل';
                    if (paymentFilter === 'pending') return payment.status === 'قيد المراجعة' || payment.status === 'معلق' || payment.status === 'نجح - قيد التحقق';
                    return true;
                  }).length === 0 && (
                    <div className="text-center py-6 text-muted-foreground">
                      <Filter className="w-10 h-10 mx-auto mb-2 opacity-30" />
                      <p>لا توجد مدفوعات مطابقة للفلتر المحدد</p>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* رسالة عند الطي */}
          {!paymentsExpanded && (
            <div className="text-center py-4 text-muted-foreground text-sm">
              اضغط على <Plus className="w-4 h-4 inline mx-1" /> لعرض سجل المدفوعات
            </div>
          )}
        </Card>

        {/* ===== معلومات العقار + أداء العقار ===== */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* معلومات العقار */}
          <Card className="p-6">
            <h2 className="text-lg font-bold text-primary mb-4">
              معلومات العقار
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
              <Info title="اسم العقار" value={property.name} />
              <Info title="المدينة" value={property.city} />
              <Info title="الموقع" value={property.location} />
              <Info title="الاتجاه" value={property.direction} />
              <Info title="النوع" value={property.type} />
              <Info title="سعر وسط الأسبوع" value={property.prices?.weekday ? <PriceDisplay amount={property.prices.weekday} size="sm" /> : "غير محدد"} />
              <Info title="سعر نهاية الأسبوع" value={property.prices?.weekend ? <PriceDisplay amount={property.prices.weekend} size="sm" /> : "غير محدد"} />
              <Info title="سعر المبيت" value={property.prices?.overnight ? <PriceDisplay amount={property.prices.overnight} size="sm" /> : "غير محدد"} />
              <Info title="سعر الإجازات" value={property.prices?.holidays ? <PriceDisplay amount={property.prices.holidays} size="sm" /> : "غير محدد"} />
            </div>
          </Card>

{/* ===== أداء العقار ===== */}
<Card className="p-6">
  <div className="flex items-center justify-between mb-4">
    <h2 className="text-lg font-bold text-primary">أداء العقار</h2>
    <Badge variant="outline" className="flex items-center gap-1">
      <Activity className="w-3 h-3" />
      تحليلات ذكية
    </Badge>
  </div>

  <div className="grid grid-cols-2 gap-4">
    {/* معدل التفاعل */}
    <StatCard
      label="معدل التفاعل"
      value={analytics?.engagementRate || "متوسط"}
      icon={<Activity className="w-4 h-4" />}
    />

    {/* فترة الذروة: يوم + ساعة */}
    <StatCard
      label="فترة الذروة"
      value={stats.peakPeriod}
      icon={<BarChart2 className="w-4 h-4" />}
    />

    {/* نسبة النمو */}
    <StatCard
      label="النمو الشهري"
      value={`+${analytics?.previousMonthGrowth || 0}%`}
      icon={<TrendingUpIcon />}
    />

    {/* حالة الظهور */}
    <StatCard
      label="حالة الظهور"
      value={isVip ? "ظهور بارز" : analytics?.visibilityStatus || "ظهور عادي"}
      icon={<Eye className="w-4 h-4" />}
    />
  </div>
</Card>

        </div>

{/* ===== تحليلات وملخص ===== */}
<Card className="p-6">
  <div className="flex items-center justify-between mb-4">
    <h2 className="text-lg font-bold text-primary">تحليلات وملخص</h2>
    <Badge variant="outline" className="text-xs">
      بيانات حقيقية
    </Badge>
  </div>

  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
    <AnalyticsBox
      label="طلبات واتساب هذا الشهر"
      value={String(stats.monthlyRequests)}
      note={`نمو +${stats.previousMonthGrowth}% عن الشهر الماضي`}
    />

    <AnalyticsBox
      label="متوسط الطلبات يومياً"
      value={String(stats.dailyAverage)}
      note="معدل ثابت وجيد"
    />

    <AnalyticsBox
      label="اليوم الأعلى طلباً"
      value={stats.highestDemandDay}
      note="ركز عروضك في أيام الذروة"
    />

    <AnalyticsBox
      label="ترتيبك بين العقارات"
      value={`#${stats.rank || 1}`}
      note={`من أصل ${stats.totalProperties} عقار`}
    />
  </div>
</Card>


        {/* ===== أزرار التحكم (أيقونات كبيرة) ===== */}
        <Card className="p-6">
          <h2 className="text-lg font-bold text-primary mb-4">
            إدارة العقار والإعدادات
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <BigActionButton
              icon={<ImageIcon className="w-6 h-6" />}
              title="إدارة الصور"
              desc="رفع وتحديث صور العقار"
              onClick={() => setLocation("/owner/images")}
            />
            <BigActionButton
              icon={<Edit3 className="w-6 h-6" />}
              title="تحديث بيانات العقار"
              desc="الاسم – المدينة – الوصف"
              onClick={() => setLocation("/owner/update-property")}
            />

            <BigActionButton
              icon={<BarChart2 className="w-6 h-6" />}
              title="الإحصائيات المفصلة"
              desc="رسوم بيانية وفلترة حسب التاريخ"
              onClick={handleComingSoon}
            />
          </div>
        </Card>

        {/* ===== صور العقار ===== */}
        {property.imageUrls && property.imageUrls.length > 0 && (
          <Card className="p-6 mt-2">
            <h2 className="text-lg font-bold text-primary mb-4">
              صور العقار ({property.imageUrls.length})
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {property.imageUrls.map((url, idx) => (
                <img
                  key={idx}
                  src={url}
                  alt={`صورة ${idx + 1}`}
                  className="w-full h-32 object-cover rounded-lg"
                />
              ))}
            </div>
          </Card>
        )}

        {/* ===== Modal إحصائيات الطلبات ===== */}
        {showRequestsStats && (
          <RequestsStatsModal
            requestsData={requestsData}
            requestsLoading={requestsLoading}
            onClose={() => setShowRequestsStats(false)}
          />
        )}

        {/* ===== نافذة رفع الإيصال للتحويل البنكي ===== */}
        <Dialog open={showReceiptDialog} onOpenChange={setShowReceiptDialog}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Upload className="w-5 h-5" />
                رفع إيصال التحويل البنكي
              </DialogTitle>
              <DialogDescription>
                ارفع صورة إيصال التحويل البنكي للدفعة المعلقة وسيتم مراجعته
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              {/* معلومات الدفعة */}
              {selectedPaymentForReceipt && (
                <div className="p-3 bg-muted/20 rounded-lg text-sm space-y-2">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">المبلغ:</span>
                    <span className="font-bold"><PriceDisplay amount={selectedPaymentForReceipt.finalAmount} size="sm" /></span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">الباقة:</span>
                    <span>{getPackageNameArabic(selectedPaymentForReceipt.packageId)}</span>
                  </div>
                  {selectedPaymentForReceipt.receiptUrl && (
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">إيصال سابق:</span>
                      <a 
                        href={selectedPaymentForReceipt.receiptUrl} 
                        target="_blank" 
                        rel="noreferrer"
                        className="text-primary text-xs underline"
                      >
                        عرض الإيصال السابق
                      </a>
                    </div>
                  )}
                </div>
              )}

              {/* رفع الإيصال */}
              <div className="space-y-2">
                <label className="block text-sm font-semibold">صورة الإيصال الجديد</label>
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
                {receiptFile && (
                  <p className="text-xs text-green-600">تم اختيار: {receiptFile.name}</p>
                )}
              </div>

              {/* أزرار الإجراء */}
              <div className="flex gap-2 pt-4">
                <Button
                  onClick={handleReceiptUpload}
                  disabled={!receiptFile || isUploadingReceipt}
                  className="flex-1 gap-2"
                >
                  {isUploadingReceipt ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      جاري الرفع...
                    </>
                  ) : (
                    <>
                      <Upload className="w-4 h-4" />
                      رفع الإيصال
                    </>
                  )}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    setShowReceiptDialog(false);
                    setSelectedPaymentForReceipt(null);
                    setReceiptFile(null);
                  }}
                >
                  إلغاء
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}

// دالة تحويل اسم الباقة للعربي
function getPackageNameArabic(packageId: string): string {
  const packageNames: Record<string, string> = {
    'pkg-monthly': 'اشتراك شهري',
    'pkg-month': 'اشتراك شهر',
    'pkg-special': 'اشتراك خاص شهري',
    'pkg-special-2months': 'اشتراك خاص شهرين',
    'pkg-2months': 'عرض خاص شهرين',
    'pkg-camps': 'باقة المخيمات',
    'pkg-2properties': 'اشتراك شهر لعقارين',
    'pkg-month-2properties': 'اشتراك شهر لعقارين',
    'pkg-free': 'باقة مجانية',
  };
  return packageNames[packageId] || packageId;
}

/* ================== مكوّنات مساعدة ================== */

function Loader({ text }: { text: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center text-center">
      <div>
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="mt-4 text-muted-foreground">{text}</p>
      </div>
    </div>
  );
}

function ErrorView({ setLocation }: { setLocation: (path: string) => void }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md p-8 text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-100 flex items-center justify-center">
          <AlertTriangle className="w-8 h-8 text-red-500" />
        </div>
        <h2 className="text-xl font-bold mb-2">خطأ في تحميل البيانات</h2>
        <p className="text-muted-foreground mb-4">
          تعذر تحميل بيانات العقار، حاول مرة أخرى.
        </p>
        <div className="flex gap-2 justify-center">
          <Button onClick={() => window.location.reload()}>إعادة المحاولة</Button>
          <Button variant="outline" onClick={() => setLocation("/owner/login")}>
            تسجيل الدخول
          </Button>
        </div>
      </Card>
    </div>
  );
}

function Info({ title, value }: { title: string; value: React.ReactNode }) {
  return (
    <div className="p-3 rounded-lg bg-[#e6e4e026]">
      <p className="text-xs text-muted-foreground">{title}</p>
      <div className="font-semibold text-base truncate">{value || "---"}</div>
    </div>
  );
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="w-full h-2 rounded-full bg-muted overflow-hidden">
      <div
        className="h-full rounded-full bg-primary transition-all"
        style={{ width: `${value}%` }}
      />
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="p-3 rounded-lg bg-muted/15 flex items-center gap-3">
      <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center">
        {icon}
      </div>
      <div className="flex-1">
        <p className="text-xs text-muted-foreground">{label}</p>
        <p className="font-semibold text-sm">{value}</p>
      </div>
    </div>
  );
}

function AnalyticsBox({
  label,
  value,
  note,
}: {
  label: string;
  value: string;
  note?: string;
}) {
  return (
    <div className="p-4 rounded-xl bg-muted/15 border border-border/40">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className="text-xl font-bold text-primary mb-1">{value}</p>
      {note && <p className="text-[11px] text-muted-foreground">{note}</p>}
    </div>
  );
}

function PaymentRow({ payment, onRetryPayment, isRetrying, onVerifyPayment, isVerifying }: { payment: any; onRetryPayment?: (payment: any) => void; isRetrying?: boolean; onVerifyPayment?: (payment: any) => void; isVerifying?: boolean }) {
  const [showDetails, setShowDetails] = useState(false);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "مكتمل":
        return <CheckCircle2 className="w-4 h-4 text-green-500" />;
      case "نجح - قيد التحقق":
        return <CheckCircle2 className="w-4 h-4 text-blue-500" />;
      case "قيد المراجعة":
        return <Clock className="w-4 h-4 text-amber-500" />;
      case "معلق":
        return <Clock className="w-4 h-4 text-blue-500" />;
      case "ملغي":
      case "فشل":
        return <XCircle className="w-4 h-4 text-red-500" />;
      default:
        return <Clock className="w-4 h-4 text-muted-foreground" />;
    }
  };

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case "مكتمل":
        return "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400";
      case "نجح - قيد التحقق":
        return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400";
      case "قيد المراجعة":
        return "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400";
      case "معلق":
        return "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400";
      case "ملغي":
      case "فشل":
        return "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400";
      default:
        return "bg-muted text-muted-foreground";
    }
  };

  const getDisplayStatus = (status: string) => {
    if (status === "نجح - قيد التحقق") return "قيد التحقق";
    return status;
  };

  const getStatusReason = (status: string, paymentMethod: string, createdAt?: string) => {
    const isBankTransfer = paymentMethod === "تحويل بنكي";
    
    switch (status) {
      case "معلق":
        return isBankTransfer 
          ? "في انتظار رفع إيصال التحويل" 
          : "لم يكتمل الدفع - اضغط لإكمال الدفع";
      case "فشل":
        return "فشل الدفع - اضغط لإعادة المحاولة";
      case "قيد المراجعة":
        return isBankTransfer 
          ? "بانتظار مراجعة الإدارة للإيصال" 
          : "لم يكتمل الدفع - اضغط لإكمال الدفع";
      case "نجح - قيد التحقق":
        return "تم الدفع بنجاح - أكمل بيانات العقار للتفعيل";
      case "مكتمل":
        return "تم بنجاح ✓";
      default:
        return "";
    }
  };

  // التحقق من إظهار زر إكمال/إعادة الدفع (للدفعات الإلكترونية فقط)
  const shouldShowRetryButton = (payment: any) => {
    const method = getPaymentMethodArabic(payment.paymentMethod);
    const status = getStatusArabic(payment.status);
    
    // استثناء التحويل البنكي - يظهر له زر "رفع إيصال" منفصل
    if (method === "تحويل بنكي") return false;

    // للدفعات الفاشلة الإلكترونية، اظهر الزر دائماً
    if (status === "فشل") return true;

    // للدفعات المعلقة الإلكترونية، اظهر الزر مباشرة
    if (status === "معلق") return true;

    // للدفعات الإلكترونية بحالة "قيد المراجعة" (غير مكتملة)
    if (status === "قيد المراجعة") return true;

    return false;
  };
  
  // التحقق من إظهار زر رفع إيصال للتحويل البنكي
  const shouldShowUploadReceiptButton = (payment: any) => {
    const method = getPaymentMethodArabic(payment.paymentMethod);
    const status = getStatusArabic(payment.status);
    
    // فقط للتحويل البنكي
    if (method !== "تحويل بنكي") return false;
    
    // للحالات: معلق، قيد المراجعة
    return status === "معلق" || status === "قيد المراجعة";
  };

  const formatDate = (dateStr: string) => {
    return formatLiveSaudiTime(dateStr);
  };

  const getPackageNameArabic = (packageId: string) => {
    const packageNames: Record<string, string> = {
      'pkg-monthly': 'اشتراك شهري',
      'pkg-month': 'اشتراك شهر',
      'pkg-special': 'اشتراك خاص شهري',
      'pkg-special-2months': 'اشتراك خاص شهرين',
      'pkg-2months': 'عرض خاص شهرين',
      'pkg-camps': 'باقة المخيمات',
      'pkg-2properties': 'اشتراك شهر لعقارين',
      'pkg-month-2properties': 'اشتراك شهر لعقارين',
      'pkg-free': 'باقة مجانية',
    };
    if (packageNames[packageId]) return packageNames[packageId];
    if (packageId?.startsWith('addon-')) return 'إضافة';
    return 'باقة';
  };
  
  const getPaymentMethodArabic = (method: string) => {
    switch (method) {
      case 'bank_transfer': return 'تحويل بنكي';
      case 'paymob': return 'دفع إلكتروني';
      case 'cards': return 'بطاقة';
      case 'apple_pay': return 'Apple Pay';
      case 'تحويل بنكي': return 'تحويل بنكي';
      case 'دفع إلكتروني': return 'دفع إلكتروني';
      default: return method || 'غير محدد';
    }
  };
  
  const getStatusArabic = (status: string) => {
    switch (status) {
      case 'completed': return 'مكتمل';
      case 'pending': return 'معلق';
      case 'failed': return 'فشل';
      case 'cancelled': return 'ملغي';
      case 'مكتمل': return 'مكتمل';
      case 'معلق': return 'معلق';
      case 'فشل': return 'فشل';
      case 'قيد المراجعة': return 'قيد المراجعة';
      case 'نجح - قيد التحقق': return 'نجح - قيد التحقق';
      default: return status || 'غير محدد';
    }
  };

  const amount = payment.finalAmount || payment.amount || 0;
  const normalizedStatus = getStatusArabic(payment.status);
  const isCompleted = normalizedStatus === "مكتمل";

  return (
    <div 
      className="rounded-lg bg-muted/10 border border-border/40 hover:bg-muted/20 transition overflow-hidden"
      data-testid={`payment-row-${payment.id}`}
    >
      {/* الصف الرئيسي */}
      <div className="flex flex-col md:flex-row md:items-center gap-3 p-4">
        {/* السعر على اليسار */}
        <div className="flex items-center gap-2 md:order-first order-last flex-shrink-0">
          <div className="text-center md:text-right min-w-[80px]">
            <div className="font-bold text-primary text-lg">
              <PriceDisplay amount={amount} size="lg" />
            </div>
            {payment.paymentMethod && (
              <div className="text-xs text-muted-foreground">{getPaymentMethodArabic(payment.paymentMethod)}</div>
            )}
          </div>
        </div>

        {/* معلومات الباقة */}
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center flex-shrink-0">
            <CreditCard className="w-5 h-5 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <Badge className={`text-xs px-2 py-0.5 flex items-center gap-1 ${getStatusBadgeClass(normalizedStatus)}`}>
                {getStatusIcon(normalizedStatus)}
                {getDisplayStatus(normalizedStatus)}
              </Badge>
              <span className="font-semibold text-sm truncate">{getPackageNameArabic(payment.packageId)}</span>
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {formatDate(payment.createdAt)}
            </div>
            {getStatusReason(normalizedStatus, getPaymentMethodArabic(payment.paymentMethod), payment.createdAt) && (
              <div className={`text-xs mt-1 ${
                normalizedStatus === "مكتمل" ? "text-green-600 dark:text-green-400" :
                normalizedStatus === "فشل" ? "text-red-600 dark:text-red-400" :
                normalizedStatus === "نجح - قيد التحقق" ? "text-blue-600 dark:text-blue-400" :
                "text-amber-600 dark:text-amber-400"
              }`}>
                {getStatusReason(normalizedStatus, getPaymentMethodArabic(payment.paymentMethod), payment.createdAt)}
              </div>
            )}
          </div>
        </div>

        {/* زر عرض التفاصيل - فقط للدفعات المكتملة */}
        {isCompleted && (
          <Button
            size="sm"
            variant="ghost"
            className="flex-shrink-0 gap-1"
            onClick={() => setShowDetails(!showDetails)}
            data-testid={`button-toggle-details-${payment.id}`}
          >
            {showDetails ? (
              <ChevronDown className="w-4 h-4 rotate-180" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
            <span className="text-xs">تفاصيل</span>
          </Button>
        )}

        {/* زر تفاصيل - للدفعات الإلكترونية الناجحة قيد التحقق */}
        {normalizedStatus === "نجح - قيد التحقق" && (
          <Button
            size="sm"
            variant="ghost"
            className="flex-shrink-0 gap-1"
            onClick={() => setShowDetails(!showDetails)}
            data-testid={`button-toggle-details-${payment.id}`}
          >
            {showDetails ? (
              <ChevronDown className="w-4 h-4 rotate-180" />
            ) : (
              <ChevronDown className="w-4 h-4" />
            )}
            <span className="text-xs">تفاصيل</span>
          </Button>
        )}

        {/* زر رفع إيصال - للتحويل البنكي */}
        {shouldShowUploadReceiptButton(payment) && onRetryPayment && (
          <Button
            size="sm"
            variant="default"
            className="bg-amber-600 hover:bg-amber-700 text-white gap-1 flex-shrink-0"
            onClick={() => onRetryPayment(payment)}
            disabled={isRetrying}
            data-testid={`button-upload-receipt-${payment.id}`}
          >
            {isRetrying ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Receipt className="w-4 h-4" />
            )}
            {isRetrying ? "جاري الرفع..." : "رفع إيصال"}
          </Button>
        )}

        {/* زر تحقق من الدفع - للدفعات الإلكترونية المعلقة */}
        {normalizedStatus === "معلق" && payment.paymobOrderId && onVerifyPayment && (
          <Button
            size="sm"
            variant="outline"
            className="gap-1 flex-shrink-0 border-green-500 text-green-600 hover:bg-green-50"
            onClick={() => onVerifyPayment(payment)}
            disabled={isVerifying}
            data-testid={`button-verify-payment-${payment.id}`}
          >
            {isVerifying ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <CheckCircle2 className="w-4 h-4" />
            )}
            {isVerifying ? "جاري التحقق..." : "تحقق من الدفع"}
          </Button>
        )}

        {/* زر إكمال/إعادة الدفع - للدفعات الإلكترونية المعلقة أو الفاشلة */}
        {shouldShowRetryButton(payment) && onRetryPayment && (
          <Button
            size="sm"
            variant="default"
            className="bg-primary text-white gap-1 flex-shrink-0"
            onClick={() => onRetryPayment(payment)}
            disabled={isRetrying}
            data-testid={`button-retry-payment-${payment.id}`}
          >
            {isRetrying ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <CreditCard className="w-4 h-4" />
            )}
            {isRetrying ? "جاري التحويل..." : normalizedStatus === "فشل" ? "إعادة الدفع" : (normalizedStatus === "معلق" || normalizedStatus === "قيد المراجعة") ? "إكمال الدفع" : "إعادة الدفع"}
          </Button>
        )}
      </div>

      {/* تفاصيل الدفعة الموسعة - للدفعات الناجحة قيد التحقق */}
      {showDetails && payment.status === "نجح - قيد التحقق" && (
        <div className="border-t border-border/40 bg-blue-50/50 dark:bg-blue-900/10 p-4">
          <div className="bg-blue-100 dark:bg-blue-900/30 p-3 rounded text-sm text-blue-800 dark:text-blue-300 mb-4">
            ✅ تم استلام الدفع بنجاح! يرجى إكمال بيانات العقار وسيتم تفعيل الاشتراك تلقائياً.
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            <div>
              <div className="text-xs text-muted-foreground mb-1">المبلغ المدفوع</div>
              <div className="font-bold text-primary"><PriceDisplay amount={amount} size="sm" /></div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">الباقة</div>
              <div className="font-semibold">{getPackageNameArabic(payment.packageId)}</div>
            </div>
            {payment.pendingSubscriptionType && (
              <div>
                <div className="text-xs text-muted-foreground mb-1">نوع الاشتراك</div>
                <Badge variant={payment.pendingSubscriptionType === 'موثوق' ? 'default' : 'outline'} className="text-xs">
                  {payment.pendingSubscriptionType === 'موثوق' && <Crown className="w-3 h-3 ml-1" />}
                  {payment.pendingSubscriptionType}
                </Badge>
              </div>
            )}
            {payment.pendingStartDate && (
              <div>
                <div className="text-xs text-muted-foreground mb-1">تاريخ البداية المتوقع</div>
                <div className="font-semibold">{payment.pendingStartDate}</div>
              </div>
            )}
            {payment.pendingEndDate && (
              <div>
                <div className="text-xs text-muted-foreground mb-1">تاريخ الانتهاء المتوقع</div>
                <div className="font-semibold">{payment.pendingEndDate}</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* تفاصيل الدفعة الموسعة - للدفعات المكتملة */}
      {showDetails && isCompleted && (
        <div className="border-t border-border/40 bg-muted/5 p-4">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            {/* المبلغ الأصلي */}
            {payment.amount && payment.amount !== amount && (
              <div>
                <div className="text-xs text-muted-foreground mb-1">المبلغ الأصلي</div>
                <div className="font-semibold"><PriceDisplay amount={payment.amount} size="sm" /></div>
              </div>
            )}

            {/* كود الخصم */}
            {payment.discountCode && (
              <div>
                <div className="text-xs text-muted-foreground mb-1">كود الخصم</div>
                <div className="font-semibold text-green-600">{payment.discountCode}</div>
              </div>
            )}

            {/* قيمة الخصم */}
            {payment.discountAmount > 0 && (
              <div>
                <div className="text-xs text-muted-foreground mb-1">قيمة الخصم</div>
                <div className="font-semibold text-green-600">-<PriceDisplay amount={payment.discountAmount} size="sm" /></div>
              </div>
            )}

            {/* المبلغ المدفوع */}
            <div>
              <div className="text-xs text-muted-foreground mb-1">المبلغ المدفوع</div>
              <div className="font-bold text-primary"><PriceDisplay amount={amount} size="sm" /></div>
            </div>

            {/* فترة الاشتراك */}
            {payment.pendingStartDate && (
              <div>
                <div className="text-xs text-muted-foreground mb-1">بداية الاشتراك</div>
                <div className="font-semibold">{payment.pendingStartDate}</div>
              </div>
            )}
            {payment.pendingEndDate && (
              <div>
                <div className="text-xs text-muted-foreground mb-1">نهاية الاشتراك</div>
                <div className="font-semibold">{payment.pendingEndDate}</div>
              </div>
            )}

            {/* نوع الاشتراك */}
            {payment.pendingSubscriptionType && (
              <div>
                <div className="text-xs text-muted-foreground mb-1">نوع الاشتراك</div>
                <Badge variant={payment.pendingSubscriptionType === 'موثوق' ? 'default' : 'outline'} className="text-xs">
                  {payment.pendingSubscriptionType === 'موثوق' && <Crown className="w-3 h-3 ml-1" />}
                  {payment.pendingSubscriptionType}
                </Badge>
              </div>
            )}

            {/* نوع العملية */}
            {payment.action && (
              <div>
                <div className="text-xs text-muted-foreground mb-1">نوع العملية</div>
                <div className="font-semibold">
                  {payment.action === 'activate' ? 'تفعيل جديد' : 
                   payment.action === 'renew' ? 'تجديد' : 
                   payment.action === 'upgrade' ? 'ترقية' : payment.action}
                </div>
              </div>
            )}

            {/* تاريخ الإتمام */}
            {payment.completedAt && (
              <div>
                <div className="text-xs text-muted-foreground mb-1">تاريخ الإتمام</div>
                <div className="font-semibold">{formatDate(payment.completedAt)}</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function BigActionButton({
  icon,
  title,
  desc,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group rounded-xl border border-border bg-card hover:bg-primary/5 transition p-4 flex flex-col gap-2 text-right h-full"
    >
      <div className="flex items-center justify-between">
        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center group-hover:bg-primary/20 transition">
          {icon}
        </div>
      </div>
      <div>
        <div className="font-bold text-sm mb-1">{title}</div>
        <div className="text-[11px] text-muted-foreground leading-relaxed">
          {desc}
        </div>
      </div>
    </button>
  );
}

function RequestsStatsModal({
  requestsData,
  requestsLoading,
  onClose,
}: {
  requestsData: any;
  requestsLoading: boolean;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-2xl max-h-[80vh] overflow-y-auto">
        <div className="sticky top-0 bg-card border-b border-border p-6 flex items-center justify-between">
          <h2 className="text-lg font-bold text-primary flex items-center gap-2">
            <BarChart2 className="w-5 h-5" />
            إحصائيات طلبات واتساب
          </h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
            data-testid="button-close-modal"
          >
            ✕
          </button>
        </div>
        <div className="p-6">
          {requestsLoading ? (
            <div className="text-center py-12 text-muted-foreground">
              جاري التحميل...
            </div>
          ) : requestsData?.requests?.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              لا توجد طلبات حتى الآن
            </div>
          ) : (
            <>
              <div className="mb-6 p-4 bg-primary/5 rounded-lg border border-primary/15">
                <p className="text-sm text-muted-foreground mb-2">إجمالي الطلبات</p>
                <p className="text-2xl font-bold text-primary">{requestsData?.requests?.length || 0}</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-border">
                    <tr className="text-muted-foreground">
                      <th className="text-right p-3">الكود</th>
                      <th className="text-right p-3">التاريخ والوقت</th>
                    </tr>
                  </thead>
                  <tbody>
                    {requestsData?.requests?.map((req: any, idx: number) => (
                      <tr key={idx} className="border-b border-border/50 hover:bg-primary/5">
                        <td className="p-3 font-mono text-primary">{req.requestCode || req.id}</td>
                        <td className="p-3 text-muted-foreground">
                          {formatLiveSaudiTime(req.timestamp)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      </Card>
    </div>
  );
}

function TrendingUpIcon() {
  return (
    <svg
      className="w-4 h-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
      <polyline points="17 6 23 6 23 12" />
    </svg>
  );
}