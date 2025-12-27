import { useState, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Property, Package, Subscription } from "@shared/schema";
import { 
  CalendarDays, Crown, TrendingUp, Check, Upload, 
  AlertTriangle, Clock, XCircle, CheckCircle2, Timer, Building2
} from "lucide-react";
import {
  calculateRemainingDays,
  calculateSubscriptionDuration,
  getSubscriptionStatus,
  getStatusInfo,
  canExtendSubscription,
  canUpgradeSubscription,
  formatDate,
  SubscriptionStatus,
} from "@/lib/subscription-utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PriceDisplay } from "@/components/price-display";
import riyal from "@/assets/riyal-symbol.png";
import { cleanPropertyNumber } from "@/lib/validation";

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
  const [showUpgradeWarning, setShowUpgradeWarning] = useState(false);
  const [pendingUpgradePackage, setPendingUpgradePackage] = useState<string | null>(null);
  
  // للباقات متعددة العقارات
  const [secondPropertyNumber, setSecondPropertyNumber] = useState<string>('');
  const [secondPropertyInfo, setSecondPropertyInfo] = useState<{ number: string; name: string; city: string } | null>(null);
  const [isVerifyingSecondProperty, setIsVerifyingSecondProperty] = useState(false);
  const [secondPropertyError, setSecondPropertyError] = useState<string | null>(null);

  const { data: property } = useQuery<Property>({
    queryKey: ["/api/owner/property"],
  });

  const { data: currentSubscription } = useQuery<Subscription>({
    queryKey: ["/api/owner/current-subscription"],
  });

  const { data: packages = [] } = useQuery<Package[]>({
    queryKey: ["/api/packages"],
  });

  const currentPackage = packages.find(p => p.id === currentSubscription?.packageId);

  // حساب الأيام المتبقية باستخدام الدوال الآمنة
  // تمرير تاريخ البداية لحساب صحيح إذا كان الاشتراك في المستقبل
  const daysRemaining = currentSubscription 
    ? calculateRemainingDays(currentSubscription.endDate, currentSubscription.startDate)
    : 0;

  // حساب مدة الاشتراك
  const subscriptionDuration = currentSubscription
    ? calculateSubscriptionDuration(currentSubscription.startDate, currentSubscription.endDate)
    : 0;

  // تحديد حالة الاشتراك
  const subscriptionStatus: SubscriptionStatus = currentSubscription
    ? getSubscriptionStatus(currentSubscription.endDate, currentSubscription.status)
    : 'expired';

  const statusInfo = getStatusInfo(subscriptionStatus);

  // هل يمكن التمديد؟
  const canExtend = canExtendSubscription(currentSubscription?.endDate, subscriptionStatus);
  
  // هل يمكن الترقية؟
  const canUpgrade = canUpgradeSubscription(subscriptionStatus);

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
        title: "خطأ",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // تأكيد الترقية مع التحذير
  const handleUpgradeConfirm = () => {
    if (pendingUpgradePackage) {
      prepareMutation.mutate({ 
        action: 'upgrade', 
        packageId: pendingUpgradePackage 
      });
      setShowUpgradeWarning(false);
      setPendingUpgradePackage(null);
    }
  };

  // طلب الترقية مع إظهار التحذير إذا كان هناك أيام متبقية
  const requestUpgrade = (packageId: string) => {
    if (daysRemaining > 0) {
      setPendingUpgradePackage(packageId);
      setShowUpgradeWarning(true);
    } else {
      prepareMutation.mutate({ action: 'upgrade', packageId });
    }
  };

  // التحقق من العقار الثاني
  const verifySecondProperty = async () => {
    if (!secondPropertyNumber.trim()) {
      setSecondPropertyError('الرجاء إدخال رقم العقار الثاني');
      return;
    }
    
    setIsVerifyingSecondProperty(true);
    setSecondPropertyError(null);
    setSecondPropertyInfo(null);
    
    try {
      const response = await apiRequest('POST', '/api/owner/verify-second-property', {
        secondPropertyNumber: secondPropertyNumber.trim()
      });
      const data = await response.json();
      
      if (data.ok) {
        setSecondPropertyInfo(data.property);
        toast({
          title: 'تم التحقق بنجاح',
          description: `تم العثور على: ${data.property.name}`,
        });
      }
    } catch (err: any) {
      setSecondPropertyError(err.message || 'فشل في التحقق من العقار');
    } finally {
      setIsVerifyingSecondProperty(false);
    }
  };

  // هل الباقة المختارة تدعم عقارين؟
  const selectedPackage = packages.find(p => p.id === selectedPackageId);
  const isMultiPropertyPackage = (selectedPackage?.propertyCount || 1) > 1;

  // إعادة تعيين العقار الثاني عند تغيير الباقة
  const handlePackageSelect = (packageId: string) => {
    setSelectedPackageId(packageId);
    setSecondPropertyNumber('');
    setSecondPropertyInfo(null);
    setSecondPropertyError(null);
  };

  if (!property || !currentSubscription) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="p-8 text-center">
          <div className="inline-block w-12 h-12 border-4 border-primary border-t-transparent rounded-full animate-spin mb-4"></div>
          <p className="text-lg font-semibold text-foreground">جاري تحميل البيانات...</p>
        </Card>
      </div>
    );
  }

  // فلترة الباقات حسب الإجراء المختار
  const availablePackages = packages.filter(p => {
    if (!p.isActive) return false;
    
    if (selectedAction === 'upgrade') {
      return p.price > (currentPackage?.price || 0);
    }
    if (selectedAction === 'extend') {
      return p.price > 0;
    }
    return true;
  });

  // أيقونة الحالة
  const StatusIcon = () => {
    switch (subscriptionStatus) {
      case 'active': return <CheckCircle2 className="w-5 h-5" />;
      case 'expiring': return <Timer className="w-5 h-5" />;
      case 'expired': return <XCircle className="w-5 h-5" />;
      case 'cancelled': return <XCircle className="w-5 h-5" />;
      case 'pending': return <Clock className="w-5 h-5" />;
    }
  };

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-[#434040] mb-2">إدارة الاشتراك</h1>
          <p className="text-muted-foreground">عقار: {property.name} ({property.propertyNumber})</p>
        </header>

        {/* بطاقة الاشتراك الحالية */}
        <Card className={`mb-8 p-6 border-2 transition-all ${statusInfo.borderColor} ${
          subscriptionStatus === 'active' 
            ? 'bg-gradient-to-r from-green-50 to-background dark:from-green-950/20'
            : subscriptionStatus === 'expiring'
            ? 'bg-gradient-to-r from-orange-50 to-background dark:from-orange-950/20'
            : 'bg-gradient-to-r from-[#fffdf0] to-background'
        }`}>
          {/* رأس البطاقة */}
          <div className="flex items-start justify-between mb-6">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Crown className="w-5 h-5 text-[#b88d2b]" />
                <h2 className="text-2xl font-bold text-[#434040]">الباقة الحالية</h2>
              </div>
              <p className="text-lg font-semibold text-[#b88d2b]">{currentPackage?.name || 'بدون اشتراك'}</p>
            </div>
            <Badge className={`${statusInfo.bgColor} text-white flex items-center gap-1`} data-testid="badge-subscription-status">
              <StatusIcon />
              {statusInfo.label}
            </Badge>
          </div>

          {/* عداد الأيام المتبقية - كبير وواضح */}
          <div className="text-center py-8 mb-6 rounded-xl bg-white/50 dark:bg-black/20 border border-border">
            <p className="text-sm text-muted-foreground mb-2">الأيام المتبقية</p>
            <p className={`text-7xl font-bold ${statusInfo.color}`} data-testid="text-days-remaining">
              {daysRemaining}
            </p>
            <p className="text-lg text-muted-foreground mt-2">يوم</p>
            
            {/* تحذير إذا ينتهي قريباً */}
            {subscriptionStatus === 'expiring' && (
              <div className="mt-4 flex items-center justify-center gap-2 text-orange-600">
                <AlertTriangle className="w-5 h-5" />
                <span className="font-semibold">اشتراكك ينتهي قريباً! قم بالتمديد الآن</span>
              </div>
            )}
          </div>

          {/* معلومات الاشتراك */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="text-center p-3 rounded-lg bg-white/50 dark:bg-black/20">
              <p className="text-xs text-muted-foreground mb-1">رسوم الاشتراك</p>
              <PriceDisplay 
                amount={(currentSubscription as any)?.price || (currentPackage?.propertyCount && currentPackage.propertyCount > 1 ? currentPackage.price / currentPackage.propertyCount : currentPackage?.price) || 0}
                size="lg"
                textColor="text-[#434040]"
              />
              {(currentPackage?.propertyCount || 1) > 1 && (
                <p className="text-xs text-muted-foreground">(لكل عقار)</p>
              )}
            </div>
            <div className="text-center p-3 rounded-lg bg-white/50 dark:bg-black/20">
              <p className="text-xs text-muted-foreground mb-1">المدة</p>
              <p className="text-xl font-bold text-[#434040]" data-testid="text-subscription-duration">
                {subscriptionDuration || currentPackage?.duration || 0} يوم
              </p>
            </div>
            <div className="text-center p-3 rounded-lg bg-white/50 dark:bg-black/20">
              <p className="text-xs text-muted-foreground mb-1">تاريخ البداية</p>
              <p className="text-sm font-bold text-[#434040]" data-testid="text-start-date">
                {formatDate(currentSubscription.startDate)}
              </p>
            </div>
            <div className="text-center p-3 rounded-lg bg-white/50 dark:bg-black/20">
              <p className="text-xs text-muted-foreground mb-1">تاريخ الانتهاء</p>
              <p className="text-sm font-bold text-[#434040]" data-testid="text-end-date">
                {formatDate(currentSubscription.endDate)}
              </p>
            </div>
          </div>

          {/* العقار المرتبط */}
          {(currentSubscription as any)?.linkedProperty && (
            <div className="mb-6 p-4 rounded-xl bg-blue-50/50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800">
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 rounded-full bg-blue-100 dark:bg-blue-900 flex items-center justify-center">
                  <Building2 className="w-4 h-4 text-blue-600" />
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">العقار المرتبط</p>
                  <p className="font-bold text-blue-600" data-testid="text-linked-property">
                    {(currentSubscription as any).linkedProperty}
                  </p>
                </div>
                <p className="mr-auto text-xs text-muted-foreground">
                  باقة عقارين - نفس تاريخ الانتهاء
                </p>
              </div>
            </div>
          )}

          {/* أزرار الإجراءات */}
          <div className="flex gap-3 flex-wrap">
            {/* زر التمديد */}
            {canExtend ? (
              <Button
                onClick={() => {
                  setSelectedAction('extend');
                  setSelectedPackageId(null);
                  setPaymentInfo(null);
                }}
                variant={selectedAction === 'extend' ? 'default' : 'outline'}
                className="flex-1 md:flex-initial"
                data-testid="button-extend-subscription"
              >
                <CalendarDays className="w-4 h-4 ml-2" />
                تمديد الاشتراك
              </Button>
            ) : (
              <div className="flex-1 md:flex-initial px-4 py-2 text-sm text-muted-foreground bg-muted/30 rounded-lg text-center">
                يمكن التمديد عند بقاء 10 أيام أو أقل
              </div>
            )}

            {/* زر الترقية */}
            {canUpgrade && (
              <Button
                onClick={() => {
                  setSelectedAction('upgrade');
                  setSelectedPackageId(null);
                  setPaymentInfo(null);
                }}
                variant={selectedAction === 'upgrade' ? 'default' : 'outline'}
                className="flex-1 md:flex-initial"
                data-testid="button-upgrade-subscription"
              >
                <TrendingUp className="w-4 h-4 ml-2" />
                الترقية إلى باقة أفضل
              </Button>
            )}
          </div>
        </Card>

        {/* اختيار الباقة */}
        {selectedAction && !paymentInfo && (
          <Card className="mb-8 p-6">
            <h3 className="text-xl font-bold mb-2">
              {selectedAction === 'extend' ? 'اختر مدة التمديد' : 'اختر الباقة الجديدة'}
            </h3>
            
            {/* تحذير الترقية */}
            {selectedAction === 'upgrade' && daysRemaining > 0 && (
              <div className="mb-6 p-4 bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800 rounded-lg">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-6 h-6 text-orange-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold text-orange-800 dark:text-orange-200 mb-1">تنبيه مهم</p>
                    <p className="text-sm text-orange-700 dark:text-orange-300">
                      لديك اشتراك متبقي فيه <strong>{daysRemaining} يوم</strong>.
                      الترقية ستؤدي إلى:
                    </p>
                    <ul className="text-sm text-orange-700 dark:text-orange-300 mt-2 list-disc mr-4 space-y-1">
                      <li>تصفير العداد الحالي</li>
                      <li>بدء باقة جديدة بالكامل</li>
                      <li>الأيام المتبقية السابقة لن تُرحّل</li>
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {/* ملاحظة التمديد */}
            {selectedAction === 'extend' && (
              <p className="text-sm text-muted-foreground mb-6">
                الأيام الجديدة ستُضاف إلى اشتراكك الحالي
              </p>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              {availablePackages.length === 0 ? (
                <div className="col-span-2 text-center py-8 text-muted-foreground">
                  لا توجد باقات متاحة للإجراء المختار
                </div>
              ) : (
                availablePackages.map(pkg => (
                  <div
                    key={pkg.id}
                    onClick={() => handlePackageSelect(pkg.id)}
                    className={`p-4 rounded-lg border-2 cursor-pointer transition-all ${
                      selectedPackageId === pkg.id
                        ? 'border-[#b88d2b] bg-[#fffdf0]'
                        : 'border-border hover:border-[#b88d2b]'
                    }`}
                    data-testid={`package-card-${pkg.id}`}
                  >
                    <div className="flex justify-between items-start mb-2">
                      <h4 className="font-bold text-[#434040]">{pkg.name}</h4>
                      {selectedPackageId === pkg.id && (
                        <Check className="w-5 h-5 text-[#b88d2b]" />
                      )}
                    </div>
                    <p className="text-sm text-muted-foreground mb-3">{pkg.duration} يوم</p>
                    <div className="flex items-center justify-between">
                      {(pkg.propertyCount || 1) > 1 ? (
                        <div>
                          <div className="flex items-center gap-1 text-2xl font-bold text-[#b88d2b] mb-1">
                            <span>{pkg.price / (pkg.propertyCount || 1)}</span>
                            <img src={riyal} alt="ريال" className="w-6 h-6 object-contain" />
                            <span className="text-sm font-normal text-muted-foreground"> / عقار</span>
                          </div>
                          <div className="text-xs text-muted-foreground flex items-center gap-1">
                            الإجمالي: {pkg.price} 
                            <img src={riyal} alt="ريال" className="w-3 h-3 object-contain inline" /> 
                            للعقارين
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1">
                          <span className="text-2xl md:text-4xl font-bold text-[#b88d2b]">{pkg.price}</span>
                          <img src={riyal} alt="ريال" className="w-6 h-6 md:w-8 md:h-8 object-contain" />
                        </div>
                      )}
                      {(pkg.propertyCount || 1) > 1 && (
                        <Badge variant="secondary" className="text-xs">
                          {pkg.propertyCount} عقارات
                        </Badge>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* قسم العقار الثاني - يظهر فقط للباقات متعددة العقارات */}
            {isMultiPropertyPackage && selectedPackageId && (
              <div className="mb-6 p-4 bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                <h4 className="font-bold text-blue-800 dark:text-blue-200 mb-3 flex items-center gap-2">
                  <Crown className="w-5 h-5" />
                  باقة عقارين - أدخل رقم العقار الثاني
                </h4>
                <p className="text-sm text-blue-700 dark:text-blue-300 mb-4">
                  هذه الباقة تشمل عقارين بنفس السعر. يجب أن يكون العقار الثاني مسجلاً بنفس الرقم السري.
                </p>
                
                <div className="flex gap-2 mb-3">
                  <input
                    type="text"
                    value={secondPropertyNumber}
                    onChange={(e) => {
                      setSecondPropertyNumber(cleanPropertyNumber(e.target.value));
                      setSecondPropertyError(null);
                    }}
                    placeholder="رقم العقار الثاني (5 أرقام)"
                    className="flex-1 px-4 py-2 border border-input rounded-lg bg-background text-foreground"
                    maxLength={5}
                    inputMode="numeric"
                    data-testid="input-second-property"
                  />
                  <Button
                    onClick={verifySecondProperty}
                    disabled={isVerifyingSecondProperty || !secondPropertyNumber.trim()}
                    variant="outline"
                    data-testid="button-verify-second-property"
                  >
                    {isVerifyingSecondProperty ? 'جاري التحقق...' : 'تحقق'}
                  </Button>
                </div>
                
                {/* رسالة خطأ */}
                {secondPropertyError && (
                  <div className="p-3 bg-red-100 dark:bg-red-950/30 border border-red-300 dark:border-red-800 rounded-lg text-red-700 dark:text-red-300 text-sm">
                    {secondPropertyError}
                  </div>
                )}
                
                {/* معلومات العقار الثاني بعد التحقق */}
                {secondPropertyInfo && (
                  <div className="p-3 bg-green-100 dark:bg-green-950/30 border border-green-300 dark:border-green-800 rounded-lg">
                    <div className="flex items-center gap-2 text-green-700 dark:text-green-300">
                      <CheckCircle2 className="w-5 h-5" />
                      <span className="font-semibold">تم التحقق بنجاح</span>
                    </div>
                    <div className="mt-2 text-sm text-green-600 dark:text-green-400">
                      <p>اسم العقار: <strong>{secondPropertyInfo.name}</strong></p>
                      <p>المدينة: <strong>{secondPropertyInfo.city}</strong></p>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="flex gap-3">
              <Button
                onClick={() => {
                  if (!selectedPackageId) return;
                  
                  // للباقات متعددة العقارات، يجب التحقق من العقار الثاني
                  if (isMultiPropertyPackage && !secondPropertyInfo) {
                    toast({
                      title: 'مطلوب',
                      description: 'الرجاء إدخال رقم العقار الثاني والتحقق منه',
                      variant: 'destructive',
                    });
                    return;
                  }
                  
                  if (selectedAction === 'upgrade' && daysRemaining > 0) {
                    setPendingUpgradePackage(selectedPackageId);
                    setShowUpgradeWarning(true);
                  } else {
                    prepareMutation.mutate({ 
                      action: selectedAction, 
                      packageId: selectedPackageId 
                    });
                  }
                }}
                disabled={!selectedPackageId || prepareMutation.isPending || (isMultiPropertyPackage && !secondPropertyInfo)}
                className="flex-1"
                data-testid="button-continue-payment"
              >
                {prepareMutation.isPending ? 'جاري التحضير...' : 'متابعة للدفع'}
              </Button>
              <Button
                onClick={() => {
                  setSelectedAction(null);
                  setSelectedPackageId(null);
                }}
                variant="outline"
                className="flex-1"
                data-testid="button-cancel-action"
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
              <div className="flex justify-between mb-3">
                <span className="text-muted-foreground">نوع العملية:</span>
                <span className="font-bold text-[#434040]">
                  {paymentInfo.action === 'extend' ? 'تمديد' : 'ترقية'}
                </span>
              </div>
              <div className="flex justify-between border-t pt-3">
                <span className="text-lg font-bold text-[#434040]">الإجمالي:</span>
                <PriceDisplay amount={paymentInfo.price} size="xl" textColor="text-[#b88d2b]" />
              </div>
              {/* إظهار العقار الثاني إذا كانت باقة عقارين */}
              {secondPropertyInfo && (
                <div className="flex justify-between mt-3 pt-3 border-t border-blue-200">
                  <span className="text-muted-foreground">العقار الثاني:</span>
                  <span className="font-bold text-[#434040]">{secondPropertyInfo.name} ({secondPropertyInfo.number})</span>
                </div>
              )}
            </div>

            <div className="mb-6">
              <h3 className="text-lg font-bold mb-3 text-[#434040]">اختر طريقة الدفع:</h3>
              <div className="space-y-3">
                <div
                  onClick={() => { setSelectedPaymentMethod('online'); setReceiptFile(null); }}
                  className={`p-4 border-2 rounded-lg cursor-pointer transition ${
                    selectedPaymentMethod === 'online' 
                      ? 'border-[#434040] bg-[#434040]/5' 
                      : 'border-border hover:border-[#434040]/50'
                  }`}
                  data-testid="payment-method-online"
                >
                  <div className="font-semibold">الدفع الإلكتروني</div>
                  <p className="text-sm text-muted-foreground">بطاقة ائتمان أو Apple Pay</p>
                </div>
                <div
                  onClick={() => setSelectedPaymentMethod('bank')}
                  className={`p-4 border-2 rounded-lg cursor-pointer transition ${
                    selectedPaymentMethod === 'bank' 
                      ? 'border-[#434040] bg-[#434040]/5' 
                      : 'border-border hover:border-[#434040]/50'
                  }`}
                  data-testid="payment-method-bank"
                >
                  <div className="font-semibold">تحويل بنكي</div>
                  <p className="text-sm text-muted-foreground">مع تحميل إيصال التحويل</p>
                </div>
              </div>

              {/* رفع إيصال التحويل البنكي */}
              {selectedPaymentMethod === 'bank' && (
                <div className="p-4 bg-muted/30 rounded-lg mt-3">
                  <label className="block text-sm font-semibold mb-2">إيصال التحويل</label>
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
                    className="w-full gap-2 mb-3"
                  >
                    <Upload className="w-4 h-4" />
                    {receiptFile ? receiptFile.name : 'اختر صورة الإيصال'}
                  </Button>
                  {receiptFile && (
                    <Button 
                      type="button" 
                      onClick={async () => {
                        setIsSubmittingPayment(true);
                        try {
                          const formData = new FormData();
                          formData.append('propertyNumber', property?.propertyNumber || '');
                          formData.append('packageId', paymentInfo.packageId);
                          formData.append('receipt', receiptFile);
                          formData.append('action', paymentInfo.action);
                          if (secondPropertyInfo) {
                            formData.append('secondPropertyNumber', secondPropertyInfo.number);
                          }
                          await fetch('/api/owner/payment/bank-transfer', {
                            method: 'POST',
                            body: formData,
                          });
                          toast({
                            title: 'تم رفع الإيصال بنجاح',
                            description: 'سيتم التحقق من التحويل وتفعيل الاشتراك قريباً',
                          });
                          queryClient.invalidateQueries({ queryKey: ['/api/owner/current-subscription'] });
                          setPaymentInfo(null);
                          setSelectedPaymentMethod(null);
                          setReceiptFile(null);
                          setSelectedAction(null);
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
                      const paymentResponse = await apiRequest('POST', '/api/owner/payment/initiate', {
                        propertyNumber: property?.propertyNumber,
                        packageId: paymentInfo.packageId,
                        action: paymentInfo.action,
                        paymentMethod: 'cards',
                        secondPropertyNumber: secondPropertyInfo?.number || undefined,
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
                data-testid="button-cancel-payment"
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
            {packages.filter(p => p.isActive).map(pkg => (
              <Card key={pkg.id} className={`p-6 hover:shadow-lg transition-shadow ${
                currentPackage?.id === pkg.id ? 'border-2 border-[#b88d2b]' : ''
              }`}>
                {currentPackage?.id === pkg.id && (
                  <Badge className="mb-4 bg-[#b88d2b]">باقتك الحالية</Badge>
                )}
                <h4 className="text-lg font-bold mb-4 text-[#434040]">{pkg.name}</h4>
                <div className="mb-4">
                  {(pkg.propertyCount || 1) > 1 ? (
                    <>
                      <div className="flex items-center gap-1 text-3xl font-bold text-[#b88d2b]">
                        <span>{pkg.price / (pkg.propertyCount || 1)}</span>
                        <img src={riyal} alt="ريال" className="w-6 h-6 object-contain" />
                        <span className="text-sm font-normal text-muted-foreground"> / عقار</span>
                      </div>
                      <div className="flex items-center gap-1 text-xs text-muted-foreground">
                        <span>الإجمالي: {pkg.price}</span>
                        <img src={riyal} alt="ريال" className="w-3 h-3 object-contain" />
                        <span>للعقارين</span>
                      </div>
                    </>
                  ) : (
                    <div className="flex items-center gap-1 text-3xl font-bold text-[#b88d2b]">
                      <span>{pkg.price}</span>
                      <img src={riyal} alt="ريال" className="w-6 h-6 object-contain" />
                    </div>
                  )}
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

      {/* حوار تأكيد الترقية */}
      <Dialog open={showUpgradeWarning} onOpenChange={setShowUpgradeWarning}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-orange-600">
              <AlertTriangle className="w-6 h-6" />
              تأكيد الترقية
            </DialogTitle>
            <DialogDescription className="text-right pt-4">
              <div className="space-y-3">
                <p>
                  لديك اشتراك متبقي فيه <strong className="text-orange-600">{daysRemaining} يوم</strong>.
                </p>
                <p>الترقية ستؤدي إلى:</p>
                <ul className="list-disc mr-6 space-y-1 text-sm">
                  <li>تصفير العداد الحالي</li>
                  <li>بدء باقة جديدة بالكامل</li>
                  <li>الأيام المتبقية السابقة لن تُرحّل</li>
                </ul>
                <p className="font-semibold pt-2">هل أنت متأكد من المتابعة؟</p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setShowUpgradeWarning(false)}
              data-testid="button-cancel-upgrade-warning"
            >
              إلغاء
            </Button>
            <Button
              onClick={handleUpgradeConfirm}
              className="bg-orange-600 hover:bg-orange-700"
              data-testid="button-confirm-upgrade-warning"
            >
              نعم، متابعة الترقية
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
