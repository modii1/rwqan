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
import { Search, MapPin, SlidersHorizontal, ChevronUp, ChevronRight, ChevronLeft, Star, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { PriceDisplay } from "@/components/price-display";
import { FilterModal } from "@/components/filter-modal";
import { normalizeArabicText } from "@/lib/arabicSearch";

const CITIES = ["بريدة", "عنيزة", "الرس", "البكيرية", "المذنب", "البدائع", "الاسياح", "رياض الخبراء", "عيون الجواء"];
const DIRECTIONS = ["شمال", "جنوب", "شرق", "غرب"];
const TYPES = ["قسم", "قسمين"];

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

const R2_BASE = "https://pub-e2fc1c0a598f4f0e91e47af63219848e.r2.dev";

function getPropertyImage(propertyNumber: string, index: number = 0) {
    return `${R2_BASE}/${propertyNumber}/${index + 1}.jpg`;
}

export default function HomePage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const featuredScrollRef = useRef<HTMLDivElement>(null);
    const citiesScrollRef = useRef<HTMLDivElement>(null);

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
    const [showFilters, setShowFilters] = useState(false);
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
            const q = normalizeArabicText(searchQuery);
            results = results.filter(p => {
                const searchable = normalizeArabicText([
                    p.propertyNumber, p.name, p.city, p.type, p.location,
                    ...(Array.isArray(p.facilities) ? p.facilities : []),
                ].join(" "));
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
    }).slice(0, 8);

    const latestProperties = [...filteredProperties].sort((a, b) => {
        const aIsPremium = a.subscriptionType === "مميز" ? 1 : 0;
        const bIsPremium = b.subscriptionType === "مميز" ? 1 : 0;
        return bIsPremium - aIsPremium;
    }).slice(0, 12);

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
        sessionStorage.setItem("homeScrollY", String(window.scrollY));
        router.push(`/property/${propertyNumber}`);
    };

    // Restore scroll position when navigating back
    useEffect(() => {
        const savedScroll = sessionStorage.getItem("homeScrollY");
        if (savedScroll && allProperties.length > 0) {
            const scrollY = parseInt(savedScroll, 10);
            sessionStorage.removeItem("homeScrollY");
            // Multiple attempts to ensure scroll happens after Next.js resets to top
            const restore = () => window.scrollTo(0, scrollY);
            requestAnimationFrame(restore);
            setTimeout(restore, 50);
            setTimeout(restore, 150);
        }
    }, [allProperties.length]);

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

    const hasActiveFilters = !!(searchQuery || selectedCity || selectedDirection || selectedType || selectedFacilities.length > 0 || maxPrice < maxPriceValue);

    const scrollContainer = (ref: React.RefObject<HTMLDivElement | null>, dir: "left" | "right") => {
        if (ref.current) {
            const amount = 280;
            ref.current.scrollBy({
                left: dir === "left" ? -amount : amount,
                behavior: "smooth",
            });
        }
    };

    // Auto-scroll featured properties
    useEffect(() => {
        const el = featuredScrollRef.current;
        if (!el || featuredProperties.length <= 1) return;

        const interval = setInterval(() => {
            const maxScroll = el.scrollWidth - el.clientWidth;
            if (Math.abs(el.scrollLeft) >= maxScroll - 10) {
                el.scrollTo({ left: 0, behavior: "smooth" });
            } else {
                el.scrollBy({ left: -280, behavior: "smooth" });
            }
        }, 3500);

        return () => clearInterval(interval);
    }, [featuredProperties.length]);

    const handleSearch = () => {
        const qs = buildQueryString();
        router.push(`/properties${qs ? "?" + qs : ""}`);
    };

    return (
        <>
        <div className="min-h-screen bg-[#fafafa]">
            {/* Hero Section */}
            <section className="bg-white pb-6">
                <div className="max-w-7xl mx-auto px-4 pt-8 md:pt-12">
                    <div className="text-center mb-6">
                        <h1 className="text-3xl md:text-4xl font-bold text-[#1a1a1a] mb-2">
                            روقـان | نُـزل ورفـاهية
                        </h1>
                        <p className="text-[#6b6b6b] text-base md:text-lg">
                            اكتشف أفضل الشاليهات والاستراحات
                        </p>
                    </div>
                </div>
            </section>

            {/* CTA Banner */}
            <section className="max-w-7xl mx-auto px-4 -mt-2 mb-6">
                <div className="overflow-hidden rounded-2xl h-48 md:h-56 relative group">
                    {/* Background image with zoom on hover */}
                    <img
                        src="https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=1000&h=500&fit=crop&q=80"
                        alt="عقار فاخر"
                        className="absolute inset-0 w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                    />
                    {/* Gradient overlay - centered dark */}
                    <div className="absolute inset-0 bg-[#1a1a2e]/70" />
                    {/* Text content - centered */}
                    <div className="relative h-full flex flex-col justify-center items-center px-6 md:px-10 w-full text-center">
                        <span className="inline-block bg-[#b88d2b]/20 text-[#e8c66a] text-[10px] md:text-xs font-semibold px-3 py-1 rounded-full mb-2 backdrop-blur-sm border border-[#b88d2b]/30">
                            لملّاك العقارات
                        </span>
                        <h2 className="text-xl md:text-3xl font-bold text-white mb-2 leading-tight">
                            لديك عقار؟
                        </h2>
                        <p className="text-white/80 text-xs md:text-sm mb-4 leading-relaxed">
                            سجّل عقارك في منصة روقان وابدأ باستقبال الحجوزات بكل سهولة
                        </p>
                        <Link href="/subscription">
                            <Button className="bg-gradient-to-l from-[#b88d2b] to-[#d4a837] hover:from-[#9a7623] hover:to-[#b88d2b] text-white font-bold rounded-full px-6 text-xs md:text-sm h-10 shadow-lg shadow-[#b88d2b]/25 transition-all duration-300 hover:shadow-xl hover:shadow-[#b88d2b]/30 hover:-translate-y-0.5">
                                اشترك الآن ←
                            </Button>
                        </Link>
                    </div>
                </div>
            </section>

            {/* Search Card */}
            <section className="max-w-7xl mx-auto px-4 mb-8">
                <div className="bg-white rounded-2xl shadow-md border border-gray-100 p-4 md:p-6">
                    <div className="relative mb-3">
                        <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#9ca3af]" />
                        <Input
                            placeholder="ابحث عن عقار..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pr-11 h-12 rounded-xl border-gray-200 bg-[#f9fafb] text-sm"
                        />
                    </div>

                    <div className="flex flex-row gap-3 mb-4">
                        <Select value={selectedType} onValueChange={setSelectedType}>
                            <SelectTrigger className="h-11 flex-1 rounded-xl border-gray-200 bg-[#f9fafb] text-sm">
                                <SelectValue placeholder="النوع" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">الكل</SelectItem>
                                {TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                            </SelectContent>
                        </Select>

                        <Select value={selectedDirection} onValueChange={setSelectedDirection}>
                            <SelectTrigger className="h-11 flex-1 rounded-xl border-gray-200 bg-[#f9fafb] text-sm">
                                <SelectValue placeholder="الاتجاه" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">الكل</SelectItem>
                                {DIRECTIONS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                            </SelectContent>
                        </Select>
                    </div>

                    <Button
                        onClick={handleSearch}
                        className="w-full h-12 bg-[#b88d2b] hover:bg-[#9a7623] text-white font-bold rounded-xl text-base"
                    >
                        عرض النتائج
                    </Button>
                </div>
            </section>

            {/* Cities Section */}
            {cities.length > 0 && (
                <section className="max-w-7xl mx-auto px-4 mb-8">
                    <h2 className="text-xl font-bold text-[#1a1a1a] mb-4">المدن</h2>
                    <div className="relative">
                        <div ref={citiesScrollRef} className="flex gap-3 overflow-x-hidden pb-2">
                            {cities.map((city) => (
                                <Link
                                    key={city.name}
                                    href={`/properties?city=${encodeURIComponent(city.name)}`}
                                    className="group flex-shrink-0 w-36 md:w-44"
                                >
                                    <div className="relative overflow-hidden rounded-2xl aspect-[3/4] bg-gray-100">
                                        <img
                                            src={CITY_IMAGES[city.name] || city.image}
                                            alt={city.name}
                                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                                            onError={(e) => {
                                                (e.target as HTMLImageElement).src = `https://picsum.photos/seed/${city.name}/300/400`;
                                            }}
                                        />
                                        <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                                        <div className="absolute bottom-3 inset-x-0 text-center">
                                            <h3 className="text-white font-bold text-sm">{city.name}</h3>
                                            <p className="text-white/80 text-xs">{city.count.toLocaleString()} عقار</p>
                                        </div>
                                    </div>
                                </Link>
                            ))}
                        </div>
                        <button
                            onClick={() => scrollContainer(citiesScrollRef, "left")}
                            className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-white rounded-full shadow-md flex items-center justify-center hover:bg-gray-50 transition-colors z-10"
                        >
                            <ChevronLeft className="w-4 h-4 text-gray-600" />
                        </button>
                        <button
                            onClick={() => scrollContainer(citiesScrollRef, "right")}
                            className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 bg-white rounded-full shadow-md flex items-center justify-center hover:bg-gray-50 transition-colors z-10"
                        >
                            <ChevronRight className="w-4 h-4 text-gray-600" />
                        </button>
                    </div>
                </section>
            )}

            {/* Featured Properties - Horizontal Scroll */}
            {featuredProperties.length > 0 && (
                <section className="max-w-7xl mx-auto px-4 mb-8">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-xl font-bold text-[#1a1a1a]">العروض المميزة</h2>
                        <Link href="/properties" className="flex items-center gap-1 text-sm text-[#b88d2b] font-medium hover:underline">
                            عرض الكل
                            <ChevronLeft className="w-4 h-4" />
                        </Link>
                    </div>
                    <div className="relative">
                        <div
                            ref={featuredScrollRef}
                            className="flex gap-4 overflow-x-hidden pb-2"
                        >
                            {featuredProperties.map(p => (
                                <div key={p.propertyNumber} className="flex-shrink-0 w-[260px] md:w-[300px]">
                                    <PropertyCard
                                        property={p}
                                        isPremium={true}
                                        onNext={() => nextImage(p.propertyNumber)}
                                        onPrev={() => prevImage(p.propertyNumber)}
                                        imgIdx={getImgIdx(p.propertyNumber)}
                                        isTransitioning={isImageTransitioning.has(p.propertyNumber)}
                                        onClick={() => goToProperty(p.propertyNumber)}
                                    />
                                </div>
                            ))}
                        </div>
                        <button
                            onClick={() => scrollContainer(featuredScrollRef, "left")}
                            className="absolute left-2 top-1/3 -translate-y-1/2 w-9 h-9 bg-white rounded-full shadow-md flex items-center justify-center hover:bg-gray-50 transition-colors z-10"
                        >
                            <ChevronLeft className="w-5 h-5 text-gray-600" />
                        </button>
                        <button
                            onClick={() => scrollContainer(featuredScrollRef, "right")}
                            className="absolute right-2 top-1/3 -translate-y-1/2 w-9 h-9 bg-white rounded-full shadow-md flex items-center justify-center hover:bg-gray-50 transition-colors z-10"
                        >
                            <ChevronRight className="w-5 h-5 text-gray-600" />
                        </button>
                    </div>
                </section>
            )}

            {/* Latest Properties Grid */}
            <section className="max-w-7xl mx-auto px-4 pb-10">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-bold text-[#1a1a1a]">أحدث العقارات</h2>
                    <Link href="/properties" className="flex items-center gap-1 text-sm text-[#b88d2b] font-medium hover:underline">
                        عرض الكل
                        <ChevronLeft className="w-4 h-4" />
                    </Link>
                </div>

                {isLoading ? (
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
                        {[...Array(6)].map((_, i) => (
                            <div key={i} className="h-72 bg-gray-100 rounded-2xl animate-pulse" />
                        ))}
                    </div>
                ) : latestProperties.length > 0 ? (
                    <div className="grid grid-cols-2 md:grid-cols-3 gap-3 md:gap-4">
                        {latestProperties.map(p => (
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
                ) : (
                    <div className="text-center py-20">
                        <p className="text-[#6b6b6b] text-lg">لا توجد عقارات</p>
                    </div>
                )}
            </section>
        </div>

        {/* Scroll to top button */}
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
    onNext: () => void;
    onPrev: () => void;
    imgIdx: number;
    isTransitioning: boolean;
    onClick: () => void;
}

function PropertyCard({ property, isPremium, onNext, onPrev, imgIdx, isTransitioning, onClick }: PropertyCardProps) {
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

                {/* New badge */}
                {!isPremium && property.createdAt && (Date.now() - new Date(property.createdAt).getTime()) < 7 * 24 * 60 * 60 * 1000 && (
                    <div className="absolute top-2 right-2 bg-green-600/90 px-2.5 py-1 rounded-lg shadow backdrop-blur-sm">
                        <span className="text-white font-bold text-xs">جديد</span>
                    </div>
                )}

                {/* Image navigation - desktop hover */}
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
                    {isPremium && (
                        <span className="bg-[#b88d2b] text-white text-[10px] font-bold px-2 py-0.5 rounded-md">مميز</span>
                    )}
                </div>
            </div>
        </Card>
    );
}
