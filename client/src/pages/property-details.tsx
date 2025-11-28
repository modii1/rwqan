import { useRoute, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, MapPin, Compass, Home, Phone } from "lucide-react";
import { useState, useEffect } from "react";
import type { TouchEvent } from "react";

// ⭐ مؤشر السحب الذهبي في منتصف الشاشة (لا يلمس أي شيء من تصميمك)
// ⭐ مؤشر السحب المتدرّج (مجموعة أسهم)
function EdgeSwipeIndicator() {
  return (
    <div className="edge-swipe-arrows">
      <span></span>
      <span></span>
      <span></span>
    </div>
  );
}

// نوع داخلي لبيانات التفاصيل (مستقل عن @shared/schema)
interface PropertyDetails {
  propertyNumber: string;
  name: string;
  city: string;
  direction: string;
  type: string;
  location: string;
  facilities: string[];
  prices: {
    weekday: string;
    weekend: string;
    overnight: string;
    holidays: string;
  };
  subscriptionType: string; // "مميز" أو "عادي"
  phone?: string;
  imageCount: number;
}

const R2_BASE = "https://pub-e2fc1c0a598f4f0e91e47af63219848e.r2.dev";

function isVerified(property: PropertyDetails) {
  return (
    property.subscriptionType?.trim().includes("موثوق") ||
    property.subscriptionType?.trim().includes("مميز")
  );
}

export default function PropertyDetailsPage() {
  const [, params] = useRoute<{ id: string }>("/property/:id");
  const [, setLocation] = useLocation();

  const [selectedImage, setSelectedImage] = useState<number>(0);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);

  const propertyId = params?.id ?? "";

  const {
    data: properties = [],
    isLoading,
    isError,
  } = useQuery<PropertyDetails[]>({
    queryKey: ["property-details"],
    queryFn: async () => {
      const res = await fetch(
        "https://script.google.com/macros/s/AKfycbzKX7i9qZ9UPPQOEjC44d_WR70nwMFal4zC_LRKcM09S_lg68AMvWs7J2PVIgZn_aBJ/exec?action=getData"
      );
      if (!res.ok) {
        throw new Error("فشل في جلب البيانات");
      }

      const raw = await res.json();

      if (!Array.isArray(raw)) return [];

      return raw.map((item: any): PropertyDetails => {
        const propertyNumber = String(item["رقم العقار"] || "");
        const name = item["اسم العقار"] || "";
        const city = item["المنطقة"] || "";
        const direction = item["الاتجاه"] || "";
        const location = item["الموقع"] || "";
        const type = item["النوع"] || "";

        // المرافق: قد تكون نص عادي أو JSON مصفوفة
        let facilities: string[] = [];
        const rawFacilities = item["المرافق"] || "";
        if (typeof rawFacilities === "string") {
          const trimmed = rawFacilities.trim();
          if (trimmed.startsWith("[")) {
            try {
              const parsed = JSON.parse(trimmed);
              if (Array.isArray(parsed)) {
                facilities = parsed.map((f) => String(f).trim());
              }
            } catch {
              facilities = trimmed
                .split(",")
                .map((f: string) => f.replace(/"/g, "").trim())
                .filter(Boolean);
            }
          } else {
            facilities = trimmed
              .split(",")
              .map((f: string) => f.replace(/"/g, "").trim())
              .filter(Boolean);
          }
        }

        const prices = {
          weekday: item["سعر وسط الأسبوع"] ? String(item["سعر وسط الأسبوع"]) : "",
          weekend: item["سعر نهاية الأسبوع"] ? String(item["سعر نهاية الأسبوع"]) : "",
          overnight: item["سعر المبيت"] ? String(item["سعر المبيت"]) : "",
          holidays: item["سعر الإجازات"] ? String(item["سعر الإجازات"]) : "",
        };

        // قاعدة الاشتراك: إذا فيه اسم عقار = مميز، إذا ما فيه = عادي
        const subscriptionType = name ? "مميز" : "عادي";

        // رقم الجوال (للعقارات المميزة فقط عادة)
        const phone = item["رقم الجوال"] ? String(item["رقم الجوال"]) : "";

        // عدد الصور الحقيقي من عمود "رابط الصور" لو كان فيه مصفوفة
        let imageCount = 0;
        const imagesField = item["رابط الصور"];
        if (typeof imagesField === "string") {
          const trimmedImages = imagesField.trim();
          if (trimmedImages.startsWith("[")) {
            try {
              const arr = JSON.parse(trimmedImages);
              if (Array.isArray(arr)) {
                imageCount = arr.length;
              }
            } catch {
              // تجاهل الخطأ ونستعمل افتراضي
            }
          }
        }

        // لو ما قدرنا نطلع العدد الحقيقي، نستعمل 15 صورة افتراضيًا
        if (!imageCount) {
          imageCount = 15;
        }

        return {
          propertyNumber,
          name,
          city,
          direction,
          location,
          type,
          facilities,
          prices,
          subscriptionType,
          phone,
          imageCount,
        };
      });
    },

    staleTime: 1000 * 60, // دقيقة
    retry: 1,
    refetchOnWindowFocus: false,
  });

  const property = properties.find((p) => p.propertyNumber === propertyId);

  // ✅ إعادة تعيين الصورة المختارة عند تغيّر العقار
  useEffect(() => {
    if (!property) return;
    setSelectedImage(0);
  }, [property?.propertyNumber]);

  // نحسب الصور من R2 بشكل آمن
  let images: string[] = [];
  if (property && property.imageCount && property.imageCount > 0) {
    images = Array.from({ length: property.imageCount }, (_, i) => {
      return `${R2_BASE}/${property.propertyNumber}/${i + 1}.jpg`;
    });
  }

  // ✅ Preload للصورة التالية لتسريع التصفح
  useEffect(() => {
    if (!images || images.length === 0) return;
    const nextIndex = (selectedImage + 1) % images.length;
    const img = new Image();
    img.src = images[nextIndex];
  }, [images, selectedImage]);

  // ===== حالات التحميل / الخطأ / غير موجود =====

  if (isError) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="p-8 text-center space-y-4">
          <h2 className="text-xl font-bold mb-2">تعذر تحميل البيانات</h2>
          <p className="text-sm text-muted-foreground">
            حدث خطأ أثناء الاتصال بالخادم. تأكد من الاتصال بالإنترنت ثم حاول مرة أخرى.
          </p>
          <div className="flex justify-center gap-3">
            <Button onClick={() => window.location.reload()}>إعادة المحاولة</Button>
            <Button variant="outline" onClick={() => setLocation("/")}>
              العودة للرئيسية
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  if (!property) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">

      </div>
    );
  }

  // ===== سحب باللمس (Swipe) =====
  const handleTouchStart = (e: TouchEvent<HTMLDivElement>) => {
    setTouchStartX(e.touches[0].clientX);
  };

  const handleTouchEnd = (e: TouchEvent<HTMLDivElement>) => {
    if (touchStartX == null) return;
    const diff = e.changedTouches[0].clientX - touchStartX;
    const threshold = 40;

    if (diff > threshold) {
      // سحب لليمين => الصورة السابقة
      setSelectedImage((prev) =>
        images.length ? (prev - 1 + images.length) % images.length : prev
      );
    } else if (diff < -threshold) {
      // سحب لليسار => الصورة التالية
      setSelectedImage((prev) =>
        images.length ? (prev + 1) % images.length : prev
      );
    }

    setTouchStartX(null);
  };

  // إخفاء اسم العقار لغير المشتركين
  const displayName = isVerified(property) ? property.name : "";

  // الواتساب: رقم العقار المميّز أو رقم افتراضي
  const handleWhatsApp = () => {
    const DEFAULT_WHATSAPP = "966533220646";
    const whatsappNumber = property.phone || DEFAULT_WHATSAPP;
    const nameText = isVerified(property) ? ` - ${property.name}` : "";
    const message = `مرحباً، أنا مهتم بالعقار رقم ${property.propertyNumber}${nameText}`;
    const url = `https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`;
    window.open(url, "_blank");
  };

  return (
    <div className="min-h-screen bg-background">
      {/* ⭐ مؤشر السحب في منتصف الشاشة (لا يغيّر شيء من تصميمك) */}
      <EdgeSwipeIndicator />

      {/* ===== Header ===== */}
      <header className="bg-card border-b border-border shadow-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">
          {/* زر الرجوع */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => {
              const pos = sessionStorage.getItem("scrollPosition");
              setLocation("/");
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
              {displayName || `عقار رقم ${property.propertyNumber}`}
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
                  <div
                    className="relative aspect-video bg-muted select-none"
                    onTouchStart={handleTouchStart}
                    onTouchEnd={handleTouchEnd}
                  >
                    {/* Preload للصورة التالية */}
                    {images.length > 1 && (
                      <link
                        rel="preload"
                        as="image"
                        href={images[(selectedImage + 1) % images.length]}
                      />
                    )}

                    <img
                      src={images[selectedImage]}
                      alt={`صورة ${selectedImage + 1}`}
                      className="w-full h-full object-cover"
                      loading="eager"
                      decoding="async"
                      data-testid="img-main"
                      draggable={false}
                    />

                    {images.length > 1 && (
                      <>
                        {/* الزر على اليمين — الآن يروح للصورة "التالية" — والشكل سهم احترافي */}
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedImage(
                              (prev) => (prev + 1) % images.length
                            )
                          }
                          className="absolute inset-y-0 right-2 my-auto h-9 w-9 rounded-full bg-background/80 shadow flex items-center justify-center text-foreground text-sm hover:bg-background"
                        >
                          {/* شكل جديد للسهم ← للداخل (Next) */}
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            className="w-5 h-5"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
                          </svg>
                        </button>

                        {/* الزر على اليسار — الآن يروح للصورة "السابقة" — والشكل سهم احترافي */}
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedImage(
                              (prev) => (prev - 1 + images.length) % images.length
                            )
                          }
                          className="absolute inset-y-0 left-2 my-auto h-9 w-9 rounded-full bg-background/80 shadow flex items-center justify-center text-foreground text-sm hover:bg-background"
                        >
                          {/* شكل جديد للسهم → للخارج (Prev) */}
                          <svg
                            xmlns="http://www.w3.org/2000/svg"
                            className="w-5 h-5"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                            strokeWidth={2}
                          >
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                          </svg>
                        </button>
                      </>
                    )}
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
                          type="button"
                        >
                          <img
                            src={img}
                            alt={`صورة ${idx + 1}`}
                            className="w-full h-full object-cover"
                            loading="lazy"
                            decoding="async"
                            draggable={false}
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
                    <p className="font-semibold">
                      {property.direction || "غير محدد"}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Home className="w-5 h-5 text-primary" />
                  <div>
                    <p className="text-xs text-muted-foreground">النوع</p>
                    <p className="font-semibold">{property.type || "غير محدد"}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <MapPin className="w-5 h-5 text-primary" />
                  <div>
                    <p className="text-xs text-muted-foreground">الموقع</p>
                    <p className="font-semibold">
                      {property.location || "غير محدد"}
                    </p>
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