"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Property } from "@shared/schema";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import {
    Search,
    X,
    MapPin,
    Star,
    ChevronLeft,
    ChevronRight,
    ChevronUp,
    SlidersHorizontal,
    Home,
    Moon,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { PriceDisplay } from "@/components/price-display";
import { FilterModal } from "@/components/filter-modal";
import type { ActiveOccasion } from "@/lib/server-fetch";
import {
    getPublicPropertyLabel,
    isPublicPropertyPremium,
} from "@/lib/public-subscription";
import {
    getCachedPropertyImage,
    getPropertyImageSetKey,
    hasCachedPropertyImages,
    fetchPropertyImageUrls,
    PROPERTY_IMAGE_PLACEHOLDER,
} from "@/lib/property-images";
import {
    arePropertySearchQueryKeysEqual,
    buildPropertySearchQueryKey,
    buildPropertySearchQueryString,
    normalizePropertyFacilityFilters,
    normalizePropertyFilterChoice,
    parseStoredPropertyFilters,
} from "@/lib/property-search";
import { togglePropertyFacilitySelection } from "@shared/propertyFacilityFilter";
import {
    getMaximumPrimaryPropertyPrice,
    getPrimaryPropertyPriceDisplay,
} from "@shared/propertyPrice";
import { PropertyFavoriteButton } from "@/components/customer/property-favorite-button";

const DIRECTIONS = ["شمال", "جنوب", "شرق", "غرب"];
const TYPES = ["قسم", "قسمين"];
const FACILITIES = ["مسبح", "بدون مسبح", "مبيت", "ألعاب مائية", "ملعب", "مناسبات", "شتاء", "صيف", "مكيف", "واي فاي"];

interface PropertiesClientProps {
    initialAllProperties?: Property[];
    initialSearchResults?: Property[];
    initialOccasion?: ActiveOccasion | null;
    initialImages?: Record<string, string[]>;
}

export default function PropertiesClient({ initialAllProperties, initialSearchResults, initialOccasion, initialImages }: PropertiesClientProps) {
    const router = useRouter();
    const searchParams = useSearchParams();

    const initialSearchQuery = searchParams.get("search") || "";
    const [searchQuery, setSearchQuery] = useState(initialSearchQuery);
    const [debouncedSearchQuery, setDebouncedSearchQuery] = useState(initialSearchQuery);
    const [selectedCity, setSelectedCity] = useState(
        normalizePropertyFilterChoice(searchParams.get("city")),
    );
    const [selectedDirection, setSelectedDirection] = useState(
        normalizePropertyFilterChoice(searchParams.get("direction")),
    );
    const [selectedType, setSelectedType] = useState(
        normalizePropertyFilterChoice(searchParams.get("type")),
    );
    const [selectedFacilities, setSelectedFacilities] = useState<string[]>(
        normalizePropertyFacilityFilters(searchParams.get("facilities")?.split(",")),
    );
    const maxPriceParam = searchParams.get("maxPrice");
    const initialMaxPrice = maxPriceParam && Number.isFinite(Number(maxPriceParam)) && Number(maxPriceParam) >= 0
        ? Number(maxPriceParam)
        : getMaximumPrimaryPropertyPrice(initialAllProperties);
    const [maxPrice, setMaxPrice] = useState<number>(initialMaxPrice);
    const [showFilters, setShowFilters] = useState(false);
    const [currentImageIndex, setCurrentImageIndex] = useState<Map<string, number>>(new Map());
    const [visibleCount, setVisibleCount] = useState(30);
    const [showScrollTop, setShowScrollTop] = useState(false);
    const [occasionFilter, setOccasionFilter] = useState(
        normalizePropertyFilterChoice(searchParams.get("occasion")),
    );
    const [selectedDay, setSelectedDay] = useState(
        normalizePropertyFilterChoice(searchParams.get("day")),
    );
    const [propertyImages, setPropertyImages] = useState<Map<string, string[]>>(
        () => new Map(Object.entries(initialImages || {}))
    );
    const [loadingImages, setLoadingImages] = useState<Set<string>>(new Set());

    useEffect(() => {
        const timer = window.setTimeout(() => setDebouncedSearchQuery(searchQuery), 300);
        return () => window.clearTimeout(timer);
    }, [searchQuery]);


    useEffect(() => {
        const onScroll = () => setShowScrollTop(window.scrollY > 400);
        window.addEventListener("scroll", onScroll);
        return () => window.removeEventListener("scroll", onScroll);
    }, []);

    const { data: allProperties = [] } = useQuery<Property[]>({
        queryKey: ["/api/properties"],
        initialData: initialAllProperties,
    });

    const { data: activeOccasion } = useQuery<ActiveOccasion | null>({
        queryKey: ["/api/occasions/active"],
        initialData: initialOccasion,
    });

    const maxPriceValue = useMemo(
        () => getMaximumPrimaryPropertyPrice(allProperties),
        [allProperties],
    );
    const isOccasionFilterActive = Boolean(
        activeOccasion && occasionFilter === activeOccasion.occasion.slug,
    );
    const effectiveSelectedDay = isOccasionFilterActive
        && activeOccasion?.occasion.days?.some((day) => day.key === selectedDay)
        ? selectedDay
        : "";

    useEffect(() => {
        if (!occasionFilter) {
            if (selectedDay) setSelectedDay("");
            return;
        }
        if (activeOccasion === undefined) return;
        if (!activeOccasion || occasionFilter !== activeOccasion.occasion.slug) {
            setOccasionFilter("");
            setSelectedDay("");
            return;
        }
        if (selectedDay && !activeOccasion.occasion.days?.some(
            (day) => day.key === selectedDay,
        )) {
            setSelectedDay("");
        }
    }, [activeOccasion, occasionFilter, selectedDay]);

    const searchFilterState = {
        searchQuery: debouncedSearchQuery,
        selectedCity,
        selectedDirection,
        selectedType,
        selectedFacilities,
        maxPrice,
        maxPriceCeiling: maxPriceValue,
    };
    const searchQueryKey = buildPropertySearchQueryKey(searchFilterState);
    const initialSearchQueryKeyRef = useRef(searchQueryKey);
    const initialSearchDataRef = useRef(initialSearchResults);

    useEffect(() => {
        // SSR data is a one-time hydration seed. If this query was already in
        // the client cache, prevent the old snapshot from being reused after GC.
        initialSearchDataRef.current = undefined;
    }, []);

    const { data: properties = [], isLoading } = useQuery<Property[]>({
        queryKey: searchQueryKey,
        queryFn: async ({ signal }) => {
            const qs = buildPropertySearchQueryString(searchFilterState);
            const res = await fetch(`/api/search${qs ? `?${qs}` : ""}`, { signal });
            if (!res.ok) throw new Error("Failed to fetch");
            return res.json();
        },
        initialData: () => {
            if (!arePropertySearchQueryKeysEqual(
                searchQueryKey,
                initialSearchQueryKeyRef.current,
            )) return undefined;
            const initialData = initialSearchDataRef.current;
            initialSearchDataRef.current = undefined;
            return initialData;
        },
    });

    const initializedRef = useRef(false);
    useEffect(() => {
        if (initializedRef.current && !maxPriceParam) {
            setMaxPrice(maxPriceValue);
        }
    }, [maxPriceValue, maxPriceParam]);

    useEffect(() => {
        if (initializedRef.current) return;
        initializedRef.current = true;
        if (!maxPriceParam) {
            setMaxPrice(maxPriceValue);
        }

        const hasScrollPosition = sessionStorage.getItem("propsScrollY");
        const saved = sessionStorage.getItem("propsPageFilters");
        if (saved && hasScrollPosition) {
            const f = parseStoredPropertyFilters(saved);
            const hasUrlParams = searchParams.get("search") || searchParams.get("city") ||
                searchParams.get("direction") || searchParams.get("type") || searchParams.get("facilities") ||
                searchParams.get("maxPrice") || searchParams.get("occasion") || searchParams.get("day");
            
            if (f && !hasUrlParams) {
                setSearchQuery(f.searchQuery);
                setSelectedCity(f.selectedCity);
                setSelectedDirection(f.selectedDirection);
                setSelectedType(f.selectedType);
                setSelectedFacilities(f.selectedFacilities);
                if (f.maxPrice !== undefined) setMaxPrice(f.maxPrice);
                setOccasionFilter(f.occasionFilter);
                setSelectedDay(f.selectedDay);
            }
            if (f?.visibleCount !== undefined) setVisibleCount(f.visibleCount);
        }
        sessionStorage.removeItem("propsPageFilters");
    }, []);

    const toggleFacility = (f: string) => {
        setSelectedFacilities(prev => togglePropertyFacilitySelection(prev, f));
    };

    const clearFilters = () => {
        setSearchQuery("");
        setDebouncedSearchQuery("");
        setSelectedCity("");
        setSelectedDirection("");
        setSelectedType("");
        setSelectedFacilities([]);
        setMaxPrice(maxPriceValue);
        setOccasionFilter("");
        setSelectedDay("");
        sessionStorage.removeItem("propsPageFilters");
    };

    const hasActiveFilters = !!(
        searchQuery.trim() ||
        selectedCity ||
        selectedDirection ||
        selectedType ||
        selectedFacilities.length > 0 ||
        maxPrice < maxPriceValue ||
        isOccasionFilterActive
    );

    useEffect(() => {
        const filters = { searchQuery, selectedCity, selectedDirection, selectedType, selectedFacilities, maxPrice, visibleCount, occasionFilter, selectedDay };
        sessionStorage.setItem("propsPageFilters", JSON.stringify(filters));
    }, [searchQuery, selectedCity, selectedDirection, selectedType, selectedFacilities, maxPrice, visibleCount, occasionFilter, selectedDay]);

    useEffect(() => {
        if (!initializedRef.current) return;
        const params = new URLSearchParams(
            buildPropertySearchQueryString(searchFilterState),
        );
        if (isOccasionFilterActive && activeOccasion) {
            params.set("occasion", activeOccasion.occasion.slug);
            if (effectiveSelectedDay) params.set("day", effectiveSelectedDay);
        }
        const query = params.toString();
        const nextUrl = `/properties${query ? `?${query}` : ""}`;
        const currentUrl = `${window.location.pathname}${window.location.search}`;
        if (currentUrl !== nextUrl) {
            window.history.replaceState(window.history.state, "", nextUrl);
        }
    }, [
        debouncedSearchQuery,
        selectedCity,
        selectedDirection,
        selectedType,
        selectedFacilities,
        maxPrice,
        maxPriceValue,
        occasionFilter,
        selectedDay,
        isOccasionFilterActive,
        effectiveSelectedDay,
        activeOccasion,
    ]);

    useEffect(() => {
        const savedScroll = sessionStorage.getItem("propsScrollY");
        if (savedScroll && properties.length > 0) {
            const scrollY = parseInt(savedScroll, 10);
            sessionStorage.removeItem("propsScrollY");
            const restore = () => window.scrollTo(0, scrollY);
            requestAnimationFrame(restore);
            setTimeout(restore, 50);
            setTimeout(restore, 150);
        }
    }, [properties.length]);

    useEffect(() => {
        const onScroll = () => {
            const y = window.scrollY;
            if (y + window.innerHeight >= document.documentElement.scrollHeight - 600) {
                setVisibleCount(prev => {
                    if (properties.length === 0) return prev;
                    return Math.min(prev + 12, properties.length);
                });
            }
        };
        window.addEventListener("scroll", onScroll);
        return () => window.removeEventListener("scroll", onScroll);
    }, [properties.length]);

    const getImgIdx = (pn: string) => currentImageIndex.get(pn) || 0;

    const nextImage = (pn: string) => {
        const count = propertyImages.get(pn)?.length || 3;
        setCurrentImageIndex(prev => {
            const m = new Map(prev);
            m.set(pn, ((m.get(pn) || 0) + 1) % count);
            return m;
        });
    };

    const prevImage = (pn: string) => {
        const count = propertyImages.get(pn)?.length || 3;
        setCurrentImageIndex(prev => {
            const m = new Map(prev);
            const cur = m.get(pn) || 0;
            m.set(pn, cur === 0 ? count - 1 : cur - 1);
            return m;
        });
    };

    const fetchPropertyImages = async (propertyNumber: string) => {
        if (hasCachedPropertyImages(propertyImages, propertyNumber) || loadingImages.has(propertyNumber)) return;
        setLoadingImages(prev => new Set(prev).add(propertyNumber));
        try {
            const images = await fetchPropertyImageUrls(propertyNumber);
            setPropertyImages(prev => {
                const newMap = new Map(prev);
                newMap.set(propertyNumber, images);
                return newMap;
            });
        } catch {
            setPropertyImages(prev => {
                const newMap = new Map(prev);
                newMap.set(propertyNumber, []);
                return newMap;
            });
        } finally {
            setLoadingImages(prev => {
                const newSet = new Set(prev);
                newSet.delete(propertyNumber);
                return newSet;
            });
        }
    };

    const sortedProperties = useMemo(() => {
        let result = [...properties];

        if (isOccasionFilterActive && activeOccasion) {
            const occasionPropertyNumbers = new Set(
                activeOccasion.properties
                    .filter(op => {
                        if (!effectiveSelectedDay) return true;
                        return op.availability[effectiveSelectedDay] === true;
                    })
                    .map(op => op.propertyNumber)
            );
            result = result.filter(p => occasionPropertyNumbers.has(p.propertyNumber));
        }

        return result.sort((a, b) => {
            const aIsPremium = isPublicPropertyPremium(a) ? 1 : 0;
            const bIsPremium = isPublicPropertyPremium(b) ? 1 : 0;
            return bIsPremium - aIsPremium;
        });
    }, [properties, isOccasionFilterActive, activeOccasion, effectiveSelectedDay]);

    const visibleProperties = sortedProperties.slice(0, visibleCount);
    const visiblePropertyImageKey = getPropertyImageSetKey(
        visibleProperties.map((property) => property.propertyNumber),
    );

    useEffect(() => {
        if (isLoading || properties.length === 0) return;
        visibleProperties.forEach(p => fetchPropertyImages(p.propertyNumber));
    }, [visiblePropertyImageKey, isLoading]);

    return (
        <>
        <div className="min-h-screen bg-[#fafafa]">
            {/* Search & Filter Header */}
            <section className="bg-white border-b border-gray-100 sticky top-[70px] z-40">
                <div className="max-w-7xl mx-auto px-4 py-4">
                    {/* Search Bar */}
                    <div className="flex gap-2 mb-3">
                        <div className="relative flex-1">
                            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9ca3af]" />
                            <Input
                                placeholder="ابحث عن عقار..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="pr-10 h-11 rounded-xl border-gray-200 bg-[#f9fafb] text-sm"
                            />
                        </div>
                        <button
                            onClick={() => setShowFilters(true)}
                            className={`flex items-center gap-2 px-4 h-11 rounded-xl text-sm font-medium whitespace-nowrap transition-colors ${
                                hasActiveFilters
                                    ? "bg-[#b88d2b] text-white"
                                    : "bg-[#f9fafb] border border-gray-200 text-[#6b6b6b] hover:bg-gray-100"
                            }`}
                        >
                            <SlidersHorizontal className="w-4 h-4" />
                            تصفية
                        </button>
                    </div>

                    {/* Direction pills */}
                    <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide">
                        {DIRECTIONS.map(dir => (
                            <button
                                key={dir}
                                onClick={() => setSelectedDirection(selectedDirection === dir ? "" : dir)}
                                className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                                    selectedDirection === dir
                                        ? "bg-[#b88d2b] text-white"
                                        : "bg-[#f3f4f6] text-[#6b6b6b] hover:bg-gray-200"
                                }`}
                            >
                                {dir}
                            </button>
                        ))}
                        {hasActiveFilters && (
                            <button
                                onClick={clearFilters}
                                className="flex items-center gap-1 px-3 py-1.5 text-xs text-red-500 hover:text-red-600 whitespace-nowrap"
                            >
                                <X className="w-3 h-3" />
                                مسح
                            </button>
                        )}
                    </div>

                    {/* Occasion Day Filter */}
                    {activeOccasion && activeOccasion.properties.length > 0 && (
                        <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide mt-2 pt-2 border-t border-gray-100">
                            <div className="flex items-center gap-1 pl-2">
                                <Moon className="w-3.5 h-3.5 text-[#b88d2b]" />
                                <span className="text-xs font-medium text-[#1a1a1a] whitespace-nowrap">{activeOccasion.occasion.name}:</span>
                            </div>
                            <button
                                onClick={() => { setOccasionFilter(""); setSelectedDay(""); }}
                                className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                                    !isOccasionFilterActive
                                        ? "bg-[#1a472a] text-[#d4af37]"
                                        : "bg-[#f0fdf4] text-[#2d6b45] hover:bg-[#dcfce7]"
                                }`}
                            >
                                الكل
                            </button>
                            <button
                                onClick={() => {
                                    setOccasionFilter(
                                        isOccasionFilterActive ? "" : activeOccasion.occasion.slug,
                                    );
                                    setSelectedDay("");
                                }}
                                className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                                    isOccasionFilterActive
                                        ? "bg-[#1a472a] text-[#d4af37]"
                                        : "bg-[#f0fdf4] text-[#2d6b45] hover:bg-[#dcfce7]"
                                }`}
                            >
                                عروض المناسبة فقط
                            </button>
                            {isOccasionFilterActive && activeOccasion.occasion.days?.map(day => (
                                <button
                                    key={day.key}
                                    onClick={() => setSelectedDay(selectedDay === day.key ? "" : day.key)}
                                    className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                                        selectedDay === day.key
                                            ? "bg-[#d4af37] text-[#1a472a]"
                                            : "bg-[#fefce8] text-[#92400e] hover:bg-[#fef3c7]"
                                    }`}
                                >
                                    {day.label}
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            </section>

            {/* Results */}
            <div className="max-w-7xl mx-auto px-4 py-6">
                {hasActiveFilters && (
                    <div className="mb-4 flex items-center gap-2 flex-wrap">
                        <span className="text-sm text-[#6b6b6b]">النتائج:</span>
                        <span className="text-sm font-bold text-[#1a1a1a]">{sortedProperties.length}</span>
                        {selectedCity && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#b88d2b]/10 text-[#b88d2b] text-xs rounded-full">
                                {selectedCity}
                                <button onClick={() => setSelectedCity("")}><X className="w-2.5 h-2.5" /></button>
                            </span>
                        )}
                        {selectedDirection && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#b88d2b]/10 text-[#b88d2b] text-xs rounded-full">
                                {selectedDirection}
                                <button onClick={() => setSelectedDirection("")}><X className="w-2.5 h-2.5" /></button>
                            </span>
                        )}
                        {selectedType && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#b88d2b]/10 text-[#b88d2b] text-xs rounded-full">
                                {selectedType}
                                <button onClick={() => setSelectedType("")}><X className="w-2.5 h-2.5" /></button>
                            </span>
                        )}
                        {selectedFacilities.map(f => (
                            <span key={f} className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#b88d2b]/10 text-[#b88d2b] text-xs rounded-full">
                                {f}
                                <button onClick={() => toggleFacility(f)}><X className="w-2.5 h-2.5" /></button>
                            </span>
                        ))}
                    </div>
                )}

                {isLoading ? (
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 md:gap-4">
                        {[...Array(10)].map((_, i) => (
                            <div key={i} className="h-64 bg-gray-100 rounded-2xl animate-pulse" />
                        ))}
                    </div>
                ) : sortedProperties.length === 0 ? (
                    <div className="text-center py-20">
                        <div className="w-16 h-16 mx-auto mb-4 bg-gray-100 rounded-full flex items-center justify-center">
                            <Home className="w-8 h-8 text-[#9ca3af]" />
                        </div>
                        <p className="text-[#6b6b6b] text-lg mb-4">لا توجد عقارات مطابقة</p>
                        <button
                            onClick={clearFilters}
                            className="text-[#b88d2b] font-medium hover:underline"
                        >
                            مسح الفلاتر
                        </button>
                    </div>
                ) : (
                    <>
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3 md:gap-4">
                            {visibleProperties.map(p => {
                                const occasionProp = activeOccasion?.properties.find(op => op.propertyNumber === p.propertyNumber);
                                return (
                                <PropertyCard
                                    key={p.propertyNumber}
                                    property={p}
                                    isPremium={isPublicPropertyPremium(p)}
                                    imgIdx={getImgIdx(p.propertyNumber)}
                                    onNext={() => nextImage(p.propertyNumber)}
                                    onPrev={() => prevImage(p.propertyNumber)}
                                    onClick={() => {
                                        sessionStorage.setItem("propsScrollY", String(window.scrollY));
                                        router.push(`/property/${p.propertyNumber}`);
                                    }}
                                    occasionData={occasionProp ? {
                                        name: effectiveSelectedDay
                                            ? (activeOccasion!.occasion.days?.find(d => d.key === effectiveSelectedDay)?.label || activeOccasion!.occasion.name)
                                            : activeOccasion!.occasion.name,
                                        price: effectiveSelectedDay
                                            ? (occasionProp.prices[effectiveSelectedDay] || "")
                                            : (Object.values(occasionProp.prices).find(p => p) || "")
                                    } : undefined}
                                    propertyImages={propertyImages}
                                />
                                );
                            })}
                        </div>

                        {visibleCount < sortedProperties.length && (
                            <div className="text-center mt-8">
                                <button
                                    onClick={() => setVisibleCount(prev => Math.min(prev + 12, sortedProperties.length))}
                                    className="px-8 py-3 border-2 border-[#b88d2b] text-[#b88d2b] font-bold rounded-full hover:bg-[#b88d2b] hover:text-white transition-colors"
                                >
                                    تحميل المزيد ({sortedProperties.length - visibleCount} متبقي)
                                </button>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>

        {showScrollTop && (
            <button
                onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
                className="fixed bottom-6 left-6 z-50 w-11 h-11 rounded-full bg-[#b88d2b] text-white shadow-lg hover:bg-[#9a7623] transition-all duration-300 flex items-center justify-center"
            >
                <ChevronUp className="w-5 h-5" />
            </button>
        )}

        {showScrollTop && (
            <a
                href="https://wa.me/966533220646"
                target="_blank"
                rel="noopener noreferrer"
                className="fixed bottom-6 right-6 z-50 px-6 py-3 rounded-full bg-[#25D366] text-white shadow-lg hover:bg-[#1da851] transition-all duration-300 flex items-center gap-2 font-bold text-sm"
            >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>
                تواصل معنا
            </a>
        )}

        <FilterModal
            showFilters={showFilters}
            setShowFilters={setShowFilters}
            selectedDirection={selectedDirection}
            setSelectedDirection={setSelectedDirection}
            selectedType={selectedType}
            setSelectedType={setSelectedType}
            maxPrice={maxPrice}
            maxPriceValue={maxPriceValue}
            setMaxPrice={setMaxPrice}
            selectedFacilities={selectedFacilities}
            toggleFacility={toggleFacility}
            clearFilters={clearFilters}
            hasActiveFilters={hasActiveFilters}
            DIRECTIONS={DIRECTIONS}
            TYPES={TYPES}
            FACILITIES={FACILITIES}
        />
        </>
    );
}

interface PropertyCardProps {
    property: Property;
    isPremium: boolean;
    imgIdx: number;
    onNext: () => void;
    onPrev: () => void;
    onClick: () => void;
    occasionData?: { name: string; price: string };
    propertyImages: Map<string, string[]>;
}

function PropertyCard({ property, isPremium, imgIdx, onNext, onPrev, onClick, occasionData, propertyImages }: PropertyCardProps) {
    const imageUrl = getCachedPropertyImage(property.propertyNumber, imgIdx, propertyImages);
    const mainPrice = getPrimaryPropertyPriceDisplay(property.prices);
    const publicLabel = getPublicPropertyLabel(property);

    return (
        <Card
            className="group overflow-hidden rounded-xl cursor-pointer transition-shadow hover:shadow-lg border-0 shadow-sm bg-white"
            onClick={onClick}
        >
            <div className="relative">
                <img
                    src={imageUrl}
                    alt={publicLabel}
                    className="w-full h-36 sm:h-40 md:h-44 object-cover"
                    loading="lazy"
                    onError={(e) => {
                        (e.target as HTMLImageElement).src = PROPERTY_IMAGE_PLACEHOLDER;
                    }}
                />

                <PropertyFavoriteButton
                    propertyNumber={property.propertyNumber}
                    className="absolute left-2 top-2 z-20"
                />

                {!isPremium && property.createdAt && (Date.now() - new Date(property.createdAt).getTime()) < 7 * 24 * 60 * 60 * 1000 && (
                    <div className="absolute top-2 right-2 bg-green-600/90 px-2.5 py-1 rounded-lg shadow backdrop-blur-sm">
                        <span className="text-white font-bold text-xs">جديد</span>
                    </div>
                )}

                <div
                    className="absolute inset-0 flex items-center justify-between px-1 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => e.stopPropagation()}
                >
                    <button
                        onClick={(e) => { e.stopPropagation(); onPrev(); }}
                        className="w-7 h-7 bg-white/90 rounded-full flex items-center justify-center shadow hover:bg-white transition-colors"
                    >
                        <ChevronRight className="w-4 h-4 text-gray-700" />
                    </button>
                    <button
                        onClick={(e) => { e.stopPropagation(); onNext(); }}
                        className="w-7 h-7 bg-white/90 rounded-full flex items-center justify-center shadow hover:bg-white transition-colors"
                    >
                        <ChevronLeft className="w-4 h-4 text-gray-700" />
                    </button>
                </div>
            </div>

            <div className="p-2.5 sm:p-3">
                <h3 className="font-bold text-[#1a1a1a] text-xs sm:text-sm mb-1 line-clamp-1">
                    {publicLabel}
                </h3>

                <div className="flex items-center gap-1 text-[#6b6b6b] mb-2">
                    <MapPin className="w-3 h-3 flex-shrink-0" />
                    <span className="text-[11px] truncate">
                        {property.location || property.city}
                    </span>
                </div>

                <div className="flex items-center justify-between">
                    <PriceDisplay amount={mainPrice} size="md" />
                    {isPremium && (
                        <span className="-ml-3 bg-[#f5f0e4] text-[#b88d2b] text-xs font-bold pl-3 pr-4 py-1.5 rounded-tr-full">مميز</span>
                    )}
                </div>

                {occasionData && occasionData.price && (
                    <div className="mt-2 flex items-center gap-1 bg-[#f0fdf4] border border-green-200 rounded-lg px-2 py-1">
                        <Moon className="w-3 h-3 text-green-600" />
                        <span className="text-[10px] text-green-700 font-medium">{occasionData.name}:</span>
                        <PriceDisplay amount={occasionData.price} size="sm" />
                    </div>
                )}
            </div>
        </Card>
    );
}
