import { useRoute, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Property } from "@shared/schema";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, MapPin, Compass, Home, Phone } from "lucide-react";
import { useState, useEffect } from "react";

const SCRIPT_BASE =
  "https://script.google.com/macros/s/AKfycbzfNOTODQD2EG53U0X8dIjA7J_C5kDz9WYYxGjfVGbvtOz9XXE-YWhP7fY0sznMLvp5/exec";

// نفس دالة التحويل إلى /proxy/drive
const toProxyUrl = (url: string): string => {
  if (!url) return url;
  if (url.startsWith("/proxy/drive") || url.startsWith("/public")) return url;

  let match = url.match(/\/d\/([^/]+)/);
  if (!match) match = url.match(/[?&]id=([^&]+)/);
  if (!match) match = url.match(/googleusercontent\.com\/d\/([^/?]+)/);

  const id = match ? match[1] : null;
  if (!id) return url;

  return `/proxy/drive/${id}`;
};

export default function PropertyDetailsPage() {
  const [, params] = useRoute("/property/:id");
  const [, setLocation] = useLocation();
  const [selectedImage, setSelectedImage] = useState<number>(0);
  const [images, setImages] = useState<string[]>([]);

  const { data: properties = [] } = useQuery<Property[]>({
    queryKey: ["properties"],
    queryFn: async () => {
      const res = await fetch(
        `${SCRIPT_BASE}?page=getData`
      );

      const raw = await res.json();

      return raw.map((row: any) => ({
        propertyNumber: String(row["رقم العقار"] || ""),
        name: row["🏡 اسم العقار"] || "",
        city: row["📍 المنطقة"] || "",
        direction: row["🧭 الاتجاه"] || "",
        type: row["🏠 النوع"] || "",
        facilities: (row["🔹 المرافق"] || "")
          .split(/[,،]/)
          .map((f: string) => f.trim()),
        prices: {
          weekday: row["💰 سعر وسط الأسبوع"] || "",
          weekend: row["💰 سعر نهاية الأسبوع"] || "",
          overnight: row["💰 سعر المبيت"] || "",
          holidays: row["💰 سعر الإجازات"] || "",
        },
        imagesFolderUrl: row["🔗 رابط الصور"] || "",
        imageUrls: [],
        subscriptionType: row["🟡 نوع الاشتراك"] || "عادي",
        whatsappNumber: row["📞 رقم الجوال"] || "",
      }));
    },
  });

  const property = properties.find((p) => p.propertyNumber === params?.id);

  // تحميل صور هذا العقار فقط عبر Apps Script ثم تحويلها للبروكسي
  useEffect(() => {
    const loadImages = async () => {
      if (!property) return;

      try {
        const res = await fetch(
          `${SCRIPT_BASE}?page=images&propertyId=${encodeURIComponent(
            property.propertyNumber
          )}`
        );
        if (!res.ok) return;

        const imgs = await res.json();
        if (Array.isArray(imgs)) {
          const proxied = imgs
            .map((u: any) => toProxyUrl(String(u)))
            .filter(Boolean);
          setImages(proxied);
          setSelectedImage(0);
        }
      } catch (err) {
        console.error("Error loading images for details", err);
      }
    };

    loadImages();
  }, [property?.propertyNumber]);

  if (!property) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="p-8 text-center">
          <h2 className="text-xl font-bold mb-2">العقار غير موجود</h2>
          <Button onClick={() => setLocation("/")} data-testid="button-back">
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

  // إخفاء اسم العقار لغير المشتركين
  const displayName = isVerified(property) ? property.name : "";

  // الواتساب بدون اسم للعقارات غير الموثوقة
  const handleWhatsApp = () => {
    const nameText = isVerified(property) ? ` - ${property.name}` : "";
    const message = `مرحباً، أنا مهتم بالعقار رقم ${property.propertyNumber}${nameText}`;
    const url = `https://wa.me/${property.whatsappNumber}?text=${encodeURIComponent(
      message
    )}`;
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
            <h1 className="text-lg font-bold text-primary truncate">
              {displayName}
            </h1>
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
            <Card
              className={`overflow-hidden ${
                isVerified(property) ? "ring-2 ring-primary/20" : ""
              }`}
            >
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
                <div className="aspect-video flex items-center justify-center bg-muted text-muted-foreground">
                  لا توجد صور متاحة حالياً
                </div>
              )}
            </Card>
          </div>

          {/* ===== التفاصيل ===== */}
          <div className="space-y-4">
            <Card className="p-4 space-y-3">
              <div className="flex items-center gap-2 text-sm">
                <Home className="w-4 h-4 text-primary" />
                <span className="font-semibold">
                  {isVerified(property)
                    ? property.name
                    : "عقار موثوق في القصيم"}
                </span>
              </div>

              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <MapPin className="w-4 h-4" />
                <span>{property.city || "القصيم"}</span>
              </div>

              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Compass className="w-4 h-4" />
                <span>{property.direction || "غير محدد"}</span>
              </div>

              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Home className="w-4 h-4" />
                <span>{property.type || "غير محدد"}</span>
              </div>

              {/* الأسعار */}
              <div className="pt-3 border-t border-border/60 space-y-2">
                <h3 className="text-sm font-semibold text-primary">
                  الأسعار
                </h3>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {property.prices.weekday && (
                    <div className="flex flex-col p-2 rounded-md bg-muted">
                      <span className="text-muted-foreground">
                        وسط الأسبوع
                      </span>
                      <span className="font-bold text-primary">
                        {property.prices.weekday} ريال
                      </span>
                    </div>
                  )}

                  {property.prices.weekend && (
                    <div className="flex flex-col p-2 rounded-md bg-muted">
                      <span className="text-muted-foreground">
                        نهاية الأسبوع
                      </span>
                      <span className="font-bold text-primary">
                        {property.prices.weekend} ريال
                      </span>
                    </div>
                  )}

                  {property.prices.overnight && (
                    <div className="flex flex-col p-2 rounded-md bg-muted">
                      <span className="text-muted-foreground">
                        المبيت
                      </span>
                      <span className="font-bold text-primary">
                        {property.prices.overnight} ريال
                      </span>
                    </div>
                  )}

                  {property.prices.holidays && (
                    <div className="flex flex-col p-2 rounded-md bg-muted">
                      <span className="text-muted-foreground">
                        الإجازات
                      </span>
                      <span className="font-bold text-primary">
                        {property.prices.holidays} ريال
                      </span>
                    </div>
                  )}
                </div>
              </div>

              {/* المرافق */}
              {property.facilities.length > 0 && (
                <div className="pt-3 border-t border-border/60 space-y-2">
                  <h3 className="text-sm font-semibold text-primary">
                    المرافق
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {property.facilities.map((f, idx) => (
                      <Badge
                        key={idx}
                        variant="secondary"
                        className="text-[11px]"
                      >
                        {f}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}

              {/* زر الواتساب */}
              <div className="pt-4">
                <Button
                  className="w-full bg-[#25D366] hover:bg-[#1ebe5a] text-white font-bold flex items-center justify-center gap-2"
                  onClick={handleWhatsApp}
                  data-testid="button-whatsapp"
                >
                  <Phone className="w-4 h-4" />
                  تواصل عبر واتساب
                </Button>
              </div>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
