import { serverFetch, serverFetchImages, ActiveOccasion } from "@/lib/server-fetch";
import { Property } from "@shared/schema";
import PropertiesClient from "@/components/properties-client";

interface Props {
    searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function AllPropertiesPage({ searchParams }: Props) {
    const params = await searchParams;

    const qs = new URLSearchParams();
    if (params.search) qs.set("search", params.search as string);
    if (params.city) qs.set("city", params.city as string);
    if (params.direction) qs.set("direction", params.direction as string);
    if (params.type) qs.set("type", params.type as string);
    if (params.facilities) qs.set("facilities", params.facilities as string);
    if (params.maxPrice) qs.set("maxPrice", params.maxPrice as string);

    const hasParams = qs.toString().length > 0;

    const [allProperties, occasion, searchResults] = await Promise.all([
        serverFetch<Property[]>("/api/properties"),
        serverFetch<ActiveOccasion | null>("/api/occasions/active"),
        hasParams ? serverFetch<Property[]>(`/api/search?${qs.toString()}`) : Promise.resolve(null),
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
        <PropertiesClient
            initialAllProperties={allProperties ?? undefined}
            initialSearchResults={hasParams ? (searchResults ?? undefined) : (allProperties ?? undefined)}
            initialOccasion={occasion}
            initialImages={initialImages}
        />
    );
}
