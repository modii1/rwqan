import { useRoute, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Property } from "@shared/schema";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, MapPin, Compass, Home, Phone } from "lucide-react";
import { useState } from "react";

export default function PropertyDetailsPage() {
  const [, params] = useRoute("/property/:id");
  const [, setLocation] = useLocation();
  const [selectedImage, setSelectedImage] = useState<number>(0);

  const { data: properties = [] } = useQuery<Property[]>({
    queryKey: ["property-details"],
    queryFn: async () => {
      const res = await fetch(
        "https://script.google.com/macros/s/AKfycbzKX7i9qZ9UPPQOEjC44d_WR70nwMFal4zC_LRKcM09S_lg68AMvWs7J2PVIgZn_aBJ/exec?action=getData"
      );
      if (!res.ok) return [];

      const raw = await res.json();

      return raw.map((item: any) => {
        const propertyNumber = String(item["رقم العقار"] || "");
        const name = item["اسم العقار"] || "";
        const city = item["المنطقة"] || "";
        const direction = item["الاتجاه"] || "";
        const location = item["الموقع"] || "";
        const type = item["النوع"] || "";
        const facilities = (item["المرافق"] || "")
          .replace(/^\[|\]$/g, "")
          .split(",")
          .map((f: string) => f.replace(/"/g, "").trim());

        const prices = {
          weekday: item["سعر وسط الأسبوع"] ? String(item["سعر وسط الأسبوع"]) : "",
          weekend: item["سعر نهاية الأسبوع"] ? String(item["سعر نهاية الأسبوع"]) : "",
          overnight: item["سعر المبيت"] ? String(item["سعر المبيت"]) : "",
          holidays: item["سعر الإجازات"] ? String(item["سعر الإجازات"]) : "",
        };

        // 🔥 قاعدة الاشتراك: إذا فيه اسم عقار = مميز، إذا ما فيه = عادي
        const subscriptionType = item["اسم العقار"] ? "مميز" : "عادي";

        return {
          propertyNumber,
          name,
          city,
          direction,
          type,
          location,
          facilities,
          prices,
          subscriptionType,
        };
      });
    },
  });


  const property = properties.find(p => p.propertyNumber === params?.id);

  

  if (!property) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="p-8 text-center">
          <h2 className="text-xl font-bold mb-2">العقار غير موجود</h2>
          <Button onClick={() => setLocation('/')} data-testid="button-back">
            العودة للرئيسية
          </Button>
        </Card>
      </div>
    );
  }

      function isVerified(property: Property) {
        return (
          property.subscriptionType?.trim().includes("موثوق") ||
          property.subscriptionType?.trim().includes("مميز")
        );
      }

      // 🔥 بناء روابط صور R2 بدل Google Drive
      const r2Base = "https://pub-e2fc1c0a598f4f0e91e47af63219848e.r2.dev";

      const images = Array.from({ length: 20 }) // حد أقصى 20 صورة
        .map((_, i) => `${r2Base}/${property.propertyNumber}/${i + 1}.jpg`);

      // إخفاء اسم العقار لغير المشتركين
      const displayName = isVerified(property) ? property.name : "";

      // الواتساب بدون اسم للعقارات غير الموثوقة
      const handleWhatsApp = () => {
        const nameText = isVerified(property) ? ` - ${property.name}` : "";
        const message = `مرحباً، أنا مهتم بالعقار رقم ${property.propertyNumber}${nameText}`;
        const url = `https://wa.me/${property.whatsappNumber}?text=${encodeURIComponent(message)}`;
        window.open(url, "_blank");
      };

      return (
        <div className="min-h-screen bg-background">


      {/* ===== Header ===== */}
      <header className="bg-card border-b border-border shadow-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">

          {/* زر الرجوع */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => {
                const pos = sessionStorage.getItem("scrollPosition"); // جلب آخر مكان
                setLocation("/"); // رجوع للرئيسية

                // بعد الرجوع بوقت بسيط، ارجع للمكان بالضبط
                setTimeout(() => {
                  if (pos) window.scrollTo(0, Number(pos));
                }, 50);
              }}
            >

            <ArrowRight className="w-5 h-5" />
          </Button>

          {/* الاسم + الرقم */}
          <div className="flex-1">
            <h1 className="text-lg font-bold text-primary truncate">{displayName}</h1>
            <p className="text-xs text-muted-foreground">
              عقار رقم {property.propertyNumber}
            </p>
          </div>

          {/* شارة موثوق */}
                {isVerified(property) && (
                  <Badge className="bg-primary/10 text-primary border-primary/30 text-xs">
              موثوق
            </Badge>
          )}
        </div>
      </header>

      {/* ===== Content ===== */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">

          {/* ===== الصور ===== */}
          <div className="lg:col-span-2 space-y-4">
              <Card className={`overflow-hidden ${isVerified(property) ? 'ring-2 ring-primary/20' : ''}`}>

              {images.length > 0 ? (
                <>
                  <div className="relative aspect-video bg-muted">
                    <img
                      src={images[selectedImage]}
                      alt={`صورة ${selectedImage + 1}`}
                      className="w-full h-full object-cover"
                      data-testid="img-main"
                    />
                  </div>

                  {images.length > 1 && (
                    <div className="p-4 bg-muted/30 flex gap-2 overflow-x-auto">
                      {images.map((img, idx) => (
                        <button
                          key={idx}
                          onClick={() => setSelectedImage(idx)}
                          className={`flex-shrink-0 w-20 h-20 rounded-md overflow-hidden transition-all ${
                            selectedImage === idx
                              ? "ring-2 ring-primary"
                              : "opacity-60 hover:opacity-100"
                          }`}
                          data-testid={`button-thumbnail-${idx}`}
                        >
                          <img
                            src={img}
                            alt={`صورة ${idx + 1}`}
                            className="w-full h-full object-cover"
                          />
                        </button>
                      ))}
                    </div>
                  )}
                </>
              ) : (
                <div className="aspect-video bg-muted flex items-center justify-center">
                  <div className="text-center">
                    <Home className="w-16 h-16 mx-auto mb-2 text-muted-foreground" />
                    <p className="text-muted-foreground">لا توجد صور</p>
                  </div>
                </div>
              )}
            </Card>

            {/* ===== التفاصيل ===== */}
<Card className="p-6">
  <h2 className="text-xl font-bold text-primary mb-4">تفاصيل العقار</h2>

  <div className="flex flex-wrap items-center gap-6 mb-6">
    
    
    <div className="flex items-center gap-2">
      <MapPin className="w-5 h-5 text-primary" />
      <div>
        <p className="text-xs text-muted-foreground">المدينة</p>
        <p className="font-semibold">{property.city || "غير محدد"}</p>
      </div>
    </div>

    <div className="flex items-center gap-2">
      <Compass className="w-5 h-5 text-primary" />
      <div>
        <p className="text-xs text-muted-foreground">الاتجاه</p>
        <p className="font-semibold">{property.direction || "غير محدد"}</p>
      </div>
    </div>

    <div className="flex items-center gap-2">
      <Home className="w-5 h-5 text-primary" />
      <div>
        <p className="text-xs text-muted-foreground">النوع</p>
        <p className="font-semibold">{property.type || "غير محدد"}</p>
      </div>
    </div>

    {/* ===== الموقع / الحي ===== */}
    <div className="flex items-center gap-2">
      <MapPin className="w-5 h-5 text-primary" />
      <div>
        <p className="text-xs text-muted-foreground">الموقع</p>
        <p className="font-semibold">{property.location || property.neighborhood || "غير محدد"}</p>
      </div>
    </div>

  </div>




              {property.facilities?.length > 0 && (
                <div>
                  <h3 className="font-bold mb-3">المرافق</h3>
                  <div className="flex flex-wrap gap-2">
                    {property.facilities.map((facility, idx) => (
                      <Badge
                        key={idx}
                        variant="outline"
                        className="text-sm"
                        data-testid={`badge-facility-${idx}`}
                      >
                        {facility}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
            </Card>
          </div>

          {/* ===== الأسعار + التواصل ===== */}
          <div className="space-y-4">

            {/* الأسعار */}
            <Card className="p-6">
              <h3 className="text-lg font-bold text-primary mb-4">الأسعار</h3>
              <div className="space-y-3">
                {property.prices?.weekday && (
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">وسط الأسبوع</span>
                    <span className="font-bold text-primary">
                      {property.prices.weekday} ر.س
                    </span>
                  </div>
                )}

                {property.prices?.weekend && (
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">نهاية الأسبوع</span>
                    <span className="font-bold text-primary">
                      {property.prices.weekend} ر.س
                    </span>
                  </div>
                )}

                {property.prices?.overnight && (
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">مبيت</span>
                    <span className="font-bold text-primary">
                      {property.prices.overnight} ر.س
                    </span>
                  </div>
                )}

                {property.prices?.holidays && (
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">إجازات</span>
                    <span className="font-bold text-primary">
                      {property.prices.holidays} ر.س
                    </span>
                  </div>
                )}
              </div>
            </Card>

            {/* التواصل */}
            <Card className="p-6">
              <h3 className="text-lg font-bold text-primary mb-4">التواصل</h3>
              <Button
                onClick={handleWhatsApp}
                className="w-full bg-[#25D366] hover:bg-[#128C7E] text-white"
                size="lg"
                data-testid="button-whatsapp"
              >
                <Phone className="w-5 h-5 ml-2" />
                تواصل عبر واتساب
              </Button>
            </Card>

            

          </div>
        </div>
      </div>
    </div>
  );
}
