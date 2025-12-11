import { useRoute, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, MapPin, Compass, Home, Phone } from "lucide-react";
import { useState, useEffect } from "react";
import type { TouchEvent } from "react";
import { PriceDisplay } from "@/components/price-display";
import { useToast } from "@/hooks/use-toast";
import { trackEvent } from "@/lib/analytics";

// ⭐ مؤشر السحب المحسّن - يظهر لمدة 4 ثواني ثم يختفي
function EdgeSwipeIndicator() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), 4000);
    return () => clearTimeout(timer);
  }, []);

  if (!visible) return null;

  return (
    <div className="swipe-hint-container">
      <div className="swipe-hint-content">
        <div className="swipe-arrows">
          <span></span>
          <span></span>
          <span></span>
        </div>
        <span className="swipe-text">اسحب للرجوع</span>
      </div>
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
  return property.subscriptionType?.trim().includes("مميز");
}

function detectDeviceType() {
  const ua = navigator.userAgent || navigator.vendor || (window as any).opera;

  // iPhone / iPad / iPod
  if (/iPhone|iPad|iPod/i.test(ua)) return "iphone";

  // Android phones
  if (/Android/i.test(ua)) return "android";

  // Detect Facebook, Instagram, TikTok internal browsers
  if (/FBAN|FBAV|Instagram|IG|TikTok|Snapchat|SCBrowser/i.test(ua))
    return "inapp";

  // Desktop Browsers
  if (/Windows|Macintosh|Linux/i.test(ua)) return "desktop";

  return "unknown";
}

export default function PropertyDetailsPage() {
  const [, params] = useRoute<{ id: string }>("/property/:id");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isSending, setIsSending] = useState(false);
  const [shake, setShake] = useState(false);

  const [selectedImage, setSelectedImage] = useState<number>(0);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);

  const propertyId = params?.id ?? "";

  // جلب بيانات العقار مباشرة من الخادم (أسرع من Google Apps Script)
  const {
    data: property,
    isLoading,
    isError,
  } = useQuery<PropertyDetails | null>({
    queryKey: ["property-details", propertyId],
    queryFn: async () => {
      if (!propertyId) return null;

      // محاولة الجلب من الخادم المحلي أولاً (أسرع بكثير)
      try {
        const localRes = await fetch(`/api/properties/${propertyId}`);
        if (localRes.ok) {
          const data = await localRes.json();
          if (data) {
            return {
              propertyNumber: data.propertyNumber || propertyId,
              name: data.name || "",
              city: data.city || "",
              direction: data.direction || "",
              location: data.location || "",
              type: data.type || "",
              facilities: Array.isArray(data.facilities) ? data.facilities : [],
              prices: data.prices || {
                weekday: "",
                weekend: "",
                overnight: "",
                holidays: "",
              },
              subscriptionType:
                data.subscriptionType || (data.name ? "مميز" : "عادي"),
              phone: data.whatsappNumber || "",
              imageCount: 0,
            } as PropertyDetails;
          }
        }
      } catch {
        // تجاهل - سنجرب Google Apps Script
      }

      // الرجوع إلى Google Apps Script
      const res = await fetch(
        "https://script.google.com/macros/s/AKfycbzKX7i9qZ9UPPQOEjC44d_WR70nwMFal4zC_LRKcM09S_lg68AMvWs7J2PVIgZn_aBJ/exec?action=getData",
      );
      if (!res.ok) {
        throw new Error("فشل في جلب البيانات");
      }

      const raw = await res.json();
      if (!Array.isArray(raw)) return null;

      const item = raw.find((p: any) => String(p["رقم العقار"]) === propertyId);
      if (!item) return null;

      const name = item["اسم العقار"] || "";
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

      return {
        propertyNumber: String(item["رقم العقار"] || ""),
        name,
        city: item["المنطقة"] || "",
        direction: item["الاتجاه"] || "",
        location: item["الموقع"] || "",
        type: item["النوع"] || "",
        facilities,
        prices: {
          weekday: item["سعر وسط الأسبوع"]
            ? String(item["سعر وسط الأسبوع"])
            : "",
          weekend: item["سعر نهاية الأسبوع"]
            ? String(item["سعر نهاية الأسبوع"])
            : "",
          overnight: item["سعر المبيت"] ? String(item["سعر المبيت"]) : "",
          holidays: item["سعر الإجازات"] ? String(item["سعر الإجازات"]) : "",
        },
        subscriptionType: name ? "مميز" : "عادي",
        phone: item["رقم الجوال"] ? String(item["رقم الجوال"]) : "",
        imageCount: 0,
      } as PropertyDetails;
    },
    staleTime: 1000 * 60 * 5, // 5 دقائق
    retry: 1,
    refetchOnWindowFocus: false,
  });

  // ✅ تتبع الزيارات
  useEffect(() => {
    if (!propertyId) return;

    const trackView = async () => {
      try {
        const deviceType = detectDeviceType();

        await fetch("/api/track-pageview", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            propertyNumber: propertyId,
            userAgent: navigator.userAgent,
            device: deviceType,
          }),
        });
      } catch (err) {
        console.log("Failed to track page view:", err);
      }
    };

    trackView();
  }, [propertyId]);

  // ✅ إعادة تعيين الصورة المختارة عند تغيّر العقار
  useEffect(() => {
    if (!property) return;
    setSelectedImage(0);
  }, [property?.propertyNumber]);

  // جلب الصور من R2 بشكل متوازي مع البيانات
  const { data: r2ImagesData } = useQuery<string[]>({
    queryKey: ["r2-images", propertyId],
    queryFn: async () => {
      if (!propertyId) return [];
      try {
        const res = await fetch(`/api/admin/r2-images/${propertyId}`);
        if (res.ok) {
          const data = await res.json();
          return data.images || [];
        }
      } catch {
        // تجاهل
      }
      return [];
    },
    staleTime: 1000 * 60 * 10, // 10 دقائق
    enabled: !!propertyId,
  });

  const images = r2ImagesData || [];

  // إعادة تعيين حالة تحميل الصورة عند تغيير الصورة
  useEffect(() => {
    setImageLoaded(false);
  }, [selectedImage]);

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
            حدث خطأ أثناء الاتصال بالخادم. تأكد من الاتصال بالإنترنت ثم حاول مرة
            أخرى.
          </p>
          <div className="flex justify-center gap-3">
            <Button onClick={() => window.location.reload()}>
              إعادة المحاولة
            </Button>
            <Button variant="outline" onClick={() => setLocation("/")}>
              العودة للرئيسية
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  // حالة التحميل مع Skeleton
  if (isLoading || !property) {
    return (
      <div className="min-h-screen bg-background">
        <header className="bg-card border-b border-border shadow-sm sticky top-0 z-10">
          <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setLocation("/")}
            >
              <ArrowRight className="w-5 h-5" />
            </Button>
            <div className="flex-1">
              <div className="h-5 w-32 bg-muted animate-pulse rounded" />
              <div className="h-3 w-20 bg-muted animate-pulse rounded mt-1" />
            </div>
          </div>
        </header>
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2 space-y-4">
              <Card className="overflow-hidden">
                <div className="aspect-video bg-muted animate-pulse flex items-center justify-center">
                  <Home className="w-16 h-16 text-muted-foreground/30" />
                </div>
              </Card>
              <Card className="p-6">
                <div className="h-6 w-32 bg-muted animate-pulse rounded mb-4" />
                <div className="flex flex-wrap gap-6">
                  {[1, 2, 3, 4].map((i) => (
                    <div
                      key={i}
                      className="h-12 w-24 bg-muted animate-pulse rounded"
                    />
                  ))}
                </div>
              </Card>
            </div>
            <div className="space-y-4">
              <Card className="p-6">
                <div className="h-6 w-20 bg-muted animate-pulse rounded mb-4" />
                <div className="space-y-3">
                  {[1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className="h-8 bg-muted animate-pulse rounded"
                    />
                  ))}
                </div>
              </Card>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ===== سحب باللمس للصور =====
  const handleTouchStart = (e: TouchEvent<HTMLDivElement>) => {
    setTouchStartX(e.touches[0].clientX);
  };

  const handleTouchEnd = (e: TouchEvent<HTMLDivElement>) => {
    if (touchStartX == null) return;
    const diff = e.changedTouches[0].clientX - touchStartX;
    const threshold = 40;

    if (diff > threshold) {
      setSelectedImage((prev) =>
        images.length ? (prev - 1 + images.length) % images.length : prev,
      );
    } else if (diff < -threshold) {
      setSelectedImage((prev) =>
        images.length ? (prev + 1) % images.length : prev,
      );
    }

    setTouchStartX(null);
  };

  // إخفاء اسم العقار لغير المشتركين
  const displayName = isVerified(property) ? property.name : "";

  // الواتساب: رقم العقار المميّز أو رقم افتراضي
  const handleWhatsApp = async () => {
    // ⭐ عند الضغط المتكرر — اهتزاز فقط
    if (isSending) {
      setShake(true);
      setTimeout(() => setShake(false), 500);
      return;
    }

    setIsSending(true);

    try {
      const response = await fetch("/api/requests/smart", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyNumber: property.propertyNumber }),
      });

      const result = await response.json();

      if (!response.ok) {
        if (result.remainingTimeFormatted) {
          toast({
            title: "⏱️ انتظر",
            description: `${result.remainingTimeFormatted}\nقبل إرسال طلب آخر لنفس العقار`,
            variant: "destructive",
          });
        }
        setIsSending(false);
        return;
      }

      const DEFAULT_WHATSAPP = "966533220646";
      const whatsappNumber = property.phone || DEFAULT_WHATSAPP;
      const nameText = isVerified(property) ? ` - ${property.name}` : "";
      const message = `مرحباً، أنا مهتم بالعقار رقم ${property.propertyNumber}${nameText}\n\nكود الطلب: ${result.requestCode}`;

      const isMobile =
        /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
          navigator.userAgent,
        );

      const url = isMobile
        ? `whatsapp://send?phone=${whatsappNumber}&text=${encodeURIComponent(message)}`
        : `https://web.whatsapp.com/send?phone=${whatsappNumber}&text=${encodeURIComponent(message)}`;

      if (isMobile) {
        window.location.href = url; // الجوال
      } else {
        window.open(url, "_blank"); // سطح المكتب
      }

      toast({
        title: "✅ تم تسجيل طلبك",
        description: `في ${result.requestTime}`,
      });

      // رجوع الزر بعد ثانيتين
      setTimeout(() => setIsSending(false), 2000);
    } catch (error) {
      console.error("Error creating WhatsApp request:", error);
      toast({
        title: "خطأ",
        description: "حدث خطأ عند تسجيل الطلب",
        variant: "destructive",
      });
      setIsSending(false);
    }
  };

  // ⭐ دالة الرجوع المتوافقة مع Safari + Chrome + Edge + Wouter
  const goBack = (e?: React.MouseEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }

    // لو فيه خطوة سابقة في التاريخ → رجوع طبيعي
    if (window.history.length > 1) {
      window.history.back();
      return;
    }

    // fallback — لو ما فيه خطوة سابقة (فتح مباشر)
    setLocation("/properties"); // أو "/" حسب موقعك
  };

  return (
    <div className="min-h-screen bg-background">
      {/* ⭐ مؤشر السحب */}
      <EdgeSwipeIndicator />

      {/* ===== Header ===== */}
      <header className="bg-card border-b border-border shadow-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-3">
          {/* زر الرجوع */}
          <Button variant="ghost" size="icon" onClick={goBack}>
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
              مميز
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

                    {/* Skeleton أثناء تحميل الصورة */}
                    {!imageLoaded && (
                      <div className="absolute inset-0 bg-muted animate-pulse flex items-center justify-center">
                        <Home className="w-16 h-16 text-muted-foreground/30" />
                      </div>
                    )}
                    <img
                      src={images[selectedImage]}
                      alt={`صورة ${selectedImage + 1}`}
                      className={`w-full h-full object-cover transition-opacity duration-300 ${imageLoaded ? "opacity-100" : "opacity-0"}`}
                      loading="eager"
                      decoding="async"
                      data-testid="img-main"
                      draggable={false}
                      onLoad={() => setImageLoaded(true)}
                    />

                    {images.length > 1 && (
                      <>
                        {/* الزر على اليمين — الآن يروح للصورة "التالية" — والشكل سهم احترافي */}
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedImage(
                              (prev) => (prev + 1) % images.length,
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
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M15 19l-7-7 7-7"
                            />
                          </svg>
                        </button>

                        {/* الزر على اليسار — الآن يروح للصورة "السابقة" — والشكل سهم احترافي */}
                        <button
                          type="button"
                          onClick={() =>
                            setSelectedImage(
                              (prev) =>
                                (prev - 1 + images.length) % images.length,
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
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              d="M9 5l7 7-7 7"
                            />
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
              <h2 className="text-xl font-bold text-primary mb-4">
                تفاصيل العقار
              </h2>

              <div className="flex flex-wrap items-center gap-6 mb-6">
                <div className="flex items-center gap-2">
                  <MapPin className="w-5 h-5 text-primary" />
                  <div>
                    <p className="text-xs text-muted-foreground">المدينة</p>
                    <p className="font-semibold">
                      {property.city || "غير محدد"}
                    </p>
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
                    <p className="font-semibold">
                      {property.type || "غير محدد"}
                    </p>
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
                    <PriceDisplay amount={property.prices.weekday} size="md" />
                  </div>
                )}

                {property.prices?.weekend && (
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">نهاية الأسبوع</span>
                    <PriceDisplay amount={property.prices.weekend} size="md" />
                  </div>
                )}

                {property.prices?.overnight && (
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">مبيت</span>
                    <PriceDisplay
                      amount={property.prices.overnight}
                      size="md"
                    />
                  </div>
                )}

                {property.prices?.holidays && (
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">إجازات</span>
                    <PriceDisplay amount={property.prices.holidays} size="md" />
                  </div>
                )}
              </div>
            </Card>

            {/* التواصل */}
            <Card className="p-6">
              <h3 className="text-lg font-bold text-primary mb-4">التواصل</h3>
              <Button
                onClick={handleWhatsApp}
                disabled={isSending}
                className={`
    w-full text-white 
    ${isSending ? "bg-gray-400 cursor-not-allowed" : "bg-[#25D366] hover:bg-[#128C7E]"}
    ${shake ? "animate-shake" : ""}
  `}
                size="lg"
                data-testid="button-whatsapp"
              >
                {isSending ? (
                  <span className="flex items-center gap-2">
                    <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24">
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                      />
                    </svg>
                    جاري التحميل...
                  </span>
                ) : (
                  <>
                    <Phone className="w-5 h-5 ml-2" />
                    تواصل عبر واتساب
                  </>
                )}
              </Button>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
