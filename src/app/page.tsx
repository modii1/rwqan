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
import { Search, MapPin, SlidersHorizontal, ChevronUp, ChevronRight, ChevronLeft, Waves, Star, Dumbbell, Snowflake, Flame, Sparkles, Wifi, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { PriceDisplay } from "@/components/price-display";
import { FilterModal } from "@/components/filter-modal";

const CITIES = ["بريدة", "عنيزة", "الرس", "البكيرية", "المذنب", "البدائع", "الاسياح", "رياض الخبراء", "عيون الجواء"];
const DIRECTIONS = ["شمال", "جنوب", "شرق", "غرب"];
const TYPES = ["قسم", "قسمين"];

// City-specific images from Unsplash (Saudi Arabia / Arabian Peninsula themed)
const CITY_IMAGES: Record<string, string> = {
    "بريدة": "https://images.unsplash.com/photo-1580418827495-f2df08f05e3c?w=600&h=450&fit=crop",
    "عنيزة": "https://images.unsplash.com/photo-1548013146-72479768bada?w=600&h=450&fit=crop",
    "الرس": "https://images.unsplash.com/photo-1597659840241-37e2b9c2f55f?w=600&h=450&fit=crop",
    "البكيرية": "https://images.unsplash.com/photo-1549880338-65ddcdfd017b?w=600&h=450&fit=crop",
    "المذنب": "https://images.unsplash.com/photo-1509316975850-ff9c5deb0cd9?w=600&h=450&fit=crop",
    "البدائع": "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=600&h=450&fit=crop",
    "الاسياح": "https://images.unsplash.com/photo-1473773508845-188df29842c1?w=600&h=450&fit=crop",
    "رياض الخبراء": "https://images.unsplash.com/photo-1501785888041-af3ef285b470?w=600&h=450&fit=crop",
    "عيون الجواء": "https://images.unsplash.com/photo-1469474968028-56623f02e42e?w=600&h=450&fit=crop"
};

const FACILITIES = [
    "مسبح", "بدون مسبح", "مبيت", "ألعاب مائية", "ملعب",
    "مناسبات", "شتاء", "صيف", "مكيف", "واي فاي",
];

const FEATURE_ICONS: Record<string, React.ReactNode> = {
    "مسبح": <Waves className="w-5 h-5 text-blue-500" />,
    "بدون مسبح": <Waves className="w-5 h-5 text-gray-400" />,
    "مبيت": <Star className="w-5 h-5 text-purple-500" />,
    "ألعاب مائية": <Waves className="w-5 h-5 text-cyan-500" />,
    "ملعب": <Dumbbell className="w-5 h-5 text-orange-500" />,
    "مناسبات": <Star className="w-5 h-5 text-pink-500" />,
    "شتاء": <Snowflake className="w-5 h-5 text-blue-400" />,
    "صيف": <Flame className="w-5 h-5 text-red-500" />,
    "مكيف": <Sparkles className="w-5 h-5 text-green-500" />,
    "واي فاي": <Wifi className="w-5 h-5 text-indigo-500" />,
};

const R2_BASE = "https://pub-e2fc1c0a598f4f0e91e47af63219848e.r2.dev";

function getPropertyImage(propertyNumber: string, index: number = 0) {
    return `${R2_BASE}/${propertyNumber}/${index + 1}.jpg`;
}

export default function HomePage() {
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
    const [currentImageIndex, setCurrentImageIndex] = useState<Map<string, number>>(new Map());
    const [isImageTransitioning, setIsImageTransitioning] = useState<Set<string>>(new Set());
    const [showFilters, setShowFilters] = useState(true);
    const [visibleCount, setVisibleCount] = useState(24);
    const [showScrollTop, setShowScrollTop] = useState(false);

    useEffect(() => {
        const onScroll = () => setShowScrollTop(window.scrollY > 400);
        window.addEventListener("scroll", onScroll);
        return () => window.removeEventListener("scroll", onScroll);
    }, []);

    const { data: allProperties = [], isLoading } = useQuery<Property[]>({
        queryKey: ["/api/properties"],
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

        const saved = sessionStorage.getItem("homeFilters");
        if (saved) {
            const f = JSON.parse(saved);
            setSearchQuery(f.searchQuery || "");
            setSelectedCity(f.selectedCity || "");
            setSelectedDirection(f.selectedDirection || "");
            setSelectedType(f.selectedType || "");
            setSelectedFacilities(f.selectedFacilities || []);
            if (f.maxPrice) setMaxPrice(f.maxPrice);
        }
    }, []);

    const filteredProperties = useMemo(() => {
        let results = allProperties;

        if (searchQuery.trim()) {
            const q = searchQuery.toLowerCase().trim();
            results = results.filter(p => {
                const searchable = [
                    p.propertyNumber, p.name, p.city, p.type,
                    ...(Array.isArray(p.facilities) ? p.facilities : []),
                ].join(" ").toLowerCase();
                return searchable.includes(q);
            });
        }

        return results.filter(p => {
            if (selectedCity && selectedCity !== "all") {
                if (p.city !== selectedCity) return false;
            }
            if (selectedDirection && selectedDirection !== "all") {
                if (p.direction !== selectedDirection) return false;
            }
            if (selectedType && selectedType !== "all") {
                if (p.type !== selectedType) return false;
            }
            if (selectedFacilities.length > 0) {
                const pf = Array.isArray(p.facilities) ? p.facilities : [];
                const hasAll = selectedFacilities.every(f =>
                    pf.some(pf2 => pf2.includes(f) || f.includes(pf2))
                );
                if (!hasAll) return false;
            }
            if (maxPrice < maxPriceValue) {
                const price = parseFloat(p.prices?.weekend || p.prices?.weekday || "0");
                if (price > maxPrice) return false;
            }
            return true;
        }).sort((a, b) => {
            const aPremium = a.subscriptionType === "مميز" ? 1 : 0;
            const bPremium = b.subscriptionType === "مميز" ? 1 : 0;
            return bPremium - aPremium;
        });
    }, [allProperties, searchQuery, selectedCity, selectedDirection, selectedType, selectedFacilities, maxPrice, maxPriceValue]);

    const featuredProperties = filteredProperties.filter(p => p.subscriptionType === "مميز").sort((a, b) => {
        const dateA = new Date(a.createdAt || a.subscriptionDate || 0).getTime();
        const dateB = new Date(b.createdAt || b.subscriptionDate || 0).getTime();
        return dateB - dateA;
    }).slice(0, 6);
    const visibleProperties = filteredProperties.slice(0, visibleCount);

    const cities = useMemo(() => {
        const counts: Record<string, number> = {};
        allProperties.forEach(p => {
            if (p.city) counts[p.city] = (counts[p.city] || 0) + 1;
        });
        return CITIES.map(city => ({
            name: city,
            count: counts[city] || 0,
            image: getPropertyImage(
                allProperties.find(p => p.city === city)?.propertyNumber || "0",
                0
            ),
        })).filter(c => c.count > 0);
    }, [allProperties]);

    const buildQueryString = () => {
        const params = new URLSearchParams();
        if (searchQuery) params.set("search", searchQuery);
        if (selectedCity) params.set("city", selectedCity);
        if (selectedDirection) params.set("direction", selectedDirection);
        if (selectedType) params.set("type", selectedType);
        if (selectedFacilities.length > 0) params.set("facilities", selectedFacilities.join(","));
        if (maxPrice < maxPriceValue) params.set("maxPrice", String(maxPrice));
        return params.toString();
    };

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
    };

    const goToProperty = (propertyNumber: string) => {
        const filters = { searchQuery, selectedCity, selectedDirection, selectedType, selectedFacilities, maxPrice };
        sessionStorage.setItem("homeFilters", JSON.stringify(filters));
        router.push(`/property/${propertyNumber}`);
    };

    const nextImage = (pn: string) => {
        setIsImageTransitioning(prev => new Set(prev).add(pn));
        setTimeout(() => {
            setCurrentImageIndex(prev => {
                const newMap = new Map(prev);
                newMap.set(pn, ((newMap.get(pn) || 0) + 1) % 3);
                return newMap;
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
                const newMap = new Map(prev);
                const cur = newMap.get(pn) || 0;
                newMap.set(pn, cur === 0 ? 2 : cur - 1);
                return newMap;
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

    const hasActiveFilters = searchQuery || selectedCity || selectedDirection || selectedType || selectedFacilities.length > 0 || maxPrice < maxPriceValue;

    useEffect(() => {
        const onScroll = () => {
            const y = window.scrollY;
            const nearBottom = y + window.innerHeight >= document.documentElement.scrollHeight - 600;
            if (nearBottom) {
                setVisibleCount(prev => Math.min(prev + 12, filteredProperties.length));
            }
        };
        window.addEventListener("scroll", onScroll);
        return () => window.removeEventListener("scroll", onScroll);
    }, [filteredProperties.length]);

    return (
        <>
        <div className="min-h-screen bg-[#fafafa]">
            {/* Hero Section */}
            <section className="relative bg-white border-b border-gray-100">
                <div className="max-w-7xl mx-auto px-4 pt-12 pb-8">
                    <div className="text-center mb-8">
                        <h1 className="text-3xl md:text-4xl font-bold text-[#1a1a1a] mb-2">
                            روقـان | نُـزل ورفـاهية
                        </h1>
                        <p className="text-[#6b6b6b] text-base md:text-lg">
                            اكتشف أفضل الشاليهات والاستراحات
                        </p>
                    </div>

                    {/* Hero Search */}
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
            <div className="bg-white border-b border-gray-100 shadow-sm">
                <div className="max-w-7xl mx-auto px-4 py-3">
                    <div className="flex items-center gap-3 overflow-x-auto scrollbar-hide">
                        <button
                            onClick={() => setShowFilters(!showFilters)}
                            className="flex items-center gap-2 px-4 py-2 bg-[#f9fafb] hover:bg-gray-100 rounded-full text-sm font-medium whitespace-nowrap transition-colors"
                        >
                            <Sparkles className="w-4 h-4" />
                            الفلاتر
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

                        <div className="mr-auto">
                            <Link href={`/properties${buildQueryString() ? "?" + buildQueryString() : ""}`}>
                                <Button size="sm" className="bg-[#b88d2b] hover:bg-[#9a7623] text-white rounded-full px-6 text-sm font-bold whitespace-nowrap">
                                    عرض الكل
                                </Button>
                            </Link>
                        </div>
                    </div>
                </div>
            </div>

            <div className="max-w-7xl mx-auto px-4 py-8">
                {/* CTA Section - Moved before cities */}
                <section className="bg-white border border-gray-200 rounded-2xl py-10 mb-10">
                    <div className="max-w-3xl mx-auto px-4 text-center">
                        <h2 className="text-2xl md:text-3xl font-bold text-[#1a1a1a] mb-3">لديك عقار؟</h2>
                        <p className="text-gray-600 mb-6">سجّل عقارك في منصة روقان وابدأ باستقبال الحجوزات</p>
                        <Link href="/subscription">
                            <Button size="lg" className="bg-[#b88d2b] hover:bg-[#9a7623] text-white font-bold rounded-full px-10">
                                اشترك الآن
                            </Button>
                        </Link>
                    </div>
                </section>

                {/* Cities Section */}
                {cities.length > 0 && (
                    <section className="mb-10">
                        <h2 className="text-xl font-bold text-[#1a1a1a] mb-4">المدن</h2>
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 md:gap-4">
                            {cities.map((city, idx) => (
                                <Link
                                    key={city.name}
                                    href={`/properties?city=${encodeURIComponent(city.name)}`}
                                    className="group relative overflow-hidden rounded-2xl aspect-[4/3] bg-gray-100"
                                >
                                    <img
                                        src={CITY_IMAGES[city.name] || getPropertyImage(
                                            allProperties.find(p => p.city === city.name)?.propertyNumber || "0",
                                            idx % 3
                                        )}
                                        alt={city.name}
                                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                                        onError={(e) => {
                                            (e.target as HTMLImageElement).src = `https://picsum.photos/seed/${city.name}/400/300`;
                                        }}
                                    />
                                    <div className="absolute inset-0 bg-black/30" />
                                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                                        <h3 className="text-white font-bold text-base">{city.name}</h3>
                                        <p className="text-white/80 text-xs">{city.count} عقار</p>
                                    </div>
                                </Link>
                            ))}
                        </div>
                    </section>
                )}

                {/* Results count */}
                {hasActiveFilters && (
                    <div className="mb-6">
                        <p className="text-sm text-[#6b6b6b]">
                            <span className="font-bold text-[#1a1a1a]">{filteredProperties.length}</span> عقار
                        </p>
                    </div>
                )}

                {/* Featured Properties - Commented out */}
                {/* {featuredProperties.length > 0 && !hasActiveFilters && (
                    <section className="mb-10">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-xl font-bold text-[#1a1a1a]">أحدث العقارات</h2>
                            <Link href="/properties" className="text-sm text-[#b88d2b] font-medium hover:underline">
                                عرض الكل
                            </Link>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 md:gap-6">
                            {featuredProperties.map(p => (
                                <PropertyCard
                                    key={p.propertyNumber}
                                    property={p}
                                    isPremium={p.subscriptionType === "مميز"}
                                    onNext={() => nextImage(p.propertyNumber)}
                                    onPrev={() => prevImage(p.propertyNumber)}
                                    imgIdx={getImgIdx(p.propertyNumber)}
                                    isTransitioning={isImageTransitioning.has(p.propertyNumber)}
                                    onClick={() => goToProperty(p.propertyNumber)}
                                />
                            ))}
                        </div>
                    </section>
                )} */}

                {/* All Properties - Mixed Premium and Normal */}
                {filteredProperties.length > 0 && (
                    <section className="mb-10">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-xl font-bold text-[#1a1a1a]">جميع العقارات</h2>
                        </div>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 md:gap-6">
                            {filteredProperties.map(p => (
                                <PropertyCard
                                    key={p.propertyNumber}
                                    property={p}
                                    isPremium={p.subscriptionType === "مميز"}
                                    onNext={() => nextImage(p.propertyNumber)}
                                    onPrev={() => prevImage(p.propertyNumber)}
                                    imgIdx={getImgIdx(p.propertyNumber)}
                                    isTransitioning={isImageTransitioning.has(p.propertyNumber)}
                                    onClick={() => goToProperty(p.propertyNumber)}
                                />
                            ))}
                        </div>
                    </section>
                )}

                {isLoading ? (
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-4 md:gap-6">
                        {[...Array(6)].map((_, i) => (
                            <div key={i} className="h-72 bg-gray-100 rounded-2xl animate-pulse" />
                        ))}
                    </div>
                ) : filteredProperties.length === 0 ? (
                    <div className="text-center py-20">
                        <p className="text-[#6b6b6b] text-lg">لا توجد عقارات مطابقة</p>
                        <button
                            onClick={clearFilters}
                            className="mt-4 text-[#b88d2b] font-medium hover:underline"
                        >
                            مسح الفلاتر
                        </button>
                    </div>
                ) : null}

                {/* Empty state - no filters, no properties yet */}
                {!hasActiveFilters && filteredProperties.length === 0 && !isLoading && (
                    <div className="text-center py-20">
                        <p className="text-[#6b6b6b] text-lg">جاري تحميل العقارات...</p>
                    </div>
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
                className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-6 py-3 rounded-full bg-[#b88d2b] text-white shadow-lg hover:bg-[#9a7623] transition-all duration-300 flex items-center gap-2 font-bold text-sm"
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
    onNext: () => void;
    onPrev: () => void;
    imgIdx: number;
    isTransitioning: boolean;
    onClick: () => void;
}

function PropertyCard({ property, isPremium, onNext, onPrev, imgIdx, isTransitioning, onClick }: PropertyCardProps) {
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
                    alt={property.name}
                    className={`w-full h-40 md:h-52 object-cover transition-opacity duration-300 ${
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
                    <div className="flex items-center gap-2 text-[#9ca3af] mb-3">
                        {topFacilities.map((f, i) => (
                            <span key={i} className="text-xs">{f}</span>
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
