import { Metadata } from "next";
import PropertyDetailsClient, { PropertyDetails } from "@/components/property-details-client";
import { getEffectiveSubscriptionType } from "@shared/subscriptionType";
import { isPublicPropertyPremium } from "@/lib/public-subscription";
import { buildServerUrl } from "@/lib/server-fetch";

interface PageProps {
    params: Promise<{
        id: string;
    }>;
}

type PropertyApiLookup = {
    property: PropertyDetails | null;
    status: number | null;
};

async function getPropertyApiLookup(id: string): Promise<PropertyApiLookup> {
    try {
        const res = await fetch(buildServerUrl(`/api/properties/${id}`), {
            cache: "no-store",
        });
        if (!res.ok) return { property: null, status: res.status };
        const data = await res.json();
        if (!data || data.error) return { property: null, status: res.status };
        return { property: {
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
            freePropertyContactDailyLimit:
                typeof data.freePropertyContactDailyLimit === "number"
                    ? data.freePropertyContactDailyLimit
                    : undefined,
            imageCount: 0,
        } as PropertyDetails, status: res.status };
    } catch {
        return { property: null, status: null };
    }
}

async function getPropertyFromApi(id: string): Promise<PropertyDetails | null> {
    return (await getPropertyApiLookup(id)).property;
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
            cache: "no-store",
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
    const [apiLookup, images] = await Promise.all([
        getPropertyApiLookup(id),
        getPropertyImages(id),
    ]);
    const property = apiLookup.property ?? (
        apiLookup.status === 403 || apiLookup.status === 423
            ? null
            : await getPropertyFromScript(id)
    );

    if (!property) {
        return {
            title: "عقار غير موجود | روقان",
            description: "العقار المطلوب غير متوفر حالياً.",
        };
    }

    const isPremium = isPublicPropertyPremium(property);
    const title = isPremium
        ? `${property.name || "عقار"} - ${property.city || ""} | روقان`
        : `عقار رقم ${property.propertyNumber} - ${property.city || ""} | روقان`;
    const description = isPremium && property.name
        ? `${property.name} في ${property.city}${property.direction ? ` - ${property.direction}` : ""}. ${property.type || "عقار"} للإيجار. احجز الآن في روقان.`
        : `عقار رقم ${property.propertyNumber} للإيجار في ${property.city || "القصيم"} | روقان`;

    const socialImages = images[0] ? [images[0]] : undefined;

    return {
        title,
        description,
        openGraph: {
            title,
            description,
            type: "website",
            images: socialImages,
        },
        twitter: {
            card: "summary_large_image",
            title,
            description,
            images: socialImages,
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
