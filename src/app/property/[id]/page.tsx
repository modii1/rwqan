import { Metadata } from "next";
import PropertyDetailsClient, { PropertyDetails } from "@/components/property-details-client";
import { getEffectiveSubscriptionType, isActivePremiumSubscription } from "@shared/subscriptionType";
import { buildServerUrl } from "@/lib/server-fetch";

interface PageProps {
    params: Promise<{
        id: string;
    }>;
}

async function getPropertyFromApi(id: string): Promise<PropertyDetails | null> {
    try {
        const res = await fetch(buildServerUrl(`/api/properties/${id}`), {
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
        } as PropertyDetails;
    } catch {
        return null;
    }
}

async function getPropertyFromScript(id: string): Promise<PropertyDetails | null> {
    try {
        const res = await fetch(
            "https://script.google.com/macros/s/AKfycbzKX7i9qZ9UPPQOEjC44d_WR70nwMFal4zC_LRKcM09S_lg68AMvWs7J2PVIgZn_aBJ/exec?action=getData",
            { next: { revalidate: 3600 } }
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
            subscriptionType: getEffectiveSubscriptionType({ subscriptionType: name ? "مميز" : "عادي" }),
            phone: item["رقم الجوال"] ? String(item["رقم الجوال"]) : "",
            imageCount: 0,
        };
    } catch (err) {
        console.error("Error fetching property for metadata:", err);
        return null;
    }
}

async function getPropertyImages(id: string): Promise<string[]> {
    try {
        const res = await fetch(buildServerUrl(`/api/public/property-images/${id}`), {
            next: { revalidate: 300 },
        });
        if (!res.ok) return [];
        const data = await res.json();
        return data.images || [];
    } catch {
        return [];
    }
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
    const { id } = await params;
    const property = await getPropertyFromApi(id) ?? await getPropertyFromScript(id);

    if (!property) {
        return {
            title: "عقار غير موجود | روقان",
            description: "العقار المطلوب غير متوفر حالياً.",
        };
    }

    const isPremium = isActivePremiumSubscription({
        subscriptionType: property.subscriptionType,
        status: property.subscriptionStatus,
        isExpired: property.isSubscriptionExpired,
    });
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

    const [property, images] = await Promise.all([
        getPropertyFromApi(id),
        getPropertyImages(id),
    ]);

    return <PropertyDetailsClient propertyId={id} initialProperty={property} initialImages={images.length > 0 ? images : undefined} />;
}
