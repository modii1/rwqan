function getServerBaseUrl(): string {
    const configured = process.env.NEXT_PUBLIC_BASE_URL?.trim();
    if (configured && configured !== "/" && /^https?:\/\//i.test(configured)) {
        return configured.replace(/\/+$/, "");
    }

    return `http://127.0.0.1:${process.env.PORT || 5000}`;
}

export function buildServerUrl(url: string): string {
    if (/^https?:\/\//i.test(url)) return url;
    const path = url.startsWith("/") ? url : `/${url}`;
    return `${getServerBaseUrl()}${path}`;
}

export interface ActiveOccasion {
    occasion: {
        id: string;
        name: string;
        slug: string;
        type: string;
        days: { key: string; label: string }[];
        theme: string;
        isActive: boolean;
        description?: string;
    };
    properties: {
        id: string;
        occasionId: string;
        propertyNumber: string;
        availability: Record<string, boolean>;
        prices: Record<string, string>;
    }[];
}

export async function serverFetch<T>(url: string, revalidate = 60): Promise<T | null> {
    try {
        const res = await fetch(buildServerUrl(url), { next: { revalidate } });
        if (!res.ok) return null;
        return res.json();
    } catch {
        return null;
    }
}

export async function serverFetchImages(propertyNumbers: string[]): Promise<Record<string, string[]>> {
    const results: Record<string, string[]> = {};
    await Promise.all(
        propertyNumbers.map(async (pn) => {
            try {
                const data = await serverFetch<{ images: string[] }>(`/api/public/property-images/${pn}`);
                results[pn] = data?.images || [];
            } catch {
                results[pn] = [];
            }
        })
    );
    return results;
}
