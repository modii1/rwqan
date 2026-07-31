"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowRight, BadgeCheck, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Compass, Home, Loader2, MapPin, Moon, Phone, Share2, Sparkles, Tags } from "lucide-react";
import { useState, useEffect, useMemo, useRef } from "react";
import type { TouchEvent } from "react";
import { PriceDisplay } from "@/components/price-display";
import { useToast } from "@/hooks/use-toast";
import { useSessionQuery } from "@/hooks/use-session";
import {
    CONTACT_IDENTITY_QUERY_KEY,
    EMPTY_CONTACT_IDENTITY,
    commitContactIdentityCache,
    useContactIdentityQuery,
} from "@/hooks/use-contact-identity";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { getEffectiveSubscriptionType } from "@shared/subscriptionType";
import { normalizeWhatsAppDestination } from "@shared/phone";
import {
    getPublicPropertyContactPolicyMessage,
    isPublicPropertyPremium,
} from "@/lib/public-subscription";
import {
    buildWhatsAppUrl,
    closeReservedWhatsAppTab,
    getCleanWhatsAppReturnUrl,
    navigatePropertyWhatsAppTab,
    reservePropertyWhatsAppTab,
    type ReservedWhatsAppTab,
} from "@/lib/whatsapp-navigation";
import { PropertyDetailsSkeleton } from "@/components/property-details-skeleton";
import { ContactPhoneDialog } from "@/components/contact/contact-phone-dialog";

const DEFAULT_WHATSAPP = "966533220646";

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
    imageCount: number;
    imageUrls?: string[];
}

function isVerified(property: PropertyDetails) {
    return isPublicPropertyPremium(property);
}

function getExternalHref(value?: string) {
    const trimmed = value?.trim();
    if (!trimmed) return "";
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    if (/^www\./i.test(trimmed)) return `https://${trimmed}`;
    return "";
}

function getSafeImageSrc(value?: string) {
    const trimmed = value?.trim();
    if (!trimmed || trimmed === "/" || trimmed === "#") return "";
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    if (trimmed.startsWith("/assets/")) return trimmed;
    return "";
}

function normalizeWhatsAppNumber(value?: string) {
    return normalizeWhatsAppDestination(value) || DEFAULT_WHATSAPP;
}

type ContactRequestErrorKind = "phone_required" | "cooldown" | "daily_limit" | "general";

class ContactRequestError extends Error {
    constructor(
        message: string,
        readonly kind: ContactRequestErrorKind,
        readonly remainingTimeFormatted?: string,
    ) {
        super(message);
        this.name = "ContactRequestError";
    }
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
    const queryClient = useQueryClient();
    const { toast } = useToast();
    const { data: ownerSession } = useSessionQuery();
    const contactIdentityQuery = useContactIdentityQuery();
    const contactButtonRef = useRef<HTMLButtonElement>(null);
    const isSendingRef = useRef(false);
    const contactFlowActiveRef = useRef(false);
    const [isSending, setIsSending] = useState(false);
    const [shake, setShake] = useState(false);
    const [isContactDialogOpen, setIsContactDialogOpen] = useState(false);
    const [whatsappFallbackUrl, setWhatsAppFallbackUrl] = useState<string | null>(null);

    const [selectedImage, setSelectedImage] = useState<number>(0);
    const [touchStartX, setTouchStartX] = useState<number | null>(null);
    const [imageLoaded, setImageLoaded] = useState(false);
    const [failedImageUrls, setFailedImageUrls] = useState<string[]>([]);
    const [showAllFacilities, setShowAllFacilities] = useState(false);

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
                            imageCount: 0,
                            imageUrls: Array.isArray(data.imageUrls) ? data.imageUrls : [],
                        } as PropertyDetails;
                    }
                }
            } catch {
                throw new Error("تعذر جلب بيانات العقار من الخادم");
            }

            // Never download the legacy full-property dataset in a public browser.
            return null;
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

        const cleanReturnUrl = getCleanWhatsAppReturnUrl(window.location.href);
        if (cleanReturnUrl) {
            window.history.replaceState(window.history.state, "", cleanReturnUrl);
            return;
        }

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
        setFailedImageUrls([]);
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
    const images = useMemo(() => {
        const r2Urls = (r2ImagesData || []).map(getSafeImageSrc).filter(Boolean);
        const propertyUrls = (property?.imageUrls || []).map(getSafeImageSrc).filter(Boolean);
        const merged = [...r2Urls];
        for (const url of propertyUrls) {
            if (url && !merged.includes(url)) {
                merged.push(url);
            }
        }
        return merged;
    }, [property?.imageUrls, r2ImagesData]);
    const galleryImages = useMemo(
        () => images.filter((url) => !failedImageUrls.includes(url)),
        [failedImageUrls, images],
    );
    const currentImage = galleryImages[selectedImage] || "";

    // إعادة تعيين حالة تحميل الصورة عند تغيير الصورة
    useEffect(() => {
        setImageLoaded(false);
        if (!currentImage) return;

        let cancelled = false;
        const image = new Image();
        image.onload = () => {
            if (!cancelled) setImageLoaded(true);
        };
        image.onerror = () => {
            if (!cancelled) {
                setFailedImageUrls((current) => current.includes(currentImage) ? current : [...current, currentImage]);
            }
        };
        image.src = currentImage;

        if (image.complete && image.naturalWidth > 0) {
            setImageLoaded(true);
        }

        return () => {
            cancelled = true;
        };
    }, [currentImage]);

    useEffect(() => {
        if (selectedImage >= galleryImages.length) {
            setSelectedImage(Math.max(0, galleryImages.length - 1));
        }
    }, [galleryImages.length, selectedImage]);

    // Preload للصورة التالية عند التنقل
    useEffect(() => {
        if (galleryImages.length === 0) return;
        const nextIndex = (selectedImage + 1) % galleryImages.length;
        const prevIndex = selectedImage === 0 ? galleryImages.length - 1 : selectedImage - 1;

        // تحميل الصورة التالية والسابقة
        [nextIndex, prevIndex].forEach((idx) => {
            const img = new Image();
            img.src = galleryImages[idx];
        });
    }, [galleryImages, selectedImage]);

    // ===== حالات التحميل / الخطأ / غير موجود =====

    if (isError) {
        return (
            <div className="min-h-screen bg-[#faf8f1] flex items-center justify-center px-4">
                <Card className="p-10 text-center space-y-5 max-w-md border-border/60 rounded-lg animate-in fade-in zoom-in-95 duration-500">
                    <div className="w-16 h-16 mx-auto rounded-lg bg-destructive/10 flex items-center justify-center">
                        <Home className="w-8 h-8 text-destructive/70" />
                    </div>
                    <h2 className="text-2xl font-bold tracking-tight">تعذر تحميل البيانات</h2>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                        حدث خطأ أثناء الاتصال بالخادم. تأكد من الاتصال بالإنترنت ثم حاول مرة
                        أخرى.
                    </p>
                    <div className="flex justify-center gap-3 pt-2">
                        <Button onClick={() => window.location.reload()} className="rounded-lg">
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
        return <PropertyDetailsSkeleton />;
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
                galleryImages.length ? (prev - 1 + galleryImages.length) % galleryImages.length : prev,
            );
        } else if (diff < -threshold) {
            setSelectedImage((prev) =>
                galleryImages.length ? (prev + 1) % galleryImages.length : prev,
            );
        }

        setTouchStartX(null);
    };

    // إخفاء اسم العقار لغير المشتركين
    const displayName = isVerified(property) ? property.name : "";

    const showContactRequestError = (error: unknown) => {
        if (error instanceof ContactRequestError && error.kind === "daily_limit") {
            toast({
                title: "اكتمل الحد اليومي",
                description: error.message,
                variant: "destructive",
            });
            return;
        }

        if (error instanceof ContactRequestError && error.kind === "cooldown") {
            toast({
                title: "⏱️ انتظر",
                description: error.remainingTimeFormatted
                    ? `${error.remainingTimeFormatted}\nقبل إرسال طلب آخر لنفس العقار`
                    : error.message,
                variant: "destructive",
            });
            return;
        }

        console.error("Error creating WhatsApp request:", error);
        toast({
            title: "خطأ",
            description: error instanceof Error ? error.message : "حدث خطأ عند تسجيل الطلب",
            variant: "destructive",
        });
    };

    // الواتساب: سجّل الطلب أولاً، ثم افتح رقم العقار المميّز أو الرقم الافتراضي.
    const sendWhatsAppRequest = async (
        submittedPhone: string | undefined,
        whatsappTab: ReservedWhatsAppTab,
    ) => {
        if (isSendingRef.current) {
            setShake(true);
            setTimeout(() => setShake(false), 500);
            throw new ContactRequestError("جاري تسجيل طلبك بالفعل", "general");
        }

        isSendingRef.current = true;
        setIsSending(true);
        try {
            const response = await fetch("/api/requests/smart", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    propertyNumber: property.propertyNumber,
                    ...(submittedPhone ? { clientPhone: submittedPhone } : {}),
                }),
            });

            const result = await response.json().catch(() => ({})) as Record<string, unknown>;

            const returnedIdentity = result.contactIdentity;
            if (
                returnedIdentity &&
                typeof returnedIdentity === "object" &&
                (returnedIdentity as Record<string, unknown>).kind === "client" &&
                typeof (returnedIdentity as Record<string, unknown>).maskedPhone === "string"
            ) {
                await commitContactIdentityCache(queryClient, {
                    kind: "client",
                    maskedPhone: (returnedIdentity as Record<string, unknown>).maskedPhone as string,
                });
            }

            if (!response.ok) {
                const errorMessage = typeof result.error === "string"
                    ? result.error
                    : "تعذر تسجيل طلب التواصل";
                const responseCode = typeof result.code === "string" ? result.code : "";

                if (response.status === 428 || responseCode === "CONTACT_PHONE_REQUIRED") {
                    throw new ContactRequestError(errorMessage, "phone_required");
                }

                if (responseCode === "FREE_PROPERTY_DAILY_CONTACT_LIMIT") {
                    throw new ContactRequestError(errorMessage, "daily_limit");
                }

                const remainingTimeFormatted = typeof result.remainingTimeFormatted === "string"
                    ? result.remainingTimeFormatted
                    : undefined;
                if (remainingTimeFormatted) {
                    throw new ContactRequestError(errorMessage, "cooldown", remainingTimeFormatted);
                }

                throw new ContactRequestError(errorMessage, "general");
            }

            const requestCode = typeof result.requestCode === "string"
                ? result.requestCode.trim()
                : "";
            if (result.ok !== true || !requestCode) {
                throw new ContactRequestError(
                    "تعذر تأكيد تسجيل طلب التواصل. حاول مرة أخرى.",
                    "general",
                );
            }

            const requestTime = typeof result.requestTime === "string" ? result.requestTime : "";
            const whatsappNumber = normalizeWhatsAppNumber(
                typeof result.whatsappNumber === "string" ? result.whatsappNumber : undefined,
            );
            const nameText = isVerified(property) ? ` - ${property.name}` : "";
            const message = `مرحباً، أنا مهتم بالعقار رقم ${property.propertyNumber}${nameText}\n\nكود الطلب: ${requestCode}`;

            const url = buildWhatsAppUrl(whatsappNumber, message);

            if (!await navigatePropertyWhatsAppTab(whatsappTab, url)) {
                setIsContactDialogOpen(false);
                setWhatsAppFallbackUrl(url);
                throw new ContactRequestError(
                    "تم تسجيل طلبك، لكن أُغلقت علامة واتساب. استخدم زر فتح واتساب الظاهر في الصفحة.",
                    "general",
                );
            }

            setWhatsAppFallbackUrl(null);
            setIsContactDialogOpen(false);
            toast({
                title: "✅ تم تسجيل طلبك",
                description: requestTime ? `في ${requestTime}` : undefined,
            });
        } catch (error) {
            if (error instanceof ContactRequestError) throw error;
            console.error("Unexpected WhatsApp contact error:", error);
            throw new ContactRequestError("حدث خطأ عند تسجيل الطلب. تحقق من اتصالك وحاول مرة أخرى.", "general");
        } finally {
            isSendingRef.current = false;
            setIsSending(false);
        }
    };

    const handleContactClick = async () => {
        if (contactFlowActiveRef.current || isSendingRef.current) {
            setShake(true);
            setTimeout(() => setShake(false), 500);
            return;
        }

        contactFlowActiveRef.current = true;
        try {
            let identity = contactIdentityQuery.data;
            const ownerIsLoggedIn = Boolean(ownerSession?.user);
            if (
                !ownerIsLoggedIn &&
                (!identity || identity.kind === "none" || identity.kind === "admin")
            ) {
                setIsContactDialogOpen(true);
                return;
            }

            const whatsappTab = reservePropertyWhatsAppTab(property.propertyNumber);
            if (!whatsappTab) {
                showContactRequestError(
                    new ContactRequestError(
                        "المتصفح منع فتح واتساب في علامة جديدة. اسمح بالنوافذ المنبثقة ثم حاول مجدداً.",
                        "general",
                    ),
                );
                return;
            }

            const canContactImmediately =
                ownerIsLoggedIn || identity?.kind === "owner" || identity?.kind === "client";
            if (!canContactImmediately) {
                closeReservedWhatsAppTab(whatsappTab);
                setIsContactDialogOpen(true);
                return;
            }

            try {
                await sendWhatsAppRequest(undefined, whatsappTab);
            } catch (error) {
                closeReservedWhatsAppTab(whatsappTab);
                const isOwnerContact = ownerIsLoggedIn || identity?.kind === "owner";
                if (error instanceof ContactRequestError && error.kind === "phone_required" && !isOwnerContact) {
                    queryClient.setQueryData(CONTACT_IDENTITY_QUERY_KEY, EMPTY_CONTACT_IDENTITY);
                    setIsContactDialogOpen(true);
                    return;
                }
                showContactRequestError(error);
            }
        } finally {
            contactFlowActiveRef.current = false;
        }
    };

    const handleContactPhoneSubmit = async (phone: string) => {
        if (contactFlowActiveRef.current || isSendingRef.current) {
            throw new Error("جاري تسجيل طلبك بالفعل");
        }

        contactFlowActiveRef.current = true;
        try {
            const whatsappTab = reservePropertyWhatsAppTab(property.propertyNumber);
            if (!whatsappTab) {
                throw new Error(
                    "المتصفح منع فتح واتساب في علامة جديدة. اسمح بالنوافذ المنبثقة ثم حاول مجدداً.",
                );
            }

            try {
                await sendWhatsAppRequest(phone, whatsappTab);
            } catch (error) {
                closeReservedWhatsAppTab(whatsappTab);
                if (error instanceof ContactRequestError && error.kind === "phone_required") {
                    queryClient.setQueryData(CONTACT_IDENTITY_QUERY_KEY, EMPTY_CONTACT_IDENTITY);
                    throw new Error("تعذر استخدام رقم التواصل المحفوظ. حاول حفظه مرة أخرى.");
                }
                if (
                    error instanceof ContactRequestError &&
                    (error.kind === "cooldown" || error.kind === "daily_limit")
                ) {
                    setIsContactDialogOpen(false);
                    showContactRequestError(error);
                    return;
                }
                throw error;
            }
        } finally {
            contactFlowActiveRef.current = false;
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
    const propertyTitle = displayName || "عقار للإيجار";
    const quickFacts = [
        { icon: MapPin, label: "المدينة", value: property.city || "غير محدد" },
        { icon: Compass, label: "الاتجاه", value: property.direction || "غير محدد" },
        { icon: Home, label: "النوع", value: property.type || "غير محدد" },
    ];
    const priceRows = [
        { label: "وسط الأسبوع", amount: property.prices?.weekday },
        { label: "نهاية الأسبوع", amount: property.prices?.weekend },
        { label: "مبيت", amount: property.prices?.overnight },
        { label: "إجازات", amount: property.prices?.holidays },
    ].filter((row) => row.amount);
    const featuredFacilities = Array.from(
        new Set((property.facilities || []).map((facility) => facility.trim()).filter(Boolean)),
    );
    const visibleFacilities = showAllFacilities
        ? featuredFacilities
        : featuredFacilities.slice(0, 8);

    return (
        <div className="min-h-screen bg-[#faf8f1]" dir="rtl">
            <ContactPhoneDialog
                open={isContactDialogOpen}
                onOpenChange={setIsContactDialogOpen}
                onSubmit={handleContactPhoneSubmit}
                isSubmitting={isSending}
                mode="contact"
                returnFocusRef={contactButtonRef}
            />

            {whatsappFallbackUrl && (
                <div
                    role="alert"
                    className="fixed inset-x-3 bottom-3 z-[100] mx-auto max-w-md rounded-xl border border-emerald-200 bg-white p-4 text-right shadow-2xl"
                    data-testid="whatsapp-fallback"
                >
                    <p className="font-semibold text-[#2f2a1f]">تم تسجيل طلب التواصل</p>
                    <p className="mt-1 text-sm leading-6 text-[#6f6249]">
                        أُغلقت علامة واتساب قبل اكتمال الفتح. يمكنك فتحها مجدداً من هنا دون تسجيل طلب آخر.
                    </p>
                    <div className="mt-3 flex gap-2">
                        <Button asChild className="flex-1 bg-[#128c47] text-white hover:bg-[#0f783d]">
                            <a
                                href={whatsappFallbackUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={() => setWhatsAppFallbackUrl(null)}
                            >
                                فتح واتساب
                            </a>
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            onClick={() => setWhatsAppFallbackUrl(null)}
                        >
                            إغلاق
                        </Button>
                    </div>
                </div>
            )}

            <EdgeSwipeIndicator />

            <header className="border-b border-[#e5dcc7] bg-[#fffdf8]">
                <div className="mx-auto flex max-w-7xl items-center gap-2 px-3 py-2.5 sm:gap-3 sm:px-4">
                    <Button
                        variant="ghost"
                        size="icon"
                        className="h-10 w-10 flex-shrink-0 rounded-lg"
                        onClick={() => {
                            if (window.history.length > 1) router.back();
                            else router.push("/");
                        }}
                        aria-label="العودة"
                    >
                        <ArrowRight className="h-5 w-5" />
                    </Button>
                    <div className="min-w-0 flex-1">
                        <p className="text-[11px] font-semibold text-[#8b7140]">تفاصيل العقار</p>
                        <h1 className="truncate text-sm font-bold text-[#2f2a1f] sm:text-base">عقار رقم {property.propertyNumber}</h1>
                    </div>
                    <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={handleShare}
                        className="h-10 w-10 flex-shrink-0 rounded-lg border-[#d8c9a8] bg-white text-[#6f5520]"
                        title="مشاركة العقار"
                        aria-label="مشاركة العقار"
                    >
                        <Share2 className="h-4 w-4" />
                    </Button>
                    {premium && (
                        <Badge className="flex-shrink-0 gap-1 rounded-lg border-0 bg-[#b88d2b] px-2 py-1.5 text-xs text-white sm:px-3">
                            <BadgeCheck className="h-3.5 w-3.5" />
                            مميز
                        </Badge>
                    )}
                </div>
            </header>

            <main className="mx-auto w-full max-w-7xl px-3 pb-10 pt-4 sm:px-4 sm:pt-6 md:pb-14 md:pt-8">
                <section className="mb-4 min-w-0 sm:mb-6">
                    <h2 className="break-words text-2xl font-bold leading-tight text-[#26221a] sm:text-3xl md:text-4xl">
                        {propertyTitle}
                    </h2>
                </section>

                <div dir="ltr" className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[minmax(0,1fr)_380px] lg:gap-6">
                    <section dir="rtl" className="min-w-0 space-y-4 lg:col-start-1 lg:row-start-1">
                        <section className="min-w-0 overflow-hidden rounded-lg border border-[#e2d6bd] bg-white">
                            <div
                                className="relative aspect-[4/3] bg-[#efe7d8] sm:aspect-[16/10]"
                                onTouchStart={handleTouchStart}
                                onTouchEnd={handleTouchEnd}
                            >
                                {galleryImages.length > 1 && (
                                    <link rel="preload" as="image" href={galleryImages[(selectedImage + 1) % galleryImages.length]} />
                                )}

                                {galleryImages.length > 0 ? (
                                    <>
                                        {!imageLoaded && (
                                            <div className="absolute inset-0 z-[1] flex items-center justify-center bg-[#efe7d8]">
                                                <div className="absolute inset-0 shimmer" />
                                                <div className="relative flex h-12 w-12 items-center justify-center rounded-lg border border-white/80 bg-white/75 text-[#9a7623] shadow-sm">
                                                    <Loader2 className="h-5 w-5 animate-spin" />
                                                </div>
                                            </div>
                                        )}
                                        <img
                                            key={currentImage}
                                            src={currentImage}
                                            alt={`صورة ${selectedImage + 1}`}
                                            className={`h-full w-full object-cover transition duration-500 ${imageLoaded ? "opacity-100" : "opacity-0"}`}
                                            loading="eager"
                                            decoding="async"
                                            data-testid="img-main"
                                            draggable={false}
                                            onLoad={() => setImageLoaded(true)}
                                            onError={() => {
                                                setFailedImageUrls((current) => current.includes(currentImage) ? current : [...current, currentImage]);
                                            }}
                                        />

                                        {galleryImages.length > 1 && (
                                            <>
                                                <button
                                                    type="button"
                                                    aria-label="الصورة التالية"
                                                    onClick={() => setSelectedImage((prev) => (prev + 1) % galleryImages.length)}
                                                    className="absolute right-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg border border-[#efe7d8] bg-white/90 text-[#2f2a1f] sm:right-3 sm:h-11 sm:w-11"
                                                >
                                                    <ChevronRight className="h-5 w-5" />
                                                </button>
                                                <button
                                                    type="button"
                                                    aria-label="الصورة السابقة"
                                                    onClick={() => setSelectedImage((prev) => (prev - 1 + galleryImages.length) % galleryImages.length)}
                                                    className="absolute left-2 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg border border-[#efe7d8] bg-white/90 text-[#2f2a1f] sm:left-3 sm:h-11 sm:w-11"
                                                >
                                                    <ChevronLeft className="h-5 w-5" />
                                                </button>
                                                <div className="absolute bottom-3 left-3 rounded-lg border border-[#efe7d8] bg-white/90 px-3 py-1.5 text-xs font-semibold tabular-nums text-[#2f2a1f]">
                                                    {selectedImage + 1} / {galleryImages.length}
                                                </div>
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

                            {galleryImages.length > 1 && (
                                <div className="flex gap-2 overflow-x-auto border-t border-[#eee4cf] bg-[#fffdf8] p-3 custom-scrollbar">
                                    {galleryImages.map((img, idx) => (
                                        <button
                                            key={img}
                                            onClick={() => setSelectedImage(idx)}
                                            className={`h-14 w-[4.5rem] flex-shrink-0 overflow-hidden rounded-lg sm:h-20 sm:w-24 ${
                                                selectedImage === idx
                                                    ? "ring-2 ring-[#9a7623] ring-offset-2 ring-offset-[#fffdf8]"
                                                    : "opacity-55"
                                            }`}
                                            data-testid={`button-thumbnail-${idx}`}
                                            type="button"
                                        >
                                            <img
                                                ref={(node) => {
                                                    if (node?.complete && node.naturalWidth === 0) {
                                                        setFailedImageUrls((current) => current.includes(img) ? current : [...current, img]);
                                                    }
                                                }}
                                                src={img}
                                                alt={`صورة ${idx + 1}`}
                                                className="h-full w-full object-cover"
                                                loading="lazy"
                                                decoding="async"
                                                draggable={false}
                                                onError={() => {
                                                    setFailedImageUrls((current) => current.includes(img) ? current : [...current, img]);
                                                }}
                                            />
                                        </button>
                                    ))}
                                </div>
                            )}
                        </section>

                        <section className="grid min-w-0 grid-cols-3 overflow-hidden rounded-lg border border-[#e2d6bd] bg-[#e2d6bd]">
                            {quickFacts.map((item) => {
                                const Icon = item.icon;
                                return (
                                    <div key={item.label} className="min-w-0 bg-white p-3 sm:p-4">
                                        <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg border border-[#eadfca] bg-[#fffaf0] sm:mb-3 sm:h-9 sm:w-9">
                                            <Icon className="h-4 w-4 text-[#9a7623]" />
                                        </div>
                                        <p className="truncate text-[11px] font-semibold text-[#8b7140] sm:text-xs">{item.label}</p>
                                        <p className="mt-1 truncate text-sm font-bold text-[#2f2a1f] sm:text-base" title={item.value}>{item.value}</p>
                                    </div>
                                );
                            })}
                        </section>
                    </section>

                    <aside dir="rtl" className="min-w-0 space-y-4 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:sticky lg:top-24 lg:self-start">
                        <section className="rounded-lg border border-[#d8d1bf] bg-[#fffdf8] p-4 sm:p-5">
                            <div className="mb-4 flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <p className="text-xs font-semibold text-[#8b7140]">التواصل والحجز</p>
                                    <h3 className="mt-1 text-xl font-bold text-[#2f2a1f]">تواصل مع المعلن</h3>
                                    <p className="mt-2 text-sm leading-6 text-[#6f6249]">سيتم تسجيل طلبك قبل فتح واتساب</p>
                                    <p className="mt-2 rounded-lg bg-[#fbf7ee] px-3 py-2 text-xs leading-5 text-[#6f6249]">
                                        {getPublicPropertyContactPolicyMessage(property)}
                                    </p>
                                </div>
                                <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg border border-[#cfe5d6] bg-[#eef8f1] text-[#128c47]">
                                    <Phone className="h-5 w-5" />
                                </div>
                            </div>

                            <div className="space-y-3">
                                <Button
                                    ref={contactButtonRef}
                                    type="button"
                                    onClick={() => void handleContactClick()}
                                    disabled={
                                        isSending ||
                                        contactIdentityQuery.isPending
                                    }
                                    className={`h-12 w-full whitespace-normal rounded-lg px-3 text-center text-sm font-semibold text-white sm:text-base ${
                                        isSending || contactIdentityQuery.isPending ? "bg-[#6f7a67]" : "bg-[#128c47]"
                                    } ${shake ? "animate-shake" : ""}`}
                                    size="lg"
                                    data-testid="button-whatsapp"
                                >
                                    {isSending || contactIdentityQuery.isPending ? (
                                        <span className="flex items-center gap-2">
                                            <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24">
                                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                                            </svg>
                                            {isSending ? "جاري تسجيل الطلب..." : "جاري التحقق..."}
                                        </span>
                                    ) : (
                                        <>
                                            <Phone className="ml-2 h-5 w-5" />
                                            تواصل عبر واتساب
                                        </>
                                    )}
                                </Button>
                            </div>
                        </section>

                        <section className="rounded-lg border border-[#e2d6bd] bg-white p-4 sm:p-5">
                            <h3 className="mb-4 text-lg font-bold text-[#2f2a1f]">أسعار الحجز</h3>
                            <div className="divide-y divide-[#eee4cf]">
                                {priceRows.length > 0 ? (
                                    priceRows.map((row) => (
                                        <div key={row.label} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                                            <span className="font-medium text-[#6f6249]">{row.label}</span>
                                            <PriceDisplay amount={row.amount || ""} size="md" />
                                        </div>
                                    ))
                                ) : (
                                    <p className="rounded-lg bg-[#fbf7ee] px-4 py-3 text-sm text-[#6f6249]">الأسعار غير محددة</p>
                                )}
                            </div>
                        </section>

                        {activeOccasion && propertyOccasionData && (
                            <section className="rounded-lg border border-[#c8dec5] bg-[#f8fff7] p-5">
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
                            </section>
                        )}
                    </aside>

                    <section dir="rtl" className="min-w-0 space-y-4 lg:col-start-1 lg:row-start-2">
                        {(property.location || featuredFacilities.length > 0) && (
                            <section className="rounded-lg border border-[#e2d6bd] bg-white p-4 sm:p-5 md:p-7">
                                {property.location && (
                                    <div>
                                        <div className="mb-2 flex items-center gap-2">
                                            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#eadfca] bg-[#fffaf0]">
                                                <MapPin className="h-4 w-4 text-[#6f5520]" />
                                            </div>
                                            <h3 className="font-bold text-[#2f2a1f]">الموقع</h3>
                                        </div>
                                        {locationHref ? (
                                            <Link
                                                href={locationHref}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="inline-flex max-w-full items-center gap-2 break-words text-sm font-semibold leading-6 text-[#6f5520] underline-offset-4 hover:underline"
                                            >
                                                <span>{property.location}</span>
                                            </Link>
                                        ) : (
                                            <p className="break-words text-sm leading-7 text-[#5f543f]">{property.location}</p>
                                        )}
                                    </div>
                                )}

                                {featuredFacilities.length > 0 && (
                                    <div className={property.location ? "mt-5 border-t border-[#eee4cf] pt-5" : ""}>
                                        <div className="mb-3 flex items-center gap-2">
                                            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#eadfca] bg-[#fffaf0]">
                                                <Tags className="h-4 w-4 text-[#6f5520]" />
                                            </div>
                                            <h3 className="font-bold text-[#2f2a1f]">أبرز المرافق</h3>
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                            {visibleFacilities.map((facility, idx) => (
                                                <Badge
                                                    key={`featured-${facility}-${idx}`}
                                                    variant="outline"
                                                    className="max-w-full whitespace-normal rounded-lg border-[#d8c9a8] bg-[#fffaf0] px-3 py-1.5 text-right text-sm font-semibold leading-5 text-[#5e4a20]"
                                                    data-testid={`badge-facility-${idx}`}
                                                >
                                                    {facility}
                                                </Badge>
                                            ))}
                                        </div>
                                        {featuredFacilities.length > 8 && (
                                            <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => setShowAllFacilities((current) => !current)}
                                                className="mt-3 gap-1.5 rounded-lg px-2 text-[#6f5520]"
                                            >
                                                {showAllFacilities ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                                {showAllFacilities ? "عرض أقل" : "عرض المزيد"}
                                            </Button>
                                        )}
                                    </div>
                                )}
                            </section>
                        )}

                        {premium && seoData?.seoDescription && (
                            <section className="rounded-lg border border-[#e0c98b] bg-[#fffaf0] p-4 sm:p-5 md:p-7">
                                <div className="mb-3 flex items-center gap-2">
                                    <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-[#dec684] bg-[#f6eac0]">
                                        <Sparkles className="h-4 w-4 text-[#6f5520]" />
                                    </div>
                                    <h3 className="text-lg font-bold text-[#2f2a1f]">وصف العقار</h3>
                                </div>
                                <p className="break-words text-sm leading-7 text-[#5f543f] sm:text-base sm:leading-8">{seoData.seoDescription}</p>
                            </section>
                        )}
                    </section>
                </div>
            </main>
        </div>
    );
}
