"use client";

import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, BadgeCheck, ChevronLeft, ChevronRight, Compass, Copy, Home, Images, MapPin, Moon, Phone, Share2, Sparkles, Tags } from "lucide-react";
import { useState, useEffect } from "react";
import type { TouchEvent } from "react";
import { PriceDisplay } from "@/components/price-display";
import { useToast } from "@/hooks/use-toast";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getEffectiveSubscriptionType, isActivePremiumSubscription } from "@shared/subscriptionType";

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

function isVerified(property: PropertyDetails) {
    return isActivePremiumSubscription({
        subscriptionType: property.subscriptionType,
        status: property.subscriptionStatus,
        isExpired: property.isSubscriptionExpired,
    });
}

function getExternalHref(value?: string) {
    const trimmed = value?.trim();
    if (!trimmed) return "";
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    if (/^www\./i.test(trimmed)) return `https://${trimmed}`;
    return "";
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
                            subscriptionType: getEffectiveSubscriptionType({
                                subscriptionType: data.subscriptionType,
                                status: data.subscriptionStatus,
                                isExpired: data.isSubscriptionExpired,
                            }),
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
                subscriptionType: getEffectiveSubscriptionType({ subscriptionType: name ? "مميز" : "عادي" }),
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
                <Card className="p-10 text-center space-y-5 max-w-md border-border/60 shadow-[0_8px_40px_-12px_rgba(0,0,0,0.18)] rounded-lg animate-in fade-in zoom-in-95 duration-500">
                    <div className="w-16 h-16 mx-auto rounded-lg bg-destructive/10 flex items-center justify-center">
                        <Home className="w-8 h-8 text-destructive/70" />
                    </div>
                    <h2 className="text-2xl font-bold tracking-tight">تعذر تحميل البيانات</h2>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                        حدث خطأ أثناء الاتصال بالخادم. تأكد من الاتصال بالإنترنت ثم حاول مرة
                        أخرى.
                    </p>
                    <div className="flex justify-center gap-3 pt-2">
                        <Button onClick={() => window.location.reload()} className="rounded-lg shadow-sm">
                            إعادة المحاولة
                        </Button>
                        <Button variant="outline" onClick={() => router.push("/")} className="rounded-lg">
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
                            className="rounded-lg"
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
                            <Card className="overflow-hidden rounded-lg border-border/60">
                                <div className="aspect-video bg-muted shimmer flex items-center justify-center">
                                    <Home className="w-16 h-16 text-muted-foreground/20" />
                                </div>
                            </Card>
                            <Card className="p-7 rounded-lg border-border/60">
                                <div className="h-6 w-36 bg-muted shimmer rounded-lg mb-5" />
                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                                    {[1, 2, 3, 4].map((i) => (
                                        <div key={i} className="h-20 bg-muted shimmer rounded-lg" />
                                    ))}
                                </div>
                            </Card>
                        </div>
                        <div className="space-y-5">
                            <Card className="p-7 rounded-lg border-border/60">
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

    const handleShare = async () => {
        const shareUrl = window.location.href;
        try {
            if (navigator.share) {
                await navigator.share({
                    title: displayName || `عقار رقم ${property.propertyNumber}`,
                    text: `عقار رقم ${property.propertyNumber} على روقان`,
                    url: shareUrl,
                });
                return;
            }

            await navigator.clipboard.writeText(shareUrl);
            toast({
                title: "تم نسخ رابط العقار",
                description: "يمكنك مشاركة الرابط الآن",
            });
        } catch {
            toast({
                title: "تعذر مشاركة الرابط",
                description: "انسخ رابط الصفحة من المتصفح وحاول مرة أخرى",
                variant: "destructive",
            });
        }
    };

    const premium = isVerified(property);
    const locationHref = getExternalHref(property.location);
    const facts = [
        { icon: MapPin, label: "المدينة", value: property.city || "غير محدد" },
        { icon: Compass, label: "الاتجاه", value: property.direction || "غير محدد" },
        { icon: Home, label: "النوع", value: property.type || "غير محدد" },
        { icon: Images, label: "الصور", value: images.length ? `${images.length} صورة` : "لا توجد صور" },
    ];
    const priceRows = [
        { label: "وسط الأسبوع", amount: property.prices?.weekday },
        { label: "نهاية الأسبوع", amount: property.prices?.weekend },
        { label: "مبيت", amount: property.prices?.overnight },
        { label: "إجازات", amount: property.prices?.holidays },
    ].filter((row) => row.amount);
    const leadPrice = priceRows[0];
    const facilityCount = property.facilities?.length || 0;
    const visibleFacilities = property.facilities?.slice(0, 8) || [];
    const hiddenFacilitiesCount = Math.max(0, facilityCount - visibleFacilities.length);
    const summaryItems = [
        { label: "المرافق", value: facilityCount ? `${facilityCount} مرفق` : "غير محددة" },
        { label: "الأسعار", value: priceRows.length ? `${priceRows.length} خيارات` : "غير محددة" },
        { label: "نوع الاشتراك", value: premium ? "مميز" : "عادي" },
    ];

    return (
        <div className="min-h-screen bg-[#faf8f1]" dir="rtl">
            <EdgeSwipeIndicator />

            <header className="sticky top-0 z-20 border-b border-[#e5dcc7] bg-[#fffdf8]/90 backdrop-blur-xl">
                <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3">
                    <Button
                        variant="ghost"
                        size="icon"
                        className="rounded-lg hover:bg-[#f3ead8]"
                        onClick={() => {
                            if (window.history.length > 1) router.back();
                            else router.push("/");
                        }}
                    >
                        <ArrowRight className="h-5 w-5" />
                    </Button>
                    <div className="min-w-0 flex-1">
                        <p className="text-xs font-medium text-[#8b7140]">عقار رقم {property.propertyNumber}</p>
                        <h1 className="truncate text-base font-bold text-[#2f2a1f] sm:text-lg">
                            {displayName || `عقار رقم ${property.propertyNumber}`}
                        </h1>
                    </div>
                    {premium && (
                        <Badge className="gap-1 rounded-lg border-0 bg-[#b88d2b] px-3 py-1.5 text-white">
                            <BadgeCheck className="h-3.5 w-3.5" />
                            مميز
                        </Badge>
                    )}
                </div>
            </header>

            <main className="mx-auto max-w-7xl px-4 py-5 md:py-8">
                <section className="mb-5 overflow-hidden rounded-lg border border-[#e2d6bd] bg-[#fffdf8] shadow-[0_14px_45px_-38px_rgba(85,66,28,0.7)]">
                    <div className="grid gap-0 md:grid-cols-[minmax(0,1fr)_auto]">
                        <div className="grid gap-px bg-[#eadfca] sm:grid-cols-3">
                            {summaryItems.map((item) => (
                                <div key={item.label} className="bg-[#fffdf8] px-4 py-3">
                                    <p className="text-xs font-semibold text-[#8b7140]">{item.label}</p>
                                    <p className="mt-1 text-sm font-bold text-[#2f2a1f]">{item.value}</p>
                                </div>
                            ))}
                        </div>
                        <div className="flex items-center gap-2 border-t border-[#e2d6bd] bg-[#fbf7ee] p-3 md:border-r md:border-t-0">
                            <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                onClick={handleShare}
                                className="rounded-lg border-[#d8c9a8] bg-white text-[#6f5520] transition hover:bg-[#f7edd9]"
                                title="مشاركة العقار"
                                aria-label="مشاركة العقار"
                            >
                                <Share2 className="h-4 w-4" />
                            </Button>
                            <Button
                                type="button"
                                variant="outline"
                                size="icon"
                                onClick={async () => {
                                    try {
                                        await navigator.clipboard.writeText(property.propertyNumber);
                                        toast({ title: "تم نسخ رقم العقار" });
                                    } catch {
                                        toast({
                                            title: "تعذر نسخ رقم العقار",
                                            description: "يمكنك نسخه يدوياً من أعلى الصفحة",
                                            variant: "destructive",
                                        });
                                    }
                                }}
                                className="rounded-lg border-[#d8c9a8] bg-white text-[#6f5520] transition hover:bg-[#f7edd9]"
                                title="نسخ رقم العقار"
                                aria-label="نسخ رقم العقار"
                            >
                                <Copy className="h-4 w-4" />
                            </Button>
                            {locationHref && (
                                <Link
                                    href={locationHref}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex h-10 items-center gap-2 rounded-lg border border-[#d8c9a8] bg-white px-3 text-sm font-semibold text-[#6f5520] transition hover:bg-[#f7edd9]"
                                >
                                    <MapPin className="h-4 w-4" />
                                    الموقع
                                </Link>
                            )}
                        </div>
                    </div>
                </section>

                <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
                    <section className="space-y-5">
                        <Card className="overflow-hidden rounded-lg border-[#e2d6bd] bg-white shadow-[0_18px_50px_-35px_rgba(85,66,28,0.65)]">
                            <div
                                className="group relative aspect-[4/3] bg-[#efe7d8] sm:aspect-video"
                                onTouchStart={handleTouchStart}
                                onTouchEnd={handleTouchEnd}
                            >
                                {images.length > 1 && (
                                    <link rel="preload" as="image" href={images[(selectedImage + 1) % images.length]} />
                                )}

                                {images.length > 0 ? (
                                    <>
                                        {!imageLoaded && (
                                            <div className="absolute inset-0 flex items-center justify-center bg-[#efe7d8] shimmer">
                                                <Home className="h-14 w-14 text-[#b8aa8d]" />
                                            </div>
                                        )}
                                        <img
                                            key={selectedImage}
                                            src={images[selectedImage]}
                                            alt={`صورة ${selectedImage + 1}`}
                                            className={`h-full w-full object-cover transition duration-500 ${imageLoaded ? "opacity-100" : "opacity-0"}`}
                                            loading="eager"
                                            decoding="async"
                                            data-testid="img-main"
                                            draggable={false}
                                            onLoad={() => setImageLoaded(true)}
                                        />
                                        {images.length > 2 && (
                                            <div className="absolute left-4 top-4 hidden gap-2 md:flex">
                                                {images.slice(0, 3).map((img, idx) => (
                                                    <button
                                                        key={`${img}-preview`}
                                                        type="button"
                                                        onClick={() => setSelectedImage(idx)}
                                                        className={`h-16 w-20 overflow-hidden rounded-lg border border-white/50 bg-white/15 shadow-lg backdrop-blur transition hover:-translate-y-0.5 hover:border-white ${
                                                            selectedImage === idx ? "ring-2 ring-[#d4af37]" : "opacity-85"
                                                        }`}
                                                        aria-label={`عرض الصورة ${idx + 1}`}
                                                    >
                                                        <img src={img} alt={`صورة ${idx + 1}`} className="h-full w-full object-cover" loading="lazy" decoding="async" draggable={false} />
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />

                                        <div className="absolute bottom-4 right-4 left-4 flex flex-col gap-3 text-white md:flex-row md:items-end md:justify-between">
                                            <div className="min-w-0">
                                                <div className="mb-2 flex flex-wrap items-center gap-2">
                                                    {premium && (
                                                        <Badge className="rounded-lg border-0 bg-[#d4af37] text-[#2f2a1f]">
                                                            <Sparkles className="ml-1 h-3 w-3" />
                                                            مميز
                                                        </Badge>
                                                    )}
                                                    <Badge variant="outline" className="rounded-lg border-white/40 bg-white/15 text-white backdrop-blur">
                                                        {property.type || "عقار"}
                                                    </Badge>
                                                </div>
                                                <h2 className="truncate text-2xl font-bold sm:text-3xl">
                                                    {displayName || `عقار رقم ${property.propertyNumber}`}
                                                </h2>
                                                <p className="mt-1 flex items-center gap-1.5 text-sm text-white/85">
                                                    <MapPin className="h-4 w-4" />
                                                    {property.city || "غير محدد"} {property.direction ? `، ${property.direction}` : ""}
                                                </p>
                                            </div>
                                            {images.length > 1 && (
                                                <div className="w-fit rounded-lg bg-black/45 px-3 py-1.5 text-xs font-semibold tabular-nums backdrop-blur">
                                                    {selectedImage + 1} / {images.length}
                                                </div>
                                            )}
                                        </div>

                                        {images.length > 1 && (
                                            <>
                                                <button
                                                    type="button"
                                                    aria-label="الصورة التالية"
                                                    onClick={() => setSelectedImage((prev) => (prev + 1) % images.length)}
                                                    className="absolute right-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg bg-white/90 text-[#2f2a1f] shadow-lg transition hover:bg-white md:opacity-0 md:group-hover:opacity-100"
                                                >
                                                    <ChevronRight className="h-5 w-5" />
                                                </button>
                                                <button
                                                    type="button"
                                                    aria-label="الصورة السابقة"
                                                    onClick={() => setSelectedImage((prev) => (prev - 1 + images.length) % images.length)}
                                                    className="absolute left-3 top-1/2 flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-lg bg-white/90 text-[#2f2a1f] shadow-lg transition hover:bg-white md:opacity-0 md:group-hover:opacity-100"
                                                >
                                                    <ChevronLeft className="h-5 w-5" />
                                                </button>
                                            </>
                                        )}
                                    </>
                                ) : (
                                    <div className="flex h-full items-center justify-center text-center">
                                        <div>
                                            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-lg bg-white/70">
                                                <Home className="h-7 w-7 text-[#9b8c6e]" />
                                            </div>
                                            <p className="font-medium text-[#6f6249]">لا توجد صور</p>
                                        </div>
                                    </div>
                                )}
                            </div>

                            {images.length > 1 && (
                                <div className="flex gap-2 overflow-x-auto border-t border-[#eee4cf] bg-[#fffaf0] p-3 custom-scrollbar">
                                    {images.map((img, idx) => (
                                        <button
                                            key={img}
                                            onClick={() => setSelectedImage(idx)}
                                            className={`h-16 w-20 flex-shrink-0 overflow-hidden rounded-lg transition sm:h-20 sm:w-24 ${
                                                selectedImage === idx
                                                    ? "ring-2 ring-[#b88d2b] ring-offset-2 ring-offset-[#fffaf0]"
                                                    : "opacity-65 hover:opacity-100"
                                            }`}
                                            data-testid={`button-thumbnail-${idx}`}
                                            type="button"
                                        >
                                            <img src={img} alt={`صورة ${idx + 1}`} className="h-full w-full object-cover" loading="lazy" decoding="async" draggable={false} />
                                        </button>
                                    ))}
                                </div>
                            )}
                        </Card>

                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                            {facts.map((item) => {
                                const Icon = item.icon;
                                return (
                                    <Card key={item.label} className="rounded-lg border-[#e2d6bd] bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                                        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-lg bg-[#f5ecd9]">
                                            <Icon className="h-5 w-5 text-[#9a7623]" />
                                        </div>
                                        <p className="text-xs font-semibold text-[#8b7140]">{item.label}</p>
                                        <p className="mt-1 truncate font-bold text-[#2f2a1f]">{item.value}</p>
                                    </Card>
                                );
                            })}
                        </div>

                        <Card className="rounded-lg border-[#e2d6bd] bg-white p-5 shadow-sm md:p-6">
                            <div className="mb-5 flex items-center justify-between gap-3">
                                <div>
                                    <p className="text-xs font-semibold text-[#b88d2b]">التفاصيل</p>
                                    <h2 className="text-xl font-bold text-[#2f2a1f]">معلومات العقار</h2>
                                </div>
                                {locationHref && (
                                    <Link
                                        href={locationHref}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="rounded-lg border border-[#d8c9a8] px-3 py-2 text-sm font-semibold text-[#6f5520] transition hover:bg-[#f7edd9]"
                                    >
                                        فتح الموقع
                                    </Link>
                                )}
                            </div>

                            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                                <div className="rounded-lg bg-[#fbf7ee] p-4">
                                    <p className="text-xs text-[#8b7140]">رقم العقار</p>
                                    <p className="mt-1 font-bold text-[#2f2a1f]">{property.propertyNumber}</p>
                                </div>
                                <div className="rounded-lg bg-[#fbf7ee] p-4">
                                    <p className="text-xs text-[#8b7140]">المدينة</p>
                                    <p className="mt-1 font-bold text-[#2f2a1f]">{property.city || "غير محدد"}</p>
                                </div>
                                <div className="rounded-lg bg-[#fbf7ee] p-4">
                                    <p className="text-xs text-[#8b7140]">الاتجاه</p>
                                    <p className="mt-1 font-bold text-[#2f2a1f]">{property.direction || "غير محدد"}</p>
                                </div>
                                <div className="rounded-lg bg-[#fbf7ee] p-4">
                                    <p className="text-xs text-[#8b7140]">النوع</p>
                                    <p className="mt-1 font-bold text-[#2f2a1f]">{property.type || "غير محدد"}</p>
                                </div>
                                {property.location && (
                                    <div className="rounded-lg bg-[#fbf7ee] p-4 sm:col-span-2 lg:col-span-4">
                                        <p className="text-xs text-[#8b7140]">الموقع</p>
                                        {locationHref ? (
                                            <Link
                                                href={locationHref}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="mt-1 inline-flex max-w-full truncate font-bold text-[#6f5520] underline-offset-4 hover:underline"
                                            >
                                                {property.location}
                                            </Link>
                                        ) : (
                                            <p className="mt-1 font-bold text-[#2f2a1f]">{property.location}</p>
                                        )}
                                    </div>
                                )}
                            </div>

                            {visibleFacilities.length > 0 && (
                                <div className="mt-6 rounded-lg border border-[#eadfca] bg-[#fffaf0] p-4">
                                    <div className="mb-3 flex items-center gap-2">
                                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#ead59a]">
                                            <Tags className="h-4 w-4 text-[#6f5520]" />
                                        </div>
                                        <h3 className="font-bold text-[#2f2a1f]">أبرز المرافق</h3>
                                    </div>
                                    <div className="flex flex-wrap gap-2">
                                        {visibleFacilities.map((facility, idx) => (
                                            <span
                                                key={`featured-${facility}-${idx}`}
                                                className="rounded-lg bg-white px-3 py-1.5 text-sm font-semibold text-[#5e4a20] shadow-sm"
                                            >
                                                {facility}
                                            </span>
                                        ))}
                                        {hiddenFacilitiesCount > 0 && (
                                            <span className="rounded-lg border border-[#d8c9a8] px-3 py-1.5 text-sm font-bold text-[#6f5520]">
                                                +{hiddenFacilitiesCount}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            )}

                            {property.facilities?.length > 0 && (
                                <div className="mt-6 border-t border-[#eee4cf] pt-5">
                                    <h3 className="mb-3 font-bold text-[#2f2a1f]">المرافق</h3>
                                    <div className="flex flex-wrap gap-2">
                                        {property.facilities.map((facility, idx) => (
                                            <Badge
                                                key={`${facility}-${idx}`}
                                                variant="outline"
                                                className="rounded-lg border-[#d8c9a8] bg-[#fffaf0] px-3 py-1.5 text-sm font-semibold text-[#5e4a20] transition hover:border-[#b88d2b] hover:bg-[#f7edd9]"
                                                data-testid={`badge-facility-${idx}`}
                                            >
                                                {facility}
                                            </Badge>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </Card>

                        {premium && seoData?.seoDescription && (
                            <Card className="rounded-lg border-[#e0c98b] bg-[#fffaf0] p-5 shadow-sm md:p-6">
                                <div className="mb-3 flex items-center gap-2">
                                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#ead59a]">
                                        <Sparkles className="h-4 w-4 text-[#6f5520]" />
                                    </div>
                                    <h3 className="text-lg font-bold text-[#2f2a1f]">وصف العقار</h3>
                                </div>
                                <p className="leading-8 text-[#5f543f]">{seoData.seoDescription}</p>
                            </Card>
                        )}
                    </section>

                    <aside className="space-y-5 lg:sticky lg:top-24 lg:self-start">
                        <Card className="overflow-hidden rounded-lg border-[#3d3527] bg-[#2f2a1f] text-white shadow-[0_18px_50px_-35px_rgba(47,42,31,0.75)]">
                            <div className="border-b border-white/10 bg-white/5 p-5">
                                <div className="mb-3 flex items-center justify-between gap-3">
                                    <div>
                                        <p className="text-xs font-semibold text-[#d9c27b]">جاهز للتواصل</p>
                                        <h3 className="mt-1 text-xl font-bold">احجز أو استفسر الآن</h3>
                                    </div>
                                    <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-[#d4af37] text-[#2f2a1f]">
                                        <Phone className="h-5 w-5" />
                                    </div>
                                </div>
                                <p className="text-sm leading-6 text-white/70">
                                    عقار رقم {property.propertyNumber}
                                    {displayName ? ` - ${displayName}` : ""}
                                </p>
                            </div>
                            <div className="space-y-4 p-5">
                                {leadPrice && (
                                    <div className="flex items-center justify-between rounded-lg bg-white/10 px-4 py-3">
                                        <span className="text-sm text-white/70">{leadPrice.label}</span>
                                        <PriceDisplay amount={leadPrice.amount || ""} size="md" />
                                    </div>
                                )}
                                <Button
                                    onClick={handleWhatsApp}
                                    disabled={isSending}
                                    className={`group/wa h-12 w-full rounded-lg text-base font-semibold text-white transition ${
                                        isSending ? "bg-gray-500" : "bg-[#25D366] hover:bg-[#1eb858]"
                                    } ${shake ? "animate-shake" : ""}`}
                                    size="lg"
                                    data-testid="button-whatsapp"
                                >
                                    {isSending ? (
                                        <span className="flex items-center gap-2">
                                            <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24">
                                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                                            </svg>
                                            جاري التحميل...
                                        </span>
                                    ) : (
                                        <>
                                            <Phone className="ml-2 h-5 w-5 transition-transform group-hover/wa:rotate-12" />
                                            تواصل عبر واتساب
                                        </>
                                    )}
                                </Button>
                            </div>
                        </Card>

                        <Card className="rounded-lg border-[#e2d6bd] bg-white p-5 shadow-[0_18px_50px_-38px_rgba(85,66,28,0.65)]">
                            <div className="mb-4 flex items-center justify-between">
                                <h3 className="text-lg font-bold text-[#2f2a1f]">الأسعار</h3>
                                {premium && <Badge className="rounded-lg bg-[#f1dfaa] text-[#6f5520]">مميز</Badge>}
                            </div>
                            <div className="space-y-2">
                                {priceRows.length > 0 ? (
                                    priceRows.map((row) => (
                                        <div key={row.label} className="flex items-center justify-between rounded-lg bg-[#fbf7ee] px-4 py-3 transition hover:bg-[#f6edda]">
                                            <span className="font-medium text-[#6f6249]">{row.label}</span>
                                            <PriceDisplay amount={row.amount || ""} size="md" />
                                        </div>
                                    ))
                                ) : (
                                    <p className="rounded-lg bg-[#fbf7ee] px-4 py-3 text-sm text-[#6f6249]">الأسعار غير محددة</p>
                                )}
                            </div>
                        </Card>

                        {activeOccasion && propertyOccasionData && (
                            <Card className="rounded-lg border-[#c8dec5] bg-[#f8fff7] p-5 shadow-sm">
                                <div className="mb-4 flex items-center gap-2">
                                    <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#e5f4df]">
                                        <Moon className="h-5 w-5 text-[#2d6b45]" />
                                    </div>
                                    <h3 className="font-bold text-[#1a472a]">{activeOccasion.occasion.name}</h3>
                                </div>
                                <div className="grid grid-cols-3 gap-3">
                                    {activeOccasion.occasion.days?.map(day => (
                                        <div key={day.key} className="rounded-lg border border-[#dcebd8] bg-white p-2 text-center">
                                            <div className={`mx-auto mb-1 flex h-9 w-9 items-center justify-center rounded-lg ${
                                                propertyOccasionData.availability[day.key]
                                                    ? "bg-[#2d6b45] text-white"
                                                    : "bg-gray-100 text-gray-400"
                                            }`}>
                                                {propertyOccasionData.availability[day.key] ? "✓" : "-"}
                                            </div>
                                            <p className="text-[10px] font-medium text-[#5c684f]">{day.label}</p>
                                            {propertyOccasionData.prices[day.key] && propertyOccasionData.availability[day.key] && (
                                                <div className="mt-1">
                                                    <PriceDisplay amount={propertyOccasionData.prices[day.key]} size="sm" />
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </Card>
                        )}
                    </aside>
                </div>
            </main>
        </div>
    );
}
