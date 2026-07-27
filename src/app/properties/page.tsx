import { Suspense } from "react";
import { serverFetch, serverFetchImages, ActiveOccasion } from "@/lib/server-fetch";
import { Property } from "@shared/schema";
import PropertiesClient from "@/components/properties-client";
import {
    buildPropertySearchQueryString,
    normalizePropertyFacilityFilters,
} from "@/lib/property-search";

interface Props {
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function AllPropertiesPage({ searchParams }: Props) {
    const params = await searchParams;
    const first = (value: string | string[] | undefined) =>
        Array.isArray(value) ? value[0] || "" : value || "";
    const rawMaxPriceParam = first(params.maxPrice).trim();
    const rawMaxPrice = Number(rawMaxPriceParam);
    const hasValidMaxPrice = rawMaxPriceParam !== ""
        && Number.isFinite(rawMaxPrice)
        && rawMaxPrice >= 0;
    const qs = buildPropertySearchQueryString({
        searchQuery: first(params.search),
        selectedCity: first(params.city),
        selectedDirection: first(params.direction),
        selectedType: first(params.type),
        selectedFacilities: normalizePropertyFacilityFilters(
            first(params.facilities).split(","),
        ),
        maxPrice: hasValidMaxPrice ? rawMaxPrice : Number.POSITIVE_INFINITY,
        maxPriceCeiling: Number.POSITIVE_INFINITY,
    });

    const hasParams = qs.length > 0;

    const [allProperties, occasion, searchResults] = await Promise.all([
        serverFetch<Property[]>("/api/properties"),
        serverFetch<ActiveOccasion | null>("/api/occasions/active"),
        hasParams ? serverFetch<Property[]>(`/api/search?${qs}`) : Promise.resolve(null),
    ]);

    const displayProperties = hasParams
        ? (searchResults ?? allProperties ?? [])
        : (allProperties ?? []);

    const neededImageIds = [...new Set(
        displayProperties.slice(0, 24).map(p => p.propertyNumber)
    )];

    const initialImages = neededImageIds.length > 0
        ? await serverFetchImages(neededImageIds)
        : {};

    return (
        <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><p className="text-[#6b6b6b] text-lg">جاري التحميل...</p></div>}>
            <PropertiesClient
                initialAllProperties={allProperties ?? undefined}
                initialSearchResults={hasParams ? (searchResults ?? undefined) : undefined}
                initialOccasion={occasion}
                initialImages={initialImages}
            />
        </Suspense>
    );
}
