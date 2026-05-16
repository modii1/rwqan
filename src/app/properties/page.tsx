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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Search,
    X,
    MapPin,
    Star,
    ChevronLeft,
    ChevronRight,
    Sparkles,
    Home,
    ChevronUp,
    SlidersHorizontal,
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
    const filtersRef = useRef<HTMLDivElement>(null);

    const [searchQuery, setSearchQuery] = useState(searchParams.get("search") || "");
    const [selectedCity, setSelectedCity] = useState(searchParams.get("city") || "");
    const [selectedDirection, setSelectedDirection] = useState(searchParams.get("direction") || "");
    const [selectedType, setSelectedType] = useState(searchParams.get("type") || "");
    const [selectedFacilities, setSelectedFacilities] = useState<string[]>(
        searchParams.get("facilities") ? searchParams.get("facilities")!.split(",").filter(Boolean) : []
    );
    const [maxPrice, setMaxPrice] = useState<number>(99999);
    const [showFilters, setShowFilters] = useState(true);
    const [currentImageIndex, setCurrentImageIndex] = useState<Map<string, number>>(new Map());
    const [isImageTransitioning, setIsImageTransitioning] = useState<Set<string>>(new Set());
    const [visibleCount, setVisibleCount] = useState(24);
    const [showScrollTop, setShowScrollTop] = useState(false);

    useEffect(() => {
        const onScroll = () => setShowScrollTop(window.scrollY > 400);
        window.addEventListener("scroll", onScroll);
        return () => window.removeEventListener("scroll", onScroll);
    }, []);

    // Fetch ALL properties for computing max price (not filtered)
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
            setSearchQuery(f.searchQuery || "");
            setSelectedCity(f.selectedCity || "");
            setSelectedDirection(f.selectedDirection || "");
            setSelectedType(f.selectedType || "");
            setSelectedFacilities(f.selectedFacilities || []);
            if (f.maxPrice && f.maxPrice < 99999) setMaxPrice(f.maxPrice);
        }
    }, []);

    const filteredCount = properties.length;

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

    const hasActiveFilters = searchQuery || selectedCity || selectedDirection || selectedType || selectedFacilities.length > 0 || maxPrice < maxPriceValue;

    useEffect(() => {
        const filters = { searchQuery, selectedCity, selectedDirection, selectedType, selectedFacilities, maxPrice };
        sessionStorage.setItem("propsPageFilters", JSON.stringify(filters));
    }, [searchQuery, selectedCity, selectedDirection, selectedType, selectedFacilities, maxPrice]);

    useEffect(() => {
        const onScroll = () => {
            const y = window.scrollY;
            if (y + window.innerHeight >= document.documentElement.scrollHeight - 600) {
                setVisibleCount(prev => Math.min(prev + 12, properties.length));
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

    const visibleProperties = properties.slice(0, visibleCount);

    return (
        <>
        <div className="min-h-screen bg-[#fafafa]">
            {/* Header */}
            <section className="relative bg-white border-b border-gray-100">
                <div className="max-w-7xl mx-auto px-4 pt-12 pb-8">
                    <div className="text-center mb-8">
                        <h1 className="text-3xl md:text-4xl font-bold text-[#1a1a1a] mb-2">
                            جميع العقارات
                        </h1>
                        <p className="text-[#6b6b6b] text-base md:text-lg">
                            اكتشف أفضل الشاليهات والاستراحات في منطقة القصيم
                        </p>
                    </div>

                    {/* Search Bar */}
                    <div className="max-w-3xl mx-auto">
                        <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-3 md:p-4">
                            <div className="flex flex-col md:flex-row gap-2 md:gap-3">
                                <div className="relative flex-1">
                                    <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9ca3af]" />
                                    <Input
                                        placeholder="ابحث عن عقار..."
                                        value={searchQuery}
                                        onChange={(e) => setSearchQuery(e.target.value)}
                                        className="pr-10 h-11 rounded-xl border-gray-200 bg-[#f9fafb] text-sm"
                                    />
                                </div>

                                <div className="flex flex-row gap-2 md:flex-row md:gap-3">
                                    <Select value={selectedCity} onValueChange={setSelectedCity}>
                                        <SelectTrigger className="h-11 w-full md:w-36 rounded-xl border-gray-200 bg-[#f9fafb] text-sm">
                                            <SelectValue placeholder="المدينة" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="all">الكل</SelectItem>
                                            {CITIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                                        </SelectContent>
                                    </Select>

                                    <Select value={selectedType} onValueChange={setSelectedType}>
                                        <SelectTrigger className="h-11 w-full md:w-32 rounded-xl border-gray-200 bg-[#f9fafb] text-sm">
                                            <SelectValue placeholder="النوع" />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="all">الكل</SelectItem>
                                            {TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                                        </SelectContent>
                                    </Select>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </section>

            {/* Filters Bar */}
            <div ref={filtersRef} className="bg-white border-b border-gray-100 shadow-sm">
                <div className="max-w-7xl mx-auto px-4 py-3">
                    <div className="flex items-center gap-3 overflow-x-auto scrollbar-hide">
                        <button
                            onClick={() => setShowFilters(!showFilters)}
                            className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                                showFilters || hasActiveFilters
                                    ? "bg-[#b88d2b] text-white"
                                    : "bg-[#f3f4f6] text-[#6b6b6b] hover:bg-gray-100"
                            }`}
                        >
                            <Sparkles className="w-4 h-4" />
                            الفلاتر
                            {hasActiveFilters && (
                                <span className="bg-white text-[#b88d2b] text-xs font-bold rounded-full w-5 h-5 flex items-center justify-center">
                                    {selectedFacilities.length + (selectedDirection ? 1 : 0) + (selectedType ? 1 : 0) + (searchQuery ? 1 : 0)}
                                </span>
                            )}
                        </button>

                        <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide">
                            {CITIES.map(city => (
                                <button
                                    key={city}
                                    onClick={() => setSelectedCity(selectedCity === city ? "" : city)}
                                    className={`px-3 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                                        selectedCity === city
                                            ? "bg-[#b88d2b] text-white"
                                            : "bg-[#f3f4f6] text-[#6b6b6b] hover:bg-gray-100"
                                    }`}
                                >
                                    {city}
                                </button>
                            ))}
                        </div>

                        {hasActiveFilters && (
                            <button
                                onClick={clearFilters}
                                className="flex items-center gap-1 px-3 py-1.5 text-sm text-red-500 hover:text-red-600 whitespace-nowrap transition-colors"
                            >
                                <X className="w-3 h-3" />
                                مسح
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* Properties Grid */}
            <div className="max-w-7xl mx-auto px-4 py-8">
                {/* Active filters summary */}
                {hasActiveFilters && (
                    <div className="mb-6 flex items-center gap-2 flex-wrap">
                        <span className="text-sm text-[#6b6b6b]">نتائج:</span>
                        <span className="text-sm font-bold text-[#1a1a1a]">{filteredCount}</span>
                        {selectedCity && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#b88d2b]/10 text-[#b88d2b] text-xs rounded-full">
                                {selectedCity}
                                <button onClick={() => setSelectedCity("")} className="hover:text-[#9a7623]"><X className="w-2.5 h-2.5" /></button>
                            </span>
                        )}
                        {selectedDirection && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#b88d2b]/10 text-[#b88d2b] text-xs rounded-full">
                                {selectedDirection}
                                <button onClick={() => setSelectedDirection("")} className="hover:text-[#9a7623]"><X className="w-2.5 h-2.5" /></button>
                            </span>
                        )}
                        {selectedType && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#b88d2b]/10 text-[#b88d2b] text-xs rounded-full">
                                {selectedType}
                                <button onClick={() => setSelectedType("")} className="hover:text-[#9a7623]"><X className="w-2.5 h-2.5" /></button>
                            </span>
                        )}
                        {selectedFacilities.map(f => (
                            <span key={f} className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#b88d2b]/10 text-[#b88d2b] text-xs rounded-full">
                                {f}
                                <button onClick={() => toggleFacility(f)} className="hover:text-[#9a7623]"><X className="w-2.5 h-2.5" /></button>
                            </span>
                        ))}
                        {maxPrice < maxPriceValue && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-[#b88d2b]/10 text-[#b88d2b] text-xs rounded-full">
                                حتى {maxPrice}
                                <button onClick={() => setMaxPrice(maxPriceValue)} className="hover:text-[#9a7623]"><X className="w-2.5 h-2.5" /></button>
                            </span>
                        )}
                    </div>
                )}

                {isLoading ? (
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4 md:gap-6">
                        {[...Array(6)].map((_, i) => (
                            <div key={i} className="h-80 bg-gray-100 rounded-2xl animate-pulse" />
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
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 md:gap-6">
                            {visibleProperties.map(p => (
                                <PropertyCard
                                    key={p.propertyNumber}
                                    property={p}
                                    isPremium={p.subscriptionType === "مميز"}
                                    imgIdx={getImgIdx(p.propertyNumber)}
                                    isTransitioning={isImageTransitioning.has(p.propertyNumber)}
                                    onNext={() => nextImage(p.propertyNumber)}
                                    onPrev={() => prevImage(p.propertyNumber)}
                                    onClick={() => router.push(`/property/${p.propertyNumber}`)}
                                />
                            ))}
                        </div>

                        {visibleCount < properties.length && (
                            <div className="text-center mt-10">
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

        {showScrollTop && (
            <button
                onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
                className="fixed bottom-6 right-6 z-50 w-12 h-12 rounded-full bg-[#b88d2b] text-white shadow-lg hover:bg-[#9a7623] transition-all duration-300 flex items-center justify-center"
            >
                <ChevronUp className="w-6 h-6" />
            </button>
        )}

        {showScrollTop && (
            <button
                onClick={() => setShowFilters(true)}
                className="fixed bottom-6 left-6 z-50 px-4 py-3 rounded-full bg-[#b88d2b] text-white shadow-lg hover:bg-[#9a7623] transition-all duration-300 flex items-center gap-2 font-bold text-sm"
            >
                <SlidersHorizontal className="w-4 h-4" />
                تصفية
            </button>
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
    const topFacilities = (Array.isArray(property.facilities) ? property.facilities : []).slice(0, 2);

    return (
        <Card
            className={`group overflow-hidden rounded-2xl cursor-pointer transition-shadow hover:shadow-lg ${
                isPremium ? "ring-2 ring-[#b88d2b]" : ""
            }`}
            onClick={onClick}
        >
            <div className="relative">
                <img
                    src={imageUrl}
                    alt={property.name || property.propertyNumber}
                    className={`w-full h-44 md:h-56 object-cover transition-opacity duration-300 ${
                        isTransitioning ? "opacity-0" : "opacity-100"
                    }`}
                    onError={(e) => {
                        (e.target as HTMLImageElement).src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='300' viewBox='0 0 400 300'%3E%3Crect fill='%23f3f4f6' width='400' height='300'/%3E%3Ctext x='50%25' y='50%25' font-family='Cairo,sans-serif' font-size='18' fill='%239ca3af' text-anchor='middle' dy='.3em'%3Eلا توجد صور%3C/text%3E%3C/svg%3E";
                    }}
                />

                {isPremium && (
                    <div className="absolute top-2 right-2 bg-white/95 backdrop-blur-sm px-2 py-1 rounded-full shadow flex items-center gap-1">
                        <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" />
                        <span className="text-[#b38b00] font-bold text-xs">مميز</span>
                    </div>
                )}

                <div
                    className="absolute inset-0 flex items-center justify-between px-1 opacity-0 group-hover:opacity-100 transition-opacity"
                    onClick={(e) => e.stopPropagation()}
                >
                    <button
                        onClick={(e) => { e.stopPropagation(); onPrev(); }}
                        className="w-8 h-8 bg-white/90 rounded-full flex items-center justify-center shadow hover:bg-white transition-colors"
                    >
                        <ChevronRight className="w-4 h-4 text-[#434040]" />
                    </button>
                    <button
                        onClick={(e) => { e.stopPropagation(); onNext(); }}
                        className="w-8 h-8 bg-white/90 rounded-full flex items-center justify-center shadow hover:bg-white transition-colors"
                    >
                        <ChevronLeft className="w-4 h-4 text-[#434040]" />
                    </button>
                </div>
            </div>

            <div className="p-3 md:p-4">
                <div className="flex items-center gap-1 text-[#b88d2b] mb-1">
                    <MapPin className="w-3 h-3 flex-shrink-0" />
                    <span className="text-xs font-medium truncate">
                        {property.location || property.city}
                    </span>
                </div>

                {isPremium && property.name && (
                    <h3 className="font-bold text-[#1a1a1a] text-sm mb-1 line-clamp-1">{property.name}</h3>
                )}

                {topFacilities.length > 0 && (
                    <div className="flex items-center gap-2 text-[#9ca3af] mb-3 overflow-hidden">
                        {topFacilities.map((f, i) => (
                            <span key={i} className="text-xs whitespace-nowrap">{f}</span>
                        ))}
                    </div>
                )}

                <div className="flex items-center justify-between">
                    <PriceDisplay amount={mainPrice} size="md" />
                    <Button
                        size="sm"
                        className="bg-[#b88d2b] hover:bg-[#9a7623] text-white text-xs h-8 px-3 rounded-lg font-bold"
                        onClick={(e) => { e.stopPropagation(); onClick(); }}
                    >
                        التفاصيل
                    </Button>
                </div>
            </div>
        </Card>
    );
}
