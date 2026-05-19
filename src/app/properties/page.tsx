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
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { PriceDisplay } from "@/components/price-display";
import { FilterModal } from "@/components/filter-modal";

const CITIES = ["بريدة", "عنيزة", "الرس", "البكيرية", "المذنب", "البدائع", "الاسياح", "رياض الخبراء", "عيون الجواء"];
const DIRECTIONS = ["شمال", "جنوب", "شرق", "غرب"];
const TYPES = ["قسم", "قسمين"];
const FACILITIES = ["مسبح", "بدون مسبح", "مبيت", "ألعاب مائية", "ملعب", "مناسبات", "شتاء", "صيف", "مكيف", "واي فاي"];

const R2_BASE = "https://pub-e2fc1c0a598f4f0e91e47af63219848e.r2.dev";

function getPropertyImage(propertyNumber: string, index: number = 0) {
    return `${R2_BASE}/${propertyNumber}/${index + 1}.jpg`;
}

export default function AllPropertiesPage() {
    const router = useRouter();
    const searchParams = useSearchParams();

    const [searchQuery, setSearchQuery] = useState(searchParams.get("search") || "");
    const [selectedCity, setSelectedCity] = useState(searchParams.get("city") || "");
    const [selectedDirection, setSelectedDirection] = useState(searchParams.get("direction") || "");
    const [selectedType, setSelectedType] = useState(searchParams.get("type") || "");
    const [selectedFacilities, setSelectedFacilities] = useState<string[]>(
        searchParams.get("facilities") ? searchParams.get("facilities")!.split(",").filter(Boolean) : []
    );
    const [maxPrice, setMaxPrice] = useState<number>(99999);
    const [showFilters, setShowFilters] = useState(false);
    const [currentImageIndex, setCurrentImageIndex] = useState<Map<string, number>>(new Map());
    const [isImageTransitioning, setIsImageTransitioning] = useState<Set<string>>(new Set());
    const [visibleCount, setVisibleCount] = useState(24);
    const [showScrollTop, setShowScrollTop] = useState(false);

    useEffect(() => {
        const onScroll = () => setShowScrollTop(window.scrollY > 400);
        window.addEventListener("scroll", onScroll);
        return () => window.removeEventListener("scroll", onScroll);
    }, []);

    const { data: allProperties = [] } = useQuery<Property[]>({
        queryKey: ["/api/properties"],
    });

    const buildQueryString = () => {
        const params = new URLSearchParams();
        if (searchQuery) params.set("search", searchQuery);
        if (selectedCity) params.set("city", selectedCity);
        if (selectedDirection) params.set("direction", selectedDirection);
        if (selectedType) params.set("type", selectedType);
        if (selectedFacilities.length > 0) params.set("facilities", selectedFacilities.join(","));
        if (maxPrice < 99999) params.set("maxPrice", String(maxPrice));
        return params.toString();
    };

    const { data: properties = [], isLoading } = useQuery<Property[]>({
        queryKey: ["/api/search", searchQuery, selectedCity, selectedDirection, selectedType, selectedFacilities.join(","), maxPrice],
        queryFn: async () => {
            const qs = buildQueryString();
            const res = await fetch(`/api/search${qs ? `?${qs}` : ""}`);
            if (!res.ok) throw new Error("Failed to fetch");
            return res.json();
        },
    });

    const maxPriceValue = useMemo(() => {
        const prices = allProperties.flatMap(p => [
            parseFloat(p.prices?.weekday || "0"),
            parseFloat(p.prices?.weekend || "0"),
        ]).filter(p => p > 0);
        return prices.length > 0 ? Math.ceil(Math.max(...prices)) : 500;
    }, [allProperties]);

    const initializedRef = useRef(false);
    useEffect(() => {
        if (initializedRef.current) {
            setMaxPrice(maxPriceValue);
        }
    }, [maxPriceValue]);

    useEffect(() => {
        if (initializedRef.current) return;
        initializedRef.current = true;
        setMaxPrice(maxPriceValue);

        const saved = sessionStorage.getItem("propsPageFilters");
        if (saved) {
            const f = JSON.parse(saved);
            // Only restore from sessionStorage if there are NO URL params
            // (URL params take priority - e.g. coming from home page city click)
            const hasUrlParams = searchParams.get("search") || searchParams.get("city") || 
                searchParams.get("direction") || searchParams.get("type") || searchParams.get("facilities");
            
            if (!hasUrlParams) {
                setSearchQuery(f.searchQuery || "");
                setSelectedCity(f.selectedCity || "");
                setSelectedDirection(f.selectedDirection || "");
                setSelectedType(f.selectedType || "");
                setSelectedFacilities(f.selectedFacilities || []);
                if (f.maxPrice && f.maxPrice < 99999) setMaxPrice(f.maxPrice);
            }
            // Always restore visibleCount (min 24 to prevent empty page)
            if (f.visibleCount && f.visibleCount >= 24) setVisibleCount(f.visibleCount);
        }
    }, []);

    const toggleFacility = (f: string) => {
        setSelectedFacilities(prev =>
            prev.includes(f) ? prev.filter(x => x !== f) : [...prev, f]
        );
    };

    const clearFilters = () => {
        setSearchQuery("");
        setSelectedCity("");
        setSelectedDirection("");
        setSelectedType("");
        setSelectedFacilities([]);
        setMaxPrice(maxPriceValue);
        sessionStorage.removeItem("propsPageFilters");
    };

    const hasActiveFilters = !!(searchQuery || selectedCity || selectedDirection || selectedType || selectedFacilities.length > 0 || maxPrice < maxPriceValue);

    useEffect(() => {
        const filters = { searchQuery, selectedCity, selectedDirection, selectedType, selectedFacilities, maxPrice, visibleCount };
        sessionStorage.setItem("propsPageFilters", JSON.stringify(filters));
    }, [searchQuery, selectedCity, selectedDirection, selectedType, selectedFacilities, maxPrice, visibleCount]);

    // Restore scroll position when navigating back
    useEffect(() => {
        const savedScroll = sessionStorage.getItem("propsScrollY");
        if (savedScroll && properties.length > 0) {
            requestAnimationFrame(() => {
                window.scrollTo(0, parseInt(savedScroll, 10));
                sessionStorage.removeItem("propsScrollY");
            });
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

    const nextImage = (pn: string) => {
        setIsImageTransitioning(prev => new Set(prev).add(pn));
        setTimeout(() => {
            setCurrentImageIndex(prev => {
                const m = new Map(prev);
                m.set(pn, ((m.get(pn) || 0) + 1) % 3);
                return m;
            });
            setTimeout(() => {
                setIsImageTransitioning(prev => {
                    const s = new Set(prev);
                    s.delete(pn);
                    return s;
                });
            }, 150);
        }, 150);
    };

    const prevImage = (pn: string) => {
        setIsImageTransitioning(prev => new Set(prev).add(pn));
        setTimeout(() => {
            setCurrentImageIndex(prev => {
                const m = new Map(prev);
                const cur = m.get(pn) || 0;
                m.set(pn, cur === 0 ? 2 : cur - 1);
                return m;
            });
            setTimeout(() => {
                setIsImageTransitioning(prev => {
                    const s = new Set(prev);
                    s.delete(pn);
                    return s;
                });
            }, 150);
        }, 150);
    };

    const getImgIdx = (pn: string) => currentImageIndex.get(pn) || 0;

    const sortedProperties = useMemo(() => {
        return [...properties].sort((a, b) => {
            const aIsPremium = a.subscriptionType === "مميز" ? 1 : 0;
            const bIsPremium = b.subscriptionType === "مميز" ? 1 : 0;
            return bIsPremium - aIsPremium;
        });
    }, [properties]);

    const visibleProperties = sortedProperties.slice(0, visibleCount);

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

                    {/* City pills */}
                    <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide">
                        {CITIES.map(city => (
                            <button
                                key={city}
                                onClick={() => setSelectedCity(selectedCity === city ? "" : city)}
                                className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                                    selectedCity === city
                                        ? "bg-[#b88d2b] text-white"
                                        : "bg-[#f3f4f6] text-[#6b6b6b] hover:bg-gray-200"
                                }`}
                            >
                                {city}
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
                </div>
            </section>

            {/* Results */}
            <div className="max-w-7xl mx-auto px-4 py-6">
                {/* Active filter tags */}
                {hasActiveFilters && (
                    <div className="mb-4 flex items-center gap-2 flex-wrap">
                        <span className="text-sm text-[#6b6b6b]">النتائج:</span>
                        <span className="text-sm font-bold text-[#1a1a1a]">{properties.length}</span>
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
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
                        {[...Array(6)].map((_, i) => (
                            <div key={i} className="h-72 bg-gray-100 rounded-2xl animate-pulse" />
                        ))}
                    </div>
                ) : properties.length === 0 ? (
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
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
                            {visibleProperties.map(p => (
                                <PropertyCard
                                    key={p.propertyNumber}
                                    property={p}
                                    isPremium={p.subscriptionType === "مميز"}
                                    imgIdx={getImgIdx(p.propertyNumber)}
                                    isTransitioning={isImageTransitioning.has(p.propertyNumber)}
                                    onNext={() => nextImage(p.propertyNumber)}
                                    onPrev={() => prevImage(p.propertyNumber)}
                                    onClick={() => {
                                        sessionStorage.setItem("propsScrollY", String(window.scrollY));
                                        router.push(`/property/${p.propertyNumber}`);
                                    }}
                                />
                            ))}
                        </div>

                        {visibleCount < properties.length && (
                            <div className="text-center mt-8">
                                <button
                                    onClick={() => setVisibleCount(prev => Math.min(prev + 12, properties.length))}
                                    className="px-8 py-3 border-2 border-[#b88d2b] text-[#b88d2b] font-bold rounded-full hover:bg-[#b88d2b] hover:text-white transition-colors"
                                >
                                    تحميل المزيد ({properties.length - visibleCount} متبقي)
                                </button>
                            </div>
                        )}
                    </>
                )}
            </div>
        </div>

        {/* Scroll to top */}
        {showScrollTop && (
            <button
                onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
                className="fixed bottom-6 left-6 z-50 w-11 h-11 rounded-full bg-[#b88d2b] text-white shadow-lg hover:bg-[#9a7623] transition-all duration-300 flex items-center justify-center"
            >
                <ChevronUp className="w-5 h-5" />
            </button>
        )}

        {/* WhatsApp contact button */}
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
    isTransitioning: boolean;
    onNext: () => void;
    onPrev: () => void;
    onClick: () => void;
}

function PropertyCard({ property, isPremium, imgIdx, isTransitioning, onNext, onPrev, onClick }: PropertyCardProps) {
    const imageUrl = getPropertyImage(property.propertyNumber, imgIdx);
    const mainPrice = property.prices?.weekday || property.prices?.weekend || "0";

    return (
        <Card
            className="group overflow-hidden rounded-2xl cursor-pointer transition-shadow hover:shadow-lg border-0 shadow-sm"
            onClick={onClick}
        >
            <div className="relative">
                <img
                    src={imageUrl}
                    alt={property.name || property.propertyNumber}
                    className={`w-full h-40 md:h-48 object-cover transition-opacity duration-300 ${
                        isTransitioning ? "opacity-0" : "opacity-100"
                    }`}
                    onError={(e) => {
                        (e.target as HTMLImageElement).src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='300' viewBox='0 0 400 300'%3E%3Crect fill='%23f3f4f6' width='400' height='300'/%3E%3Ctext x='50%25' y='50%25' font-family='Cairo,sans-serif' font-size='18' fill='%239ca3af' text-anchor='middle' dy='.3em'%3Eلا توجد صور%3C/text%3E%3C/svg%3E";
                    }}
                />

                {/* Badge */}
                {isPremium && (
                    <div className="absolute top-2 right-2 bg-[#b88d2b] px-2.5 py-1 rounded-lg shadow">
                        <span className="text-white font-bold text-xs">مميز</span>
                    </div>
                )}

                {!isPremium && property.createdAt && (Date.now() - new Date(property.createdAt).getTime()) < 7 * 24 * 60 * 60 * 1000 && (
                    <div className="absolute top-2 right-2 bg-green-600 px-2.5 py-1 rounded-lg shadow">
                        <span className="text-white font-bold text-xs">جديد</span>
                    </div>
                )}

                {/* Image navigation */}
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

            <div className="p-3">
                {/* Property name - only for premium */}
                {isPremium && (
                    <h3 className="font-bold text-[#1a1a1a] text-sm mb-1 line-clamp-1">
                        {property.name || property.type || "عقار"}
                    </h3>
                )}

                {/* Location */}
                <div className="flex items-center gap-1 text-[#6b6b6b] mb-2">
                    <MapPin className="w-3 h-3 flex-shrink-0" />
                    <span className="text-xs truncate">
                        {property.location || property.city}
                    </span>
                </div>

                {/* Price */}
                <div className="flex items-center justify-between">
                    <PriceDisplay amount={mainPrice} size="md" />
                </div>
            </div>
        </Card>
    );
}
