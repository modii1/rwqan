import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Property } from "@shared/schema";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LogOut, CreditCard, Image as ImageIcon, Home } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function OwnerDashboard() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);

  // Check session first
  const { data: sessionData, isLoading: isSessionLoading } = useQuery<{ isLoggedIn: boolean; propertyNumber?: string }>({
    queryKey: ['/api/owner/session'],
    retry: false,
    refetchOnWindowFocus: false,
  });

  // Only fetch property if authenticated
  const { data: property, isLoading: isPropertyLoading, error: propertyError } = useQuery<Property>({
    queryKey: ['/api/owner/property'],
    enabled: sessionData?.isLoggedIn === true,
    retry: false,
    refetchOnWindowFocus: false,
  });

  // Handle authentication redirect
  useEffect(() => {
    if (!isSessionLoading && sessionData) {
      if (!sessionData.isLoggedIn) {
        setLocation('/owner/login');
      } else {
        setIsAuthenticated(true);
      }
    }
  }, [sessionData, isSessionLoading, setLocation]);

  const handleLogout = async () => {
    try {
      const response = await fetch('/api/owner/logout', {
        method: 'POST',
        credentials: 'include',
      });
      
      if (response.ok) {
        toast({
          title: "تم تسجيل الخروج",
          description: "نراك قريباً!",
        });
        setLocation('/owner/login');
      }
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  // Show loading while checking session
  if (isSessionLoading || isAuthenticated === null) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
          <p className="mt-4 text-muted-foreground">جاري التحقق من الجلسة...</p>
        </div>
      </div>
    );
  }

  // Show loading while fetching property
  if (isPropertyLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
          <p className="mt-4 text-muted-foreground">جاري تحميل بيانات العقار...</p>
        </div>
      </div>
    );
  }

  // Show error if property fetch failed
  if (propertyError || !property) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md p-8 text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-red-100 flex items-center justify-center">
            <Home className="w-8 h-8 text-red-500" />
          </div>
          <h2 className="text-xl font-bold mb-2">خطأ في تحميل البيانات</h2>
          <p className="text-muted-foreground mb-4">تعذر تحميل بيانات العقار</p>
          <div className="flex gap-2 justify-center">
            <Button onClick={() => window.location.reload()} data-testid="button-retry">
              إعادة المحاولة
            </Button>
            <Button variant="outline" onClick={() => setLocation('/owner/login')} data-testid="button-go-login">
              تسجيل الدخول
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-card border-b border-border shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
              <Home className="w-5 h-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-primary" data-testid="text-dashboard-title">لوحة التحكم</h1>
              <p className="text-sm text-muted-foreground" data-testid="text-property-number">عقار رقم {property.propertyNumber}</p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleLogout}
            data-testid="button-logout"
          >
            <LogOut className="w-4 h-4 ml-2" />
            تسجيل الخروج
          </Button>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
          {/* Property Info */}
          <Card className="p-6">
            <h2 className="text-lg font-bold text-primary mb-4">معلومات العقار</h2>
            <div className="space-y-3">
              <div>
                <span className="text-sm text-muted-foreground">الاسم:</span>
                <p className="font-semibold" data-testid="text-property-name">{property.name}</p>
              </div>
              <div>
                <span className="text-sm text-muted-foreground">المدينة:</span>
                <p className="font-semibold" data-testid="text-property-city">{property.city}</p>
              </div>
              <div>
                <span className="text-sm text-muted-foreground">الاتجاه:</span>
                <p className="font-semibold" data-testid="text-property-direction">{property.direction}</p>
              </div>
              <div>
                <span className="text-sm text-muted-foreground">النوع:</span>
                <p className="font-semibold" data-testid="text-property-type">{property.type}</p>
              </div>
              <div>
                <span className="text-sm text-muted-foreground">نوع الاشتراك:</span>
                <Badge 
                  variant={property.subscriptionType === 'موثوق' ? 'default' : 'secondary'}
                  data-testid="badge-subscription-type"
                >
                  {property.subscriptionType}
                </Badge>
              </div>
            </div>
          </Card>

          {/* Subscription Status */}
          <Card className="p-6">
            <h2 className="text-lg font-bold text-primary mb-4">حالة الاشتراك</h2>
            <div className="space-y-4">
              {property.subscriptionType === "موثوق" && property.subscriptionDate ? (
                <>
                  <div>
                    <span className="text-sm text-muted-foreground">تاريخ البدء:</span>
                    <p className="font-semibold" data-testid="text-subscription-date">
                      {new Date(property.subscriptionDate).toLocaleDateString('ar-SA')}
                    </p>
                  </div>
                  <Button
                    className="w-full"
                    onClick={() => setLocation('/owner/subscription')}
                    data-testid="button-manage-subscription"
                  >
                    <CreditCard className="w-4 h-4 ml-2" />
                    إدارة الاشتراك
                  </Button>
                </>
              ) : (
                <>
                  <p className="text-muted-foreground" data-testid="text-free-subscription">
                    اشتراك مجاني (نسبة 10% من الحجز)
                  </p>
                  <Button
                    className="w-full gradient-golden"
                    onClick={() => setLocation('/owner/subscription')}
                    data-testid="button-upgrade-subscription"
                  >
                    ترقية الاشتراك
                  </Button>
                </>
              )}
            </div>
          </Card>
        </div>

        {/* Quick Actions */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Button
            variant="outline"
            className="h-20"
            onClick={() => setLocation('/owner/subscription')}
            data-testid="button-subscription-action"
          >
            <CreditCard className="w-6 h-6 ml-3" />
            <div className="text-right">
              <div className="font-bold">إدارة الاشتراك</div>
              <div className="text-xs text-muted-foreground">عرض الباقات والتجديد</div>
            </div>
          </Button>

          <Button
            variant="outline"
            className="h-20"
            onClick={() => setLocation('/owner/images')}
            data-testid="button-images-action"
          >
            <ImageIcon className="w-6 h-6 ml-3" />
            <div className="text-right">
              <div className="font-bold">إدارة الصور</div>
              <div className="text-xs text-muted-foreground">رفع وتحديث صور العقار</div>
            </div>
          </Button>
        </div>

        {/* Property Images */}
        {property.imageUrls && property.imageUrls.length > 0 && (
          <Card className="p-6 mt-6">
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
                  data-testid={`img-property-${idx}`}
                />
              ))}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
