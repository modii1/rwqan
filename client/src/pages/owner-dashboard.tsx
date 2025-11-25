import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Property } from "@shared/schema";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LogOut, CreditCard, Image as ImageIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

export default function OwnerDashboard() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: property, isLoading } = useQuery<Property>({
    queryKey: ['/api/owner/property'],
  });

  useEffect(() => {
    // Check if logged in
    fetch('/api/owner/session')
      .then(res => {
        if (!res.ok) {
          setLocation('/owner/login');
        }
      })
      .catch(() => setLocation('/owner/login'));
  }, [setLocation]);

  const handleLogout = async () => {
    try {
      await apiRequest('POST', '/api/owner/logout');
      toast({
        title: "تم تسجيل الخروج",
        description: "نراك قريباً!",
      });
      setLocation('/owner/login');
    } catch (error) {
      console.error('Logout error:', error);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="inline-block w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
          <p className="mt-4 text-muted-foreground">جاري التحميل...</p>
        </div>
      </div>
    );
  }

  if (!property) {
    return null;
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-card border-b border-border shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
              <svg className="w-5 h-5 text-primary" fill="currentColor" viewBox="0 0 20 20">
                <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z"></path>
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-bold text-primary">لوحة التحكم</h1>
              <p className="text-sm text-muted-foreground">عقار رقم {property.propertyNumber}</p>
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
                <p className="font-semibold">{property.name}</p>
              </div>
              <div>
                <span className="text-sm text-muted-foreground">المدينة:</span>
                <p className="font-semibold">{property.city}</p>
              </div>
              <div>
                <span className="text-sm text-muted-foreground">الاتجاه:</span>
                <p className="font-semibold">{property.direction}</p>
              </div>
              <div>
                <span className="text-sm text-muted-foreground">النوع:</span>
                <p className="font-semibold">{property.type}</p>
              </div>
              <div>
                <span className="text-sm text-muted-foreground">نوع الاشتراك:</span>
                <Badge variant={property.subscriptionType === 'موثوق' ? 'default' : 'secondary'}>
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
                    <p className="font-semibold">{new Date(property.subscriptionDate).toLocaleDateString('ar-SA')}</p>
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
                  <p className="text-muted-foreground">اشتراك مجاني (نسبة 10% من الحجز)</p>
                  <Button
                    className="w-full gradient-golden"
                    onClick={() => setLocation('/owner/subscription')}
                    data-testid="button-subscribe"
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
            data-testid="button-subscription"
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
            data-testid="button-images"
          >
            <ImageIcon className="w-6 h-6 ml-3" />
            <div className="text-right">
              <div className="font-bold">إدارة الصور</div>
              <div className="text-xs text-muted-foreground">رفع وتحديث صور العقار</div>
            </div>
          </Button>
        </div>

        {/* Property Images */}
        {property.imageUrls.length > 0 && (
          <Card className="p-6 mt-6">
            <h2 className="text-lg font-bold text-primary mb-4">صور العقار ({property.imageUrls.length})</h2>
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
      </div>
    </div>
  );
}
