import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Property, Package, Subscription } from "@shared/schema";
import { CalendarDays, Crown, TrendingUp, Check, ExternalLink, Upload } from "lucide-react";

export default function OwnerSubscriptionPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedAction, setSelectedAction] = useState<'extend' | 'upgrade' | null>(null);
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null);
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<'online' | 'bank' | null>(null);
  const [paymentInfo, setPaymentInfo] = useState<any>(null);
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);

  // جلب بيانات المالك
  const { data: property } = useQuery<Property>({
    queryKey: ["/api/owner/property"],
  });

  // جلب الاشتراك الحالي
  const { data: currentSubscription } = useQuery<Subscription>({
    queryKey: ["/api/owner/current-subscription"],
  });

  // جلب جميع الباقات
  const { data: packages = [] } = useQuery<Package[]>({
    queryKey: ["/api/packages"],
  });

  // جلب الباقة الحالية
  const currentPackage = packages.find(p => p.id === currentSubscription?.packageId);

  // حساب الأيام المتبقية
  const daysRemaining = currentSubscription
    ? Math.ceil((new Date(currentSubscription.endDate).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  // حساب مدة الاشتراك من البيانات
  const subscriptionDuration = currentSubscription && currentSubscription.startDate && currentSubscription.endDate
    ? Math.ceil((new Date(currentSubscription.endDate).getTime() - new Date(currentSubscription.startDate).getTime()) / (1000 * 60 * 60 * 24))
    : 0;

  const isSubscriptionActive = daysRemaining > 0;
  // هل يمكن التمديد؟
  const canExtend = daysRemaining <= 10;


  // تحضير معلومات الدفع
  const prepareMutation = useMutation({
    mutationFn: async ({ action, packageId }: { action: 'extend' | 'upgrade'; packageId: string }) => {
      const response = await apiRequest('POST', '/api/owner/subscription/prepare-payment', {
        action,
        packageId,
      });
      return response.json();
    },
    onSuccess: (data) => {
      setPaymentInfo(data);
    },
    onError: (error: any) => {
      toast({
        title: "❌ خطأ",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // تأكيد الدفع والاشتراك
  const confirmMutation = useMutation({
    mutationFn: async ({ paymentId }: { paymentId: string }) => {
      const response = await apiRequest('POST', '/api/owner/subscription/confirm', {
        action: paymentInfo?.action,
        packageId: paymentInfo?.packageId,
        paymentId,
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/owner/current-subscription"] });
      toast({
        title: "✅ تم بنجاح",
        description: `تم ${paymentInfo?.action === 'extend' ? 'التمديد' : 'الترقية'} بنجاح وتم استقطاع المبلغ`,
      });
      setSelectedAction(null);
      setPaymentInfo(null);
      setSelectedPackageId(null);
      setSelectedPaymentMethod(null);
    },
    onError: (error: any) => {
      toast({
        title: "❌ خطأ",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  if (!property || !currentSubscription) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="p-8 text-center">
          <div className="inline-block w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mb-4"></div>
          <p className="text-lg font-semibold text-foreground">جاري تحميل البيانات...</p>
          <p className="text-sm text-muted-foreground mt-2">يرجى الانتظار قليلاً</p>
        </Card>
      </div>
    );
  }

  const availablePackages = packages.filter(p => {
  if (selectedAction === 'upgrade') {
    // الترقية: فقط باقات أعلى سعراً
    return p.price > (currentPackage?.price || 0);
  }

  if (selectedAction === 'extend') {
    // التمديد: ممنوع عرض الباقة المجانية
    return p.price > 0;
  }

  return true;
});


  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <header className="mb-8 flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-[#434040] mb-2">إدارة الاشتراك</h1>
            <p className="text-muted-foreground">عقار: {property.name} ({property.propertyNumber})</p>
          </div>
          <Button
            onClick={() => setLocation("/owner/subscription")}
            variant="outline"
            className="flex items-center gap-2"
            data-testid="button-view-all-packages"
          >
            <span>اشترك معنا</span>
            <ExternalLink className="w-4 h-4" />
          </Button>
        </header>

        {/* الاشتراك الحالي */}
        <Card className={`mb-8 p-6 border-2 transition-all ${
          currentPackage?.type === 'مميز' && isSubscriptionActive
            ? 'border-green-500 bg-gradient-to-r from-green-50 to-background dark:from-green-950/20'
            : 'border-[#e0c97b] bg-gradient-to-r from-[#fffdf0] to-background'
        }`}>
          <div className="flex items-start justify-between mb-6">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Crown className="w-5 h-5 text-[#b88d2b]" />
                <h2 className="text-2xl font-bold text-[#434040]">الباقة الحالية</h2>
              </div>
              <p className="text-lg font-semibold text-[#b88d2b]">{currentPackage?.name || 'بدون اشتراك'}</p>
            </div>
            <div className="flex gap-2 items-center">
              {currentPackage?.type === 'مميز' && isSubscriptionActive && (
                <Badge className="bg-green-500 text-white animate-pulse">
                  ✓ مفعلة
                </Badge>
              )}
              <Badge className={isSubscriptionActive ? "bg-green-500" : "bg-red-500"}>
                {isSubscriptionActive ? '✓ نشط' : '✗ منتهي'}
              </Badge>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div>
              <p className="text-sm text-muted-foreground">السعر الشهري</p>
              <p className="text-2xl font-bold text-[#434040]">{(currentSubscription as any)?.price || currentPackage?.price || 0} ر.س</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">المدة</p>
              <p className="text-2xl font-bold text-[#434040]">{subscriptionDuration || currentPackage?.duration || 0} يوم</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">الأيام المتبقية</p>
              <p className={`text-2xl font-bold ${daysRemaining > 0 ? 'text-green-600' : 'text-red-600'}`}>
                {Math.max(0, daysRemaining)} يوم
              </p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">انتهاء الاشتراك</p>
              <p className="text-lg font-bold text-[#434040]">
                {new Date(currentSubscription.endDate).toLocaleDateString('en-US')}
              </p>
            </div>
          </div>

         {/* أزرار الإجراءات */}
<div className="flex gap-3 flex-wrap">

  {/* زر التمديد بشرط ≤ 10 أيام */}
  {daysRemaining <= 10 ? (
    <Button
      onClick={() => setSelectedAction('extend')}
      variant={selectedAction === 'extend' ? 'default' : 'outline'}
      className="flex-1 md:flex-initial"
    >
      <CalendarDays className="w-4 h-4 ml-2" />
      تمديد الاشتراك
    </Button>
  ) : (
    <div className="flex-1 text-center text-red-600 font-semibold py-2">
      يمكن تمديد الاشتراك فقط عندما يتبقى 10 أيام أو أقل
    </div>
  )}

  {/* زر الترقية — بدون تعديل */}
  <Button
    onClick={() => setSelectedAction('upgrade')}
    variant={selectedAction === 'upgrade' ? 'default' : 'outline'}
    className="flex-1 md:flex-initial"
  >
    <TrendingUp className="w-4 h-4 ml-2" />
    الترقية إلى باقة أفضل
  </Button>

</div>

        </Card>

        {/* اختيار الباقة */}
        {selectedAction && (
          <Card className="mb-8 p-6">
            <h3 className="text-xl font-bold mb-6">
              {selectedAction === 'extend' ? 'اختر مدة التمديد' : 'اختر الباقة الجديدة'}
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              {availablePackages.map(pkg => (
                <div
                  key={pkg.id}
                  onClick={() => setSelectedPackageId(pkg.id)}
                  className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                    selectedPackageId === pkg.id
                      ? 'border-[#b88d2b] bg-[#fffdf0]'
                      : 'border-border hover:border-[#b88d2b]'
                  }`}
                >
                  <div className="flex justify-between items-start mb-2">
                    <h4 className="font-bold text-[#434040]">{pkg.name}</h4>
                    {selectedPackageId === pkg.id && (
                      <Check className="w-5 h-5 text-[#b88d2b]" />
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mb-3">{pkg.duration} يوم</p>
                  <p className="text-2xl font-bold text-[#b88d2b]">{pkg.price} ر.س</p>
                </div>
              ))}
            </div>

            <div className="flex gap-3">
              <Button
  onClick={() => {

    // ❌ منع التمديد إذا المتبقي أكثر من 10 أيام
    if (selectedAction === "extend" && daysRemaining > 10) {
      toast({
        title: "لا يمكن التمديد",
        description: "يمكن تمديد الاشتراك فقط عندما يتبقى 10 أيام أو أقل.",
        variant: "destructive",
      });
      return;
    }

    if (selectedPackageId && selectedAction) {
      prepareMutation.mutate({ 
        action: selectedAction, 
        packageId: selectedPackageId 
      });
    }
  }}
  disabled={!selectedPackageId || prepareMutation.isPending}
  className="flex-1"
>
  {prepareMutation.isPending ? 'جاري التحضير...' : 'متابعة للدفع'}
</Button>
<Button
                onClick={() => setSelectedAction(null)}
                variant="outline"
                className="flex-1"
              >
                إلغاء
              </Button>
            </div>
          </Card>
        )}

        {/* نموذج الدفع */}
        {paymentInfo && (
          <Card className="mb-8 p-6 border-[#b88d2b] bg-[#fffdf0]">
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
              <div className="space-y-3">
                <div
                  onClick={() => { setSelectedPaymentMethod('online'); setReceiptFile(null); }}
                  className={`p-4 border-2 rounded-lg cursor-pointer transition ${selectedPaymentMethod === 'online' ? 'border-[#434040] bg-[#434040]/5' : 'border-border hover:border-[#434040]/50'}`}
                  data-testid="payment-method-online"
                >
                  <div className="font-semibold">الدفع الإلكتروني</div>
                  <p className="text-sm text-muted-foreground">بطاقة ائتمان أو Apple Pay</p>
                </div>
                <div
                  onClick={() => setSelectedPaymentMethod('bank')}
                  className={`p-4 border-2 rounded-lg cursor-pointer transition ${selectedPaymentMethod === 'bank' ? 'border-[#434040] bg-[#434040]/5' : 'border-border hover:border-[#434040]/50'}`}
                  data-testid="payment-method-bank"
                >
                  <div className="font-semibold">تحويل بنكي</div>
                  <p className="text-sm text-muted-foreground">مع تحميل إيصال التحويل</p>
                </div>
              </div>

              {/* Bank Receipt Upload */}
              {selectedPaymentMethod === 'bank' && (
                <div className="p-4 bg-muted/30 rounded-lg mt-3">
                  <label className="block text-sm font-semibold mb-2">إيصال التحويل</label>
                  <input ref={fileInputRef} type="file" accept="image/*" onChange={(e) => setReceiptFile(e.target.files?.[0] || null)} className="hidden" />
                  <Button type="button" variant="outline" onClick={() => fileInputRef.current?.click()} className="w-full gap-2 mb-3">
                    <Upload className="w-4 h-4" />
                    {receiptFile ? receiptFile.name : 'اختر صورة الإيصال'}
                  </Button>
                  {receiptFile && (
                    <Button 
                      type="button" 
                      onClick={async () => {
                        setIsSubmittingPayment(true);
                        try {
                          const propertyNumber = property?.propertyNumber;
                          const formData = new FormData();
                          formData.append('propertyNumber', propertyNumber || '');
                          formData.append('packageId', paymentInfo.packageId);
                          formData.append('receipt', receiptFile);
                          formData.append('action', paymentInfo.action);
                          await fetch('/api/owner/payment/bank-transfer', {
                            method: 'POST',
                            body: formData,
                          });
                          toast({
                            title: 'تم رفع الإيصال بنجاح',
                            description: 'سيتم التحقق من التحويل البنكي وتفعيل الاشتراك قريباً',
                          });
                          queryClient.invalidateQueries({ queryKey: ['/api/owner/current-subscription'] });
                          setPaymentInfo(null);
                          setSelectedPaymentMethod(null);
                          setReceiptFile(null);
                        } catch (err: any) {
                          toast({
                            title: 'خطأ في رفع الإيصال',
                            description: err.message || 'حدث خطأ غير متوقع',
                            variant: 'destructive',
                          });
                        } finally {
                          setIsSubmittingPayment(false);
                        }
                      }}
                      disabled={isSubmittingPayment}
                      className="w-full"
                      data-testid="button-upload-receipt"
                    >
                      {isSubmittingPayment ? 'جاري الرفع...' : 'رفع الإيصال'}
                    </Button>
                  )}
                </div>
              )}
            </div>

            <div className="flex gap-3">
              {selectedPaymentMethod === 'online' && (
                <Button
                  onClick={async () => {
                    setIsSubmittingPayment(true);
                    try {
                      const propertyNumber = property?.propertyNumber;
                      const paymentResponse = await apiRequest('POST', '/api/owner/payment/initiate', {
                        propertyNumber,
                        packageId: paymentInfo.packageId,
                        action: paymentInfo.action,
                        paymentMethod: 'cards',
                      });
                      const paymentData = await paymentResponse.json();
                      if (paymentData.checkoutUrl) {
                        window.location.href = paymentData.checkoutUrl;
                      } else {
                        throw new Error('لم يتم الحصول على رابط الدفع');
                      }
                    } catch (err: any) {
                      toast({
                        title: 'خطأ في الدفع',
                        description: err.message || 'حدث خطأ غير متوقع',
                        variant: 'destructive',
                      });
                    } finally {
                      setIsSubmittingPayment(false);
                    }
                  }}
                  disabled={isSubmittingPayment}
                  className="flex-1"
                  data-testid="button-confirm-payment"
                >
                  {isSubmittingPayment ? 'جاري الدفع...' : 'تأكيد الدفع'}
                </Button>
              )}
              <Button
                onClick={() => {
                  setPaymentInfo(null);
                  setSelectedPaymentMethod(null);
                  setReceiptFile(null);
                }}
                variant="outline"
                className="flex-1"
              >
                إلغاء
              </Button>
            </div>
          </Card>
        )}

        {/* الباقات المتاحة */}
        <div>
          <h3 className="text-xl font-bold mb-6">الباقات المتاحة</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {packages.map(pkg => (
              <Card key={pkg.id} className="p-6 hover:shadow-lg transition-shadow">
                <h4 className="text-lg font-bold mb-4 text-[#434040]">{pkg.name}</h4>
                <div className="mb-4">
                  <p className="text-3xl font-bold text-[#b88d2b]">{pkg.price}<span className="text-sm"> ر.س</span></p>
                  <p className="text-sm text-muted-foreground mt-1">{pkg.duration} يوم</p>
                </div>
                <div className="mb-4">
                  <p className="text-xs text-muted-foreground mb-2">المميزات:</p>
                  <ul className="space-y-1">
                    {pkg.features?.map((feature, idx) => (
                      <li key={idx} className="text-sm flex items-start gap-2">
                        <span className="text-[#b88d2b]">✓</span>
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <Badge className={pkg.type === 'مميز' ? 'bg-[#b88d2b]' : 'bg-gray-400'}>
                  {pkg.type}
                </Badge>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
