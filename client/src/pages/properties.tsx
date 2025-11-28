import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Property } from "@shared/schema";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Search, X, ExternalLink, ChevronLeft, ChevronRight, Sparkles, Star } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Link, useLocation } from "wouter";

const CITIES = ["بريدة", "عنيزة", "الرس", "البكيرية", "المذنب"];
const DIRECTIONS = ["شمال", "جنوب", "شرق", "غرب"];
const TYPES = ["قسم", "قسمين"];

// Smart filters mapping - تطابق ذكي للمرافق
const SMART_FILTERS = {
  مبيت: ["غرف نوم", "غرفة نوم", "نوم", "مبيت"],
  شتاء: ["خيمة", "مشب", "تدفئة", "شتاء", "شتوية"],
  صيف: ["مسبح", "ألعاب مائية", "مكيف", "صيف", "صيفية"],
  مناسبات: ["قاعة", "صالة", "مناسبات", "حفلات"],
  ألعاب: ["ملعب", "ألعاب", "ترامبولين", "زحليقة"],
};

const PRIORITY_FACILITIES = [
  "مسبح",
  "بدون مسبح",
  "مبيت",
  "ألعاب مائية",
  "ملعب",
  "مناسبات",
  "شتاء",
  "صيف",
  "مكيف",
  "واي فاي",
];

// Normalize text for smart filtering (remove Arabic & Latin diacritics, normalize variants)
const normalizeText = (text: string): string => {
  return text
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f\u064b-\u0652\u0670\u06d6-\u06ed]/g, "") // Remove Latin & Arabic diacritics
    .replace(/\u0640/g, "") // Remove tatweel
    .replace(/[إأٱآ]/g, "ا") // All alef forms to simple alef
    .replace(/[ؤئ]/g, "و") // Hamza on waw/ya to waw
    .replace(/ى/g, "ي") // Alef maqsura to yaa
    .replace(/ة/g, "ه"); // Taa marbuta to haa
};

export default function PropertiesPage() {
  const [, setLocation] = useLocation();
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCity, setSelectedCity] = useState<string>("");
  const [selectedDirection, setSelectedDirection] = useState<string>("");
  const [selectedType, setSelectedType] = useState<string>("");
  const [selectedFacilities, setSelectedFacilities] = useState<string[]>([]);
  const [priceRange, setPriceRange] = useState<[number, number]>([0, 5000]);
  const [selectedImage, setSelectedImage] = useState<{ url: string; index: number; total: number } | null>(null);
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null);
  const [currentImageIndex, setCurrentImageIndex] = useState<Map<string, number>>(new Map());
  const [imageTransitioning, setImageTransitioning] = useState<Set<string>>(new Set());

  // لزر التصفية الثابت وزر الصعود للأعلى
  const [showFiltersModal, setShowFiltersModal] = useState(false);
  const [showFilterFab, setShowFilterFab] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);

  // عدد العقارات الظاهرة حالياً (لـ infinite scroll)
  const [visibleCount, setVisibleCount] = useState(24);

  // تحميل الفلاتر المحفوظة عند فتح الصفحة
  useEffect(() => {
    const saved = sessionStorage.getItem("propertyFilters");
    if (saved) {
      const f = JSON.parse(saved);
      setSearchQuery(f.searchQuery || "");
      setSelectedCity(f.selectedCity || "");
      setSelectedDirection(f.selectedDirection || "");
      setSelectedType(f.selectedType || "");
      setSelectedFacilities(f.selectedFacilities || []);
      setPriceRange(f.priceRange || [0, 5000]);
    }
  }, []);

  // تحميل عدد العناصر الظاهرة المحفوظ عند الرجوع من صفحة التفاصيل
  useEffect(() => {
    const savedVisible = sessionStorage.getItem("visibleCount");
    if (savedVisible) {
      const n = Number(savedVisible);
      if (!Number.isNaN(n) && n > 0) {
        setVisibleCount(n);
      }
    }
  }, []);

  // حفظ عدد العناصر الظاهرة في sessionStorage عند تغيّره
  useEffect(() => {
    sessionStorage.setItem("visibleCount", String(visibleCount));
  }, [visibleCount]);

  const { data: properties = [], isLoading } = useQuery<Property[]>({
    queryKey: ["properties"],
    queryFn: async () => {
      const res = await fetch(
        "https://script.google.com/macros/s/AKfycbzKX7i9qZ9UPPQOEjC44d_WR70nwMFal4zC_LRKcM09S_lg68AMvWs7J2PVIgZn_aBJ/exec?action=getData"
      );
      if (!res.ok) return [];

      const raw = await res.json();

      // تحويل البيانات العربية إلى شكل Property الصحيح
      return raw.map((item: any) => {
        const subscriptionType = item["اسم العقار"] ? "مميز" : "عادي";
        const propertyNumber = String(item["رقم العقار"] || "");
        const name = item["اسم العقار"] || "";
        const city = item["المنطقة"] || "";
        const direction = item["الاتجاه"] || "";
        const type = item["النوع"] || "";
        const facilities = (item["المرافق"] || "")
          .split(",")
          .map((f: string) => f.trim());

        const prices = {
          weekday: item["سعر وسط الأسبوع"] ? String(item["سعر وسط الأسبوع"]) : "",
          weekend: item["سعر نهاية الأسبوع"] ? String(item["سعر نهاية الأسبوع"]) : "",
          overnight: item["سعر المبيت"] ? String(item["سعر المبيت"]) : "",
          holidays: item["سعر الإجازات"] ? String(item["سعر الإجازات"]) : "",
        };

        // صور R2 الأساسية
        const r2Base = "https://pub-e2fc1c0a598f4f0e91e47af63219848e.r2.dev";

        return {
          propertyNumber,
          name,
          city,
          direction,
          type,
          facilities,
          prices,
          subscriptionType,
          imageUrls: [
            `${r2Base}/${propertyNumber}/1.jpg`,
            `${r2Base}/${propertyNumber}/2.jpg`,
            `${r2Base}/${propertyNumber}/3.jpg`,
            `${r2Base}/${propertyNumber}/4.jpg`,
            `${r2Base}/${propertyNumber}/5.jpg`,
          ],
        };
      });
    },
  });

  const toggleFacility = (facility: string) => {
    setSelectedFacilities((prev) =>
      prev.includes(facility) ? prev.filter((f) => f !== facility) : [...prev, facility]
    );
  };

  const filteredProperties = properties
    .filter((property) => {
      // Search query
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchesSearch =
          property.name.toLowerCase().includes(query) ||
          property.propertyNumber.includes(query) ||
          property.city.includes(query) ||
          property.facilities.some((f) => f.toLowerCase().includes(query));
        if (!matchesSearch) return false;
      }

      // City filter
      if (selectedCity && selectedCity !== "" && selectedCity !== "all") {
        if (property.city !== selectedCity) return false;
      }

      // Direction filter
      if (selectedDirection && selectedDirection !== "" && selectedDirection !== "all") {
        if (property.direction !== selectedDirection) return false;
      }

      // Type filter
      if (selectedType && selectedType !== "" && selectedType !== "all") {
        if (property.type !== selectedType) return false;
      }

      // Facilities filter with smart matching and normalization
      if (selectedFacilities.length > 0) {
        const hasAllFacilities = selectedFacilities.every((selectedFacility) => {
          // Direct match
          if (property.facilities.includes(selectedFacility)) {
            return true;
          }

          // Smart match using SMART_FILTERS with normalization
          const smartKeywords = SMART_FILTERS[selectedFacility as keyof typeof SMART_FILTERS];
          if (smartKeywords) {
            return property.facilities.some((facility) => {
              const normalizedFacility = normalizeText(facility);
              return smartKeywords.some((keyword) => normalizedFacility.includes(normalizeText(keyword)));
            });
          }

          return false;
        });
        if (!hasAllFacilities) return false;
      }

      // Price filter
      const prices = [
        parseFloat(property.prices.weekday) || 0,
        parseFloat(property.prices.weekend) || 0,
        parseFloat(property.prices.overnight) || 0,
        parseFloat(property.prices.holidays) || 0,
      ];
      const validPrices = prices.filter((p) => p > 0);
      if (validPrices.length > 0) {
        const minPrice = Math.min(...validPrices);
        if (minPrice < priceRange[0] || minPrice > priceRange[1]) return false;
      }

      return true;
    })
    .sort((a, b) => {
      // Sort: verified (موثوق/مميز) properties first, then free (عادي)
      const aIsVerified = a.subscriptionType === "موثوق" || a.subscriptionType === "مميز";
      const bIsVerified = b.subscriptionType === "موثوق" || b.subscriptionType === "مميز";
      if (aIsVerified && !bIsVerified) return -1;
      if (!aIsVerified && bIsVerified) return 1;
      return 0;
    });

  // قائمة العقارات الظاهرة حالياً فقط
  const visibleProperties = filteredProperties.slice(0, visibleCount);

  // حفظ الفلاتر في sessionStorage عند تغييرها
  useEffect(() => {
    const filters = {
      searchQuery,
      selectedCity,
      selectedDirection,
      selectedType,
      selectedFacilities,
      priceRange,
    };
    sessionStorage.setItem("propertyFilters", JSON.stringify(filters));
  }, [searchQuery, selectedCity, selectedDirection, selectedType, selectedFacilities, priceRange]);

  // مراقبة السكرول لإظهار/إخفاء الأزرار + تفعيل الـ infinite scroll
  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY || window.pageYOffset;
      setShowFilterFab(y > 200); // يظهر زر التصفية بعد نزول بسيط
      setShowScrollTop(y > 400); // يظهر زر السهم بعد نزول أكثر

      // تحميل المزيد تلقائياً عند الاقتراب من أسفل الصفحة
      const doc = document.documentElement;
      const scrollHeight = doc.scrollHeight;
      const clientHeight = doc.clientHeight;

      if (y + clientHeight >= scrollHeight - 400) {
        setVisibleCount((prev) => {
          if (prev >= filteredProperties.length) return prev;
          return Math.min(prev + 20, filteredProperties.length); // حمّل 20 عقار إضافي
        });
      }
    };

    onScroll();
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, [filteredProperties.length]);

  const handleWhatsApp = async (property: Property) => {
    try {
      await fetch("/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ propertyNumber: property.propertyNumber }),
      });

      const DEFAULT_WHATSAPP = "966533220646";
      const whatsappNumber = property.whatsappNumber || DEFAULT_WHATSAPP;

      const message = property.whatsappNumber
        ? encodeURIComponent(`مرحباً، أريد الاستفسار عن عقار رقم ${property.propertyNumber} - ${property.name}`)
        : encodeURIComponent(`استفسار عن رقم العقار ${property.propertyNumber}`);

      window.open(`https://wa.me/${whatsappNumber}?text=${message}`, "_blank");
    } catch (error) {
      console.error("Error creating WhatsApp request:", error);
    }
  };

  const clearFilters = () => {
    setSearchQuery("");
    setSelectedCity("all");
    setSelectedDirection("all");
    setSelectedType("all");
    setSelectedFacilities([]);
    setPriceRange([0, 5000]);
  };

  const getCurrentImageIndex = (propertyNumber: string) => {
    return currentImageIndex.get(propertyNumber) || 0;
  };

  const nextImage = (propertyNumber: string, totalImages: number) => {
    setImageTransitioning(new Set(imageTransitioning.add(propertyNumber)));
    setTimeout(() => {
      const current = getCurrentImageIndex(propertyNumber);
      const next = (current + 1) % totalImages;
      setCurrentImageIndex(new Map(currentImageIndex.set(propertyNumber, next)));
      setTimeout(() => {
        const newSet = new Set(imageTransitioning);
        newSet.delete(propertyNumber);
        setImageTransitioning(newSet);
      }, 50);
    }, 150);
  };

  const prevImage = (propertyNumber: string, totalImages: number) => {
    setImageTransitioning(new Set(imageTransitioning.add(propertyNumber)));
    setTimeout(() => {
      const current = getCurrentImageIndex(propertyNumber);
      const prev = current === 0 ? totalImages - 1 : current - 1;
      setCurrentImageIndex(new Map(currentImageIndex.set(propertyNumber, prev)));
      setTimeout(() => {
        const newSet = new Set(imageTransitioning);
        newSet.delete(propertyNumber);
        setImageTransitioning(newSet);
      }, 50);
    }, 150);
  };

  const goToImage = (propertyNumber: string, index: number) => {
    setImageTransitioning(new Set(imageTransitioning.add(propertyNumber)));
    setTimeout(() => {
      setCurrentImageIndex(new Map(currentImageIndex.set(propertyNumber, index)));
      setTimeout(() => {
        const newSet = new Set(imageTransitioning);
        newSet.delete(propertyNumber);
        setImageTransitioning(newSet);
      }, 50);
    }, 150);
  };

  const handleCardClick = (propertyNumber: string) => {
    // حفظ موضع السكرول قبل الانتقال + visibleCount (يحفظ تلقائياً من useEffect فوق)
    sessionStorage.setItem("scrollPosition", String(window.scrollY));
    setLocation(`/property/${propertyNumber}`);
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Subscribe CTA Banner */}
        <Card className="p-6 mb-6 bg-gradient-to-r from-primary/10 via-primary/5 to-primary/10 border-primary/20">
          <div className="flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="text-center md:text-right flex-1">
              <h2 className="text-xl md:text-2xl font-bold text-primary mb-2 flex items-center justify-center md:justify-start gap-2">
                <Sparkles className="w-6 h-6" />
                هل لديك عقار استثماري؟
              </h2>
              <p className="text-muted-foreground text-sm md:text-base">
                سجّل عقارك الآن واحصل على عرض مميز في منصة مودي الذكي
              </p>
            </div>
            <Link href="/owner/subscription">
              <Button
                size="lg"
                className="gradient-golden min-w-48 text-base font-bold shadow-lg"
                data-testid="button-subscribe-cta"
              >
                <Sparkles className="w-5 h-5 ml-2" />
                اشترك معنا الآن
              </Button>
            </Link>
          </div>
        </Card>

        {/* Filters */}
        <Card id="filters-section" className="p-4 md:p-6 mb-6 bg-muted/30">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold text-primary">الفلاتر</h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={clearFilters}
              className="text-sm"
              data-testid="button-clear-filters"
            >
              <X className="w-4 h-4 ml-2" />
              مسح الفلاتر
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            {/* Search */}
            <div className="relative">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="بحث شامل..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pr-10"
                data-testid="input-search"
              />
            </div>

            {/* City */}
            <Select value={selectedCity} onValueChange={setSelectedCity}>
              <SelectTrigger data-testid="select-city">
                <SelectValue placeholder="المدينة" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                {CITIES.map((city) => (
                  <SelectItem key={city} value={city}>
                    {city}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Direction */}
            <Select value={selectedDirection} onValueChange={setSelectedDirection}>
              <SelectTrigger data-testid="select-direction">
                <SelectValue placeholder="الاتجاه" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                {DIRECTIONS.map((dir) => (
                  <SelectItem key={dir} value={dir}>
                    {dir}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Type */}
            <Select value={selectedType} onValueChange={setSelectedType}>
              <SelectTrigger data-testid="select-type">
                <SelectValue placeholder="النوع" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                {TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Price Range */}
          <div className="mb-4">
            <label className="block text-sm font-semibold mb-2 text-foreground">
              نطاق السعر: {priceRange[0]} - {priceRange[1]} ريال
            </label>
            <Slider
              value={priceRange}
              onValueChange={(value) => setPriceRange(value as [number, number])}
              min={0}
              max={5000}
              step={50}
              className="mt-2"
              data-testid="slider-price"
            />
          </div>

          {/* Priority Facilities */}
          <div>
            <label className="block text-sm font-semibold mb-2 text-foreground">المرافق</label>
            <div className="flex flex-wrap gap-2">
              {PRIORITY_FACILITIES.map((facility) => (
                <Badge
                  key={facility}
                  variant={selectedFacilities.includes(facility) ? "default" : "outline"}
                  className="
                    cursor-pointer hover-elevate active-elevate-2
                    text-base
                    px-4 py-2
                    rounded-lg
                    font-semibold
                  "
                  onClick={() => toggleFacility(facility)}
                  data-testid={`badge-facility-${facility}`}
                >
                  {facility}
                </Badge>
              ))}
            </div>
          </div>
        </Card>

        {/* Results */}
        <div className="mb-4">
          <p className="text-sm text-muted-foreground">
            عدد النتائج: <span className="font-bold text-foreground">{filteredProperties.length}</span>
          </p>
        </div>

        {/* Properties Grid */}
        {isLoading ? (
          <div className="text-center py-12">
            <div className="inline-block w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
            <p className="mt-4 text-muted-foreground">جاري التحميل...</p>
          </div>
        ) : filteredProperties.length === 0 ? (
          <Card className="p-12 text-center">
            <p className="text-lg text-muted-foreground">لا توجد عقارات تطابق البحث</p>
          </Card>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-6">
            {visibleProperties.map((property) => {
              const r2Base = "https://pub-e2fc1c0a598f4f0e91e47af63219848e.r2.dev";
              const imageUrls = [
                `${r2Base}/${property.propertyNumber}/1.jpg`,
                `${r2Base}/${property.propertyNumber}/2.jpg`,
                `${r2Base}/${property.propertyNumber}/3.jpg`,
              ];

              const mainPrice = property.prices.weekend || property.prices.weekday || "0";
              const topFacilities = property.facilities.slice(0, 3);

              return (
                <Card
                  key={property.propertyNumber}
                  className={`flex flex-col relative overflow-hidden ${
                    property.subscriptionType === "موثوق" || property.subscriptionType === "مميز"
                      ? "property-card-premium"
                      : "property-card-standard"
                  }`}
                  data-testid={`card-property-${property.propertyNumber}`}
                >
                  {/* Image Section - Full width at top with swipe support */}
                  <div
                    className="relative group touch-pan-y"
                    onTouchStart={(e) => {
                      if (imageUrls.length <= 1) return;
                      const touch = e.touches[0];
                      (e.currentTarget as any).touchStartX = touch.clientX;
                    }}
                    onTouchEnd={(e) => {
                      if (imageUrls.length <= 1) return;
                      const touch = e.changedTouches[0];
                      const startX = (e.currentTarget as any).touchStartX;
                      const diff = startX - touch.clientX;

                      // Swipe threshold: 50px
                      if (Math.abs(diff) > 50) {
                        if (diff > 0) {
                          // Swipe left (next image in RTL)
                          prevImage(property.propertyNumber, imageUrls.length);
                        } else {
                          // Swipe right (previous image in RTL)
                          nextImage(property.propertyNumber, imageUrls.length);
                        }
                      }
                    }}
                  >
                    {imageUrls.length > 0 && (
                      <>
                        <img
                          src={imageUrls[getCurrentImageIndex(property.propertyNumber)]}
                          alt={property.name}
                          loading="lazy"
                          className={`w-full h-48 md:h-72 object-cover cursor-pointer transition-opacity duration-300 hover:opacity-90 ${
                            imageTransitioning.has(property.propertyNumber) ? "opacity-0" : "opacity-100"
                          }`}
                          onClick={() => handleCardClick(property.propertyNumber)}
                          data-testid={`img-property-${property.propertyNumber}-current`}
                        />

                        {/* Trusted Badge - Top Right Corner on Image */}
                        {(property.subscriptionType === "موثوق" || property.subscriptionType === "مميز") && (
                          <div className="absolute top-2 md:top-4 right-2 md:right-4 bg-white/95 backdrop-blur-sm px-2 md:px-4 py-1 md:py-2 rounded-full shadow-lg flex items-center gap-1 md:gap-2">
                            <Star className="w-4 h-4 md:w-5 md:h-5 text-yellow-600 fill-yellow-600" />
                            <span className="text-[#b38b00] font-bold text-xs md:text-sm">موثوق</span>
                          </div>
                        )}

                        {/* Navigation Arrows (Desktop only) */}
                        {imageUrls.length > 1 && (
                          <>
                            {/* التالي (يمين) */}
                            <Button
                              variant="secondary"
                              size="icon"
                              className="hidden md:flex absolute right-3 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full opacity-0 group-hover:opacity-100 transition shadow-lg bg-white/90 hover:bg-white"
                              onClick={(e) => {
                                e.stopPropagation();
                                nextImage(property.propertyNumber, imageUrls.length);
                              }}
                              data-testid={`button-next-image-${property.propertyNumber}`}
                            >
                              <ChevronLeft className="h-5 w-5" />
                            </Button>

                            {/* السابق (يسار) */}
                            <Button
                              variant="secondary"
                              size="icon"
                              className="hidden md:flex absolute left-3 top-1/2 -translate-y-1/2 h-10 w-10 rounded-full opacity-0 group-hover:opacity-100 transition shadow-lg bg-white/90 hover:bg-white"
                              onClick={(e) => {
                                e.stopPropagation();
                                prevImage(property.propertyNumber, imageUrls.length);
                              }}
                              data-testid={`button-prev-image-${property.propertyNumber}`}
                            >
                              <ChevronRight className="h-5 w-5" />
                            </Button>
                          </>
                        )}

                        {/* Image Dots Indicator (Mobile only) */}
                        {imageUrls.length > 1 && (
                          <div className="md:hidden absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
                            {imageUrls.map((_, idx) => (
                              <div
                                key={idx}
                                className={`h-1.5 rounded-full transition-all ${
                                  idx === getCurrentImageIndex(property.propertyNumber)
                                    ? "w-4 bg-white"
                                    : "w-1.5 bg-white/50"
                                }`}
                              />
                            ))}
                          </div>
                        )}
                      </>
                    )}
                  </div>

                  {/* Content Section - Flexible grow */}
                  <div className="flex flex-col flex-1 p-3 md:p-5">
                    {/* Title - Only show for verified properties */}
                    {(property.subscriptionType === "موثوق" || property.subscriptionType === "مميز") && (
                      <h3
                        className="text-base md:text-xl font-bold text-[#4a3b2a] mb-2 md:mb-3 line-clamp-1 cursor-pointer hover:text-primary transition-colors"
                        onClick={() => handleCardClick(property.propertyNumber)}
                      >
                        {property.name}
                      </h3>
                    )}

                    {/* Location */}
                    <div className="flex items-center gap-1 md:gap-2 text-xs md:text-sm text-[#b88d2b] mb-2 md:mb-4">
                      <svg className="w-3 h-3 md:w-4 md:h-4 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                        <path
                          fillRule="evenodd"
                          d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z"
                          clipRule="evenodd"
                        />
                      </svg>
                      <span className="font-semibold truncate">{property.city}</span>
                    </div>

                    {/* Top Facilities - Hidden on small mobile */}
                    <div className="hidden md:flex items-center gap-4 lg:gap-6 mb-4 lg:mb-6 text-sm text-[#b88d2b]">
                      {topFacilities.map((facility, idx) => (
                        <div key={idx} className="flex items-center gap-2">
                          <Sparkles className="w-3 h-3 lg:w-4 lg:h-4" />
                          <span className="font-semibold text-xs">{facility}</span>
                        </div>
                      ))}
                    </div>

                    {/* Price and CTA - Always at bottom */}
                    <div className="mt-auto flex flex-col md:flex-row items-stretch md:items-center justify-between gap-2 md:gap-4">
                      {/* Price */}
                      <div className="flex items-baseline gap-1">
                        <span className="text-2xl md:text-4xl font-bold text-[#b88d2b]">{mainPrice}</span>
                        <span className="text-xs md:text-sm text-muted-foreground">ريال</span>
                      </div>

                      {/* CTA Button - Fixed at bottom */}
                      <Button
                        className="bg-[#b88d2b] hover:bg-[#a07d25] text-white font-bold px-3 md:px-6 py-2 md:py-6 rounded-lg shadow-md text-xs md:text-sm whitespace-nowrap"
                        onClick={() => handleCardClick(property.propertyNumber)}
                        data-testid={`button-details-${property.propertyNumber}`}
                      >
                        عرض التفاصيل
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>

      {/* زر تصفية عائم شفاف في الوسط */}
      {showFilterFab && (
        <button
          type="button"
          onClick={() => setShowFiltersModal(true)}
          className="
            fixed bottom-20 right-1/2 translate-x-1/2 z-50
            bg-white/60 backdrop-blur-md border border-[#b88d2b]/40
            text-[#b88d2b] font-bold shadow-xl rounded-full
            px-10 py-3 text-lg
            hover:bg-white/90 transition
          "
        >
          تصفية
        </button>
      )}

      {/* زر الصعود للأعلى */}
      {showScrollTop && (
        <button
          type="button"
          id="scrollTopBtn"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="
            fixed bottom-6 right-6 z-50
            bg-[#b88d2b] hover:bg-[#a07c25]
            text-white shadow-lg rounded-full
            w-12 h-12 flex items-center justify-center text-2xl
          "
        >
          ↑
        </button>
      )}

      {/* Property Details Dialog */}
      <Dialog open={!!selectedProperty} onOpenChange={(open) => !open && setSelectedProperty(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          {selectedProperty && (
            <div className="space-y-6">
              <DialogTitle className="sr-only">{selectedProperty.name}</DialogTitle>
              {/* Image Gallery */}
              {selectedProperty.imageUrls.length > 0 && (
                <div className="relative">
                  <img
                    src={selectedProperty.imageUrls[getCurrentImageIndex(selectedProperty.propertyNumber)]}
                    alt={selectedProperty.name}
                    className="w-full h-96 object-cover rounded-lg"
                    data-testid="img-dialog-current"
                  />

                  {/* Navigation Arrows */}
                  {selectedProperty.imageUrls.length > 1 && (
                    <>
                      <button
                        onClick={() =>
                          prevImage(selectedProperty.propertyNumber, selectedProperty.imageUrls.length)
                        }
                        className="absolute left-4 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-full p-2 transition-colors"
                        data-testid="button-prev-image"
                      >
                        <ChevronRight className="w-6 h-6" />
                      </button>
                      <button
                        onClick={() =>
                          nextImage(selectedProperty.propertyNumber, selectedProperty.imageUrls.length)
                        }
                        className="absolute right-4 top-1/2 -translate-y-1/2 bg-black/50 hover:bg-black/70 text-white rounded-full p-2 transition-colors"
                        data-testid="button-next-image"
                      >
                        <ChevronLeft className="w-6 h-6" />
                      </button>
                    </>
                  )}

                  {/* Slide Dots */}
                  {selectedProperty.imageUrls.length > 1 && (
                    <div className="flex justify-center gap-2 mt-4">
                      {selectedProperty.imageUrls.map((_, idx) => (
                        <button
                          key={idx}
                          className={`h-2 rounded-full transition-all ${
                            idx === getCurrentImageIndex(selectedProperty.propertyNumber)
                              ? "w-8 bg-[#b88d2b]"
                              : "w-2 bg-muted-foreground/30"
                          }`}
                          onClick={() => goToImage(selectedProperty.propertyNumber, idx)}
                          data-testid={`button-slide-${idx}`}
                        />
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Details */}
              <div>
                <h2 className="text-2xl font-bold text-foreground mb-2">{selectedProperty.name}</h2>
                <p className="text-muted-foreground mb-4">
                  {selectedProperty.city} • {selectedProperty.direction} • {selectedProperty.type}
                </p>

                {/* All Prices */}
                <div className="price-box rounded-lg p-4 mb-4 space-y-2">
                  {selectedProperty.prices.weekday && (
                    <div className="flex justify-between">
                      <span>وسط الأسبوع:</span>
                      <span className="font-bold text-green-600">{selectedProperty.prices.weekday} ريال</span>
                    </div>
                  )}
                  {selectedProperty.prices.weekend && (
                    <div className="flex justify-between">
                      <span>نهاية الأسبوع:</span>
                      <span className="font-bold text-green-600">{selectedProperty.prices.weekend} ريال</span>
                    </div>
                  )}
                  {selectedProperty.prices.overnight && (
                    <div className="flex justify-between">
                      <span>مبيت:</span>
                      <span className="font-bold text-green-600">{selectedProperty.prices.overnight} ريال</span>
                    </div>
                  )}
                  {selectedProperty.prices.holidays && (
                    <div className="flex justify-between">
                      <span>إجازات:</span>
                      <span className="font-bold text-green-600">{selectedProperty.prices.holidays} ريال</span>
                    </div>
                  )}
                </div>

                {/* All Facilities */}
                <div className="mb-6">
                  <h4 className="font-semibold mb-2">المرافق:</h4>
                  <div className="flex flex-wrap gap-2">
                    {selectedProperty.facilities.map((facility, idx) => (
                      <Badge key={`dialog-facility-${idx}-${facility}`} variant="secondary" className="text-xs">
                        {facility}
                      </Badge>
                    ))}
                  </div>
                </div>

                {/* Actions */}
                <div className="flex gap-3">
                  {selectedProperty.imagesFolderUrl && (
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() => window.open(selectedProperty.imagesFolderUrl, "_blank")}
                    >
                      <ExternalLink className="w-4 h-4 ml-2" />
                      فتح ملف العقار
                    </Button>
                  )}
                  <Button
                    className="flex-1 bg-[#25D366] hover:bg-[#1da851] text-white"
                    onClick={() => handleWhatsApp(selectedProperty)}
                  >
                    تواصل عبر واتساب
                  </Button>
                </div>
              </div>
            </div>
          )}
        </DialogContent>

        {/* فلتر الموبايل (نفس السابق) */}
        <Dialog open={showFiltersModal} onOpenChange={setShowFiltersModal}>
          <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto p-6 rounded-xl">
            <DialogTitle className="text-xl font-bold text-primary mb-4">تصفية العقارات</DialogTitle>

            {/* Search */}
            <div className="mb-4">
              <label className="text-sm font-semibold mb-1 block">بحث</label>
              <div className="relative">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="بحث شامل..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pr-10"
                />
              </div>
            </div>

            {/* City */}
            <div className="mb-4">
              <label className="text-sm font-semibold mb-2 block">المدينة</label>
              <Select value={selectedCity} onValueChange={setSelectedCity}>
                <SelectTrigger>
                  <SelectValue placeholder="المدينة" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  {CITIES.map((city) => (
                    <SelectItem key={city} value={city}>
                      {city}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Direction */}
            <div className="mb-4">
              <label className="text-sm font-semibold mb-2 block">الاتجاه</label>
              <Select value={selectedDirection} onValueChange={setSelectedDirection}>
                <SelectTrigger>
                  <SelectValue placeholder="الاتجاه" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  {DIRECTIONS.map((d) => (
                    <SelectItem key={d} value={d}>
                      {d}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Type */}
            <div className="mb-4">
              <label className="text-sm font-semibold mb-2 block">نوع العقار</label>
              <Select value={selectedType} onValueChange={setSelectedType}>
                <SelectTrigger>
                  <SelectValue placeholder="النوع" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">الكل</SelectItem>
                  {TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Price Range */}
            <div className="mb-6">
              <label className="text-sm font-semibold mb-2 block">
                نطاق السعر: {priceRange[0]} - {priceRange[1]} ريال
              </label>
              <Slider
                value={priceRange}
                onValueChange={(v) => setPriceRange(v as [number, number])}
                min={0}
                max={5000}
                step={50}
              />
            </div>

            {/* Facilities */}
            <div className="mb-6">
              <label className="text-sm font-semibold mb-2 block">المرافق</label>
              <div className="flex flex-wrap gap-2">
                {PRIORITY_FACILITIES.map((facility) => (
                  <Badge
                    key={facility}
                    variant={selectedFacilities.includes(facility) ? "default" : "outline"}
                    className="cursor-pointer"
                    onClick={() => toggleFacility(facility)}
                  >
                    {facility}
                  </Badge>
                ))}
              </div>
            </div>

            {/* Buttons */}
            <div className="flex gap-3 mt-6">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => {
                  clearFilters();
                  setShowFiltersModal(false);
                }}
              >
                مسح الكل
              </Button>

              <Button
                className="flex-1 bg-[#b88d2b] hover:bg-[#a07c25] text-white"
                onClick={() => setShowFiltersModal(false)}
              >
                تطبيق الفلاتر
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </Dialog>

      {/* Image Modal */}
      <Dialog open={!!selectedImage} onOpenChange={() => setSelectedImage(null)}>
        <DialogContent className="max-w-4xl p-0">
          {selectedImage && (
            <div className="relative">
              <DialogTitle className="sr-only">صورة العقار</DialogTitle>
              <img src={selectedImage.url} alt="صورة العقار" className="w-full h-auto rounded-lg" />
              <div className="absolute bottom-4 right-4 bg-black/70 text-white px-3 py-1 rounded">
                {selectedImage.index + 1} / {selectedImage.total}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}