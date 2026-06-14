import { serverFetch, serverFetchImages, ActiveOccasion } from "@/lib/server-fetch";
import { Property } from "@shared/schema";
import HomeClient from "@/components/home-client";

export default async function HomePage() {
    const [properties, occasion] = await Promise.all([
        serverFetch<Property[]>("/api/properties"),
        serverFetch<ActiveOccasion | null>("/api/occasions/active"),
    ]);

    const allProperties = properties ?? [];

    const premiumPropNumbers = allProperties
        .filter(p => p.subscriptionType === "مميز")
        .map(p => p.propertyNumber);

    const occasionPropNumbers = occasion
        ? occasion.properties.map(op => op.propertyNumber)
        : [];

    const neededImageIds = [...new Set([...premiumPropNumbers, ...occasionPropNumbers])];
    const initialImages = neededImageIds.length > 0
        ? await serverFetchImages(neededImageIds)
        : {};

    return (
        <HomeClient initialProperties={allProperties} initialOccasion={occasion} initialImages={initialImages} />
    );
}
