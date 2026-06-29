"use client";

import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, MapPin, Compass, Home, Phone, Moon, Sparkles } from "lucide-react";
import { useState, useEffect } from "react";
import type { TouchEvent } from "react";
import { PriceDisplay } from "@/components/price-display";
import { useToast } from "@/hooks/use-toast";
import { useRouter } from "next/navigation";
import Link from "next/link";

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
export interface PropertyDetails {
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
    subscriptionType: string;
    subscriptionStatus?: string;
    subscriptionEndDate?: string;
    isSubscriptionExpired?: boolean;
    phone?: string;
    imageCount: number;
    imageUrls?: string[];
}

const R2_BASE = "https://pub-e2fc1c0a598f4f0e91e47af63219848e.r2.dev";

function isVerified(property: PropertyDetails) {
    if (property.isSubscriptionExpired) return false;
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

interface PropertyDetailsClientProps {
    propertyId: string;
    initialProperty?: PropertyDetails | null;
    initialImages?: string[];
}

export default function PropertyDetailsClient({ propertyId, initialProperty, initialImages }: PropertyDetailsClientProps) {
    const router = useRouter();
    const { toast } = useToast();
    const [isSending, setIsSending] = useState(false);
    const [shake, setShake] = useState(false);

    const [selectedImage, setSelectedImage] = useState<number>(0);
    const [touchStartX, setTouchStartX] = useState<number | null>(null);
    const [imageLoaded, setImageLoaded] = useState(false);

    // ✅ التمرير للأعلى عند فتح صفحة التفاصيل
    useEffect(() => {
        window.scrollTo({ top: 0, behavior: "instant" });
    }, [propertyId]);

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
                                data.isSubscriptionExpired ? "عادي" : (data.subscriptionType || (data.name ? "مميز" : "عادي")),
                            subscriptionStatus: data.subscriptionStatus,
                            subscriptionEndDate: data.subscriptionEndDate,
                            isSubscriptionExpired: data.isSubscriptionExpired,
                            phone: data.whatsappNumber || "",
                            imageCount: 0,
                            imageUrls: Array.isArray(data.imageUrls) ? data.imageUrls : [],
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
        initialData: initialProperty ?? undefined,
    });

    // جلب بيانات SEO المخصصة للعقار
    const { data: seoData } = useQuery<{
        seoDescription: string;
        metaTitle: string;
        keywords: string[];
    }>({
        queryKey: ["property-seo", propertyId],
        queryFn: async () => {
            if (!propertyId) return null;
            const res = await fetch(`/api/properties/${propertyId}/seo`);
            if (res.ok) return res.json();
            return null;
        },
        staleTime: 1000 * 60 * 10, // 10 دقائق
        refetchOnWindowFocus: false,
    });

    // جلب بيانات المناسبة النشطة (عروض العيد)
    const { data: activeOccasion } = useQuery<{
        occasion: { id: string; name: string; slug: string; type: string; days: { key: string; label: string }[]; theme: string };
        properties: { id: string; occasionId: string; propertyNumber: string; availability: Record<string, boolean>; prices: Record<string, string> }[];
    } | null>({
        queryKey: ["/api/occasions/active"],
        staleTime: 1000 * 60 * 5,
        refetchOnWindowFocus: false,
    });

    // Get this property's occasion data
    const propertyOccasionData = activeOccasion?.properties.find(
        p => p.propertyNumber === propertyId
    );

    // NOTE: Schema and Metadata handling removed from here as it should be handled by the Server Page or Layout

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
                const res = await fetch(`/api/public/property-images/${propertyId}`);
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
        initialData: initialImages ?? undefined,
    });

    // دمج الصور من R2 + imageUrls من بيانات العقار (بدون تكرار)
    const images = (() => {
        const r2Urls = r2ImagesData || [];
        const propertyUrls = property?.imageUrls || [];
        const merged = [...r2Urls];
        for (const url of propertyUrls) {
            if (url && !merged.includes(url)) {
                merged.push(url);
            }
        }
        return merged;
    })();

    // إعادة تعيين حالة تحميل الصورة عند تغيير الصورة
    useEffect(() => {
        setImageLoaded(false);
    }, [selectedImage]);

    // ✅ Preload للصور الأولى عند تحميل الصفحة + الصورة التالية
    useEffect(() => {
        if (!images || images.length === 0) return;

        // تحميل مسبق للصور الـ 3 الأولى فوراً
        images.slice(0, 3).forEach((src) => {
            const img = new Image();
            img.src = src;
        });
    }, [images]);

    // Preload للصورة التالية عند التنقل
    useEffect(() => {
        if (!images || images.length === 0) return;
        const nextIndex = (selectedImage + 1) % images.length;
        const prevIndex = selectedImage === 0 ? images.length - 1 : selectedImage - 1;

        // تحميل الصورة التالية والسابقة
        [nextIndex, prevIndex].forEach((idx) => {
            const img = new Image();
            img.src = images[idx];
        });
    }, [images, selectedImage]);

    // ===== حالات التحميل / الخطأ / غير موجود =====

    if (isError) {
        return (
            <div className="min-h-screen bg-gradient-to-b from-background to-muted/30 flex items-center justify-center px-4">
                <Card className="p-10 text-center space-y-5 max-w-md border-border/60 shadow-[0_8px_40px_-12px_rgba(0,0,0,0.18)] rounded-3xl animate-in fade-in zoom-in-95 duration-500">
                    <div className="w-16 h-16 mx-auto rounded-2xl bg-destructive/10 flex items-center justify-center">
                        <Home className="w-8 h-8 text-destructive/70" />
                    </div>
                    <h2 className="text-2xl font-bold tracking-tight">تعذر تحميل البيانات</h2>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                        حدث خطأ أثناء الاتصال بالخادم. تأكد من الاتصال بالإنترنت ثم حاول مرة
                        أخرى.
                    </p>
                    <div className="flex justify-center gap-3 pt-2">
                        <Button onClick={() => window.location.reload()} className="rounded-xl shadow-sm">
                            إعادة المحاولة
                        </Button>
                        <Button variant="outline" onClick={() => router.push("/")} className="rounded-xl">
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
            <div className="min-h-screen bg-gradient-to-b from-background to-muted/20">
                <header className="bg-card/80 backdrop-blur-xl border-b border-border/60 shadow-sm sticky top-0 z-10">
                    <div className="max-w-7xl mx-auto px-4 py-3.5 flex items-center gap-3">
                        <Button
                            variant="ghost"
                            size="icon"
                            className="rounded-xl"
                            onClick={() => {
                                if (window.history.length > 1) {
                                    router.back();
                                } else {
                                    router.push("/");
                                }
                            }}
                        >
                            <ArrowRight className="w-5 h-5" />
                        </Button>
                        <div className="flex-1">
                            <div className="h-5 w-36 bg-muted shimmer rounded-lg" />
                            <div className="h-3 w-24 bg-muted shimmer rounded-lg mt-1.5" />
                        </div>
                    </div>
                </header>
                <div className="max-w-7xl mx-auto px-4 py-6">
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                        <div className="lg:col-span-2 space-y-5">
                            <Card className="overflow-hidden rounded-3xl border-border/60">
                                <div className="aspect-video bg-muted shimmer flex items-center justify-center">
                                    <Home className="w-16 h-16 text-muted-foreground/20" />
                                </div>
                            </Card>
                            <Card className="p-7 rounded-3xl border-border/60">
                                <div className="h-6 w-36 bg-muted shimmer rounded-lg mb-5" />
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                    {[1, 2, 3, 4].map((i) => (
                                        <div key={i} className="h-20 bg-muted shimmer rounded-2xl" />
                                    ))}
                                </div>
                            </Card>
                        </div>
                        <div className="space-y-5">
                            <Card className="p-7 rounded-3xl border-border/60">
                                <div className="h-6 w-24 bg-muted shimmer rounded-lg mb-5" />
                                <div className="space-y-3.5">
                                    {[1, 2, 3].map((i) => (
                                        <div key={i} className="h-9 bg-muted shimmer rounded-xl" />
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

    // ===== سمة العرض: مميّز مقابل عادي =====
    const premium = isVerified(property);

    return (
        <div
            className={`min-h-screen transition-colors ${premium
                ? "bg-gradient-to-b from-[#fdfbf4] via-background to-[#faf6ea] dark:from-[#13110a] dark:via-background dark:to-[#100e08]"
                : "bg-gradient-to-b from-background to-muted/20"
                }`}
        >
            {/* ⭐ مؤشر السحب */}
            <EdgeSwipeIndicator />

            {/* ===== Header ===== */}
            <header
                className={`backdrop-blur-xl border-b shadow-soft sticky top-0 z-20 ${premium
                    ? "bg-card/70 border-amber-200/40 dark:border-amber-700/20"
                    : "bg-card/70 border-border/50"
                    }`}
            >
                {/* خيط ذهبي رفيع للمميّز فقط */}
                {premium && (
                    <div className="h-0.5 w-full bg-gradient-to-l from-transparent via-[#d4af37] to-transparent opacity-70 shimmer-gold" />
                )}
                <div className="max-w-7xl mx-auto px-4 py-3.5 flex items-center gap-3">
                    {/* زر الرجوع */}
                    <Button
                        variant="ghost"
                        size="icon"
                        className="rounded-xl hover:bg-primary/10 hover:-translate-x-0.5 transition-all duration-200"
                        onClick={() => {
                            if (window.history.length > 1) {
                                router.back();
                            } else {
                                router.push("/");
                            }
                        }}
                    >
                        <ArrowRight className="w-5 h-5" />
                    </Button>

                    <div className="flex-1 min-w-0">
                        <h1 className="text-lg font-bold text-primary truncate tracking-tight">
                            {displayName || `عقار رقم ${property.propertyNumber}`}
                        </h1>
                        <p className="text-xs text-muted-foreground font-medium">
                            عقار رقم {property.propertyNumber}
                        </p>
                    </div>

                    {/* شارة موثوق */}
                    {premium && (
                        <Badge className="bg-gradient-to-l from-[#d4af37] to-[#b8932f] text-white border-0 text-xs px-3 py-1.5 gap-1 shadow-[0_2px_12px_-2px_rgba(212,175,55,0.6)] rounded-full animate-in fade-in slide-in-from-top-1 duration-500">
                            <Sparkles className="w-3 h-3" />
                            مميز
                        </Badge>
                    )}
                </div>
            </header>

            {/* ===== Content ===== */}
            <div className="max-w-7xl mx-auto px-4 py-6 md:py-8">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                    {/* ===== الصور ===== */}
                    <div className="lg:col-span-2 space-y-5">
                        <Card
                            className={`overflow-hidden rounded-3xl transition-all duration-500 animate-in fade-in slide-in-from-bottom-2 ${premium
                                ? "border-amber-200/50 dark:border-amber-700/25 ring-1 ring-[#d4af37]/25 shadow-[0_12px_48px_-18px_rgba(184,147,47,0.4)] hover:shadow-[0_16px_56px_-18px_rgba(184,147,47,0.5)]"
                                : "border-border/60 shadow-[0_8px_40px_-16px_rgba(0,0,0,0.2)] hover:shadow-[0_12px_48px_-16px_rgba(0,0,0,0.28)]"
                                }`}
                        >
                            {images.length > 0 ? (
                                <>
                                    <div
                                        className="relative aspect-video bg-muted select-none img-zoom group"
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
                                            <div className="absolute inset-0 bg-muted shimmer flex items-center justify-center">
                                                <Home className="w-16 h-16 text-muted-foreground/20" />
                                            </div>
                                        )}
                                        <img
                                            key={selectedImage}
                                            src={images[selectedImage]}
                                            alt={`صورة ${selectedImage + 1}`}
                                            className={`w-full h-full object-cover transition-all duration-500 ease-out ${imageLoaded ? "opacity-100 scale-100" : "opacity-0 scale-105"}`}
                                            loading="eager"
                                            decoding="async"
                                            data-testid="img-main"
                                            draggable={false}
                                            onLoad={() => setImageLoaded(true)}
                                        />

                                        {/* تدرّج خفيف أسفل الصورة لإبراز العدّاد */}
                                        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-black/35 to-transparent opacity-90" />

                                        {/* عدّاد الصور */}
                                        {images.length > 1 && (
                                            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-black/45 backdrop-blur-md text-white text-xs font-medium tabular-nums tracking-wide">
                                                {selectedImage + 1} / {images.length}
                                            </div>
                                        )}

                                        {images.length > 1 && (
                                            <>
                                                {/* الزر على اليمين — الآن يروح للصورة "التالية" — والشكل سهم احترافي */}
                                                <button
                                                    type="button"
                                                    aria-label="الصورة التالية"
                                                    onClick={() =>
                                                        setSelectedImage(
                                                            (prev) => (prev + 1) % images.length,
                                                        )
                                                    }
                                                    className="absolute inset-y-0 right-3 my-auto h-11 w-11 rounded-full bg-white/85 backdrop-blur-md flex items-center justify-center text-foreground shadow-[0_4px_16px_-4px_rgba(0,0,0,0.3)] hover:bg-white transition-all duration-200 hover:scale-110 active:scale-95 md:opacity-0 md:group-hover:opacity-100"
                                                >
                                                    {/* شكل جديد للسهم ← للداخل (Next) */}
                                                    <svg
                                                        xmlns="http://www.w3.org/2000/svg"
                                                        className="w-5 h-5"
                                                        fill="none"
                                                        viewBox="0 0 24 24"
                                                        stroke="currentColor"
                                                        strokeWidth={2.2}
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
                                                    aria-label="الصورة السابقة"
                                                    onClick={() =>
                                                        setSelectedImage(
                                                            (prev) =>
                                                                (prev - 1 + images.length) % images.length,
                                                        )
                                                    }
                                                    className="absolute inset-y-0 left-3 my-auto h-11 w-11 rounded-full bg-white/85 backdrop-blur-md flex items-center justify-center text-foreground shadow-[0_4px_16px_-4px_rgba(0,0,0,0.3)] hover:bg-white transition-all duration-200 hover:scale-110 active:scale-95 md:opacity-0 md:group-hover:opacity-100"
                                                >
                                                    {/* شكل جديد للسهم → للخارج (Prev) */}
                                                    <svg
                                                        xmlns="http://www.w3.org/2000/svg"
                                                        className="w-5 h-5"
                                                        fill="none"
                                                        viewBox="0 0 24 24"
                                                        stroke="currentColor"
                                                        strokeWidth={2.2}
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
                                        <div className="p-4 bg-muted/30 flex gap-2.5 overflow-x-auto custom-scrollbar">
                                            {images.map((img, idx) => (
                                                <button
                                                    key={idx}
                                                    onClick={() => setSelectedImage(idx)}
                                                    className={`flex-shrink-0 w-20 h-20 rounded-2xl overflow-hidden transition-all duration-300 ${selectedImage === idx
                                                        ? premium
                                                            ? "ring-2 ring-[#d4af37] ring-offset-2 ring-offset-background shadow-golden scale-105"
                                                            : "ring-2 ring-primary ring-offset-2 ring-offset-background scale-105"
                                                        : "opacity-55 hover:opacity-100 hover:scale-105 ring-1 ring-border/40"
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
                                <div className="aspect-video bg-gradient-to-br from-muted to-muted/50 flex items-center justify-center">
                                    <div className="text-center">
                                        <div className="w-16 h-16 mx-auto mb-3 rounded-2xl bg-background/60 flex items-center justify-center">
                                            <Home className="w-8 h-8 text-muted-foreground" />
                                        </div>
                                        <p className="text-muted-foreground font-medium">لا توجد صور</p>
                                    </div>
                                </div>
                            )}
                        </Card>

                        {/* ===== التفاصيل ===== */}
                        <Card
                            className={`p-7 rounded-3xl shadow-[0_4px_24px_-12px_rgba(0,0,0,0.12)] animate-in fade-in slide-in-from-bottom-2 duration-500 ${premium
                                ? "border-amber-200/50 dark:border-amber-700/25 bg-gradient-to-br from-[#fffdf7] to-card dark:from-amber-950/5 dark:to-card"
                                : "border-border/60"
                                }`}
                            style={{ animationDelay: "80ms" }}
                        >
                            <div className="flex items-center gap-2.5 mb-6">
                                <span className={`h-5 w-1 rounded-full ${premium ? "bg-[#d4af37]" : "bg-primary"}`} />
                                <h2 className="text-xl font-bold text-primary tracking-tight">
                                    تفاصيل العقار
                                </h2>
                            </div>

                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-7">
                                {[
                                    { icon: MapPin, label: "المدينة", value: property.city },
                                    { icon: Compass, label: "الاتجاه", value: property.direction },
                                    { icon: Home, label: "النوع", value: property.type },
                                    { icon: MapPin, label: "الموقع", value: property.location },
                                ].map((item, i) => {
                                    const Icon = item.icon;
                                    return (
                                        <div
                                            key={i}
                                            className={`flex items-center gap-3 p-3.5 rounded-2xl border transition-all duration-200 hover:-translate-y-0.5 ${premium
                                                ? "bg-amber-50/40 border-amber-200/40 hover:bg-amber-50/70 hover:shadow-sm dark:bg-amber-950/10 dark:border-amber-800/20"
                                                : "bg-muted/40 border-border/40 hover:bg-muted/60 hover:shadow-sm"
                                                }`}
                                        >
                                            <div className={`w-10 h-10 shrink-0 rounded-xl flex items-center justify-center ${premium ? "bg-[#d4af37]/15" : "bg-primary/10"}`}>
                                                <Icon className={`w-5 h-5 ${premium ? "text-[#b8932f]" : "text-primary"}`} />
                                            </div>
                                            <div className="min-w-0">
                                                <p className="text-[11px] text-muted-foreground font-medium">{item.label}</p>
                                                <p className="font-semibold truncate">
                                                    {item.value || "غير محدد"}
                                                </p>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>

                            {property.facilities?.length > 0 && (
                                <div className="pt-5 border-t border-border/50">
                                    <h3 className="font-bold mb-3.5 text-foreground/90">المرافق</h3>
                                    <div className="flex flex-wrap gap-2">
                                        {property.facilities.map((facility, idx) => (
                                            <Badge
                                                key={idx}
                                                variant="outline"
                                                className={`text-sm font-medium px-3 py-1.5 rounded-full transition-all duration-200 hover:scale-105 ${premium
                                                    ? "bg-amber-50/50 border-amber-200/60 text-amber-900 hover:bg-amber-100/60 dark:bg-amber-950/15 dark:text-amber-300 dark:border-amber-800/30"
                                                    : "bg-muted/40 border-border/60 hover:bg-primary/5 hover:border-primary/30"
                                                    }`}
                                                data-testid={`badge-facility-${idx}`}
                                            >
                                                {facility}
                                            </Badge>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </Card>

                        {/* وصف العقار - للمميزة فقط */}
                        {property.subscriptionType?.includes("مميز") && seoData?.seoDescription && (
                            <Card className="p-7 rounded-3xl bg-gradient-to-l from-amber-50/60 to-transparent dark:from-amber-900/10 border-amber-200/60 dark:border-amber-700/30 shadow-[0_4px_24px_-12px_rgba(212,175,55,0.25)] animate-in fade-in slide-in-from-bottom-2 duration-500">
                                <div className="flex items-center gap-2.5 mb-4">
                                    <div className="w-9 h-9 rounded-xl bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
                                        <Sparkles className="w-4 h-4 text-amber-600 dark:text-amber-400" />
                                    </div>
                                    <h3 className="text-lg font-bold text-primary">وصف العقار</h3>
                                    <Badge variant="outline" className="text-[10px] bg-amber-100 text-amber-700 border-amber-300 dark:bg-amber-900/30 dark:text-amber-400 dark:border-amber-600 rounded-full">
                                        ميزة مميزة
                                    </Badge>
                                </div>
                                <p className="text-muted-foreground leading-relaxed">{seoData.seoDescription}</p>
                            </Card>
                        )}
                    </div>

                    {/* ===== الأسعار + التواصل ===== */}
                    <div className="space-y-5 lg:sticky lg:top-24 lg:self-start">
                        {/* الأسعار */}
                        <Card
                            className={`p-7 rounded-3xl shadow-[0_4px_24px_-12px_rgba(0,0,0,0.12)] animate-in fade-in slide-in-from-bottom-2 duration-500 ${premium
                                ? "border-amber-200/50 dark:border-amber-700/25 bg-gradient-to-br from-[#fffdf7] to-card dark:from-amber-950/5 dark:to-card"
                                : "border-border/60"
                                }`}
                            style={{ animationDelay: "120ms" }}
                        >
                            <div className="flex items-center gap-2.5 mb-5">
                                <span className={`h-5 w-1 rounded-full ${premium ? "bg-[#d4af37]" : "bg-primary"}`} />
                                <h3 className="text-lg font-bold text-primary tracking-tight">الأسعار</h3>
                            </div>
                            <div className="space-y-2.5">
                                {property.prices?.weekday && (
                                    <div className={`flex justify-between items-center py-2.5 px-3.5 rounded-2xl transition-all duration-200 hover:translate-x-0.5 ${premium ? "bg-amber-50/40 hover:bg-amber-50/70 dark:bg-amber-950/10" : "bg-muted/30 hover:bg-muted/50"}`}>
                                        <span className="text-muted-foreground font-medium">وسط الأسبوع</span>
                                        <PriceDisplay amount={property.prices.weekday} size="md" />
                                    </div>
                                )}

                                {property.prices?.weekend && (
                                    <div className={`flex justify-between items-center py-2.5 px-3.5 rounded-2xl transition-all duration-200 hover:translate-x-0.5 ${premium ? "bg-amber-50/40 hover:bg-amber-50/70 dark:bg-amber-950/10" : "bg-muted/30 hover:bg-muted/50"}`}>
                                        <span className="text-muted-foreground font-medium">نهاية الأسبوع</span>
                                        <PriceDisplay amount={property.prices.weekend} size="md" />
                                    </div>
                                )}

                                {property.prices?.overnight && (
                                    <div className={`flex justify-between items-center py-2.5 px-3.5 rounded-2xl transition-all duration-200 hover:translate-x-0.5 ${premium ? "bg-amber-50/40 hover:bg-amber-50/70 dark:bg-amber-950/10" : "bg-muted/30 hover:bg-muted/50"}`}>
                                        <span className="text-muted-foreground font-medium">مبيت</span>
                                        <PriceDisplay
                                            amount={property.prices.overnight}
                                            size="md"
                                        />
                                    </div>
                                )}

                                {property.prices?.holidays && (
                                    <div className={`flex justify-between items-center py-2.5 px-3.5 rounded-2xl transition-all duration-200 hover:translate-x-0.5 ${premium ? "bg-amber-50/40 hover:bg-amber-50/70 dark:bg-amber-950/10" : "bg-muted/30 hover:bg-muted/50"}`}>
                                        <span className="text-muted-foreground font-medium">إجازات</span>
                                        <PriceDisplay amount={property.prices.holidays} size="md" />
                                    </div>
                                )}
                            </div>
                        </Card>

                        {/* عروض المناسبات - توفر الأيام */}
                        {activeOccasion && propertyOccasionData && (
                            <Card className="p-7 rounded-3xl border-[#2d6b45]/25 bg-gradient-to-br from-[#f0fdf4] to-[#fefce8] shadow-[0_4px_24px_-12px_rgba(45,107,69,0.2)] animate-in fade-in slide-in-from-bottom-2 duration-500">
                                <div className="flex items-center gap-2.5 mb-5">
                                    <div className="w-9 h-9 rounded-xl bg-[#d4af37]/15 flex items-center justify-center">
                                        <Moon className="w-5 h-5 text-[#d4af37]" />
                                    </div>
                                    <h3 className="text-lg font-bold text-[#1a472a]">
                                        {activeOccasion.occasion.name}
                                    </h3>
                                </div>
                                <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
                                    {activeOccasion.occasion.days?.map(day => (
                                        <div key={day.key} className="text-center">
                                            <div
                                                className={`w-11 h-11 mx-auto rounded-2xl flex items-center justify-center mb-1.5 transition-transform hover:scale-110 ${
                                                    propertyOccasionData.availability[day.key]
                                                        ? "bg-gradient-to-br from-green-500 to-green-600 shadow-md shadow-green-200"
                                                        : "bg-gray-100 border border-gray-200"
                                                }`}
                                            >
                                                {propertyOccasionData.availability[day.key] && (
                                                    <span className="text-white text-sm font-bold">✓</span>
                                                )}
                                            </div>
                                            <p className="text-[10px] text-[#6b6b6b] leading-tight font-medium">{day.label}</p>
                                            {propertyOccasionData.prices[day.key] && propertyOccasionData.availability[day.key] && (
                                                <div className="mt-1">
                                                    <PriceDisplay amount={propertyOccasionData.prices[day.key]} size="sm" />
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                                <div className="flex items-center gap-4 mt-5 pt-4 border-t border-[#2d6b45]/15 text-[10px] text-[#6b6b6b]">
                                    <div className="flex items-center gap-1.5">
                                        <div className="w-2.5 h-2.5 rounded-full bg-gradient-to-br from-green-500 to-green-600" />
                                        <span className="font-medium">متوفر</span>
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                        <div className="w-2.5 h-2.5 rounded-full bg-gray-100 border border-gray-200" />
                                        <span className="font-medium">غير متوفر</span>
                                    </div>
                                </div>
                            </Card>
                        )}

                        {/* التواصل */}
                        <Card
                            className={`p-7 rounded-3xl shadow-[0_4px_24px_-12px_rgba(0,0,0,0.12)] animate-in fade-in slide-in-from-bottom-2 duration-500 ${premium
                                ? "border-amber-200/50 dark:border-amber-700/25 bg-gradient-to-br from-[#fffdf7] to-card dark:from-amber-950/5 dark:to-card"
                                : "border-border/60"
                                }`}
                            style={{ animationDelay: "160ms" }}
                        >
                            <div className="flex items-center gap-2.5 mb-5">
                                <span className={`h-5 w-1 rounded-full ${premium ? "bg-[#d4af37]" : "bg-primary"}`} />
                                <h3 className="text-lg font-bold text-primary tracking-tight">التواصل</h3>
                            </div>
                            <Button
                                onClick={handleWhatsApp}
                                disabled={isSending}
                                className={`
    group/wa w-full text-white rounded-2xl h-12 text-base font-semibold shadow-[0_4px_20px_-6px_rgba(37,211,102,0.5)] transition-all duration-200 hover:shadow-[0_6px_24px_-6px_rgba(37,211,102,0.6)] hover:-translate-y-0.5 active:translate-y-0
    ${isSending ? "bg-gray-400 cursor-not-allowed shadow-none hover:translate-y-0" : "bg-[#25D366] hover:bg-[#1eb858]"}
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
                                        <Phone className="w-5 h-5 ml-2 transition-transform duration-200 group-hover/wa:rotate-12" />
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