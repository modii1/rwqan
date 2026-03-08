"use client";
import { useEffect, useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { PriceDisplay } from "@/components/price-display";
import { formatDiscount } from "@/lib/currency";
import { Progress } from "@/components/ui/progress";
import {
  Crown, CreditCard, Check, ChevronRight, Clock, Home,
  Star, Zap, Upload, AlertTriangle, RefreshCcw, CheckCircle2, Phone, ArrowLeft,
  Calendar, Timer, Banknote, Info, X, Loader2, Plus,
} from "lucide-react";

import {
  calculateRemainingDays,
  calculateSubscriptionDuration,
  getSubscriptionStatus,
  getStatusInfo,
  formatDate as formatSubDate,
  canExtendSubscription,
} from "@/lib/subscription-utils";

export default function OwnerSubscriptionPage() {
  const router = useRouter();
  const { toast } = useToast();
  const receiptInputRef = useRef<HTMLInputElement>(null);

  const [currentStep, setCurrentStep] = useState<1 | 2>(1);
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null);
  const [action, setAction] = useState<"upgrade" | "extend">("upgrade");
  const [paymentMethod, setPaymentMethod] = useState<"online" | "bank" | null>(null);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [discountCode, setDiscountCode] = useState("");
  const [validatedDiscount, setValidatedDiscount] = useState<any>(null);
  const [paymentSuccess, setPaymentSuccess] = useState(false);
  const [showUpgradeDialog, setShowUpgradeDialog] = useState(false);
  const [aiScanResult, setAiScanResult] = useState<any>(null);
  
  // Additional properties for multi-property packages
  const [additionalProperties, setAdditionalProperties] = useState<Array<{ number: string; verified: boolean; error: string; verifying: boolean }>>([]);
  const [verifyingProperty, setVerifyingProperty] = useState<number | null>(null);

  // Add-on purchase flow
  const [addOnStep, setAddOnStep] = useState<1 | 2>(1);
  const [selectedAddOn, setSelectedAddOn] = useState<any>(null);
  const [addOnPaymentMethod, setAddOnPaymentMethod] = useState<"online" | "bank" | null>(null);
  const [addOnReceiptFile, setAddOnReceiptFile] = useState<File | null>(null);
  const [addOnPaymentSuccess, setAddOnPaymentSuccess] = useState(false);
  const [addOnAiScanResult, setAddOnAiScanResult] = useState<any>(null);

  interface AIScanResult {
    recommendation: string;
    confidence: number;
    summary: string;
    matchScore: number;
    authenticityScore: number;
  }

  // Fetch default bank account for bank transfer
  const { data: bankAccount } = useQuery<any>({
    queryKey: ["/api/bank-accounts/default"],
    enabled: paymentMethod === "bank" || addOnPaymentMethod === "bank",
  });

  // Auth check
  useEffect(() => {
    fetch("/api/owner/session", { credentials: "include" })
      .then((r) => r.json())
      .then((data) => {
        if (!data.isLoggedIn) router.push("/owner/login");
      })
      .catch(() => router.push("/owner/login"));
  }, [router]);

  // Fetch current property
  const { data: property } = useQuery<any>({
    queryKey: ["/api/owner/property"],
  });

  // Fetch current subscription
  const { data: subscription, isLoading: subLoading } = useQuery<any>({
    queryKey: ["/api/owner/current-subscription"],
  });

  // Fetch available packages
  const { data: rawPackages = [] } = useQuery<any[]>({
    queryKey: ["/api/packages"],
  });

  // Deduplicate packages
  const packages = Array.from(new Map(rawPackages.map((pkg: any) => [pkg.id, pkg])).values());

  // Fetch add-on packages
  const { data: addOnPackages } = useQuery<any[]>({
    queryKey: ["/api/owner/addons"],
    queryFn: async () => {
      const res = await fetch("/api/owner/addons", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  // Fetch owner's active add-ons
  const { data: propertyAddons } = useQuery<any[]>({
    queryKey: ["/api/owner/property-addons"],
    queryFn: async () => {
      const res = await fetch("/api/owner/property-addons", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });



  // Check pending payment - only after property is loaded
  const { data: pendingPayment } = useQuery<any>({
    queryKey: ["/api/owner/payment/check-pending"],
    enabled: !!property?.propertyNumber,
  });

  const selectedPackage = packages.find((p: any) => p.id === selectedPackageId);

  // Validate discount
  const validateDiscount = async () => {
    if (!discountCode) return;
    try {
      const response = await apiRequest("POST", "/api/discount/validate", { code: discountCode });
      const data = await response.json();
      setValidatedDiscount(data);
      toast({ title: "كود الخصم صالح", description: `سيتم خصم ${formatDiscount(data.value, data.type)}` });
    } catch (error: any) {
      toast({ title: "كود الخصم غير صالح", description: error.message, variant: "destructive" });
      setValidatedDiscount(null);
    }
  };

  // Add a new additional property
  const addAdditionalProperty = () => {
    const maxProps = (selectedPackage as any)?.maxProperties || 2;
    if (additionalProperties.length >= maxProps - 1) {
      toast({ title: "الحد الأقصى", description: `الحد الأقصى للعقارات الإضافية هو ${maxProps - 1}`, variant: "destructive" });
      return;
    }
    setAdditionalProperties([...additionalProperties, { number: "", verified: false, error: "", verifying: false }]);
  };

  // Remove an additional property
  const removeAdditionalProperty = (index: number) => {
    setAdditionalProperties(additionalProperties.filter((_, i) => i !== index));
  };

  // Update additional property number
  const updateAdditionalPropertyNumber = (index: number, value: string) => {
    const cleaned = value.replace(/\D/g, '').slice(0, 5);
    const updated = [...additionalProperties];
    updated[index] = { ...updated[index], number: cleaned, verified: false, error: "" };
    setAdditionalProperties(updated);
  };

  // Verify an additional property
  const verifyAdditionalProperty = async (index: number) => {
    const prop = additionalProperties[index];
    if (!prop.number || prop.number.length !== 5) {
      const updated = [...additionalProperties];
      updated[index] = { ...updated[index], error: "رقم العقار يجب أن يكون 5 أرقام" };
      setAdditionalProperties(updated);
      return;
    }
    
    setVerifyingProperty(index);
    const updated = [...additionalProperties];
    updated[index] = { ...updated[index], error: "", verifying: true };
    setAdditionalProperties(updated);
    
    try {
      const res = await fetch("/api/owner/verify-second-property", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secondPropertyNumber: prop.number }),
        credentials: "include",
      });
      const data = await res.json();
      
      if (data.ok) {
        updated[index] = { ...updated[index], verified: true, verifying: false };
        setAdditionalProperties(updated);
        toast({ title: "تم التحقق", description: `العقار: ${data.property?.name || prop.number}` });
      } else {
        updated[index] = { ...updated[index], error: data.error || "فشل في التحقق", verified: false, verifying: false };
        setAdditionalProperties(updated);
      }
    } catch (error: any) {
      updated[index] = { ...updated[index], error: error.message || "فشل في التحقق", verified: false, verifying: false };
      setAdditionalProperties(updated);
    } finally {
      setVerifyingProperty(null);
    }
  };

  // Calculate total price based on additional properties
  const calculateTotalPrice = () => {
    if (!selectedPackage) return 0;
    const pricePerProperty = (selectedPackage as any).pricePerProperty || 25;
    const propertyCount = 1 + additionalProperties.filter(p => p.verified).length;
    return pricePerProperty * propertyCount;
  };

  // Initiate card payment
  const cardPaymentMutation = useMutation({
    mutationFn: async (data: { packageId: string; action: string; discountCode?: string }) => {
      const verifiedProperties = additionalProperties.filter(p => p.verified).map(p => p.number);
      const res = await fetch("/api/owner/payment/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyNumber: property?.propertyNumber,
          packageId: data.packageId,
          action: data.action,
          paymentMethod: "cards",
          discountCode: data.discountCode || "",
          additionalProperties: verifiedProperties.length > 0 ? verifiedProperties : undefined,
        }),
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "فشل بدء الدفع");
      }
      return res.json();
    },
    onSuccess: (data) => {
      if (data.redirectUrl) {
        const paymentWindow = window.open(data.redirectUrl, '_blank');
        if (!paymentWindow) {
          window.location.href = data.redirectUrl;
        }
      } else if (data.checkoutUrl) {
        const paymentWindow = window.open(data.checkoutUrl, '_blank');
        if (!paymentWindow) {
          window.location.href = data.checkoutUrl;
        }
      }
    },
    onError: (err: Error) => {
      toast({ title: "خطأ في الدفع", description: err.message, variant: "destructive" });
    },
  });

  // Bank transfer payment
  const bankTransferMutation = useMutation({
    mutationFn: async (data: { packageId: string; action: string; receipt: File; discountCode?: string }) => {
      const formData = new FormData();
      formData.append("propertyNumber", property?.propertyNumber || "");
      formData.append("packageId", data.packageId);
      formData.append("action", data.action);
      formData.append("receipt", data.receipt);
      if (data.discountCode) formData.append("discountCode", data.discountCode);
      const verifiedProperties = additionalProperties.filter(p => p.verified).map(p => p.number);
      if (verifiedProperties.length > 0) formData.append("additionalProperties", JSON.stringify(verifiedProperties));

      const res = await fetch("/api/owner/payment/bank-transfer", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "فشل إرسال التحويل");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/owner/current-subscription"] });
      queryClient.invalidateQueries({ queryKey: ["/api/owner/payment/check-pending"] });
      if (data.aiScan) {
        setAiScanResult(data.aiScan);
      }
      setPaymentSuccess(true);
    },
    onError: (err: Error) => {
      toast({ title: "خطأ", description: err.message, variant: "destructive" });
    },
  });

  // Add-on payment
  const addonPaymentMutation = useMutation({
    mutationFn: async (addOnPackageId: string) => {
      const res = await fetch("/api/owner/addons/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyNumber: property?.propertyNumber,
          addOnPackageId,
        }),
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "فشل في الدفع");
      }
      return res.json();
    },
    onSuccess: (data) => {
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      }
    },
    onError: (err: Error) => {
      toast({ title: "خطأ", description: err.message, variant: "destructive" });
    },
  });

  // Add-on online payment with discount support
  const addonOnlinePaymentMutation = useMutation({
    mutationFn: async (data: { addOnPackageId: string; discountCode?: string }) => {
      const res = await fetch("/api/owner/addons/pay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyNumber: property?.propertyNumber,
          addOnPackageId: data.addOnPackageId,
          discountCode: data.discountCode || "",
        }),
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "فشل في الدفع");
      }
      return res.json();
    },
    onSuccess: (data) => {
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
      }
    },
    onError: (err: Error) => {
      toast({ title: "خطأ", description: err.message, variant: "destructive" });
    },
  });

  // Add-on bank transfer
  const addonBankTransferMutation = useMutation({
    mutationFn: async (data: { addOnPackageId: string; receipt: File }) => {
      const formData = new FormData();
      formData.append("propertyNumber", property?.propertyNumber || "");
      formData.append("addOnPackageId", data.addOnPackageId);
      formData.append("receipt", data.receipt);

      const res = await fetch("/api/owner/addons/bank-transfer", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "فشل في إرسال التحويل");
      }
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/owner/property-addons"] });
      if (data.aiScan) {
        setAddOnAiScanResult(data.aiScan);
      }
      setAddOnPaymentSuccess(true);
    },
    onError: (err: Error) => {
      toast({ title: "خطأ", description: err.message, variant: "destructive" });
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPackageId) return;

    if (paymentMethod === "online") {
      cardPaymentMutation.mutate({ packageId: selectedPackageId, action, discountCode: validatedDiscount?.code });
    } else if (paymentMethod === "bank") {
      if (!receiptFile) {
        toast({ title: "مطلوب", description: "يرجى رفع إيصال التحويل", variant: "destructive" });
        return;
      }
      bankTransferMutation.mutate({ packageId: selectedPackageId, action, receipt: receiptFile, discountCode: validatedDiscount?.code });
    }
  };

  // Handle add-on purchase submit
  const handleAddOnSubmit = async () => {
    if (!selectedAddOn) return;

    if (addOnPaymentMethod === "online") {
      addonOnlinePaymentMutation.mutate({ 
        addOnPackageId: selectedAddOn.id
      });
    } else if (addOnPaymentMethod === "bank") {
      if (!addOnReceiptFile) {
        toast({ title: "مطلوب", description: "يرجى رفع إيصال التحويل", variant: "destructive" });
        return;
      }
      addonBankTransferMutation.mutate({ 
        addOnPackageId: selectedAddOn.id,
        receipt: addOnReceiptFile
      });
    }
  };

  // Calculate remaining days using shared subscription-utils
  const remainingDays = subscription?.endDate
    ? calculateRemainingDays(subscription.endDate, subscription?.startDate)
    : 0;
  
  const isExpired = remainingDays < 0;
  const isNearExpiry = remainingDays >= 0 && remainingDays <= 7;
  const canExtend = subscription?.endDate
    ? canExtendSubscription(subscription.endDate, subscription?.status)
    : true; // expired = can extend

  // Subscription duration & status
  const subscriptionDuration = subscription?.startDate && subscription?.endDate
    ? calculateSubscriptionDuration(subscription.startDate, subscription.endDate)
    : 0;
  const subStatus = subscription?.endDate
    ? getSubscriptionStatus(subscription.endDate, subscription?.status, subscription?.isPlaceholder)
    : 'expired';
  const statusInfo = getStatusInfo(subStatus);

  // Card color mapping based on status
  const getCardColors = (status: string) => {
    const colors: Record<string, { border: string; bg: string; text: string }> = {
      active: { border: 'border-green-500', bg: 'bg-green-50', text: 'text-green-700' },
      expiring: { border: 'border-amber-400', bg: 'bg-amber-50', text: 'text-amber-700' },
      expired: { border: 'border-red-400', bg: 'bg-red-50', text: 'text-red-700' },
      cancelled: { border: 'border-gray-400', bg: 'bg-gray-50', text: 'text-gray-700' },
      pending: { border: 'border-amber-400', bg: 'bg-amber-50', text: 'text-amber-700' },
    };
    return colors[status] || colors.expired;
  };
  const cardColors = getCardColors(subStatus);

  // Package name helper
  const getPackageName = (pkgId?: string) => {
    const names: Record<string, string> = {
      'pkg-monthly': 'اشتراك شهري',
      'pkg-month': 'الباقة الذهبية',
      'pkg-month1': 'الباقة الفضية',
      'pkg-special': 'عرض خاص شهرين',
      'pkg-special-2months': 'عرض خاص شهرين',
      'pkg-2months': 'عرض خاص شهرين',
      'pkg-camps': 'باقة المخيمات',
      'pkg-2properties': 'باقة النخبة - عقارين',
      'pkg-month-2properties': 'باقة النخبة - عقارين',
      'pkg-month-2prop': 'باقة النخبة - عقارين',
      'pkg-free': 'الباقة المجانية',
    };
    if (!pkgId) return 'غير محدد';
    return names[pkgId] || packages.find((p: any) => p.id === pkgId)?.name || pkgId;
  };

  // Current package price from subscription
  const currentPackageObj = packages.find((p: any) => p.id === subscription?.packageId);

  // Filter packages - show upgradable ones
  const availablePackages = packages.filter((pkg: any) => {
    if (!pkg.isActive) return false;
    if (pkg.price === 0) return false;
    return true;
  });

  const currentPkgPrice = currentPackageObj?.price || 0;

  const getCategoryColor = (cat: string) => {
    switch (cat) {
      case "اعلان": return "bg-amber-500";
      case "ابراز": return "bg-purple-500";
      case "تثبيت": return "bg-blue-500";
      case "توثيق": return "bg-emerald-500";
      default: return "bg-slate-500";
    }
  };

  // Add-on Payment Success Screen
  if (addOnPaymentSuccess) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4" dir="rtl">
        <Card className="max-w-lg w-full p-8 text-center space-y-6">
          <div className="flex justify-center">
            <div className="w-20 h-20 rounded-full bg-amber-100 flex items-center justify-center">
              <Clock className="w-10 h-10 text-[#c9951d]" />
            </div>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[#434040] mb-2">تم استلام طلبك بنجاح!</h1>
            <p className="text-muted-foreground">طلب شراء إضافة قيد المراجعة</p>
          </div>
          <div className="bg-muted/30 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground flex items-center gap-2">
                <Home className="w-4 h-4" />رقم العقار
              </span>
              <span className="font-bold text-lg">{property?.propertyNumber}</span>
            </div>
            {selectedAddOn && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">الإضافة</span>
                <Badge className="bg-[#c9951d] text-white">{selectedAddOn.name}</Badge>
              </div>
            )}
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
              <div className="text-right">
                <p className="font-semibold text-amber-800 mb-1">قيد المراجعة</p>
                <p className="text-sm text-amber-700">
                  تم استلام إيصال الدفع. سيتم تفعيل الإضافة بعد التحقق من التحويل البنكي خلال 24 ساعة.
                </p>
              </div>
            </div>
          </div>

          {/* AI Scan Results */}
          {addOnAiScanResult && (
            <div className={`p-4 rounded-lg border ${
              addOnAiScanResult.recommendation === 'تفعيل_تلقائي' 
                ? 'bg-emerald-50 border-emerald-300' 
                : addOnAiScanResult.recommendation === 'رفض'
                ? 'bg-red-50 border-red-300'
                : 'bg-amber-50 border-amber-300'
            }`}>
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-bold text-sm">نتيجة الفحص الذكي</h4>
                <Badge variant="outline" className={
                  addOnAiScanResult.recommendation === 'تفعيل_تلقائي' 
                    ? 'border-emerald-500 text-emerald-600' 
                    : addOnAiScanResult.recommendation === 'رفض'
                    ? 'border-red-500 text-red-600'
                    : 'border-amber-500 text-amber-600'
                }>
                  {addOnAiScanResult.recommendation === 'تفعيل_تلقائي' && 'مطابق - جاهز للتفعيل'}
                  {addOnAiScanResult.recommendation === 'مراجعة_يدوية' && 'يحتاج مراجعة'}
                  {addOnAiScanResult.recommendation === 'رفض' && 'غير مطابق'}
                </Badge>
              </div>
              
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">نسبة الأصالة</span>
                    <span className="font-bold">{addOnAiScanResult.authenticityScore}%</span>
                  </div>
                  <Progress value={addOnAiScanResult.authenticityScore} className="h-2" />
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-muted-foreground">نسبة التطابق</span>
                    <span className="font-bold">{addOnAiScanResult.matchScore}%</span>
                  </div>
                  <Progress value={addOnAiScanResult.matchScore} className="h-2" />
                </div>
              </div>

              {addOnAiScanResult.summary && (
                <p className="text-xs text-muted-foreground bg-white/50 rounded p-2">
                  {addOnAiScanResult.summary}
                </p>
              )}

              <div className="text-xs text-muted-foreground mt-2 pt-2 border-t border-current/20">
                مستوى الثقة: {addOnAiScanResult.confidence}%
              </div>
            </div>
          )}

          <div className="text-sm text-muted-foreground">
            <p className="flex items-center justify-center gap-2">
              <Phone className="w-4 h-4" />للاستفسار: 0533220646
            </p>
          </div>
          <div className="flex flex-col gap-3">
            <Button onClick={() => { setAddOnPaymentSuccess(false); setSelectedAddOn(null); setAddOnStep(1); setAddOnAiScanResult(null); }} className="w-full bg-[#434040] hover:bg-[#333]">
              العودة لصفحة الاشتراك
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  if (subLoading) {
    return (
      <div className="min-h-screen bg-background p-6 flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block w-8 h-8 border-4 border-[#434040] border-t-transparent rounded-full animate-spin" />
          <p className="mt-4 text-muted-foreground">جاري التحميل...</p>
        </div>
      </div>
    );
  }

  // Success Screen
  if (paymentSuccess) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4" dir="rtl">
        <Card className="max-w-lg w-full p-8 text-center space-y-6">
          <div className="flex justify-center">
            <div className="w-20 h-20 rounded-full bg-amber-100 flex items-center justify-center">
              <Clock className="w-10 h-10 text-[#c9951d]" />
            </div>
          </div>
          <div>
            <h1 className="text-2xl font-bold text-[#434040] mb-2">تم استلام طلبك بنجاح!</h1>
            <p className="text-muted-foreground">
              {action === "upgrade" ? "طلب الترقية" : "طلب التمديد"} قيد المراجعة
            </p>
          </div>
          <div className="bg-muted/30 rounded-lg p-4 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground flex items-center gap-2">
                <Home className="w-4 h-4" />رقم العقار
              </span>
              <span className="font-bold text-lg">{property?.propertyNumber}</span>
            </div>
            {selectedPackage && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">الباقة</span>
                <Badge className="bg-[#c9951d] text-white">{selectedPackage.name}</Badge>
              </div>
            )}
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
              <div className="text-right">
                <p className="font-semibold text-amber-800 mb-1">قيد المراجعة</p>
                <p className="text-sm text-amber-700">
                  تم استلام إيصال الدفع. سيتم تفعيل الاشتراك بعد التحقق من التحويل البنكي خلال 24 ساعة.
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

          <div className="text-sm text-muted-foreground">
            <p className="flex items-center justify-center gap-2">
              <Phone className="w-4 h-4" />للاستفسار: 0533220646
            </p>
          </div>
          <div className="flex flex-col gap-3">
            <Button onClick={() => router.push("/owner/dashboard")} className="w-full bg-[#434040] hover:bg-[#333]">
              العودة للوحة التحكم
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-card border-b border-border shadow-sm">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.push("/owner/dashboard")}>
            <ChevronRight className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-[#434040]">إدارة الاشتراك</h1>
            <p className="text-sm text-muted-foreground">ترقية أو تمديد اشتراكك</p>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 py-8 space-y-6">

        {/* ===== بطاقة الباقة الحالية ===== */}
        <Card className={`p-6 border-2 ${cardColors.border} ${cardColors.bg}`}>
          <div className="flex items-center justify-between mb-5">
            <h2 className={`text-xl font-bold flex items-center gap-2 ${cardColors.text}`}>
              <Crown className="w-5 h-5 text-[#c9951d]" />
              الباقة الحالية
            </h2>
            <Badge className={`${statusInfo.bgColor} text-white px-3 py-1`}>
              {statusInfo.icon} {statusInfo.label}
            </Badge>
          </div>

          {/* اسم الباقة */}
          <div className="text-center mb-5 pb-4 border-b">
            <p className={`text-2xl font-bold ${cardColors.text}`}>{getPackageName(subscription?.packageId)}</p>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-5 text-sm">
            {/* الأيام المتبقية - كبير */}
            <div className="col-span-2 md:col-span-1 text-center p-4 rounded-xl bg-muted/40">
              <p className="text-muted-foreground text-xs mb-1">الأيام المتبقية</p>
              <p className={`text-5xl font-black ${isExpired ? "text-red-500" : isNearExpiry ? "text-amber-500" : "text-[#434040]"}`}>
                {isExpired ? "0" : remainingDays}
              </p>
              <p className="text-muted-foreground text-sm mt-1">{isExpired ? "منتهي" : "يوم"}</p>
            </div>

            {/* تفاصيل الاشتراك */}
            <div className="col-span-2 grid grid-cols-2 gap-4">
              <div className="flex items-start gap-2">
                <Banknote className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-muted-foreground text-xs">رسوم الاشتراك</p>
                  <PriceDisplay amount={currentPackageObj?.price || 0} size="lg" />
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Timer className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-muted-foreground text-xs">مدة الاشتراك</p>
                  <p className="font-bold text-muted-foreground">{subscriptionDuration || currentPackageObj?.duration || 30} يوم</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Calendar className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-muted-foreground text-xs">تاريخ البداية</p>
                  <p className="font-bold text-muted-foreground text-xs">{subscription?.startDate ? formatSubDate(subscription.startDate) : "—"}</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Calendar className="w-4 h-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-muted-foreground text-xs">تاريخ الانتهاء</p>
                  <p className="font-bold text-muted-foreground text-xs">{subscription?.endDate ? formatSubDate(subscription.endDate) : "—"}</p>
                </div>
              </div>
            </div>
          </div>

          {/* Progress bar */}
          {!isExpired && subscription?.startDate && subscription?.endDate && (
            <div className="mt-4">
              <div className="w-full bg-muted rounded-full h-2">
                <div
                  className={`h-2 rounded-full transition-all ${isNearExpiry ? "bg-amber-500" : "bg-[#434040]"}`}
                  style={{
                    width: `${Math.max(5, Math.min(100, (remainingDays / Math.max(1, subscriptionDuration)) * 100))}%`
                  }}
                />
              </div>
            </div>
          )}

          {/* ملاحظة التمديد */}
          {!canExtend && !isExpired && (
            <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-700 flex items-center gap-2">
              <Info className="w-4 h-4 flex-shrink-0" />
              يمكن التمديد عند بقاء 10 أيام أو أقل
            </div>
          )}

          {isNearExpiry && (
            <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
              <AlertTriangle className="w-4 h-4 inline ml-1" />
              اشتراكك ينتهي قريباً! قم بالتمديد للحفاظ على ظهور عقارك.
            </div>
          )}

          {isExpired && (
            <div className="mt-3 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              <AlertTriangle className="w-4 h-4 inline ml-1" />
              اشتراكك منتهي. قم بالتجديد لإعادة ظهور عقارك في المنصة.
            </div>
          )}

          {/* أزرار الترقية والتمديد */}
          <div className="flex gap-3 mt-5 pt-4 border-t">
            <Button
              className="flex-1 bg-violet-600 hover:bg-violet-700 gap-2 border-2 border-violet-600 shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 cursor-pointer"
              onClick={() => {
                setAction("upgrade");
                setShowUpgradeDialog(true);
              }}
            >
              <Zap className="w-4 h-4" />
              الترقية إلى باقة أفضل
            </Button>
            {canExtend && (
              <Button
                variant="outline"
                className="flex-1 gap-2 border-2 border-blue-400 shadow-sm hover:shadow-md hover:border-blue-500 hover:bg-blue-50 hover:text-blue-700 transition-all duration-200 cursor-pointer bg-white text-blue-700"
                onClick={() => {
                  setAction("extend");
                  setSelectedPackageId(subscription?.packageId || null);
                  setCurrentStep(2);
                  setShowUpgradeDialog(false);
                }}
              >
                <RefreshCcw className="w-4 h-4" />
                تمديد الاشتراك
              </Button>
            )}
          </div>
        </Card>

        {/* Pending Payment Notice */}
        {pendingPayment?.hasPending && (
          <Card className="p-4 border-amber-300 bg-amber-50">
            <div className="flex items-center gap-2 text-amber-700">
              <Clock className="w-5 h-5" />
              <div>
                <p className="font-semibold">
                  {pendingPayment.action === 'upgrade' && 'لديك طلب ترقية قيد المراجعة'}
                  {pendingPayment.action === 'extend' && 'لديك طلب تمديد قيد المراجعة'}
                  {pendingPayment.action === 'new' && 'لديك دفعة قيد المراجعة'}
                  {!pendingPayment.action && 'لديك دفعة قيد المراجعة'}
                </p>
                <p className="text-sm">
                  {pendingPayment.action === 'upgrade' && 'سيتم ترقية اشتراكك بعد مراجعة الإيصال'}
                  {pendingPayment.action === 'extend' && 'سيتم تمديد اشتراكك بعد مراجعة الإيصال'}
                  {(!pendingPayment.action || pendingPayment.action === 'new') && 'سيتم تفعيل اشتراكك بعد مراجعة الإيصال'}
                </p>
              </div>
            </div>
          </Card>
        )}

        {/* Rejected Payment Notice */}
        {pendingPayment && !pendingPayment.hasPending && pendingPayment.payment?.status === "مرفوض" && (
          <Card className="p-4 border-red-300 bg-red-50">
            <div className="flex items-center gap-2 text-red-700">
              <AlertTriangle className="w-5 h-5" />
              <div>
                <p className="font-semibold">تم رفض الدفعة السابقة</p>
                <p className="text-sm">يرجى إعادة التحويل ورفع إيصال صحيح</p>
              </div>
            </div>
          </Card>
        )}

        {/* ===== نافذة اختيار الباقة للترقية ===== */}
        {showUpgradeDialog && currentStep === 1 && (
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-[#434040]">اختر الباقة الجديدة</h2>
              <Button variant="ghost" size="icon" onClick={() => setShowUpgradeDialog(false)}>
                <X className="w-5 h-5" />
              </Button>
            </div>

            {/* تنبيه مهم - عند الترقية */}
            {!isExpired && remainingDays > 0 && action === "upgrade" && (
              <div className="mb-6 p-4 bg-amber-50 border-2 border-amber-300 rounded-xl">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
                  <div>
                    <p className="font-bold text-amber-800 mb-2">تنبيه مهم</p>
                    <p className="text-sm text-amber-700 mb-3">
                      لديك اشتراك متبقي فيه <span className="font-bold">{remainingDays}</span> يوم. الترقية ستؤدي إلى:
                    </p>
                    <ul className="space-y-1.5 text-sm text-amber-700">
                      <li className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />
                        تصفير العداد الحالي
                      </li>
                      <li className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />
                        بدء باقة جديدة بالكامل
                      </li>
                      <li className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 flex-shrink-0" />
                        الأيام المتبقية السابقة لن تُرحّل
                      </li>
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {/* الباقات المتاحة */}
            <h3 className="font-semibold text-muted-foreground text-sm mb-3">الباقات المتاحة</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
              {availablePackages.map((pkg: any) => {
                const isCurrentPkg = subscription?.packageId === pkg.id;
                const isDowngrade = action === "upgrade" && pkg.price < currentPkgPrice;
                const isSelected = selectedPackageId === pkg.id;
                const isMultiProperty = pkg.id?.includes("2propert") || pkg.id?.includes("2prop");

                return (
                  <div
                    key={pkg.id}
                    className={`p-5 rounded-xl border-2 transition-all ${isSelected
                      ? "ring-2 ring-[#434040] bg-[#434040]/5 border-[#434040]"
                      : isCurrentPkg
                        ? "border-[#c9951d]/40 bg-[#c9951d]/5"
                        : "border-border hover:border-[#434040]/50"
                      } ${isDowngrade ? "opacity-40 pointer-events-none" : "cursor-pointer"}`}
                    onClick={() => { 
                      if (!isDowngrade) {
                        setSelectedPackageId(pkg.id);
                      }
                    }}
                  >
                    {/* اسم الباقة والحالة */}
                    <div className="flex items-start justify-between mb-2">
                      <h3 className="font-bold text-[#434040]">{pkg.name}</h3>
                      <div className="flex flex-col items-end gap-1">
                        {isSelected && <Badge className="bg-[#434040] text-white text-[10px]">مختار</Badge>}
                        {isCurrentPkg && <Badge className="bg-[#c9951d] border-0 text-[10px] text-white">الحالي</Badge>}
                      </div>
                    </div>

                    {/* المدة */}
                    <p className="text-xs text-muted-foreground mb-3">{pkg.duration} يوم</p>

                    {/* السعر */}
                    <div className="flex items-end gap-1 mb-2">
                      <PriceDisplay amount={pkg.price} size="lg" />
                      {isMultiProperty && (
                        <span className="text-xs text-muted-foreground mb-1">/ عقار</span>
                      )}
                    </div>

                    {/* معلومات الباقة المتعددة */}
                    {isMultiProperty && (
                      <div className="text-xs space-y-1 mb-2">
                        <div className="text-muted-foreground">الإجمالي: <span className="font-bold text-[#434040]"><PriceDisplay amount={pkg.price * 2} size="sm" /></span> للعقارين</div>
                        <p className="text-muted-foreground">2 عقارات</p>
                      </div>
                    )}

                    {/* المميزات */}
                    {pkg.type === "مميز" && (
                      <Badge className="bg-[#c9951d] border-0 text-xs text-[#fbfaf9] mb-2">مميز</Badge>
                    )}
                    {pkg.features && pkg.features.length > 0 && (
                      <div className="space-y-1 mt-2">
                        {pkg.features.slice(0, 4).map((f: string, i: number) => (
                          <div key={i} className="text-xs flex items-start gap-2">
                            <span className="text-[#434040] font-bold mt-0.5">✓</span>
                            <span>{f}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    {isDowngrade && (
                      <p className="text-xs text-red-500 mt-2">لا يمكن الترقية لباقة أقل</p>
                    )}
                  </div>
                );
              })}
            </div>

            {/* أزرار المتابعة والإلغاء */}
            <div className="flex gap-3 pt-4 border-t">
              <Button
                variant="outline"
                onClick={() => {
                  setShowUpgradeDialog(false);
                  setSelectedPackageId(null);
                }}
                className="border-red-300 text-red-600 hover:bg-red-50"
              >
                إلغاء
              </Button>
              <Button
                onClick={() => {
                  if (selectedPackageId) setCurrentStep(2);
                }}
                disabled={!selectedPackageId}
                className="flex-1 bg-green-600 hover:bg-green-700"
              >
                متابعة للدفع
              </Button>
            </div>
          </Card>
        )}

        {/* Step 2: Payment Method */}
        {currentStep === 2 && selectedPackageId && (
          <Card className="p-8">
            <h2 className="text-xl font-bold text-[#434040] mb-6">
              {action === "upgrade" ? "ترقية الاشتراك" : "تمديد الاشتراك"} — طريقة الدفع
            </h2>
            <form onSubmit={handleSubmit} className="space-y-6">

              {/* Selected Package Summary */}
              {selectedPackage && (
                <div className="p-4 bg-muted/30 rounded-lg flex items-center justify-between">
                  <div>
                    <p className="text-sm text-muted-foreground">الباقة المختارة</p>
                    <p className="font-bold">{selectedPackage.name}</p>
                  </div>
                  <div className="text-left">
                    <PriceDisplay amount={selectedPackage.price} size="lg" />
                    <p className="text-xs text-muted-foreground">{selectedPackage.duration} يوم</p>
                  </div>
                </div>
              )}

              {/* Additional Properties Input for Multi-Property Packages */}
              {selectedPackage && ((selectedPackage as any).maxProperties > 1 || selectedPackage.propertyCount === 2 || selectedPackage.id === 'pkg-month-2properties') && (
                <div className="p-4 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                  <h4 className="font-bold text-blue-800 dark:text-blue-200 mb-3 flex items-center gap-2">
                    <Crown className="w-5 h-5" />
                    ربط عقارات إضافية
                  </h4>
                  <p className="text-sm text-blue-700 dark:text-blue-300 mb-4">
                    يمكنك ربط حتى {(selectedPackage as any).maxProperties || 2} عقار. السعر: 25 ريال لكل عقار إضافي.
                  </p>
                  
                  {/* Dynamic property list */}
                  {additionalProperties.map((prop, index) => (
                    <div key={index} className="flex gap-2 mb-3 items-start">
                      <div className="flex-1">
                        <div className="flex gap-2">
                          <Input
                            type="text"
                            placeholder={`رقم العقار الإضافي ${index + 1} (5 أرقام)`}
                            maxLength={5}
                            inputMode="numeric"
                            value={prop.number}
                            onChange={(e) => updateAdditionalPropertyNumber(index, e.target.value)}
                            className="flex-1"
                            disabled={prop.verified}
                          />
                          {!prop.verified ? (
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => verifyAdditionalProperty(index)}
                              disabled={prop.number.length !== 5 || prop.verifying || verifyingProperty !== null}
                              className="border-blue-400 text-blue-700 hover:bg-blue-50"
                            >
                              {prop.verifying ? "..." : "تحقق"}
                            </Button>
                          ) : (
                            <div className="flex items-center gap-1 text-green-600 px-2">
                              <CheckCircle2 className="w-4 h-4" />
                            </div>
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => removeAdditionalProperty(index)}
                            className="text-red-500 hover:text-red-700"
                          >
                            <X className="w-4 h-4" />
                          </Button>
                        </div>
                        {prop.error && (
                          <p className="text-sm text-red-600 mt-1">{prop.error}</p>
                        )}
                      </div>
                    </div>
                  ))}

                  {/* Add more properties button */}
                  {additionalProperties.filter(p => p.verified).length < ((selectedPackage as any).maxProperties || 2) - 1 && (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={addAdditionalProperty}
                      className="border-blue-400 text-blue-700 hover:bg-blue-50 w-full"
                    >
                      <Plus className="w-4 h-4 mr-2" />
                      إضافة عقار آخر
                    </Button>
                  )}

                  {/* Price summary */}
                  {additionalProperties.filter(p => p.verified).length > 0 && (
                    <div className="mt-4 p-3 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
                      <div className="flex justify-between items-center">
                        <span className="text-sm text-blue-800 dark:text-blue-200">
                          {1 + additionalProperties.filter(p => p.verified).length} عقار × {(selectedPackage as any).pricePerProperty || 25} ريال
                        </span>
                        <span className="font-bold text-blue-900 dark:text-blue-100">
                          {calculateTotalPrice()} ريال
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Payment Methods */}
              <div>
                <h3 className="text-lg font-bold mb-4">اختر طريقة الدفع</h3>
                <div className="space-y-3">
                  <div
                    onClick={() => setPaymentMethod("online")}
                    className={`p-4 border-2 rounded-lg cursor-pointer transition ${paymentMethod === "online" ? "border-[#434040] bg-[#434040]/5" : "border-border hover:border-[#434040]/50"}`}
                  >
                    <div className="font-semibold flex items-center gap-2">
                      <CreditCard className="w-5 h-5 text-[#434040]" />
                      الدفع الإلكتروني
                    </div>
                    <p className="text-sm text-muted-foreground">بطاقة ائتمان أو Apple Pay — تفعيل فوري</p>
                  </div>
                  <div
                    onClick={() => setPaymentMethod("bank")}
                    className={`p-4 border-2 rounded-lg cursor-pointer transition ${paymentMethod === "bank" ? "border-[#434040] bg-[#434040]/5" : "border-border hover:border-[#434040]/50"}`}
                  >
                    <div className="font-semibold">تحويل بنكي</div>
                    <p className="text-sm text-muted-foreground">مع تحميل إيصال التحويل — خلال 24 ساعة</p>
                  </div>
                </div>
              </div>

              {/* Discount Code */}
              <div className="p-4 bg-muted/30 rounded-lg">
                <label className="block text-sm font-semibold mb-2">كود خصم (اختياري)</label>
                <div className="flex gap-2">
                  <Input placeholder="أدخل كود الخصم" value={discountCode} onChange={(e) => setDiscountCode(e.target.value)} />
                  <Button type="button" variant="outline" onClick={validateDiscount} className="border-green-400 text-green-700 hover:bg-green-50">تحقق</Button>
                </div>
                {validatedDiscount && (
                  <p className="text-sm text-green-600 mt-2">✓ سيتم خصم {formatDiscount(validatedDiscount.value, validatedDiscount.type)}</p>
                )}
              </div>

              {/* Bank Receipt */}
              {paymentMethod === "bank" && (
                <div className="p-4 bg-muted/30 rounded-lg space-y-3">
                  <div className="p-5 bg-gradient-to-br from-blue-50 to-indigo-50 border-2 border-blue-300 rounded-xl space-y-3">
                    <div className="flex items-center gap-2 mb-3">
                      <CreditCard className="w-6 h-6 text-blue-700" />
                      <p className="font-bold text-lg text-blue-800">معلومات التحويل البنكي</p>
                    </div>
                    {bankAccount ? (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between p-3 bg-white/70 rounded-lg">
                          <span className="text-sm font-semibold text-blue-700">البنك</span>
                          <span className="text-base font-bold text-blue-900">{bankAccount.bankName}</span>
                        </div>
                        <div className="flex items-center justify-between p-3 bg-white/70 rounded-lg">
                          <span className="text-sm font-semibold text-blue-700">اسم المستفيد</span>
                          <span className="text-base font-bold text-blue-900">{bankAccount.beneficiaryName}</span>
                        </div>
                        <div className="flex items-center justify-between p-3 bg-white/70 rounded-lg">
                          <span className="text-sm font-semibold text-blue-700">IBAN</span>
                          <span className="text-base font-bold text-blue-900 tracking-wide font-mono" dir="ltr">{bankAccount.iban}</span>
                        </div>
                        {bankAccount.accountNumber && (
                          <div className="flex items-center justify-between p-3 bg-white/70 rounded-lg">
                            <span className="text-sm font-semibold text-blue-700">رقم الحساب</span>
                            <span className="text-base font-bold text-blue-900 font-mono" dir="ltr">{bankAccount.accountNumber}</span>
                          </div>
                        )}
                        {bankAccount.barcodeUrl && (
                          <div className="mt-4 p-3 bg-white/70 rounded-lg text-center">
                            <p className="text-sm font-semibold text-blue-700 mb-2">باركود الحساب البنكي</p>
                            <img src={bankAccount.barcodeUrl} alt="باركود الحساب البنكي" className="max-w-[200px] mx-auto rounded-lg" />
                          </div>
                        )}
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
                    ) : (
                      <p className="text-blue-600 text-center py-4">جاري تحميل بيانات الحساب...</p>
                    )}
                    <div className="mt-3 p-3 bg-amber-50 border border-amber-300 rounded-lg space-y-2">
                      <p className="text-sm font-semibold text-amber-800">⚠ يرجى كتابة المعلومات التالية في ملاحظات التحويل:</p>
                      <ul className="text-sm text-amber-700 space-y-1">
                        <li>• الرمز المرجعي: <span className="font-mono font-bold">RWQN-MRQDHB</span></li>
                        <li>• رقم العقار</li>
                      </ul>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold mb-2">إيصال التحويل</label>
                    <input
                      ref={receiptInputRef}
                      type="file"
                      accept="image/*,application/pdf"
                      onChange={(e) => setReceiptFile(e.target.files?.[0] || null)}
                      className="hidden"
                    />
                    <Button type="button" variant="outline" onClick={() => receiptInputRef.current?.click()} className="w-full gap-2 border-blue-400 text-blue-700 hover:bg-blue-50">
                      <Upload className="w-4 h-4" />
                      {receiptFile ? receiptFile.name : "اختر صورة الإيصال"}
                    </Button>
                  </div>
                </div>
              )}

              {/* Submit */}
              <div className="flex gap-3 pt-6 border-t">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setCurrentStep(1);
                    if (action === "upgrade") setShowUpgradeDialog(true);
                  }}
                  className="gap-2"
                >
                  <ChevronRight className="w-4 h-4" />
                  رجوع
                </Button>
                <Button
                  type="submit"
                  disabled={!paymentMethod || cardPaymentMutation.isPending || bankTransferMutation.isPending || (paymentMethod === "bank" && !receiptFile)}
                  className="flex-1 bg-[#434040] hover:bg-[#333]"
                >
                  {cardPaymentMutation.isPending || bankTransferMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin ml-2" />
                      جاري المعالجة...
                    </>
                  ) : action === "upgrade" ? "متابعة للدفع" : "متابعة للدفع"
                  }
                </Button>
              </div>
            </form>
          </Card>
        )}

        {/* ===== Add-on Payment Flow (Step 1 & 2) ===== */}
        {selectedAddOn && (
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-[#434040]">شراء إضافة - {selectedAddOn.name}</h2>
              <Button variant="ghost" size="icon" onClick={() => { setSelectedAddOn(null); setAddOnStep(1); }}>
                <X className="w-5 h-5" />
              </Button>
            </div>

            {/* Add-on Summary */}
            <div className="p-4 bg-muted/30 rounded-lg flex items-center justify-between mb-6">
              <div>
                <p className="text-sm text-muted-foreground">الإضافة</p>
                <p className="font-bold">{selectedAddOn.name}</p>
                {selectedAddOn.category && (
                  <Badge className={`${getCategoryColor(selectedAddOn.category)} text-white text-xs mt-1`}>
                    {selectedAddOn.category}
                  </Badge>
                )}
              </div>
              <div className="text-left">
                <PriceDisplay amount={selectedAddOn.price} size="lg" />
                <p className="text-xs text-muted-foreground">{selectedAddOn.duration} يوم</p>
              </div>
            </div>

            {/* Step 2: Payment Method */}
            <div>
              <h3 className="text-lg font-bold mb-4">اختر طريقة الدفع</h3>
              <div className="space-y-3">
                <div
                  onClick={() => { setAddOnPaymentMethod("online"); setAddOnStep(2); }}
                  className={`p-4 border-2 rounded-lg cursor-pointer transition ${addOnStep === 2 && addOnPaymentMethod === "online" ? "border-[#434040] bg-[#434040]/5" : "border-border hover:border-[#434040]/50"}`}
                >
                  <div className="font-semibold flex items-center gap-2">
                    <CreditCard className="w-5 h-5 text-[#434040]" />
                    الدفع الإلكتروني
                  </div>
                  <p className="text-sm text-muted-foreground">بطاقة ائتمان أو Apple Pay — تفعيل فوري</p>
                </div>
                <div
                  onClick={() => { setAddOnPaymentMethod("bank"); setAddOnStep(2); }}
                  className={`p-4 border-2 rounded-lg cursor-pointer transition ${addOnStep === 2 && addOnPaymentMethod === "bank" ? "border-[#434040] bg-[#434040]/5" : "border-border hover:border-[#434040]/50"}`}
                >
                  <div className="font-semibold">تحويل بنكي</div>
                  <p className="text-sm text-muted-foreground">مع تحميل إيصال التحويل — خلال 24 ساعة</p>
                </div>
              </div>
            </div>

            {/* Bank Transfer Details */}
            {addOnPaymentMethod === "bank" && (
              <div className="mt-4 p-4 bg-muted/30 rounded-lg space-y-3">
                <div className="p-5 bg-gradient-to-br from-blue-50 to-indigo-50 border-2 border-blue-300 rounded-xl space-y-3">
                  <div className="flex items-center gap-2 mb-3">
                    <CreditCard className="w-6 h-6 text-blue-700" />
                    <p className="font-bold text-lg text-blue-800">معلومات التحويل البنكي</p>
                  </div>
                  {bankAccount ? (
                    <div className="space-y-3">
                      <div className="flex items-center justify-between p-3 bg-white/70 rounded-lg">
                        <span className="text-sm font-semibold text-blue-700">البنك</span>
                        <span className="text-base font-bold text-blue-900">{bankAccount.bankName}</span>
                      </div>
                      <div className="flex items-center justify-between p-3 bg-white/70 rounded-lg">
                        <span className="text-sm font-semibold text-blue-700">اسم المستفيد</span>
                        <span className="text-base font-bold text-blue-900">{bankAccount.beneficiaryName}</span>
                      </div>
                      <div className="flex items-center justify-between p-3 bg-white/70 rounded-lg">
                        <span className="text-sm font-semibold text-blue-700">IBAN</span>
                        <span className="text-base font-bold text-blue-900 tracking-wide font-mono" dir="ltr">{bankAccount.iban}</span>
                      </div>
                      {bankAccount.accountNumber && (
                        <div className="flex items-center justify-between p-3 bg-white/70 rounded-lg">
                          <span className="text-sm font-semibold text-blue-700">رقم الحساب</span>
                          <span className="text-base font-bold text-blue-900 font-mono" dir="ltr">{bankAccount.accountNumber}</span>
                        </div>
                      )}
                      {bankAccount.barcodeUrl && (
                        <div className="mt-4 p-3 bg-white/70 rounded-lg text-center">
                          <p className="text-sm font-semibold text-blue-700 mb-2">باركود الحساب البنكي</p>
                          <img src={bankAccount.barcodeUrl} alt="باركود الحساب البنكي" className="max-w-[200px] mx-auto rounded-lg" />
                        </div>
                      )}
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
                  ) : (
                    <p className="text-blue-600 text-center py-4">جاري تحميل بيانات الحساب...</p>
                  )}
                  <div className="mt-3 p-3 bg-amber-50 border border-amber-300 rounded-lg space-y-2">
                    <p className="text-sm font-semibold text-amber-800">⚠ يرجى كتابة المعلومات التالية في ملاحظات التحويل:</p>
                    <ul className="text-sm text-amber-700 space-y-1">
                      <li>• الرمز المرجعي: <span className="font-mono font-bold">RWQN-MRQDHB</span></li>
                      <li>• رقم العقار</li>
                    </ul>
                  </div>
                </div>
                
                {/* Receipt Upload */}
                <div>
                  <label className="block text-sm font-semibold mb-2">إيصال التحويل</label>
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    onChange={(e) => setAddOnReceiptFile(e.target.files?.[0] || null)}
                    className="hidden"
                    id="add-on-receipt"
                  />
                  <Button 
                    type="button" 
                    variant="outline" 
                    onClick={() => document.getElementById('add-on-receipt')?.click()}
                    className="w-full gap-2 border-blue-400 text-blue-700 hover:bg-blue-50"
                  >
                    <Upload className="w-4 h-4" />
                    {addOnReceiptFile ? addOnReceiptFile.name : "اختر صورة الإيصال"}
                  </Button>
                </div>
              </div>
            )}

            {/* Submit Buttons */}
            <div className="flex gap-3 pt-6 border-t mt-6">
              <Button
                type="button"
                variant="outline"
                onClick={() => { setSelectedAddOn(null); setAddOnStep(1); }}
                className="gap-2"
              >
                <ChevronRight className="w-4 h-4" />
                رجوع
              </Button>
              <Button
                type="button"
                disabled={!addOnPaymentMethod || addonOnlinePaymentMutation.isPending || addonBankTransferMutation.isPending || (addOnPaymentMethod === "bank" && !addOnReceiptFile)}
                onClick={handleAddOnSubmit}
                className="flex-1 bg-[#434040] hover:bg-[#333]"
              >
                {(addonOnlinePaymentMutation.isPending || addonBankTransferMutation.isPending) ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin ml-2" />
                    جاري المعالجة...
                  </>
                ) : addOnPaymentMethod === "online" ? "دفع إلكتروني" : "تأكيد التحويل"}
              </Button>
            </div>
          </Card>
        )}

        {/* Add-ons Section */}
        {addOnPackages && addOnPackages.length > 0 && (
          <Card className="p-6">
            <h2 className="text-xl font-bold text-[#434040] mb-4 flex items-center gap-2">
              <Star className="w-5 h-5 text-[#c9951d]" />
              الإضافات
            </h2>

            {/* Active Add-ons */}
            {propertyAddons && propertyAddons.filter((a: any) => a.status === "active").length > 0 && (
              <div className="mb-4">
                <h3 className="text-sm font-semibold text-muted-foreground mb-2">إضافاتك النشطة</h3>
                <div className="space-y-2">
                  {propertyAddons.filter((a: any) => a.status === "active").map((addon: any) => {
                    const pkg = addOnPackages.find((p: any) => p.id === addon.addOnPackageId);
                    return (
                      <div key={addon.id} className="flex items-center justify-between p-3 rounded-lg border border-emerald-300 bg-emerald-50/50">
                        <div className="flex items-center gap-2">
                          <Badge className={`${getCategoryColor(pkg?.category || "")} text-white text-xs`}>
                            {pkg?.category || "إضافة"}
                          </Badge>
                          <span className="font-semibold text-sm">{pkg?.name || addon.addOnPackageId}</span>
                        </div>
                        {addon.endDate && (
                          <span className="text-xs text-muted-foreground">
                            حتى {new Date(addon.endDate).toLocaleDateString("ar-SA")}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Available Add-ons */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {addOnPackages.filter((p: any) => p.isActive).map((pkg: any) => {
                const alreadyActive = propertyAddons?.some(
                  (a: any) => a.addOnPackageId === pkg.id && a.status === "active"
                );
                return (
                  <div
                    key={pkg.id}
                    className={`p-4 rounded-lg border-2 transition-all ${alreadyActive
                      ? "border-emerald-300 bg-emerald-50/30"
                      : "border-border hover:border-[#434040]/50"
                      }`}
                  >
                    <div className="flex items-start justify-between mb-2">
                      <div>
                        <Badge className={`${getCategoryColor(pkg.category)} text-white text-xs mb-1`}>
                          {pkg.category}
                        </Badge>
                        <h4 className="font-semibold">{pkg.name}</h4>
                        {pkg.description && (
                          <p className="text-xs text-muted-foreground">{pkg.description}</p>
                        )}
                      </div>
                      <PriceDisplay amount={pkg.price} size="sm" />
                    </div>
                    {alreadyActive ? (
                      <Badge className="bg-[#434040] text-white text-xs">
                        <Check className="w-3 h-3 ml-1" />مفعّل
                      </Badge>
                    ) : (
                      <Button
                        size="sm"
                        className="w-full mt-2 bg-orange-500 hover:bg-orange-600 border-2 border-orange-500 shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all duration-200 cursor-pointer"
                        disabled={addonPaymentMutation.isPending}
                        onClick={() => {
                          setSelectedAddOn(pkg);
                          setAddOnStep(1);
                          setAddOnPaymentMethod(null);
                          setAddOnReceiptFile(null);
                        }}
                      >
                        شراء الإضافة
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        )}


      </div>
    </div>
  );
}
