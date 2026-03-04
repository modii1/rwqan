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
import {
  Crown, CreditCard, Check, ChevronRight, Clock, Home,
  Star, Zap, Upload, AlertTriangle, RefreshCcw, CheckCircle2, Phone, ArrowLeft,
} from "lucide-react";

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

  // Payment history
  const { data: payments } = useQuery<any[]>({
    queryKey: ["/api/owner/payments"],
  });

  // Check pending payment
  const { data: pendingPayment } = useQuery<any>({
    queryKey: ["/api/owner/payment/check-pending"],
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

  // Initiate card payment
  const cardPaymentMutation = useMutation({
    mutationFn: async (data: { packageId: string; action: string; discountCode?: string }) => {
      const res = await fetch("/api/owner/payment/initiate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          propertyNumber: property?.propertyNumber,
          packageId: data.packageId,
          action: data.action,
          paymentMethod: "cards",
          discountCode: data.discountCode || "",
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
      if (data.checkoutUrl) {
        window.location.href = data.checkoutUrl;
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
      queryClient.invalidateQueries({ queryKey: ["/api/owner/payments"] });
      queryClient.invalidateQueries({ queryKey: ["/api/owner/payment/check-pending"] });
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

  // Calculate remaining days
  const getRemainingDays = () => {
    if (!subscription?.endDate) return 0;
    const end = new Date(subscription.endDate);
    const now = new Date();
    const diff = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
    return Math.max(0, diff);
  };

  const remainingDays = getRemainingDays();
  const isExpired = remainingDays <= 0;
  const isNearExpiry = remainingDays > 0 && remainingDays <= 7;

  // Filter packages - show upgradable ones
  const availablePackages = packages.filter((pkg: any) => {
    if (!pkg.isActive) return false;
    if (pkg.price === 0) return false;
    return true;
  });

  const currentPkgPrice = (() => {
    if (!subscription?.packageId || !packages) return 0;
    const cur = packages.find((p: any) => p.id === subscription.packageId);
    return cur?.price || 0;
  })();

  const getCategoryColor = (cat: string) => {
    switch (cat) {
      case "اعلان": return "bg-amber-500";
      case "ابراز": return "bg-purple-500";
      case "تثبيت": return "bg-blue-500";
      case "توثيق": return "bg-emerald-500";
      default: return "bg-slate-500";
    }
  };

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

        {/* Current Subscription Status Card */}
        <Card className="p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-[#434040] flex items-center gap-2">
              <Crown className="w-5 h-5 text-[#c9951d]" />
              الاشتراك الحالي
            </h2>
            {(() => {
              const status = subscription?.status;
              if (status === "نشط" || status === "ساري" || status === "active")
                return <Badge className="bg-[#434040] text-white"><Check className="w-3 h-3 ml-1" />نشط</Badge>;
              if (status === "نشط مجاني")
                return <Badge className="bg-[#c9951d] text-white"><Star className="w-3 h-3 ml-1" />مجاني</Badge>;
              if (status === "منتهي" || status === "expired")
                return <Badge variant="destructive"><AlertTriangle className="w-3 h-3 ml-1" />منتهي</Badge>;
              return <Badge variant="secondary">{status}</Badge>;
            })()}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">العقار</p>
              <p className="font-semibold">{property?.name || property?.propertyNumber}</p>
            </div>
            <div>
              <p className="text-muted-foreground">نوع الاشتراك</p>
              <p className="font-semibold">{subscription?.packageType || subscription?.subscriptionType || "مجاني"}</p>
            </div>
            <div>
              <p className="text-muted-foreground">تاريخ الانتهاء</p>
              <p className="font-semibold">
                {subscription?.endDate ? new Date(subscription.endDate).toLocaleDateString("ar-SA") : "—"}
              </p>
            </div>
            <div>
              <p className="text-muted-foreground">الأيام المتبقية</p>
              <p className={`font-bold text-lg ${isExpired ? "text-red-500" : isNearExpiry ? "text-amber-500" : "text-[#434040]"}`}>
                {isExpired ? "منتهي" : `${remainingDays} يوم`}
              </p>
            </div>
          </div>

          {!isExpired && subscription?.startDate && subscription?.endDate && (
            <div className="mt-4">
              <div className="w-full bg-muted rounded-full h-2">
                <div
                  className={`h-2 rounded-full transition-all ${isNearExpiry ? "bg-amber-500" : "bg-[#434040]"}`}
                  style={{
                    width: `${Math.max(5, Math.min(100, (remainingDays / Math.max(1, Math.ceil((new Date(subscription.endDate).getTime() - new Date(subscription.startDate).getTime()) / 86400000))) * 100))}%`
                  }}
                />
              </div>
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
        </Card>

        {/* Pending Payment Notice */}
        {pendingPayment && (
          <Card className="p-4 border-amber-300 bg-amber-50">
            <div className="flex items-center gap-2 text-amber-700">
              <Clock className="w-5 h-5" />
              <div>
                <p className="font-semibold">لديك دفعة قيد المراجعة</p>
                <p className="text-sm">سيتم تفعيل اشتراكك بعد مراجعة الإيصال</p>
              </div>
            </div>
          </Card>
        )}

        {/* Step Progress */}
        <div className="mb-2">
          <div className="flex items-center justify-between gap-2 mb-4">
            <div className="flex flex-col items-center flex-1">
              <div className={`w-10 h-10 rounded-full font-bold flex items-center justify-center text-white transition ${currentStep >= 1 ? "bg-[#434040]" : "bg-muted"}`}>
                {currentStep > 1 ? "✓" : "1"}
              </div>
              <p className="text-xs mt-2 text-center font-semibold">اختيار الباقة</p>
            </div>
            <div className={`flex-1 h-1 ${currentStep >= 2 ? "bg-[#434040]" : "bg-muted"}`} />
            <div className="flex flex-col items-center flex-1">
              <div className={`w-10 h-10 rounded-full font-bold flex items-center justify-center text-white transition ${currentStep >= 2 ? "bg-[#434040]" : "bg-muted"}`}>
                2
              </div>
              <p className="text-xs mt-2 text-center font-semibold">طريقة الدفع</p>
            </div>
          </div>
        </div>

        {/* Step 1: Action + Package Selection */}
        {currentStep === 1 && (
          <Card className="p-8">
            <h2 className="text-xl font-bold text-[#434040] mb-6">الخطوة 1: اختر نوع العملية والباقة</h2>

            {/* Action Toggle */}
            <div className="flex gap-3 mb-6">
              <div
                onClick={() => setAction("upgrade")}
                className={`flex-1 p-4 border-2 rounded-lg cursor-pointer text-center transition ${action === "upgrade" ? "border-[#434040] bg-[#434040]/5" : "border-border hover:border-[#434040]/50"}`}
              >
                <Zap className="w-6 h-6 mx-auto mb-2 text-[#434040]" />
                <div className="font-semibold">ترقية</div>
                <p className="text-xs text-muted-foreground">الانتقال إلى باقة أفضل</p>
              </div>
              <div
                onClick={() => setAction("extend")}
                className={`flex-1 p-4 border-2 rounded-lg cursor-pointer text-center transition ${action === "extend" ? "border-[#434040] bg-[#434040]/5" : "border-border hover:border-[#434040]/50"}`}
              >
                <RefreshCcw className="w-6 h-6 mx-auto mb-2 text-[#434040]" />
                <div className="font-semibold">تمديد</div>
                <p className="text-xs text-muted-foreground">تمديد فترة الاشتراك الحالي</p>
              </div>
            </div>

            {/* Package Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
              {availablePackages.map((pkg: any) => {
                const isCurrentPkg = subscription?.packageId === pkg.id;
                const isDowngrade = action === "upgrade" && pkg.price < currentPkgPrice;
                const isSelected = selectedPackageId === pkg.id;

                return (
                  <div
                    key={pkg.id}
                    className={`p-5 rounded-lg border-2 transition-all ${isSelected
                      ? "ring-2 ring-[#434040] bg-[#434040]/5 border-[#434040]"
                      : isCurrentPkg
                        ? "border-[#c9951d]/40 bg-[#c9951d]/5"
                        : "border-border hover:border-[#434040]/50"
                      } ${isDowngrade ? "opacity-40 pointer-events-none" : "cursor-pointer"}`}
                    onClick={() => { if (!isDowngrade) setSelectedPackageId(pkg.id); }}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <h3 className="font-bold">{pkg.name}</h3>
                        <PriceDisplay amount={pkg.price} size="lg" />
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        {isSelected && <Badge className="bg-[#434040] text-white">مختار</Badge>}
                        {isCurrentPkg && <Badge className="bg-[#c9951d] border-0 text-xs text-white">الحالي</Badge>}
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mb-3">{pkg.duration} يوم</p>
                    {pkg.type === "مميز" && (
                      <Badge className="bg-[#c9951d] border-0 text-xs text-[#fbfaf9] mb-3">مميز</Badge>
                    )}
                    {pkg.features && pkg.features.length > 0 && (
                      <div className="space-y-1 mt-2">
                        {pkg.features.slice(0, 4).map((f: string, i: number) => (
                          <div key={i} className="text-sm flex items-start gap-2">
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

            <div className="flex justify-end pt-6 border-t">
              <Button
                onClick={() => setCurrentStep(2)}
                disabled={!selectedPackageId}
                className="flex-1 md:flex-none bg-[#434040] hover:bg-[#333]"
              >
                التالي: طريقة الدفع
              </Button>
            </div>
          </Card>
        )}

        {/* Step 2: Payment Method */}
        {currentStep === 2 && selectedPackageId && (
          <Card className="p-8">
            <h2 className="text-xl font-bold text-[#434040] mb-6">الخطوة 2: طريقة الدفع</h2>
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
                  <Button type="button" variant="outline" onClick={validateDiscount}>تحقق</Button>
                </div>
                {validatedDiscount && (
                  <p className="text-sm text-green-600 mt-2">✓ سيتم خصم {formatDiscount(validatedDiscount.value, validatedDiscount.type)}</p>
                )}
              </div>

              {/* Bank Receipt */}
              {paymentMethod === "bank" && (
                <div className="p-4 bg-muted/30 rounded-lg space-y-3">
                  <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm">
                    <p className="font-semibold text-blue-700 mb-1">معلومات التحويل:</p>
                    <p className="text-blue-600">البنك: الراجحي</p>
                    <p className="text-blue-600">* يرجى كتابة رقم العقار في ملاحظات التحويل</p>
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
                    <Button type="button" variant="outline" onClick={() => receiptInputRef.current?.click()} className="w-full gap-2">
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
                  onClick={() => setCurrentStep(1)}
                  className="gap-2"
                >
                  <ChevronRight className="w-4 h-4" />
                  السابق
                </Button>
                <Button
                  type="submit"
                  disabled={!paymentMethod || cardPaymentMutation.isPending || bankTransferMutation.isPending || (paymentMethod === "bank" && !receiptFile)}
                  className="flex-1 bg-[#434040] hover:bg-[#333]"
                >
                  {cardPaymentMutation.isPending || bankTransferMutation.isPending
                    ? "جاري المعالجة..."
                    : action === "upgrade" ? "ترقية الاشتراك" : "تمديد الاشتراك"
                  }
                </Button>
              </div>
            </form>
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
                        className="w-full mt-2 bg-[#434040] hover:bg-[#333]"
                        disabled={addonPaymentMutation.isPending}
                        onClick={() => addonPaymentMutation.mutate(pkg.id)}
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

        {/* Payment History */}
        {payments && payments.length > 0 && (
          <Card className="p-6">
            <h2 className="text-xl font-bold text-[#434040] mb-4 flex items-center gap-2">
              <Clock className="w-5 h-5" />
              سجل المدفوعات
            </h2>
            <div className="space-y-3">
              {payments.slice(0, 5).map((payment: any) => (
                <div key={payment.id} className="flex items-center justify-between p-3 rounded-lg border">
                  <div>
                    <p className="font-semibold text-sm">{payment.packageId}</p>
                    <p className="text-xs text-muted-foreground">{payment.paymentMethod}</p>
                  </div>
                  <div className="text-left">
                    <p className="font-bold text-sm">{payment.finalAmount} ر.س</p>
                    <Badge
                      className={`text-xs ${payment.status === "مكتمل"
                        ? "bg-[#434040] text-white"
                        : payment.status === "قيد التحقق" || payment.status === "قيد المراجعة"
                          ? "bg-amber-100 text-amber-800 border-amber-300"
                          : "bg-red-100 text-red-800 border-red-300"
                        }`}
                    >
                      {payment.status}
                    </Badge>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
