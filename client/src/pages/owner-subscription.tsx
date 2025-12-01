import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Property, Package, Subscription } from "@shared/schema";
import { CalendarDays, Crown, TrendingUp, Check } from "lucide-react";

export default function OwnerSubscriptionPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [selectedAction, setSelectedAction] = useState<'extend' | 'upgrade' | null>(null);
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null);

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

  const isSubscriptionActive = daysRemaining > 0;

  // عملية الترقية/التمديد
  const upgradeMutation = useMutation({
    mutationFn: async ({ action, packageId }: { action: 'extend' | 'upgrade'; packageId: string }) => {
      const response = await apiRequest('POST', '/api/owner/subscription/update', {
        action,
        packageId,
      });
      return response.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["/api/owner/current-subscription"] });
      toast({
        title: "✅ تم بنجاح",
        description: `تم ${selectedAction === 'extend' ? 'تمديد' : 'ترقية'} اشتراكك`,
      });
      setTimeout(() => setSelectedAction(null), 1000);
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
    return <div className="min-h-screen flex items-center justify-center">جاري التحميل...</div>;
  }

  const availablePackages = packages.filter(p => {
    if (selectedAction === 'upgrade') {
      return p.price > (currentPackage?.price || 0);
    }
    return true;
  });

  return (
    <div className="min-h-screen bg-background p-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-[#434040] mb-2">إدارة الاشتراك</h1>
          <p className="text-muted-foreground">عقار: {property.name} ({property.propertyNumber})</p>
        </header>

        {/* الاشتراك الحالي */}
        <Card className="mb-8 p-6 border-[#e0c97b] bg-gradient-to-r from-[#fffdf0] to-background">
          <div className="flex items-start justify-between mb-6">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Crown className="w-5 h-5 text-[#b88d2b]" />
                <h2 className="text-2xl font-bold text-[#434040]">الباقة الحالية</h2>
              </div>
              <p className="text-lg font-semibold text-[#b88d2b]">{currentPackage?.name || 'بدون اشتراك'}</p>
            </div>
            <Badge className={isSubscriptionActive ? "bg-green-500" : "bg-red-500"}>
              {isSubscriptionActive ? '✓ نشط' : '✗ منتهي'}
            </Badge>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div>
              <p className="text-sm text-muted-foreground">السعر الشهري</p>
              <p className="text-2xl font-bold text-[#434040]">{currentPackage?.price} ر.س</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">المدة</p>
              <p className="text-2xl font-bold text-[#434040]">{currentPackage?.duration} يوم</p>
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
                {new Date(currentSubscription.endDate).toLocaleDateString('ar-SA')}
              </p>
            </div>
          </div>

          {/* أزرار الإجراءات */}
          <div className="flex gap-3 flex-wrap">
            <Button
              onClick={() => setSelectedAction('extend')}
              variant={selectedAction === 'extend' ? 'default' : 'outline'}
              className="flex-1 md:flex-initial"
            >
              <CalendarDays className="w-4 h-4 ml-2" />
              تمديد الاشتراك
            </Button>
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
                  if (selectedPackageId) {
                    upgradeMutation.mutate({ 
                      action: selectedAction, 
                      packageId: selectedPackageId 
                    });
                  }
                }}
                disabled={!selectedPackageId || upgradeMutation.isPending}
                className="flex-1"
              >
                {upgradeMutation.isPending ? 'جاري المعالجة...' : 'تأكيد'}
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
                <Badge className={pkg.type === 'موثوق' ? 'bg-[#b88d2b]' : 'bg-gray-400'}>
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
