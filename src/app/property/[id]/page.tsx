import { Metadata } from "next";
import PropertyDetailsClient, { PropertyDetails } from "@/components/property-details-client";

interface PageProps {
    params: Promise<{
        id: string;
    }>;
}

// جلب بيانات العقار من API الخادم المحلي (أسرع وأكثر موثوقية)
async function getPropertyFromApi(id: string): Promise<PropertyDetails | null> {
    try {
        const baseUrl = process.env.NEXT_PUBLIC_BASE_URL ||
            `http://localhost:${process.env.PORT || 5000}`;
        const res = await fetch(`${baseUrl}/api/properties/${id}`, {
            next: { revalidate: 300 },
        });
        if (!res.ok) return null;
        const data = await res.json();
        if (!data || data.error) return null;
        return {
            propertyNumber: data.propertyNumber || id,
            name: data.name || "",
            city: data.city || "",
            direction: data.direction || "",
            location: data.location || "",
            type: data.type || "",
            facilities: Array.isArray(data.facilities) ? data.facilities : [],
            prices: data.prices || { weekday: "", weekend: "", overnight: "", holidays: "" },
            subscriptionType: data.isSubscriptionExpired ? "عادي" : (data.subscriptionType || "مميز"),
            phone: data.whatsappNumber || "",
            imageCount: 0,
        } as PropertyDetails;
    } catch {
        return null;
    }
}

// دالة لجلب البيانات من Google Apps Script (للخادم فقط من أجل Metadata) - fallback
async function getPropertyFromScript(id: string): Promise<PropertyDetails | null> {
    try {
        const res = await fetch(
            "https://script.google.com/macros/s/AKfycbzKX7i9qZ9UPPQOEjC44d_WR70nwMFal4zC_LRKcM09S_lg68AMvWs7J2PVIgZn_aBJ/exec?action=getData",
            { next: { revalidate: 3600 } } // Cache for 1 hour
        );

        if (!res.ok) return null;

        const raw = await res.json();
        if (!Array.isArray(raw)) return null;

        const item = raw.find((p: any) => String(p["رقم العقار"]) === id);
        if (!item) return null;

        const name = item["اسم العقار"] || "";
        let facilities: string[] = [];
        const rawFacilities = item["المرافق"] || "";
        if (typeof rawFacilities === "string") {
            // نفس منطق التحليل الموجود في العميل
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
                weekday: item["سعر وسط الأسبوع"] ? String(item["سعر وسط الأسبوع"]) : "",
                weekend: item["سعر نهاية الأسبوع"] ? String(item["سعر نهاية الأسبوع"]) : "",
                overnight: item["سعر المبيت"] ? String(item["سعر المبيت"]) : "",
                holidays: item["سعر الإجازات"] ? String(item["سعر الإجازات"]) : "",
            },
            subscriptionType: name ? "مميز" : "عادي",
            phone: item["رقم الجوال"] ? String(item["رقم الجوال"]) : "",
            imageCount: 0,
        };
    } catch (err) {
        console.error("Error fetching property for metadata:", err);
        return null;
    }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
    const { id } = await params;
    // Try our own API first (fast, reliable), then fall back to Google Apps Script
    const property = await getPropertyFromApi(id) ?? await getPropertyFromScript(id);

    if (!property) {
        return {
            title: "عقار غير موجود | روقان",
            description: "العقار المطلوب غير متوفر حالياً.",
        };
    }

    const isPremium = property.subscriptionType?.includes("مميز");
    const title = isPremium
        ? `${property.name || "عقار"} - ${property.city || ""} | روقان`
        : `عقار رقم ${property.propertyNumber} - ${property.city || ""} | روقان`;
    const description = isPremium && property.name
        ? `${property.name} في ${property.city}${property.direction ? ` - ${property.direction}` : ""}. ${property.type || ""} للإيجار مع ${property.facilities?.length || 0} مرافق. احجز الآن في روقان.`
        : `عقار رقم ${property.propertyNumber} للإيجار في ${property.city || "القصيم"} | روقان`;

    const ogImage = `https://pub-e2fc1c0a598f4f0e91e47af63219848e.r2.dev/${property.propertyNumber}/1.jpg`;

    return {
        title,
        description,
        openGraph: {
            title,
            description,
            type: "website",
            images: [ogImage],
        },
        twitter: {
            card: "summary_large_image",
            title,
            description,
            images: [ogImage],
        },
    };
}

export default async function PropertyPage({ params }: PageProps) {
    const { id } = await params;
    return <PropertyDetailsClient propertyId={id} />;
}
