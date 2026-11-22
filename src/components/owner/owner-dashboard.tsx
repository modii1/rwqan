"use client";
import { useEffect, useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useRouter } from "next/navigation";
import OwnerOccasionsSection from "./owner-occasions-section";
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
  Info as InfoIcon,
  LogOut,
  PauseCircle,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { PriceDisplay } from "@/components/price-display";
import { formatLiveSaudiTime } from "@/lib/dateUtils";
import { runOwnerManualVerification } from "@/lib/owner-verification";
import {
  resolvePaymentReceiptStatus,
  type ReceiptAvailability,
} from "@/lib/payment-receipt-status";
import { classifyReceiptError, classifyReceiptScan } from "@/lib/receipt-scan";
import {
  calculateRemainingDays,
  calculateSubscriptionDuration,
  formatDate,
  getSubscriptionStatusFromRecord,
  getSubscriptionDisplayLabel,
  getSubscriptionStatusText,
  isCancelledSubscription,
} from "@/lib/subscription-utils";
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
import {
  isPremiumSubscriptionType,
} from "@shared/subscriptionType";
import {
  OwnerMobileNavigation,
  OwnerPageHeader,
  OwnerPageMain,
  ownerPanelClass,
} from "./owner-page";
import { OwnerStatCard } from "./owner-ui";

// نظام التصميم الموحد - مستخرج من صفحة تسجيل الدخول
const ownerSoftPanelClass = "rounded-xl border border-[#e5dcc7] bg-white shadow-sm";
const ownerTileClass = "rounded-xl border border-[#f0eadc] bg-[#fffdf8]";

function getPaymentTime(value: any): number {
  if (!value) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  if (typeof value.toMillis === "function") return value.toMillis();
  if (typeof value.seconds === "number") return value.seconds * 1000 + Math.floor((value.nanoseconds || 0) / 1_000_000);
  if (typeof value._seconds === "number") return value._seconds * 1000 + Math.floor((value._nanoseconds || 0) / 1_000_000);
  return 0;
}

function sortPaymentsNewestFirst<T extends { createdAt?: any; completedAt?: any; id?: string }>(payments: T[]): T[] {
  return [...payments].sort((a, b) => {
    const byTime =
      getPaymentTime(b.createdAt || b.completedAt) -
      getPaymentTime(a.createdAt || a.completedAt);
    if (byTime !== 0) return byTime;
    return String(b.id || "").localeCompare(String(a.id || ""));
  });
}

export default function OwnerDashboard() {
  const router = useRouter();
  const { toast } = useToast();
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [showRequestsStats, setShowRequestsStats] = useState(false);
  const [requestsSearch, setRequestsSearch] = useState("");
  const [requestsDateFilter, setRequestsDateFilter] = useState<"all" | "today" | "week" | "month">("all");
  const [paymentFilter, setPaymentFilter] = useState<
    "all" | "completed" | "pending"
  >("all");
  const [paymentsExpanded, setPaymentsExpanded] = useState(false);
  const [highlightPayments, setHighlightPayments] = useState(false);
  const FEATURE_SMART_VERIFICATION = true;

  const NOTIFICATION_KEYS = {
    subscriptionExpiry: "subscription_expiry",
    paymentPendingReceipt: "payment_pending_receipt",
    paymentUnderReview: "payment_under_review",
    paymentRejected: "payment_rejected",
  };

  // Force re-render when notifications are hidden
  const [notificationRefresh, setNotificationRefresh] = useState(0);

  // Check if notification should show
  const shouldShowNotification = (notificationKey: string, isConditionMet: boolean) => {
    if (!isConditionMet) return false;
    const key = `notification_${notificationKey}_hidden`;
    return !localStorage.getItem(key);
  };

  // Hide notification permanently
  const hideNotification = (notificationKey: string) => {
    localStorage.setItem(`notification_${notificationKey}_hidden`, 'true');
    setNotificationRefresh(prev => prev + 1);
    toast({
      title: "تم الإخفاء",
      description: "لن تظهر هذه الإشعارات مرة أخرى",
    });
  };

  // التحقق من نجاح الدفع عند الوصول من Paymob
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const paymentStatus = urlParams.get("payment");
    const addonPaymentStatus = urlParams.get("addon_payment");

    if (paymentStatus === "success") {
      toast({
        title: "تم الدفع بنجاح!",
        description: "تم تفعيل اشتراكك بنجاح. شكراً لك!",
      });
      // إزالة query param من URL
      window.history.replaceState({}, "", "/owner/dashboard");
    }

    if (addonPaymentStatus === "success") {
      toast({
        title: "تم الدفع بنجاح!",
        description:
          "تم استلام طلب الإضافة وهو الآن قيد مراجعة الإدارة. سيتم تفعيله قريباً.",
      });
      // تحديث بيانات الإضافات
      queryClient.invalidateQueries({
        queryKey: ["/api/owner/property-addons"],
      });
      queryClient.invalidateQueries({ queryKey: ["/api/owner/payments"] });
      // إزالة query param من URL
      window.history.replaceState({}, "", "/owner/dashboard");
    }
  }, [toast]);

  // نافذة رفع الإيصال للتحويل البنكي
  const [showReceiptDialog, setShowReceiptDialog] = useState(false);
  const [selectedPaymentForReceipt, setSelectedPaymentForReceipt] =
    useState<any>(null);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [isUploadingReceipt, setIsUploadingReceipt] = useState(false);
  const [receiptUploadFeedback, setReceiptUploadFeedback] = useState<{
    title: string;
    message: string;
    tone: "error" | "review";
  } | null>(null);
  const [selectedReceiptVerified, setSelectedReceiptVerified] = useState<
    boolean | null
  >(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Verify the previously attached receipt before showing it in the dialog.
  useEffect(() => {
    const url = selectedPaymentForReceipt?.receiptUrl;
    if (!showReceiptDialog || !url) {
      setSelectedReceiptVerified(null);
      return;
    }
    let cancelled = false;
    setSelectedReceiptVerified(null);
    fetch(url, { method: "HEAD", credentials: "include", cache: "no-store" })
      .then((response) => {
        if (!cancelled) setSelectedReceiptVerified(response.ok);
      })
      .catch(() => {
        if (!cancelled) setSelectedReceiptVerified(false);
      });
    return () => {
      cancelled = true;
    };
  }, [showReceiptDialog, selectedPaymentForReceipt?.receiptUrl]);

  // نتيجة الفحص النهائية
  const [verificationResult, setVerificationResult] = useState<{
    success: boolean;
    summary: string;
    errors: string[];
  } | null>(null);

  // شريط التحقق الذكي - فحص بيانات العقار
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationProgress, setVerificationProgress] = useState(0);
  const [verificationSteps, setVerificationSteps] = useState<
    {
      step: number;
      name: string;
      status: "pending" | "checking" | "success" | "error";
      message?: string;
    }[]
  >([
    { step: 1, name: "التحقق من رقم العقار", status: "pending" },
    { step: 2, name: "التحقق من رقم الجوال", status: "pending" },
    { step: 3, name: "التحقق من الموقع والاتجاه", status: "pending" },
    { step: 4, name: "التحقق من الصور", status: "pending" },
    { step: 5, name: "التحقق من النوع والمرافق", status: "pending" },
    { step: 6, name: "التحقق من الأسعار", status: "pending" },
    { step: 7, name: "تحديث حالة العقار", status: "pending" },
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
      Number(Object.entries(hourCount).sort(([, a], [, b]) => b - a)[0]?.[0]) ||
      0;

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

  // تحديث isAuthenticated بناءً على بيانات الجلسة
  useEffect(() => {
    if (sessionData && !isSessionLoading) {
      setIsAuthenticated(sessionData.isLoggedIn);
    }
  }, [sessionData, isSessionLoading]);

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
  const { data: analytics, isLoading: analyticsLoading } = useQuery<any>({
    queryKey: ["/api/owner/analytics"],
    enabled: sessionData?.isLoggedIn === true,
    retry: false,
    refetchOnWindowFocus: false,
  });

  // 4) جلب الطلبات
  // 4) جلب الطلبات
  const { data: requestsData, isLoading: requestsLoading } = useQuery<any>({
    queryKey: ["/api/owner/requests"],
    enabled: sessionData?.isLoggedIn === true,
    retry: false,
    refetchOnWindowFocus: false,
  });

  // 5) جلب المدفوعات
  const { data: paymentsData, isLoading: paymentsLoading } = useQuery<any[]>({
    queryKey: ["/api/owner/payments"],
    enabled: sessionData?.isLoggedIn === true,
    retry: false,
    refetchOnWindowFocus: false,
  });

  // 5.0) جلب بيانات الاشتراك الحالي
  const { data: currentSubscription } = useQuery<any>({
    queryKey: ["/api/owner/current-subscription"],
    enabled: sessionData?.isLoggedIn === true,
    retry: false,
    refetchOnWindowFocus: true,
  });
  const subscriptionStatusRecord = {
    status: currentSubscription?.status,
    endDate: currentSubscription?.endDate,
    startDate: currentSubscription?.startDate,
    cancelledAt: currentSubscription?.cancelledAt,
    suspendedAt: currentSubscription?.suspendedAt,
    remainingDurationMs: currentSubscription?.remainingDurationMs,
  };
  const computedSubscriptionStatus = getSubscriptionStatusFromRecord(subscriptionStatusRecord);
  const isSubscriptionSuspended = computedSubscriptionStatus === "suspended";
  const isSubscriptionCancelled = isCancelledSubscription(subscriptionStatusRecord);
  const isSubscriptionExpired = computedSubscriptionStatus === "expired";
  const isFreeSubscription = currentSubscription?.status === "نشط مجاني";

  // 5.0.1) جلب بيانات الاشتراك للعقار المربوط
  const { data: linkedPropertySubscription } = useQuery<any>({
    queryKey: ["linked-property-subscription", currentSubscription?.linkedProperty],
    queryFn: async () => {
      if (!currentSubscription?.linkedProperty) return null;
      const res = await fetch(`/api/owner/subscription/${currentSubscription.linkedProperty}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: sessionData?.isLoggedIn === true && !!currentSubscription?.linkedProperty,
    retry: false,
    refetchOnWindowFocus: false,
  });

  // 5.0.2) جلب العقارات المرتبطة (approvedRequests) من API الطلبات الإضافية
  const { data: additionalPropertyRequests } = useQuery<any>({
    queryKey: ["/api/owner/additional-property-requests"],
    queryFn: async () => {
      const res = await fetch("/api/owner/additional-property-requests", { credentials: "include" });
      if (!res.ok) return { approvedRequests: [] };
      const data = await res.json();
      return data;
    },
    enabled: sessionData?.isLoggedIn === true,
    retry: false,
    refetchOnWindowFocus: false,
  });

  // 5.0.3) جلب باقات الإضافات المتاحة
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
  const [purchasingAddonId, setPurchasingAddonId] = useState<string | null>(
    null,
  );



  // دالة التحقق التدريجي الذكي من بيانات العقار
  const startSmartVerification = async () => {
    if (isSubscriptionSuspended) {
      toast({
        title: "التحقق موقوف مؤقتاً",
        description:
          "أوقفت الإدارة الاشتراك مؤقتاً. لا يمكن تشغيل التحقق حتى تعيد الإدارة تفعيله.",
        variant: "destructive",
      });
      return;
    }

    if (
      isVerifying ||
      property?.verificationStatus === "approved" ||
      property?.verificationStatus === "verified" ||
      (property as any)?.smartVerificationPassed === true
    ) return;

    if (!FEATURE_SMART_VERIFICATION) {
      toast({
        title: "⏸️ التحقق الذكي متوقف مؤقتًا",
        description: "جاري تحسين دقة التحقق، سيتم تفعيله لاحقًا",
      });
      return;
    }

    // ⬇️ كل الكود الحالي يبقى كما هو بدون أي حذف

    if (!property) return;

    setIsVerifying(true);
    setVerificationProgress(0);
    setVerificationResult(null);

    const steps: typeof verificationSteps = verificationSteps.map((step) => ({
      ...step,
      status: "pending" as const,
      message: undefined,
    }));
    setVerificationSteps(steps);
    let hasErrors = false;
    const propData = property as any;

    try {
      // خطوة 1: التحقق من رقم العقار
      steps[0].status = "checking";
      setVerificationSteps([...steps]);
      await new Promise((r) => setTimeout(r, 600));

      if (property?.propertyNumber && property.propertyNumber.length === 5) {
        steps[0].status = "success";
        steps[0].message = `رقم العقار: ${property.propertyNumber}`;
      } else {
        steps[0].status = "error";
        steps[0].message = "رقم العقار غير صحيح (يجب أن يكون 5 أرقام)";
        hasErrors = true;
      }
      setVerificationProgress(14);
      setVerificationSteps([...steps]);
      await new Promise((r) => setTimeout(r, 400));

      // خطوة 2: التحقق من رقم الجوال
      steps[1].status = "checking";
      setVerificationSteps([...steps]);
      await new Promise((r) => setTimeout(r, 600));

      const phoneNumber = propData.whatsappNumber || propData.phone || "";
      if (phoneNumber && phoneNumber.length >= 9) {
        steps[1].status = "success";
        steps[1].message = `رقم الجوال: ${phoneNumber}`;
      } else {
        steps[1].status = "error";
        steps[1].message = phoneNumber
          ? "رقم الجوال غير صحيح"
          : "رقم الجوال مفقود";
        hasErrors = true;
      }
      setVerificationProgress(28);
      setVerificationSteps([...steps]);
      await new Promise((r) => setTimeout(r, 400));

      // خطوة 3: التحقق من الموقع والاتجاه
      steps[2].status = "checking";
      setVerificationSteps([...steps]);
      await new Promise((r) => setTimeout(r, 600));

      const hasLocation = property.location && property.location.trim();
      const hasDirection = propData.direction && propData.direction.trim();
      const hasCity = property.city && property.city.trim();

      if (hasLocation && hasDirection && hasCity) {
        steps[2].status = "success";
        steps[2].message = `${property.city} - ${property.location} (${propData.direction})`;
      } else {
        steps[2].status = "error";
        const missing = [];
        if (!hasCity) missing.push("المدينة");
        if (!hasLocation) missing.push("الموقع");
        if (!hasDirection) missing.push("الاتجاه");
        steps[2].message = `${missing.join(" و ")} مفقود`;
        hasErrors = true;
      }
      setVerificationProgress(42);
      setVerificationSteps([...steps]);
      await new Promise((r) => setTimeout(r, 400));

      // خطوة 4: التحقق من الصور (من R2)
      steps[3].status = "checking";
      setVerificationSteps([...steps]);
      await new Promise((r) => setTimeout(r, 600));

      let imagesCount = 0;
      try {
        const imagesResponse = await fetch("/api/owner/r2-images");
        if (imagesResponse.ok) {
          const imagesData = await imagesResponse.json();
          const imagesArray = imagesData.images || imagesData;
          imagesCount = Array.isArray(imagesArray) ? imagesArray.length : 0;
        }
      } catch (e) {
        console.log("لم يتم جلب الصور من مجلد العقار");
      }

      if (imagesCount >= 3) {
        steps[3].status = "success";
        steps[3].message = `${imagesCount} صورة`;
      } else {
        steps[3].status = "error";
        steps[3].message =
          imagesCount === 0
            ? "لا توجد صور مرفوعة"
            : `${imagesCount} صورة فقط (يجب 3 على الأقل)`;
        hasErrors = true;
      }
      setVerificationProgress(56);
      setVerificationSteps([...steps]);
      await new Promise((r) => setTimeout(r, 400));

      // خطوة 5: التحقق من النوع والمرافق
      steps[4].status = "checking";
      setVerificationSteps([...steps]);
      await new Promise((r) => setTimeout(r, 600));

      const facilitiesData = propData.facilities || [];
      let facilitiesCount = 0;
      if (Array.isArray(facilitiesData)) {
        facilitiesCount = facilitiesData.length;
      } else if (typeof facilitiesData === "string" && facilitiesData.trim()) {
        try {
          const parsed = JSON.parse(facilitiesData);
          facilitiesCount = Array.isArray(parsed) ? parsed.length : 0;
        } catch {
          facilitiesCount = facilitiesData
            .split(",")
            .filter((s: string) => s.trim()).length;
        }
      }

      const hasType = property.type && property.type.trim();
      if (hasType && facilitiesCount >= 3) {
        steps[4].status = "success";
        steps[4].message = `${property.type} - ${facilitiesCount} مرفق`;
      } else {
        steps[4].status = "error";
        if (!hasType) {
          steps[4].message = "النوع مفقود";
        } else {
          steps[4].message = `${facilitiesCount} مرفق فقط (يجب 3 على الأقل)`;
        }
        hasErrors = true;
      }
      setVerificationProgress(70);
      setVerificationSteps([...steps]);
      await new Promise((r) => setTimeout(r, 400));

      // خطوة 6: التحقق من الأسعار
      steps[5].status = "checking";
      setVerificationSteps([...steps]);
      await new Promise((r) => setTimeout(r, 600));

      const pricesObj = propData.prices || {};
      const hasValidPrices =
        (pricesObj.weekday && Number(pricesObj.weekday) > 0) ||
        (pricesObj.weekend && Number(pricesObj.weekend) > 0) ||
        (pricesObj.overnight && Number(pricesObj.overnight) > 0);

      if (hasValidPrices) {
        steps[5].status = "success";
        const prices = [];
        if (pricesObj.weekday) prices.push(`وسط الأسبوع: ${pricesObj.weekday}`);
        if (pricesObj.weekend)
          prices.push(`نهاية الأسبوع: ${pricesObj.weekend}`);
        steps[5].message = prices.join(" | ");
      } else {
        steps[5].status = "error";
        steps[5].message = "لا توجد أسعار محددة";
        hasErrors = true;
      }
      setVerificationProgress(84);
      setVerificationSteps([...steps]);
      await new Promise((r) => setTimeout(r, 400));

      // خطوة 7: تحديث حالة العقار
      steps[6].status = "checking";
      setVerificationSteps([...steps]);
      await new Promise((r) => setTimeout(r, 600));

      // جمع الأخطاء من الخطوات
      const errorsList = steps
        .filter((s) => s.status === "error")
        .map((s) => `${s.name}: ${s.message}`);

      if (!hasErrors) {
        const result = await runOwnerManualVerification();

        if (result.success && result.verified) {
          steps[6].status = "success";
          steps[6].message = result.subscriptionActivated
            ? "تم تفعيل الاشتراك بنجاح"
            : result.pendingAdminApproval
              ? "اكتمل الفحص - بانتظار اعتماد الإدارة"
              : "اكتمل الفحص بنجاح";
          setVerificationProgress(100);
          setVerificationSteps([...steps]);
          setVerificationResult({
            success: true,
            summary: result.message || steps[6].message,
            errors: [],
          });

          if (result.notificationRequired !== false) {
            toast({
              title: result.subscriptionActivated ? "تم التحقق وتفعيل الاشتراك" : "اكتمل الفحص",
              description: result.message || steps[6].message,
            });
          }

          setTimeout(async () => {
            await queryClient.invalidateQueries({
              queryKey: ["/api/owner/property"],
            });
            await queryClient.invalidateQueries({
              queryKey: ["/api/owner/current-subscription"],
            });
            setIsVerifying(false);
          }, 1200);
        } else {
          const serverErrors = Array.isArray(result.missingFields)
            ? result.missingFields.map((field: string) => String(field))
            : [result.message || "تعذر إكمال الفحص"];
          steps[6].status = "error";
          steps[6].message = result.message || "تعذر إكمال الفحص";
          setVerificationProgress(100);
          setVerificationSteps([...steps]);
          setVerificationResult({
            success: false,
            summary: result.message || "بيانات العقار غير مكتملة",
            errors: serverErrors,
          });
          toast({
            title: "البيانات غير مكتملة",
            description: serverErrors.join("، "),
            variant: "destructive",
          });
          setTimeout(() => setIsVerifying(false), 1200);
        }
      } else {
        steps[6].status = "error";
        steps[6].message = "توجد بيانات ناقصة";
        setVerificationProgress(100);
        setVerificationSteps([...steps]);

        setVerificationResult({
          success: false,
          summary: `فشل التحقق - ${errorsList.length} مشكلة تحتاج إصلاح`,
          errors: errorsList,
        });

        toast({
          title: "البيانات غير مكتملة",
          description: "يرجى إصلاح الأخطاء في بيانات العقار وإعادة الفحص",
          variant: "destructive",
        });

        setTimeout(async () => {
          await queryClient.invalidateQueries({
            queryKey: ["/api/owner/property"],
          });
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
        summary: "حدث خطأ أثناء التحقق",
        errors: [error.message || "خطأ غير متوقع"],
      });
      setIsVerifying(false);
    }
  };

  // دالة رفع الإيصال للتحويل البنكي
  const handleReceiptUpload = async () => {
    if (!receiptFile || !selectedPaymentForReceipt) return;

    setIsUploadingReceipt(true);
    setReceiptUploadFeedback(null);

    try {
      const formData = new FormData();
      formData.append("paymentId", selectedPaymentForReceipt.id);
      formData.append("receipt", receiptFile);

      const response = await fetch("/api/owner/payment/upload-receipt", {
        method: "POST",
        body: formData,
        credentials: "include",
      });

      const result = await response.json().catch(() => ({}));

      if (!response.ok) {
        const info = classifyReceiptError({
          message: result?.error,
          code: result?.code,
          status: response.status,
        });
        setReceiptUploadFeedback({
          title: info.title,
          message: info.message,
          tone: "error",
        });
        toast({
          title: info.title,
          description: info.message,
          variant: "destructive",
        });
        await queryClient.invalidateQueries({
          queryKey: ["/api/owner/payments"],
        });
        return;
      }

      await queryClient.invalidateQueries({
        queryKey: ["/api/owner/payments"],
      });

      // Show the real scan result, never a fixed success message.
      const scanView = result?.aiScan
        ? classifyReceiptScan(result.aiScan)
        : null;
      if (
        scanView &&
        (scanView.outcome === "not_receipt" || scanView.outcome === "error")
      ) {
        setReceiptUploadFeedback({
          title: scanView.title,
          message: scanView.message,
          tone: "error",
        });
        toast({
          title: scanView.title,
          description: scanView.message,
          variant: "destructive",
        });
        return;
      }

      const reviewMessage = "تم رفع الإيصال وسيتم مراجعته من الإدارة.";
      setReceiptUploadFeedback({
        title: "تم رفع الإيصال",
        message: reviewMessage,
        tone: "review",
      });
      toast({
        title: "تم رفع الإيصال",
        description: reviewMessage,
      });

      setShowReceiptDialog(false);
      setSelectedPaymentForReceipt(null);
      setReceiptFile(null);
    } catch (error: any) {
      const info = classifyReceiptError(error);
      setReceiptUploadFeedback({
        title: info.title,
        message: info.message,
        tone: "error",
      });
      toast({
        title: info.title,
        description: info.message,
        variant: "destructive",
      });
    } finally {
      setIsUploadingReceipt(false);
    }
  };

  // 6) إعادة محاولة الدفع
  const retryPaymentMutation = useMutation({
    mutationFn: async (paymentId: string) => {
      const response = await apiRequest("POST", "/api/owner/payment/retry", {
        paymentId,
      });
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
      const response = await fetch(
        `/api/payment/verify-status/${encodeURIComponent(paymentId)}`,
      );
      return response.json();
    },
    onSuccess: (data) => {
      if (data.verified) {
        toast({
          title: "تم التحقق بنجاح ✅",
          description: data.message || "تم تأكيد الدفع",
        });
        queryClient.invalidateQueries({ queryKey: ["/api/owner/payments"] });
        queryClient.invalidateQueries({
          queryKey: ["/api/owner/current-subscription"],
        });
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

  // حذف طلب
  const deleteRequestMutation = useMutation({
    mutationFn: async (requestId: string) => {
      const response = await apiRequest("DELETE", `/api/owner/requests/${requestId}`);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/owner/requests"] });
      toast({
        title: "تم الحذف",
        description: "تم حذف الطلب بنجاح",
      });
    },
    onError: (error: any) => {
      toast({
        title: "خطأ",
        description: error.message || "حدث خطأ في الحذف",
        variant: "destructive",
      });
    },
  });

  useEffect(() => {
    if (!isSessionLoading && sessionData) {
      if (!sessionData.isLoggedIn) {
        router.push("/owner/login");
      } else {
        setIsAuthenticated(true);
      }
    }
  }, [sessionData, isSessionLoading, router]);

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

  if (isSessionLoading || !sessionData?.isLoggedIn)
    return <Loader text="جاري التحقق من الجلسة..." />;
  if (isPropertyLoading) return <Loader text="جاري تحميل بيانات العقار..." />;
  if (propertyError || !property)
    return <ErrorView setLocation={(path) => router.push(path)} />;

  // ================== من هنا يبدأ الذكاء البصري للوحة ==================

  // استخدام الأيام المتبقية من شيت الاشتراكات مباشرة (العمود H)
  // إذا لم تكن موجودة، نحسبها محلياً كـ fallback
  const calculateRemainingDaysLocal = () => {
    if (isSubscriptionSuspended) {
      const frozenDuration = Number(currentSubscription?.remainingDurationMs);
      return Number.isFinite(frozenDuration)
        ? Math.max(0, Math.ceil(frozenDuration / (24 * 60 * 60 * 1000)))
        : null;
    }

    // لا نشترط أن يكون النوع «مميز»: الاشتراك قد يكون عاديًا لكنه منتهٍ.
    if (currentSubscription?.endDate) {
      return calculateRemainingDays(
        currentSubscription.endDate,
        currentSubscription.startDate,
      );
    }

    return null;
  };

  // حساب إجمالي أيام الاشتراك - موحد مع subscription-utils
  const calculateTotalDays = () => {
    if (currentSubscription?.startDate && currentSubscription?.endDate) {
      return calculateSubscriptionDuration(
        currentSubscription.startDate,
        currentSubscription.endDate,
      );
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
    !isSubscriptionSuspended &&
    !isSubscriptionExpired &&
    remainingDays !== null &&
    remainingDays >= 0 &&
    remainingDays <= 7;

  const isVip =
    !isSubscriptionSuspended &&
    !isSubscriptionCancelled &&
    isPremiumSubscriptionType(property.subscriptionType) &&
    (computedSubscriptionStatus === "active" ||
      computedSubscriptionStatus === "expiring");

  // زر واحد ذكي للاشتراك (ترقية / إدارة)
  const subscriptionButtonLabel = isSubscriptionSuspended
    ? "عرض الاشتراك"
    : isSubscriptionExpired || isSubscriptionCancelled
      ? "تجديد الاشتراك"
      : isVip
        ? "إدارة الاشتراك"
        : "ترقية الاشتراك";

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
      (a) => a.addOnPackageId === addonId && a.status === "active",
    );
  };

  // لون الفئة
  const getCategoryColor = (category: string) => {
    switch (category) {
      case "اعلان":
        return "bg-[#9a7623]";
      case "ابراز":
        return "bg-[#80621d]";
      case "تثبيت":
        return "bg-[#315f92]";
      case "توثيق":
        return "bg-[#128c47]";
      default:
        return "bg-[#6f685b]";
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
      return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
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

    const highestDemandDay = Object.keys(dayCount).length
      ? Object.entries(dayCount).sort(([, a], [, b]) => b - a)[0][0]
      : "لا يوجد بيانات";

    // متوسط الطلبات يومياً
    const uniqueDays = Object.keys(dayCount).length || 1;
    const dailyAverage = Math.round(monthlyRequests / uniqueDays);

    // 🔥 هنا مكان peakPeriod الصحيح
    const peakPeriod = getPeakPeriod(allRequests);
    const analyticsMonthlyRequests = Number(analytics?.monthlyRequests);
    const analyticsDailyAverage = Number(analytics?.dailyAverage);
    const analyticsGrowth = Number(analytics?.previousMonthGrowth);
    const analyticsTotalProperties = Number(analytics?.totalProperties);
    const analyticsRank = Number(analytics?.rank);

    return {
      monthlyRequests: Number.isSafeInteger(analyticsMonthlyRequests) && analyticsMonthlyRequests >= 0
        ? analyticsMonthlyRequests
        : monthlyRequests,
      dailyAverage: Number.isFinite(analyticsDailyAverage) && analyticsDailyAverage >= 0
        ? analyticsDailyAverage
        : dailyAverage,
      highestDemandDay: typeof analytics?.highestDemandDay === "string" && analytics.highestDemandDay.trim()
        ? analytics.highestDemandDay
        : highestDemandDay,
      previousMonthGrowth: Number.isFinite(analyticsGrowth) ? analyticsGrowth : 0,
      totalProperties: Number.isSafeInteger(analyticsTotalProperties) && analyticsTotalProperties > 0
        ? analyticsTotalProperties
        : 0,
      peakPeriod,
      rank: Number.isSafeInteger(analyticsRank) && analyticsRank > 0 ? analyticsRank : 0,
    };
  };

  const stats = calculateAnalytics();
  const heroImage = property.imageUrls?.[0];
  const activeAddOnsCount = propertyAddOns.filter((addon) => addon.status === "active").length;
  const latestPayment = sortPaymentsNewestFirst(paymentsData || [])[0];
  const hasPendingReceiptPayment = latestPayment?.status === "معلق" || latestPayment?.status === "pending";
  const hasPaymentUnderReview =
    latestPayment?.status === "قيد المراجعة" ||
    latestPayment?.status === "قيد التحقق" ||
    latestPayment?.status === "نجح - قيد التحقق";
  const hasRejectedPayment = latestPayment?.status === "مرفوض";
  const pendingPaymentsCount = paymentsData?.filter((payment: any) =>
    payment.status === "قيد المراجعة" ||
    payment.status === "معلق" ||
    payment.status === "نجح - قيد التحقق" ||
    payment.status === "pending",
  ).length || 0;
  const completedPaymentsCount = paymentsData?.filter((payment: any) => payment.status === "مكتمل").length || 0;
  const linkedPropertiesCount = additionalPropertyRequests?.approvedRequests?.length || 0;
  const imageCount = property.imageUrls?.length || 0;
  const subscriptionStateLabel = getSubscriptionDisplayLabel(computedSubscriptionStatus, isFreeSubscription);
  const subscriptionStatusText = getSubscriptionStatusText(subscriptionStatusRecord);
  const remainingDaysLabel =
    isSubscriptionSuspended && remainingDays !== null
      ? `${remainingDays} يوم محفوظ`
      : isSubscriptionExpired
        ? "منتهي"
        : remainingDays === null
          ? "غير محدد"
          : remainingDays === 0
            ? "اليوم الأخير"
            : `${remainingDays} يوم`;
  const hasCompletedSmartVerification =
    property.verificationStatus === "approved" ||
    property.verificationStatus === "verified" ||
    (property as any).smartVerificationPassed === true;
  const verificationStateLabel =
    property.verificationStatus === "approved"
      ? "معتمد"
      : hasCompletedSmartVerification
        ? "تم الفحص"
      : property.verificationStatus === "rejected"
        ? "مرفوض"
        : "بانتظار التحقق";
  const verificationTone =
    hasCompletedSmartVerification
      ? "border-[#b8dec3] bg-[#f6fff8] text-[#128c47]"
      : property.verificationStatus === "rejected"
        ? "border-[#f1c8c8] bg-[#fff5f5] text-[#b42318]"
        : "border-[#c9d9eb] bg-[#f4f8fc] text-[#315f92]";
  const subscriptionProgressValue = isSubscriptionExpired ? 100 : (progressPercent ?? 0);

  return (
    <div className="min-h-screen bg-[#fafaf7] text-[#293129]">
      {/* ===== تنبيه أعلى الصفحة عند قرب انتهاء الاشتراك ===== */}
      {false && shouldShowNotification(NOTIFICATION_KEYS.subscriptionExpiry, isNearExpiry) && (
        <div className="bg-[#fff5f5] border-b border-[#f1c8c8]">
          <div className="max-w-7xl mx-auto px-3 md:px-4 py-3 flex items-center justify-between gap-2 text-xs md:text-sm">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 md:w-5 h-4 md:h-5 text-[#b42318] flex-shrink-0" />
              <p className="text-[#b42318] font-medium">
                اشتراكك ينتهي بـ{" "}
                <span className="font-bold">{remainingDays}</span> أيام –{" "}
                <span className="md:inline hidden">نوصي بتجديده مبكراً</span>
              </p>
            </div>
            <button
              onClick={() => hideNotification(NOTIFICATION_KEYS.subscriptionExpiry)}
              className="text-[#b42318] p-1"
              title="إخفاء بشكل دائم"
            >
              <XCircle className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* ===== تنبيه دفعة قيد المراجعة (بانتظار رفع الإيصال) ===== */}
      {false && shouldShowNotification(NOTIFICATION_KEYS.paymentPendingReceipt, !!(paymentsData?.some((p: any) => p.status === "معلق" || p.status === "pending"))) && (
        <div className="bg-[#fff9ec] border-b border-[#ead7a8]">
          <div className="max-w-7xl mx-auto px-3 md:px-4 py-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl border border-[#d9cfb8] bg-white flex items-center justify-center flex-shrink-0 shadow-sm">
                <Clock className="w-5 h-5 text-[#9a7623]" />
              </div>
              <div>
                <p className="font-bold text-[#80621d] text-sm md:text-base">
                  لديك دفعة بانتظار رفع إيصال التحويل
                </p>
                <p className="text-xs text-[#80621d]">
                  يرجى رفع إيصال التحويل البنكي لتفعيل الاشتراك
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="rounded-xl border-[#d9cfb8] text-[#80621d] hover:bg-[#fafaf7] bg-white flex-shrink-0"
                onClick={() => {
                  setPaymentFilter("all");
                  setPaymentsExpanded(true);
                  setHighlightPayments(true);
                  setTimeout(() => setHighlightPayments(false), 3000);
                  router.push("/owner/subscription#payments-section");
                }}
              >
                عرض التفاصيل
              </Button>
              <button
                onClick={() => hideNotification(NOTIFICATION_KEYS.paymentPendingReceipt)}
                className="text-[#9a7623] p-1"
                title="إخفاء بشكل دائم"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== تنبيه دفعة قيد التحقق (بعد رفع الإيصال) ===== */}
      {false && shouldShowNotification(NOTIFICATION_KEYS.paymentUnderReview, !!(paymentsData?.some((p: any) => p.status === "قيد التحقق" || p.status === "نجح - قيد التحقق"))) && (
        <div className="bg-[#f4f8fc] border-b border-[#c9d9eb]">
          <div className="max-w-7xl mx-auto px-3 md:px-4 py-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl border border-[#c9d9eb] bg-white flex items-center justify-center flex-shrink-0 shadow-sm">
                <CheckCircle2 className="w-5 h-5 text-[#315f92]" />
              </div>
              <div>
                <p className="font-bold text-[#315f92] text-sm md:text-base">
                  تم استلام إيصالك وهو قيد التحقق
                </p>
                <p className="text-xs text-[#315f92]">
                  سيتم مراجعة الإيصال والتفعيل خلال 24 ساعة
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="rounded-xl border-[#d9cfb8] text-[#80621d] hover:bg-[#fafaf7]"
                onClick={() => {
                  setPaymentFilter("all");
                  setPaymentsExpanded(true);
                  setHighlightPayments(true);
                  setTimeout(() => setHighlightPayments(false), 1000);
                  router.push("/owner/subscription#payments-section");
                }}
              >
                عرض التفاصيل
              </Button>
              <button
                onClick={() => hideNotification(NOTIFICATION_KEYS.paymentUnderReview)}
                className="text-[#315f92] p-1"
                title="إخفاء بشكل دائم"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===== تنبيه دفعة مرفوضة ===== */}
      {false && shouldShowNotification(NOTIFICATION_KEYS.paymentRejected, !!(paymentsData?.some((p: any) => p.status === "مرفوض"))) && (
        <div className="bg-[#fff5f5] border-b border-[#f1c8c8]">
          <div className="max-w-7xl mx-auto px-3 md:px-4 py-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl border border-[#f1c8c8] bg-white flex items-center justify-center flex-shrink-0 shadow-sm">
                <AlertTriangle className="w-5 h-5 text-[#b42318]" />
              </div>
              <div>
                <p className="font-bold text-[#b42318] text-sm md:text-base">
                  تم رفض إيصال التحويل
                </p>
                <p className="text-xs text-[#b42318]">
                  يرجى إعادة التحويل ورفع إيصال صحيح
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="rounded-xl border-[#d9cfb8] text-[#80621d] hover:bg-[#fafaf7]"
                onClick={() => {
                  setPaymentFilter("all");
                  setPaymentsExpanded(true);
                  setHighlightPayments(true);
                  setTimeout(() => setHighlightPayments(false), 1000);
                  router.push("/owner/subscription#payments-section");
                }}
              >
                عرض التفاصيل
              </Button>
              <button
                onClick={() => hideNotification(NOTIFICATION_KEYS.paymentRejected)}
                className="text-[#b42318] p-1"
                title="إخفاء بشكل دائم"
              >
                <XCircle className="w-5 h-5" />
              </button>
            </div>
          </div>
        </div>
      )}

      <OwnerPageHeader
        title="لوحة التحكم"
        eyebrow="مالك العقار"
        description={`${property.name || `عقار رقم ${property.propertyNumber}`} · #${property.propertyNumber}`}
        accessory={isVip ? (
          <Badge className="gap-1 rounded-full border border-[#d9c37b] bg-[#f6ecc9] text-[#5f4817]">
            <Crown className="h-3 w-3" />
            مميز
          </Badge>
        ) : isSubscriptionCancelled ? (
          <Badge className="gap-1 rounded-full bg-[#b42318] text-white">
            <XCircle className="h-3 w-3" />
            ملغى
          </Badge>
        ) : isSubscriptionSuspended ? (
          <Badge className="gap-1 rounded-full bg-[#5b6b61] text-white">
            <PauseCircle className="h-3 w-3" />
            موقوف
          </Badge>
        ) : undefined}
        actions={(
          <Button
            variant="ghost"
            size="icon"
            onClick={handleLogout}
            title="تسجيل الخروج"
            aria-label="تسجيل الخروج"
            className="h-12 w-12 rounded-xl text-[#687064]"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        )}
      />

      <OwnerPageMain className="space-y-4 pb-28 sm:space-y-5 lg:space-y-6">
        {/* ===== هوية المالك والعقار + الاشتراك ===== */}
        <section className="overflow-hidden rounded-2xl border border-[#29372f] bg-[#29372f] text-[#fffdf8] shadow-[0_18px_45px_rgba(41,55,47,0.16)]">
          <div className="relative">
            <div className="pointer-events-none absolute -left-20 -top-28 h-72 w-72 rounded-full border border-[#ccb46f]/25" aria-hidden="true" />
            <div className="pointer-events-none absolute -left-6 -top-10 h-56 w-56 rounded-full border border-[#ccb46f]/15" aria-hidden="true" />
            <div className="relative grid gap-5 p-5 sm:p-6 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-6">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-[#d8bf76]/35 bg-[#d8bf76]/12 px-3 py-1 text-[11px] font-bold text-[#f0ddaa]">
                    <Crown className="h-3.5 w-3.5" />
                    مالك العقار
                  </span>
                  <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-bold text-white">
                    {subscriptionStateLabel}
                  </span>
                  <span className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] font-semibold text-[#d9e0da]">
                    {verificationStateLabel}
                  </span>
                  {currentSubscription?.linkedProperty && (
                    <span className="rounded-full border border-[#d8bf76]/30 bg-[#d8bf76]/10 px-3 py-1 text-[11px] font-semibold text-[#f0ddaa]">
                      مرتبط: {currentSubscription.linkedProperty}
                    </span>
                  )}
                </div>

                <p className="mt-5 text-xs font-bold text-[#d8bf76]">
                  عقار رقم {property.propertyNumber}
                </p>
                <h2 className="mt-1 truncate text-2xl font-bold leading-snug sm:text-3xl">
                  {property.name || `عقار رقم ${property.propertyNumber}`}
                </h2>
                <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-[#cfd6d0]">
                  <span>{property.city || "المدينة غير محددة"}</span>
                  {property.location && <span className="text-[#8f9a92]">·</span>}
                  {property.location && <span>{property.location}</span>}
                  {property.direction && <span className="text-[#8f9a92]">·</span>}
                  {property.direction && <span>اتجاه {property.direction}</span>}
                </p>
                {property.whatsappNumber && (
                  <p className="mt-2 text-xs text-[#aab4ac]">
                    جوال المالك: <span dir="ltr">{property.whatsappNumber}</span>
                  </p>
                )}

                <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <DashboardHeroMetric label="طلبات الشهر" value={String(stats.monthlyRequests)} />
                  <DashboardHeroMetric label="الصور" value={`${imageCount}/15`} />
                  <DashboardHeroMetric label="العقارات المرتبطة" value={String(linkedPropertiesCount)} />
                  <DashboardHeroMetric label="الإضافات النشطة" value={String(activeAddOnsCount)} />
                </div>
              </div>

              <div className="rounded-xl border border-white/12 bg-white/[0.07] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-bold text-[#d8bf76]">حالة الاشتراك</p>
                    <p className="mt-1 text-3xl font-bold text-white">{remainingDaysLabel}</p>
                  </div>
                  <span className="rounded-lg border border-white/15 bg-white/10 px-2.5 py-1 text-[11px] font-bold text-[#f0ddaa]">
                    {subscriptionStatusText.text}
                  </span>
                </div>

                <dl className="mt-4 space-y-2 text-xs">
                  <div className="flex items-center justify-between gap-3 text-[#cfd6d0]">
                    <dt>تاريخ البداية</dt>
                    <dd className="font-semibold text-white" dir="ltr">
                      {currentSubscription?.startDate ? formatDate(currentSubscription.startDate, false) : "غير محدد"}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between gap-3 text-[#cfd6d0]">
                    <dt>تاريخ الانتهاء</dt>
                    <dd className="font-semibold text-white" dir="ltr">
                      {currentSubscription?.endDate ? formatDate(currentSubscription.endDate, false) : "غير محدد"}
                    </dd>
                  </div>
                </dl>

                <div className="mt-4">
                  <div className="flex items-center justify-between text-[11px] text-[#aab4ac]">
                    <span>تقدم الاشتراك</span>
                    <span>{Math.round(subscriptionProgressValue)}%</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/12">
                    <div
                      className="h-full rounded-full bg-[#d8bf76] transition-all"
                      style={{ width: `${Math.max(0, Math.min(100, subscriptionProgressValue))}%` }}
                    />
                  </div>
                </div>

                <Button
                  className="mt-4 h-11 w-full rounded-xl bg-[#d8bf76] text-sm font-bold text-[#29372f] transition-colors hover:bg-[#cbb05f]"
                  onClick={() => router.push("/owner/subscription")}
                  data-testid="button-subscription-manage"
                >
                  <CreditCard className="ml-2 h-4 w-4" />
                  {subscriptionButtonLabel}
                </Button>
              </div>
            </div>

            <div className="relative grid gap-2 border-t border-white/10 p-3 sm:grid-cols-3 sm:p-4">
              <button
                type="button"
                onClick={() => router.push("/owner/update-property")}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-white text-sm font-bold text-[#29372f] transition-colors hover:bg-[#f6f1e4]"
              >
                <Edit3 className="h-4 w-4" />
                تحديث بيانات العقار
              </button>
              <button
                type="button"
                onClick={() => router.push("/owner/images")}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/10 text-sm font-bold text-white transition-colors hover:bg-white/15"
              >
                <ImageIcon className="h-4 w-4" />
                إدارة الصور ({imageCount}/15)
              </button>
              <button
                type="button"
                onClick={() => router.push(`/property/${property.propertyNumber}`)}
                className="inline-flex h-11 items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/10 text-sm font-bold text-white transition-colors hover:bg-white/15"
              >
                <Eye className="h-4 w-4" />
                مشاهدة صفحة العقار
              </button>
            </div>
          </div>
        </section>

        <section className="space-y-2.5">
          {isSubscriptionSuspended && (
            <WorkflowNotice
              tone="blue"
              icon={<PauseCircle className="h-5 w-5" />}
              label="موقوف مؤقتاً"
              title="مدة الاشتراك محفوظة"
              description={`لن تُحتسب أيام التوقف. المتبقي المحفوظ: ${remainingDaysLabel}. يمكن للمسؤول استئناف الاشتراك من لوحة الإدارة.`}
              actionLabel="عرض الاشتراك"
              onAction={() => router.push("/owner/subscription")}
            />
          )}
          {hasPaymentUnderReview && (
            <WorkflowNotice
              tone="blue"
              icon={<Loader2 className="h-5 w-5 animate-spin" />}
              label="قيد التحقق الآن"
              title="المراجعة تعمل على إيصال التحويل"
              description="تم استلام الإيصال، وسيتم تحديث حالة الدفع والاشتراك بعد انتهاء التحقق."
              actionLabel="عرض سجل المدفوعات"
              onAction={() => router.push("/owner/subscription#payments-section")}
            />
          )}
          {hasPendingReceiptPayment && (
            <WorkflowNotice
              tone="amber"
              icon={<Clock className="h-5 w-5" />}
              label="بانتظارك"
              title="يوجد دفع بانتظار رفع إيصال التحويل"
              description="ارفع إيصال التحويل الصحيح حتى يبدأ التحقق وتظهر حالة المراجعة بوضوح."
              actionLabel="رفع الإيصال"
              onAction={() => router.push("/owner/subscription#payments-section")}
            />
          )}
          {hasRejectedPayment && (
            <WorkflowNotice
              tone="red"
              icon={<AlertTriangle className="h-5 w-5" />}
              label="مطلوب إجراء"
              title="تم رفض إيصال تحويل سابق"
              description="راجع السبب في سجل المدفوعات ثم ارفع إيصالاً صحيحاً أو أعد محاولة الدفع."
              actionLabel="معالجة الدفع"
              onAction={() => router.push("/owner/subscription#payments-section")}
            />
          )}
          {!isSubscriptionSuspended && !hasPaymentUnderReview && !hasPendingReceiptPayment && !hasRejectedPayment && property.verificationStatus === "approved" && (
            <WorkflowNotice
              tone="green"
              icon={<CheckCircle2 className="h-5 w-5" />}
              label="لا توجد إجراءات معلقة"
              title="كل شيء واضح حالياً"
              description="الاشتراك وبيانات العقار لا تحتاج إجراءً فورياً من المالك."
              actionLabel="إدارة الاشتراك"
              onAction={() => router.push("/owner/subscription")}
            />
          )}
        </section>

        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <DashboardKpiCard
            icon={<MessageCircle className="h-5 w-5" />}
            label="طلبات العملاء"
            value={String(requestsData?.summary?.total || 0)}
            note={`${requestsData?.summary?.awaitingResponse || 0} بانتظار الرد`}
            onClick={() => router.push("/owner/requests")}
            testId="kpi-requests"
          />
          <DashboardKpiCard
            icon={<CheckCircle2 className="h-5 w-5" />}
            label="حجوزات مؤكدة"
            value={String(requestsData?.summary?.confirmed || 0)}
            note={
              (requestsData?.summary?.commissionAttention || 0) > 0
                ? `${requestsData.summary.commissionAttention} عمولة للمتابعة`
                : "لا توجد عمولات معلقة"
            }
            tone={(requestsData?.summary?.commissionAttention || 0) > 0 ? "gold" : "green"}
            onClick={() => router.push("/owner/requests")}
            testId="kpi-confirmed"
          />
          <DashboardKpiCard
            icon={<Receipt className="h-5 w-5" />}
            label="المدفوعات المكتملة"
            value={String(completedPaymentsCount)}
            note={`${pendingPaymentsCount} عملية معلقة`}
            tone="blue"
            onClick={() => router.push("/owner/subscription#payments-section")}
            testId="kpi-payments"
          />
          <DashboardKpiCard
            icon={<Zap className="h-5 w-5" />}
            label="الإضافات النشطة"
            value={String(activeAddOnsCount)}
            note={`من ${addOnPackages.length} إضافة متاحة`}
            onClick={() => router.push("/owner/subscription#addons-section")}
            testId="kpi-addons"
          />
        </section>

        <section className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,0.6fr)]">
          <Card className={`${ownerPanelClass} overflow-hidden`}>
            <div className="flex flex-col gap-3 border-b border-[#f0eadc] p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
              <div className="flex min-w-0 items-center gap-3">
                <span className="inline-flex h-11 w-11 flex-none items-center justify-center rounded-xl border border-[#efe7d6] bg-[#faf7ef] text-[#80621d]">
                  <MessageCircle className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <h2 className="font-bold text-[#293129]">طلبات العملاء</h2>
                  <p className="mt-0.5 text-xs text-[#6f685b]">متابعة التواصل ونتيجة الحجز والعمولة</p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  className="h-10 rounded-xl border-[#d9cfb8] bg-white text-[#80621d] hover:bg-[#fafaf7]"
                  onClick={() => setShowRequestsStats(true)}
                  data-testid="button-requests-stats"
                >
                  <BarChart2 className="ml-2 h-4 w-4" />
                  إحصائيات مفصلة
                </Button>
                <Button
                  variant="outline"
                  className="h-10 rounded-xl border-[#d9cfb8] bg-white text-[#80621d] hover:bg-[#fafaf7]"
                  onClick={() => router.push("/owner/requests")}
                >
                  عرض كل الطلبات
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-2 divide-x divide-x-reverse divide-y divide-[#f0eadc] sm:grid-cols-4 sm:divide-y-0">
              <OwnerRequestMetric label="كل الطلبات" value={requestsData?.summary?.total || 0} />
              <OwnerRequestMetric label="بانتظار الرد" value={requestsData?.summary?.awaitingResponse || 0} />
              <OwnerRequestMetric label="حجوزات مؤكدة" value={requestsData?.summary?.confirmed || 0} />
              <OwnerRequestMetric label="عمولات للمتابعة" value={requestsData?.summary?.commissionAttention || 0} attention={(requestsData?.summary?.commissionAttention || 0) > 0} />
            </div>
          </Card>

          <Card className={`${ownerPanelClass} p-4 sm:p-5`}>
            <div className="flex items-center gap-3">
              <span className="inline-flex h-11 w-11 flex-none items-center justify-center rounded-xl border border-[#efe7d6] bg-[#faf7ef] text-[#80621d]">
                <BarChart2 className="h-5 w-5" />
              </span>
              <div>
                <h2 className="font-bold text-[#293129]">ملخص الطلبات</h2>
                <p className="mt-0.5 text-xs text-[#6f685b]">بيانات هذا العقار فقط</p>
              </div>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <div>
                <dt className="text-xs text-[#6f685b]">هذا الشهر</dt>
                <dd className="mt-1 font-bold text-[#293129]">{stats.monthlyRequests}</dd>
              </div>
              <div>
                <dt className="text-xs text-[#6f685b]">المتوسط اليومي</dt>
                <dd className="mt-1 font-bold text-[#293129]">{stats.dailyAverage}</dd>
              </div>
              <div>
                <dt className="text-xs text-[#6f685b]">اليوم الأعلى</dt>
                <dd className="mt-1 font-bold text-[#293129]">{stats.highestDemandDay}</dd>
              </div>
              <div>
                <dt className="text-xs text-[#6f685b]">فترة الذروة</dt>
                <dd className="mt-1 font-bold text-[#293129]">{stats.peakPeriod}</dd>
              </div>
            </dl>
          </Card>
        </section>





        {/* ===== عروض المناسبات (العيد) ===== */}
        <OwnerOccasionsSection />

        {/* ===== شريط التحقق الذكي المتحرك ===== */}
        {property && (
          <Card className={`${ownerPanelClass} p-4 sm:p-5`}>
            <div className="space-y-4">
              {/* العنوان والزر */}
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                    <h3 className={`flex items-center gap-2 text-base font-bold sm:text-lg ${hasCompletedSmartVerification ? "text-[#128c47]" : "text-[#293129]"}`}>
                    {isSubscriptionSuspended ? (
                      <>
                        <PauseCircle className="w-6 h-6" />
                        التحقق موقوف مؤقتاً
                      </>
                    ) : hasCompletedSmartVerification ? (
                      <>
                        <CheckCircle2 className="w-6 h-6" />
                        {property.verificationStatus === "approved" ? "العقار معتمد" : "اكتمل الفحص"}
                      </>
                    ) : (
                      <>
                        <Activity className="w-6 h-6 animate-pulse" />
                        التحقق الذكي من بيانات العقار
                      </>
                    )}
                  </h3>
                  <p className="text-sm text-[#6f685b] mt-1">
                    {isSubscriptionSuspended
                      ? "أوقفت الإدارة الاشتراك مؤقتاً، ولا يمكن تشغيل التحقق حتى تعيد تفعيله"
                      : property.verificationStatus === "approved"
                      ? "تم اعتماد بيانات عقارك"
                      : hasCompletedSmartVerification
                        ? "تم الفحص مرة واحدة والطلب بانتظار اعتماد الإدارة"
                      : "فحص ذكي لجميع بيانات عقارك - يحتاج موافقة الإدارة"
                    }
                  </p>
                  {property.verificationStatus === "rejected" && (
                    <p className="text-xs text-[#b42318] mt-1 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      العقار مرفوض - يرجى تصحيح البيانات وإعادة التحقق
                    </p>
                  )}
                </div>
                {!isSubscriptionSuspended && !isVerifying && !hasCompletedSmartVerification && (
                  <Button
                    type="button"
                    onClick={startSmartVerification}
                    className="h-11 flex-shrink-0 rounded-xl bg-[#29372f] px-5 font-bold text-white transition-colors hover:bg-[#1f2b25]"
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
                        <div className="text-3xl font-bold text-[#80621d] mb-1">
                          {verificationProgress}%
                        </div>
                        <p className="text-sm text-[#6f685b]">
                          جاري التحقق من البيانات...
                        </p>
                      </div>

                      {/* شريط التقدم */}
                      <div className="w-full h-2 bg-[#f5f1e7] rounded-full overflow-hidden border border-[#efe7d6]">
                        <div
                          className="h-full bg-[#9a7623] transition-all duration-500 ease-out"
                          style={{ width: `${verificationProgress}%` }}
                        />
                      </div>

                      {/* الخطوات */}
                      <div className="space-y-2 mt-4">
                        {verificationSteps.map((step) => (
                          <div
                            key={step.step}
                            className={`flex items-center gap-3 p-3 rounded-xl border ${step.status === "success"
                              ? "bg-[#f6fbf7] border-[#cfe5d6]"
                              : step.status === "error"
                                ? "bg-[#fff5f5] border-[#f1c8c8]"
                                : step.status === "checking"
                                  ? "bg-[#fdf8ec] border-[#e8d9b4]"
                                  : "bg-[#fffdf8] border-[#f0eadc]"
                              }`}
                          >
                            {/* الأيقونة */}
                            <div
                              className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${step.status === "success"
                                ? "bg-[#128c47]"
                                : step.status === "error"
                                  ? "bg-[#b42318]"
                                  : step.status === "checking"
                                    ? "bg-[#9a7623]"
                                    : "bg-[#c9c0ad]"
                                }`}
                            >
                              {step.status === "success" ? (
                                <CheckCircle2 className="w-5 h-5 text-white" />
                              ) : step.status === "error" ? (
                                <XCircle className="w-5 h-5 text-white" />
                              ) : step.status === "checking" ? (
                                <Loader2 className="w-5 h-5 text-white animate-spin" />
                              ) : (
                                <Clock className="w-5 h-5 text-white" />
                              )}
                            </div>

                            {/* النص */}
                            <div className="flex-1">
                              <div className="font-semibold text-sm">
                                {step.name}
                              </div>
                              {step.message && (
                                <div className="text-xs text-[#6f685b] mt-1">
                                  {step.message}
                                </div>
                              )}
                            </div>

                            {/* رقم الخطوة */}
                            <div className="text-xs font-bold text-[#6f685b]">
                              {step.step}/7
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* نتيجة الفحص الواضحة للعميل */}
                  {verificationResult && !isVerifying && !verificationResult.success && (
                    <div
                      className={`mt-4 p-4 rounded-xl border ${verificationResult.success
                        ? "bg-[#f6fbf7] border-[#cfe5d6]"
                        : "bg-[#fff5f5] border-[#f1c8c8]"
                        }`}
                    >
                      <div className="flex items-start gap-3">
                        <div
                          className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${verificationResult.success
                            ? "bg-[#128c47]"
                            : "bg-[#b42318]"
                            }`}
                        >
                          {verificationResult.success ? (
                            <CheckCircle2 className="w-6 h-6 text-white" />
                          ) : (
                            <XCircle className="w-6 h-6 text-white" />
                          )}
                        </div>
                        <div className="flex-1">
                          <h4
                            className={`font-bold text-lg ${verificationResult.success
                              ? "text-[#126b38]"
                              : "text-[#b42318]"
                              }`}
                          >
                            {verificationResult.success
                              ? "✅ نجح الفحص!"
                              : "❌ فشل الفحص"}
                          </h4>
                          <p
                            className={`text-sm mt-1 ${verificationResult.success
                              ? "text-[#126b38]"
                              : "text-[#b42318]"
                              }`}
                          >
                            {verificationResult.summary}
                          </p>

                          {/* قائمة الأخطاء */}
                          {verificationResult.errors.length > 0 && (
                            <div className="mt-3 space-y-1">
                              <p className="text-sm font-semibold text-[#b42318]">
                                المشاكل التي تحتاج إصلاح:
                              </p>
                              <ul className="list-disc list-inside text-sm text-[#b42318] space-y-1">
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
                              className="mt-3 bg-[#b42318] text-white gap-2"
                              onClick={() =>
                                router.push("/owner/update-property")
                              }
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


        {/* ===== معلومات العقار ===== */}
        <section className="space-y-4">
          <Card className={`${ownerPanelClass} p-4 sm:p-5`}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-11 w-11 flex-none items-center justify-center rounded-xl border border-[#efe7d6] bg-[#faf7ef] text-[#80621d]">
                  <Home className="h-5 w-5" />
                </span>
                <div>
                  <h2 className="font-bold text-[#293129]">معلومات العقار</h2>
                  <p className="mt-0.5 text-xs text-[#6f685b]">البيانات التي تظهر في صفحة العقار</p>
                </div>
              </div>
              <Button
                variant="outline"
                className="h-10 rounded-xl border-[#d9cfb8] bg-white text-[#80621d] hover:bg-[#fafaf7]"
                onClick={() => router.push("/owner/update-property")}
              >
                <Edit3 className="ml-2 h-4 w-4" />
                تحديث البيانات
              </Button>
            </div>
            <dl className="grid grid-cols-2 gap-2.5 text-sm sm:grid-cols-3">
              <Info title="اسم العقار" value={property.name} />
              <Info title="المدينة" value={property.city} />
              <Info title="الموقع" value={property.location} />
              <Info title="الاتجاه" value={property.direction} />
              <Info title="النوع" value={property.type} />
              <Info
                title="سعر وسط الأسبوع"
                value={
                  property.prices?.weekday ? (
                    <PriceDisplay amount={property.prices.weekday} size="sm" />
                  ) : (
                    "غير محدد"
                  )
                }
              />
              <Info
                title="سعر نهاية الأسبوع"
                value={
                  property.prices?.weekend ? (
                    <PriceDisplay amount={property.prices.weekend} size="sm" />
                  ) : (
                    "غير محدد"
                  )
                }
              />
              <Info
                title="سعر المبيت"
                value={
                  property.prices?.overnight ? (
                    <PriceDisplay
                      amount={property.prices.overnight}
                      size="sm"
                    />
                  ) : (
                    "غير محدد"
                  )
                }
              />
              <Info
                title="سعر الإجازات"
                value={
                  property.prices?.holidays ? (
                    <PriceDisplay amount={property.prices.holidays} size="sm" />
                  ) : (
                    "غير محدد"
                  )
                }
              />
            </dl>
          </Card>

        </section>

        {/* ===== أداء العقار + تحليلات وملخص ===== */}
        <section className="grid gap-4 lg:grid-cols-2">
          <Card className={`${ownerPanelClass} p-4 sm:p-5`}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-11 w-11 flex-none items-center justify-center rounded-xl border border-[#efe7d6] bg-[#faf7ef] text-[#80621d]">
                  <Activity className="h-5 w-5" />
                </span>
                <h2 className="font-bold text-[#293129]">أداء العقار</h2>
              </div>
              <Badge variant="outline" className="flex items-center gap-1 rounded-lg border-[#d9cfb8] bg-[#fffdf8] text-[#80621d]">
                <Activity className="h-3 w-3" />
                تحليلات ذكية
              </Badge>
            </div>

            <div className="grid gap-2.5 sm:grid-cols-3">
              {/* معدل التفاعل */}

              {/* فترة الذروة: يوم + ساعة */}
              <StatCard
                label="فترة الذروة"
                value={stats.peakPeriod}
                icon={<BarChart2 className="w-4 h-4" />}
              />

              {/* نسبة النمو */}
              <StatCard
                label="النمو الشهري"
                value={stats.previousMonthGrowth >= 0
                  ? `+${stats.previousMonthGrowth}%`
                  : `${stats.previousMonthGrowth}%`}
                icon={<TrendingUpIcon />}
              />

              {/* حالة الظهور */}
              <StatCard
                label="حالة الظهور"
                value={
                  isVip
                    ? "ظهور بارز"
                    : "ظهور عادي"
                }
                icon={<Eye className="w-4 h-4" />}
              />
            </div>
          </Card>

          <Card className={`${ownerPanelClass} p-4 sm:p-5`}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-11 w-11 flex-none items-center justify-center rounded-xl border border-[#efe7d6] bg-[#faf7ef] text-[#80621d]">
                  <BarChart2 className="h-5 w-5" />
                </span>
                <h2 className="font-bold text-[#293129]">تحليلات وملخص</h2>
              </div>
              <Badge variant="outline" className="rounded-lg border-[#d9cfb8] bg-[#fffdf8] text-[11px] text-[#80621d]">
                بيانات حقيقية
              </Badge>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <AnalyticsBox
                label="طلبات واتساب هذا الشهر"
                value={String(stats.monthlyRequests)}
                note={stats.previousMonthGrowth >= 0
                  ? `نمو +${stats.previousMonthGrowth}% عن الشهر الماضي`
                  : undefined}
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
                value={stats.rank > 0 ? `#${stats.rank}` : "—"}
                note={`من أصل ${stats.totalProperties} عقار`}
              />
            </div>
          </Card>
        </section>


        {/* ===== صور العقار ===== */}

        {/* ===== Modal إحصائيات الطلبات ===== */}
        {showRequestsStats && (
          <RequestsStatsModal
            requestsData={requestsData}
            requestsLoading={requestsLoading}
            onClose={() => setShowRequestsStats(false)}
            propertyName={property?.name}
            onDeleteRequest={(id) => deleteRequestMutation.mutate(id)}
          />
        )}

        {/* ===== نافذة رفع الإيصال للتحويل البنكي ===== */}
        <Dialog open={showReceiptDialog} onOpenChange={setShowReceiptDialog}>
          <DialogContent className="max-h-[90vh] w-[calc(100%-1.5rem)] max-w-md overflow-y-auto rounded-2xl border-[#e6ddc9] bg-[#fffdf8] p-5">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-[#293129]">
                <Upload className="w-5 h-5 text-[#9a7623]" />
                رفع إيصال التحويل البنكي
              </DialogTitle>
              <DialogDescription className="text-xs leading-5 text-[#6f685b]">
                ارفع صورة إيصال التحويل البنكي للدفعة المعلقة وسيتم مراجعته
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              {/* معلومات الدفعة */}
              {selectedPaymentForReceipt && (
                <div className="space-y-2 rounded-xl border border-[#f0eadc] bg-white p-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-[#6f685b]">المبلغ:</span>
                    <span className="font-bold">
                      <PriceDisplay
                        amount={selectedPaymentForReceipt.finalAmount}
                        size="sm"
                      />
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#6f685b]">الباقة:</span>
                    <span>
                      {getPackageNameArabic(
                        selectedPaymentForReceipt.packageId,
                      )}
                    </span>
                  </div>
                  {selectedPaymentForReceipt.receiptUrl &&
                    selectedReceiptVerified === true && (
                    <div className="flex justify-between items-center">
                      <span className="text-[#6f685b]">إيصال سابق:</span>
                      <a
                        href={selectedPaymentForReceipt.receiptUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-xs font-semibold text-[#80621d] underline"
                      >
                        عرض الإيصال السابق
                      </a>
                    </div>
                  )}
                </div>
              )}

              {/* رفع الإيصال */}
              <div className="space-y-2">
                <label className="block text-xs font-bold text-[#293129]">
                  صورة الإيصال الجديد
                </label>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*,application/pdf"
                  onChange={(e) => {
                    setReceiptFile(e.target.files?.[0] || null);
                    setReceiptUploadFeedback(null);
                  }}
                  className="hidden"
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => fileInputRef.current?.click()}
                  className="h-11 w-full gap-2 rounded-xl border-[#d9cfb8] bg-white text-[#80621d] hover:bg-[#fafaf7]"
                >
                  <Upload className="w-4 h-4" />
                  {receiptFile ? receiptFile.name : "اختر صورة الإيصال"}
                </Button>
                {receiptFile && (
                  <p className="text-xs font-semibold text-[#128c47]">
                    تم اختيار: {receiptFile.name}
                  </p>
                )}
              </div>

              {/* عرض الإيصال المرفوع بعد التحقق من وجود الملف */}
              {selectedPaymentForReceipt?.receiptUrl &&
                selectedReceiptVerified === true && (
                  <div className="space-y-3">
                    <div className="overflow-hidden rounded-xl border border-[#e6ddc9]">
                      <img
                        src={selectedPaymentForReceipt.receiptUrl}
                        alt="إيصال التحويل"
                        className="w-full max-h-48 object-contain bg-[#fafaf7]"
                      />
                    </div>
                  </div>
                )}

              {receiptUploadFeedback && (
                <div
                  className={`rounded-lg border p-3 text-sm ${
                    receiptUploadFeedback.tone === "error"
                      ? "border-[#f0d6d6] bg-[#fffafa] text-[#b42318]"
                      : "border-[#e8d9b4] bg-[#fdf8ec] text-[#80621d]"
                  }`}
                >
                  <p className="font-semibold">{receiptUploadFeedback.title}</p>
                  <p className="mt-1 text-xs leading-5">
                    {receiptUploadFeedback.message}
                  </p>
                </div>
              )}

              {/* أزرار الإجراء */}
              <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row">
                <Button
                  onClick={handleReceiptUpload}
                  disabled={!receiptFile || isUploadingReceipt}
                  className="h-11 flex-1 gap-2 rounded-xl bg-[#29372f] font-bold text-white hover:bg-[#1f2b25]"
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
                  className="h-11 rounded-xl border-[#d9cfb8] bg-white text-[#6f685b] hover:bg-[#fafaf7]"
                  onClick={() => {
                    setShowReceiptDialog(false);
                    setSelectedPaymentForReceipt(null);
                    setReceiptFile(null);
                    setReceiptUploadFeedback(null);
                  }}
                >
                  إلغاء
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      </OwnerPageMain>
      <OwnerMobileNavigation />
    </div>
  );
}

// دالة تحويل اسم الباقة للعربي
function getPackageNameArabic(packageId: string): string {
  const packageNames: Record<string, string> = {
    "pkg-monthly": "اشتراك شهري",
    "pkg-month": "الباقة الذهبية",
    "pkg-month1": "الباقة الفضية",
    "pkg-special": "عرض خاص شهرين",
    "pkg-special-2months": "عرض خاص شهرين",
    "pkg-2months": "عرض خاص شهرين",
    "pkg-camps": "باقة المخيمات",
    "pkg-2properties": "باقة النخبة - عقارين",
    "pkg-month-2properties": "باقة النخبة - عقارين",
    "pkg-month-2prop": "باقة النخبة - عقارين",
    "pkg-free": "الباقة المجانية",
  };
  return packageNames[packageId] || packageId;
}

/* ================== مكوّنات مساعدة ================== */

function DashboardHeroMetric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.06] px-3 py-2.5">
      <p className="text-[11px] font-semibold text-[#d8bf76]">{label}</p>
      <p className="mt-1 truncate text-base font-bold text-white">{value}</p>
    </div>
  );
}

function DashboardKpiCard(props: {
  icon: React.ReactNode;
  label: string;
  value: string;
  note: string;
  tone?: "gold" | "green" | "blue" | "red";
  onClick: () => void;
  testId?: string;
}) {
  return <OwnerStatCard {...props} />;
}

function OwnerRequestMetric({
  label,
  value,
  attention = false,
}: {
  label: string;
  value: number;
  attention?: boolean;
}) {
  return (
    <div className="min-w-0 p-4 sm:p-5">
      <p className={`text-2xl font-bold tabular-nums ${attention ? "text-[#a66317]" : "text-[#293129]"}`}>{value}</p>
      <p className="mt-1 text-xs font-semibold leading-5 text-[#687064]">{label}</p>
    </div>
  );
}

function DashboardStatusTile({
  icon,
  title,
  value,
  note,
  actionLabel,
  onAction,
  toneClass = "border-[#e2d6bd] bg-white text-[#2f2a1f]",
}: {
  icon: React.ReactNode;
  title: string;
  value: string;
  note: string;
  actionLabel: string;
  onAction: () => void;
  toneClass?: string;
}) {
  return (
    <div className={`rounded-lg border p-5 ${toneClass}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-current/15 bg-white/60">
          {icon}
        </div>
        <button
          type="button"
          onClick={onAction}
          className="rounded-lg border border-current/20 bg-white/60 px-3 py-1.5 text-xs font-bold"
        >
          {actionLabel}
        </button>
      </div>
      <div className="mt-5">
        <p className="text-xs font-semibold opacity-70">{title}</p>
        <p className="mt-1 text-2xl font-bold">{value}</p>
        <p className="mt-2 text-sm leading-6 opacity-75">{note}</p>
      </div>
    </div>
  );
}

function DashboardQuickAction({
  icon,
  title,
  value,
  action,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  value: string;
  action: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-lg border border-[#e2d6bd] bg-white p-4 text-right"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#eadfca] bg-[#fffaf0] text-[#9a7623]">
          {icon}
        </div>
        <span className="rounded-lg border border-[#eadfca] bg-[#fffdf8] px-2.5 py-1 text-[11px] font-bold text-[#6f5520]">
          {action}
        </span>
      </div>
      <div className="mt-4">
        <p className="text-xs font-semibold text-[#8b7140]">{title}</p>
        <p className="mt-1 text-2xl font-bold text-[#2f2a1f]">{value}</p>
      </div>
    </button>
  );
}

function WorkflowNotice({
  tone,
  icon,
  label,
  title,
  description,
  actionLabel,
  onAction,
}: {
  tone: "amber" | "blue" | "red" | "green";
  icon: React.ReactNode;
  label: string;
  title: string;
  description: string;
  actionLabel: string;
  onAction: () => void;
}) {
  const toneClass = {
    amber: {
      wrap: "border-[#d9cfb8] bg-[#fafaf7]",
      icon: "border-[#d9cfb8] bg-white text-[#80621d]",
      badge: "border-[#d9cfb8] bg-[#f5f3ee] text-[#80621d]",
      button: "border-[#d9cfb8] text-[#80621d]",
    },
    blue: {
      wrap: "border-[#c9d9eb] bg-[#fafbfc]",
      icon: "border-[#c9d9eb] bg-white text-[#315f92]",
      badge: "border-[#c9d9eb] bg-[#f4f8fc] text-[#315f92]",
      button: "border-[#c9d9eb] text-[#315f92]",
    },
    red: {
      wrap: "border-[#f1c8c8] bg-[#fefbfb]",
      icon: "border-[#f1c8c8] bg-white text-[#b42318]",
      badge: "border-[#f1c8c8] bg-[#fff5f5] text-[#b42318]",
      button: "border-[#f1c8c8] text-[#b42318]",
    },
    green: {
      wrap: "border-[#cfe5d6] bg-[#fafcfa]",
      icon: "border-[#cfe5d6] bg-white text-[#128c47]",
      badge: "border-[#cfe5d6] bg-[#f6fbf7] text-[#128c47]",
      button: "border-[#cfe5d6] text-[#128c47]",
    },
  }[tone];

  return (
    <div className={`rounded-xl border p-4 md:p-5 shadow-sm ${toneClass.wrap}`}>
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-3">
          <div className={`flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-xl border ${toneClass.icon}`}>
            {icon}
          </div>
          <div>
            <Badge variant="outline" className={`mb-2 rounded-lg ${toneClass.badge}`}>
              {label}
            </Badge>
            <h3 className="font-bold text-[#293129]">{title}</h3>
            <p className="mt-1 text-sm leading-6 text-[#687064]">{description}</p>
          </div>
        </div>
        <Button
          variant="outline"
          className={`h-11 flex-shrink-0 rounded-xl bg-white px-4 font-bold ${toneClass.button} hover:bg-[#fafaf7] transition-colors`}
          onClick={onAction}
        >
          {actionLabel}
        </Button>
      </div>
    </div>
  );
}

function Loader({ text }: { text: string }) {
  return (
    <div className="min-h-screen flex items-center justify-center text-center">
      <div>
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="mt-4 text-[#6f685b]">{text}</p>
      </div>
    </div>
  );
}

function ErrorView({ setLocation }: { setLocation: (path: string) => void }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md p-8 text-center">
        <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-[#fff5f5] flex items-center justify-center">
          <AlertTriangle className="w-8 h-8 text-[#b42318]" />
        </div>
        <h2 className="text-xl font-bold mb-2">خطأ في تحميل البيانات</h2>
        <p className="text-[#6f685b] mb-4">
          تعذر تحميل بيانات العقار، حاول مرة أخرى.
        </p>
        <div className="flex gap-2 justify-center">
          <Button onClick={() => window.location.reload()}>
            إعادة المحاولة
          </Button>
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
    <div className="min-w-0 rounded-lg border border-[#f0eadc] bg-[#fffdf8] px-3 py-2">
      <dt className="text-[11px] font-semibold text-[#6f685b]">{title}</dt>
      <dd className="mt-0.5 truncate text-sm font-bold text-[#293129]">{value || "---"}</dd>
    </div>
  );
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="w-full h-2 rounded-full bg-[#eee4cf] overflow-hidden">
      <div
        className="h-full rounded-full bg-[#9a7623] transition-all"
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
    <div className={ownerTileClass + " flex items-center gap-3 p-3"}>
      <div className="flex h-10 w-10 flex-none items-center justify-center rounded-xl border border-[#efe7d6] bg-white text-[#80621d]">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold text-[#6f685b]">{label}</p>
        <p className="mt-0.5 truncate text-sm font-bold text-[#293129]">{value}</p>
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
    <div className={ownerTileClass + " p-3"}>
      <p className="text-[11px] font-semibold text-[#6f685b]">{label}</p>
      <p className="mt-1 truncate text-xl font-bold text-[#293129]">{value}</p>
      {note && <p className="mt-0.5 truncate text-[11px] text-[#6f685b]">{note}</p>}
    </div>
  );
}

function PaymentRow({
  payment,
  onRetryPayment,
  isRetrying,
  onVerifyPayment,
  isVerifying,
}: {
  payment: any;
  onRetryPayment?: (payment: any) => void;
  isRetrying?: boolean;
  onVerifyPayment?: (payment: any) => void;
  isVerifying?: boolean;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const hasReceiptReference = Boolean(payment.hasReceipt || payment.receiptUrl);
  const [receiptAvailability, setReceiptAvailability] =
    useState<ReceiptAvailability>(hasReceiptReference ? "checking" : "none");

  // Verify the receipt file itself. A stale URL or a deleted object must never
  // be presented as an uploaded receipt.
  useEffect(() => {
    if (!hasReceiptReference) {
      setReceiptAvailability("none");
      return;
    }
    const url =
      typeof payment.receiptUrl === "string" ? payment.receiptUrl.trim() : "";
    if (!url) {
      setReceiptAvailability("invalid");
      return;
    }
    let cancelled = false;
    setReceiptAvailability("checking");
    fetch(url, { method: "HEAD", credentials: "include", cache: "no-store" })
      .then((response) => {
        if (!cancelled) {
          setReceiptAvailability(response.ok ? "valid" : "invalid");
        }
      })
      .catch(() => {
        if (!cancelled) setReceiptAvailability("invalid");
      });
    return () => {
      cancelled = true;
    };
  }, [hasReceiptReference, payment.receiptUrl]);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "مكتمل":
        return <CheckCircle2 className="w-4 h-4 text-[#128c47]" />;
      case "نجح - قيد التحقق":
        return <CheckCircle2 className="w-4 h-4 text-[#315f92]" />;
      case "قيد المراجعة":
        return <Clock className="w-4 h-4 text-[#a66317]" />;
      case "معلق":
        return <Clock className="w-4 h-4 text-[#315f92]" />;
      case "ملغي":
      case "فشل":
        return <XCircle className="w-4 h-4 text-[#b42318]" />;
      default:
        return <Clock className="w-4 h-4 text-[#6f685b]" />;
    }
  };

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case "مكتمل":
        return "border border-[#cfe5d6] bg-[#f6fbf7] text-[#128c47]";
      case "نجح - قيد التحقق":
        return "border border-[#d9e4ef] bg-[#f9fbfd] text-[#315f92]";
      case "قيد المراجعة":
        return "border border-[#e8d9b4] bg-[#fdf8ec] text-[#a66317]";
      case "معلق":
        return "border border-[#d9e4ef] bg-[#f9fbfd] text-[#315f92]";
      case "ملغي":
      case "فشل":
        return "border border-[#f0d6d6] bg-[#fffafa] text-[#b42318]";
      default:
        return "border border-[#efe7d6] bg-[#fffdf8] text-[#6f685b]";
    }
  };

  const getDisplayStatus = (status: string) => {
    if (status === "نجح - قيد التحقق") return "قيد التحقق";
    return status;
  };

  const getStatusReason = (
    status: string,
    paymentMethod: string,
    createdAt?: string,
  ) => {
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
        return "أكمل بيانات العقار ثم اضغط زر بدء التحقق الذكي";
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
      "pkg-monthly": "اشتراك شهري",
      "pkg-month": "الباقة الذهبية",
      "pkg-month1": "الباقة الفضية",
      "pkg-special": "عرض خاص شهرين",
      "pkg-special-2months": "عرض خاص شهرين",
      "pkg-2months": "عرض خاص شهرين",
      "pkg-camps": "باقة المخيمات",
      "pkg-2properties": "باقة النخبة - عقارين",
      "pkg-month-2properties": "باقة النخبة - عقارين",
      "pkg-month-2prop": "باقة النخبة - عقارين",
      "pkg-free": "الباقة المجانية",
    };
    if (packageNames[packageId]) return packageNames[packageId];
    if (packageId?.startsWith("addon-")) return "إضافة";
    return "باقة";
  };

  const getPaymentMethodArabic = (method: string) => {
    switch (method) {
      case "bank_transfer":
        return "تحويل بنكي";
      case "paymob":
        return "دفع إلكتروني";
      case "cards":
        return "بطاقة";
      case "apple_pay":
        return "Apple Pay";
      case "تحويل بنكي":
        return "تحويل بنكي";
      case "دفع إلكتروني":
        return "دفع إلكتروني";
      default:
        return method || "غير محدد";
    }
  };

  const getStatusArabic = (status: string) => {
    switch (status) {
      case "completed":
        return "مكتمل";
      case "pending":
        return "معلق";
      case "failed":
        return "فشل";
      case "cancelled":
        return "ملغي";
      case "مكتمل":
        return "مكتمل";
      case "معلق":
        return "معلق";
      case "فشل":
        return "فشل";
      case "قيد المراجعة":
        return "قيد المراجعة";
      case "نجح - قيد التحقق":
        return "نجح - قيد التحقق";
      default:
        return status || "غير محدد";
    }
  };

  const amount = payment.finalAmount || payment.amount || 0;
  const normalizedStatus = getStatusArabic(payment.status);
  const isCompleted = normalizedStatus === "مكتمل";
  const receiptStatusView = resolvePaymentReceiptStatus({
    paymentMethod: getPaymentMethodArabic(payment.paymentMethod),
    status: normalizedStatus,
    hasReceiptReference,
    receiptAvailability,
    scanStatus: payment.receiptScanStatus ?? null,
  });
  const statusReason =
    receiptStatusView?.reason ??
    getStatusReason(
      normalizedStatus,
      getPaymentMethodArabic(payment.paymentMethod),
      payment.createdAt,
    );
  const showUploadReceipt = receiptStatusView
    ? receiptStatusView.showUpload
    : shouldShowUploadReceiptButton(payment);

  return (
    <div
      className="overflow-hidden rounded-xl border border-[#f0eadc] bg-[#fffdf8]"
      data-testid={`payment-row-${payment.id}`}
    >
      {/* الصف الرئيسي */}
      <div className="flex flex-col gap-3 p-4 md:flex-row md:items-center">
        {/* السعر على اليسار */}
        <div className="flex flex-shrink-0 items-center gap-2 md:order-first order-last">
          <div className="min-w-[80px] text-center md:text-right">
            <div className="text-lg font-bold text-[#80621d]">
              <PriceDisplay amount={amount} size="lg" />
            </div>
            {payment.paymentMethod && (
              <div className="text-[11px] text-[#6f685b]">
                {getPaymentMethodArabic(payment.paymentMethod)}
              </div>
            )}
          </div>
        </div>

        {/* معلومات الباقة */}
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl border border-[#efe7d6] bg-white">
            <CreditCard className="w-5 h-5 text-[#9a7623]" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                className={`text-xs px-2 py-0.5 flex items-center gap-1 ${getStatusBadgeClass(normalizedStatus)}`}
              >
                {getStatusIcon(normalizedStatus)}
                {getDisplayStatus(normalizedStatus)}
              </Badge>
              <span className="truncate text-sm font-bold text-[#293129]">
                {getPackageNameArabic(payment.packageId)}
              </span>
            </div>
            <div className="mt-1 text-[11px] text-[#6f685b]">
              {formatDate(payment.createdAt)}
            </div>
            {statusReason && (
                <div
                  className={`mt-1 text-[11px] font-semibold ${normalizedStatus === "مكتمل"
                    ? "text-[#128c47]"
                    : normalizedStatus === "فشل"
                      ? "text-[#b42318]"
                      : normalizedStatus === "نجح - قيد التحقق"
                        ? "text-[#315f92]"
                        : "text-[#a66317]"
                    }`}
                >
                  {statusReason}
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
        {showUploadReceipt && onRetryPayment && (
          <Button
            size="sm"
            variant="default"
            className="bg-[#9a7623] text-white gap-1 flex-shrink-0"
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
        {normalizedStatus === "معلق" &&
          payment.paymobOrderId &&
          onVerifyPayment && (
            <Button
              size="sm"
              variant="outline"
              className="gap-1 flex-shrink-0 border-[#cfe5d6] text-[#128c47] bg-white"
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
            className="flex-shrink-0 gap-1 rounded-xl bg-[#29372f] text-white hover:bg-[#1f2b25]"
            onClick={() => onRetryPayment(payment)}
            disabled={isRetrying}
            data-testid={`button-retry-payment-${payment.id}`}
          >
            {isRetrying ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <CreditCard className="w-4 h-4" />
            )}
            {isRetrying
              ? "جاري التحويل..."
              : normalizedStatus === "فشل"
                ? "إعادة الدفع"
                : normalizedStatus === "معلق" ||
                  normalizedStatus === "قيد المراجعة"
                  ? "إكمال الدفع"
                  : "إعادة الدفع"}
          </Button>
        )}
      </div>

      {/* تفاصيل الدفعة الموسعة - للدفعات الناجحة قيد التحقق */}
      {showDetails && payment.status === "نجح - قيد التحقق" && (
        <div className="border-t border-[#f0eadc] bg-[#f9fbfd] p-4">
          <div className="mb-4 rounded-xl border border-[#d9e4ef] bg-white p-3 text-sm text-[#315f92]">
            ✅ تم استلام الدفع بنجاح! يرجى إكمال بيانات العقار وسيتم تفعيل
            الاشتراك تلقائياً.
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            <div>
              <div className="mb-1 text-[11px] font-semibold text-[#6f685b]">
                المبلغ المدفوع
              </div>
              <div className="font-bold text-[#80621d]">
                <PriceDisplay amount={amount} size="sm" />
              </div>
            </div>
            <div>
              <div className="mb-1 text-[11px] font-semibold text-[#6f685b]">الباقة</div>
              <div className="font-semibold">
                {getPackageNameArabic(payment.packageId)}
              </div>
            </div>
            {payment.pendingSubscriptionType && (
              <div>
                <div className="mb-1 text-[11px] font-semibold text-[#6f685b]">
                  نوع الاشتراك
                </div>
                <Badge
                  variant={
                    payment.pendingSubscriptionType === "مميز"
                      ? "default"
                      : "outline"
                  }
                  className="text-xs"
                >
                  {payment.pendingSubscriptionType === "مميز" && (
                    <Crown className="w-3 h-3 ml-1" />
                  )}
                  {payment.pendingSubscriptionType}
                </Badge>
              </div>
            )}
            {payment.pendingStartDate && (
              <div>
                <div className="mb-1 text-[11px] font-semibold text-[#6f685b]">
                  تاريخ البداية المتوقع
                </div>
                <div className="font-semibold">{payment.pendingStartDate}</div>
              </div>
            )}
            {payment.pendingEndDate && (
              <div>
                <div className="mb-1 text-[11px] font-semibold text-[#6f685b]">
                  تاريخ الانتهاء المتوقع
                </div>
                <div className="font-semibold">{payment.pendingEndDate}</div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* تفاصيل الدفعة الموسعة - للدفعات المكتملة */}
      {showDetails && isCompleted && (
        <div className="border-t border-[#f0eadc] bg-[#fffdf8] p-4">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
            {/* المبلغ الأصلي */}
            {payment.amount && payment.amount !== amount && (
              <div>
                <div className="mb-1 text-[11px] font-semibold text-[#6f685b]">
                  المبلغ الأصلي
                </div>
                <div className="font-semibold">
                  <PriceDisplay amount={payment.amount} size="sm" />
                </div>
              </div>
            )}

            {/* كود الخصم */}
            {payment.discountCode && (
              <div>
                <div className="mb-1 text-[11px] font-semibold text-[#6f685b]">
                  كود الخصم
                </div>
                <div className="font-semibold text-[#128c47]">
                  {payment.discountCode}
                </div>
              </div>
            )}

            {/* قيمة الخصم */}
            {payment.discountAmount > 0 && (
              <div>
                <div className="mb-1 text-[11px] font-semibold text-[#6f685b]">
                  قيمة الخصم
                </div>
                <div className="font-semibold text-[#128c47]">
                  -<PriceDisplay amount={payment.discountAmount} size="sm" />
                </div>
              </div>
            )}

            {/* المبلغ المدفوع */}
            <div>
              <div className="mb-1 text-[11px] font-semibold text-[#6f685b]">
                المبلغ المدفوع
              </div>
              <div className="font-bold text-[#80621d]">
                <PriceDisplay amount={amount} size="sm" />
              </div>
            </div>

            {/* فترة الاشتراك */}
            {payment.pendingStartDate && (
              <div>
                <div className="mb-1 text-[11px] font-semibold text-[#6f685b]">
                  بداية الاشتراك
                </div>
                <div className="font-semibold">{payment.pendingStartDate}</div>
              </div>
            )}
            {payment.pendingEndDate && (
              <div>
                <div className="mb-1 text-[11px] font-semibold text-[#6f685b]">
                  نهاية الاشتراك
                </div>
                <div className="font-semibold">{payment.pendingEndDate}</div>
              </div>
            )}

            {/* نوع الاشتراك */}
            {payment.pendingSubscriptionType && (
              <div>
                <div className="mb-1 text-[11px] font-semibold text-[#6f685b]">
                  نوع الاشتراك
                </div>
                <Badge
                  variant={
                    payment.pendingSubscriptionType === "مميز"
                      ? "default"
                      : "outline"
                  }
                  className="text-xs"
                >
                  {payment.pendingSubscriptionType === "مميز" && (
                    <Crown className="w-3 h-3 ml-1" />
                  )}
                  {payment.pendingSubscriptionType}
                </Badge>
              </div>
            )}

            {/* نوع العملية */}
            {payment.action && (
              <div>
                <div className="mb-1 text-[11px] font-semibold text-[#6f685b]">
                  نوع العملية
                </div>
                <div className="font-semibold">
                  {payment.action === "activate"
                    ? "تفعيل جديد"
                    : payment.action === "renew"
                      ? "تجديد"
                      : payment.action === "upgrade"
                        ? "ترقية"
                        : payment.action}
                </div>
              </div>
            )}

            {/* تاريخ الإتمام */}
            {payment.completedAt && (
              <div>
                <div className="mb-1 text-[11px] font-semibold text-[#6f685b]">
                  تاريخ الإتمام
                </div>
                <div className="font-semibold">
                  {formatDate(payment.completedAt)}
                </div>
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
      className="rounded-lg border border-[#e2d6bd] bg-white p-4 flex flex-col gap-2 text-right h-full"
    >
      <div className="flex items-center justify-between">
        <div className="w-10 h-10 rounded-lg border border-[#eadfca] bg-[#fffaf0] flex items-center justify-center text-[#9a7623]">
          {icon}
        </div>
      </div>
      <div>
        <div className="font-bold text-sm mb-1 text-[#2f2a1f]">{title}</div>
        <div className="text-[11px] text-[#6f6249] leading-relaxed">
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
  propertyName,
  onDeleteRequest,
}: {
  requestsData: any;
  requestsLoading: boolean;
  onClose: () => void;
  propertyName?: string;
  onDeleteRequest?: (id: string) => void;
}) {
  const [searchTerm, setSearchTerm] = useState("");
  const [dateFilter, setDateFilter] = useState<"all" | "today" | "week" | "month">("all");

  const filteredRequests = requestsData?.requests?.filter((req: any) => {
    // Search filter
    if (searchTerm) {
      const search = searchTerm.toLowerCase();
      const matchesCode = (req.requestCode || req.id || "").toLowerCase().includes(search);
      const matchesProperty = (req.propertyNumber || "").toLowerCase().includes(search);
      if (!matchesCode && !matchesProperty) return false;
    }
    
    // Date filter
    if (dateFilter !== "all" && req.timestamp) {
      const reqDate = new Date(req.timestamp);
      const now = new Date();
      const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      
      if (dateFilter === "today") {
        if (reqDate < today) return false;
      } else if (dateFilter === "week") {
        const weekAgo = new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000);
        if (reqDate < weekAgo) return false;
      } else if (dateFilter === "month") {
        const monthAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);
        if (reqDate < monthAgo) return false;
      }
    }
    
    return true;
  }) || [];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[#1b211d]/55 p-3 py-6 sm:items-center sm:p-4">
      <Card className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border-[#e6ddc9] bg-[#fffdf8] shadow-[0_20px_50px_rgba(29,38,32,0.25)]">
        <div className="flex flex-none items-center justify-between gap-3 border-b border-[#f0eadc] bg-[#fffdf8] p-4 sm:p-5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="inline-flex h-10 w-10 flex-none items-center justify-center rounded-xl border border-[#efe7d6] bg-[#faf7ef] text-[#80621d]">
              <BarChart2 className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h2 className="text-sm font-bold leading-tight text-[#293129] sm:text-base">إحصائيات طلبات واتساب</h2>
              <p className="mt-0.5 truncate text-xs text-[#6f685b]">{propertyName || "هذا العقار"}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="inline-flex h-9 w-9 flex-none items-center justify-center rounded-xl border border-[#e6ddc9] bg-white text-[#6f685b] transition-colors hover:bg-[#fafaf7]"
            data-testid="button-close-modal"
          >
            ✕
          </button>
        </div>
        
        {/* Search and Filters */}
        <div className="flex-none border-b border-[#f0eadc] bg-white p-3 sm:p-4">
          <div className="flex flex-col md:flex-row gap-3">
            <input
              type="text"
              placeholder="بحث بالرقم أو الكود..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="h-11 flex-1 rounded-xl border border-[#d9cfb8] bg-white px-3 text-sm text-[#293129] outline-none placeholder:text-[#9c9382] focus:border-[#9a7623] focus:ring-2 focus:ring-[#9a7623]/15"
            />
            <select
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value as any)}
              className="h-11 rounded-xl border border-[#d9cfb8] bg-white px-3 text-sm text-[#293129] outline-none focus:border-[#9a7623] focus:ring-2 focus:ring-[#9a7623]/15"
            >
              <option value="all">كل الأوقات</option>
              <option value="today">اليوم</option>
              <option value="week">آخر أسبوع</option>
              <option value="month">آخر شهر</option>
            </select>
          </div>
        </div>
        
        <div className="flex-1 overflow-y-auto p-4 sm:p-5">
          {requestsLoading ? (
            <div className="py-12 text-center text-sm text-[#6f685b]">
              جاري التحميل...
            </div>
          ) : filteredRequests.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[#e6ddc9] bg-white px-4 py-10 text-center text-sm text-[#6f685b]">
              {searchTerm || dateFilter !== "all" ? "لا توجد نتائج للبحث" : "لا توجد طلبات حتى الآن"}
            </div>
          ) : (
            <>
              <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-[#efe7d6] bg-white px-4 py-3">
                <p className="text-xs font-semibold text-[#6f685b]">
                  عدد الطلبات بعد الفلترة
                </p>
                <p className="text-xl font-bold tabular-nums text-[#80621d]">
                  {filteredRequests.length}
                </p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="border-b border-[#f0eadc] bg-[#fffdf8]">
                    <tr className="text-[11px] font-bold text-[#6f685b]">
                      <th className="text-right p-3">العقار</th>
                      <th className="text-right p-3">الكود</th>
                      <th className="text-right p-3">التاريخ والوقت</th>
                      <th className="text-right p-3">الإجراءات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRequests.map((req: any, idx: number) => (
                      <tr
                        key={idx}
                        className="border-b border-[#f5f0e4] last:border-0"
                      >
                        <td className="p-3">
                          <span className="font-bold text-[#293129]">
                            {propertyName || req.propertyNumber || "-"}
                          </span>
                        </td>
                        <td className="p-3 font-mono text-xs text-[#80621d]">
                          {req.requestCode || req.id}
                        </td>
                        <td className="p-3 text-xs text-[#6f685b]">
                          {formatLiveSaudiTime(req.timestamp)}
                        </td>
                        <td className="p-3">
                          {req.canDelete && req.contactRequestId && (
                            <button
                              onClick={() => onDeleteRequest?.(req.contactRequestId)}
                              className="text-sm text-[#b42318] transition-opacity hover:opacity-70"
                              title="حذف"
                            >
                              🗑️
                            </button>
                          )}
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
