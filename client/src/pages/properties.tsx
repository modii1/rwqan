import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Property, FACILITIES } from "@shared/schema";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Search, X, ExternalLink } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";

const CITIES = ['بريدة', 'عنيزة', 'الرس', 'البكيرية', 'المذنب'];
const DIRECTIONS = ['شمال', 'جنوب', 'شرق', 'غرب'];
const TYPES = ['قسم', 'قسمين'];

const PRIORITY_FACILITIES = [
  'مسبح',
  'بدون مسبح',
  'مبيت',
  'ألعاب مائية',
  'ملعب',
  'مناسبات',
  'شتاء',
  'صيف',
  'مكيف',
  'واي فاي',
];

export default function PropertiesPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCity, setSelectedCity] = useState<string>("");
  const [selectedDirection, setSelectedDirection] = useState<string>("");
  const [selectedType, setSelectedType] = useState<string>("");
  const [selectedFacilities, setSelectedFacilities] = useState<string[]>([]);
  const [priceRange, setPriceRange] = useState<[number, number]>([0, 5000]);
  const [selectedImage, setSelectedImage] = useState<{ url: string; index: number; total: number } | null>(null);
  const [selectedProperty, setSelectedProperty] = useState<Property | null>(null);

  const { data: properties = [], isLoading } = useQuery<Property[]>({
    queryKey: ["/api/properties"],
  });

  const toggleFacility = (facility: string) => {
    setSelectedFacilities(prev =>
      prev.includes(facility)
        ? prev.filter(f => f !== facility)
        : [...prev, facility]
    );
  };

  const filteredProperties = properties.filter(property => {
    // Search query
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      const matchesSearch = 
        property.name.toLowerCase().includes(query) ||
        property.propertyNumber.includes(query) ||
        property.city.includes(query) ||
        property.facilities.some(f => f.toLowerCase().includes(query));
      if (!matchesSearch) return false;
    }

    // City filter
    if (selectedCity && property.city !== selectedCity) return false;

    // Direction filter
    if (selectedDirection && property.direction !== selectedDirection) return false;

    // Type filter
    if (selectedType && property.type !== selectedType) return false;

    // Facilities filter
    if (selectedFacilities.length > 0) {
      const hasAllFacilities = selectedFacilities.every(f =>
        property.facilities.includes(f)
      );
      if (!hasAllFacilities) return false;
    }

    // Price filter
    const prices = [
      parseFloat(property.prices.weekday) || 0,
      parseFloat(property.prices.weekend) || 0,
      parseFloat(property.prices.overnight) || 0,
      parseFloat(property.prices.holidays) || 0,
    ];
    const minPrice = Math.min(...prices.filter(p => p > 0));
    if (minPrice < priceRange[0] || minPrice > priceRange[1]) return false;

    return true;
  });

  const handleWhatsApp = async (property: Property) => {
    try {
      // Create request
      await fetch('/api/requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ propertyNumber: property.propertyNumber }),
      });

      // Open WhatsApp
      const message = encodeURIComponent(`مرحباً، أريد الاستفسار عن عقار رقم ${property.propertyNumber} - ${property.name}`);
      window.open(`https://wa.me/${property.whatsappNumber}?text=${message}`, '_blank');
    } catch (error) {
      console.error('Error creating WhatsApp request:', error);
    }
  };

  const clearFilters = () => {
    setSearchQuery("");
    setSelectedCity("");
    setSelectedDirection("");
    setSelectedType("");
    setSelectedFacilities([]);
    setPriceRange([0, 5000]);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-card shadow-sm border-b border-border">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center gap-3">
            <div className="text-2xl font-bold text-primary">🏡</div>
            <h1 className="text-xl md:text-2xl font-bold text-foreground">
              مودي الذكي - العقارات
            </h1>
          </div>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Filters */}
        <Card className="p-4 md:p-6 mb-6 bg-muted/30">
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
                <SelectItem value="">الكل</SelectItem>
                {CITIES.map(city => (
                  <SelectItem key={city} value={city}>{city}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Direction */}
            <Select value={selectedDirection} onValueChange={setSelectedDirection}>
              <SelectTrigger data-testid="select-direction">
                <SelectValue placeholder="الاتجاه" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">الكل</SelectItem>
                {DIRECTIONS.map(dir => (
                  <SelectItem key={dir} value={dir}>{dir}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Type */}
            <Select value={selectedType} onValueChange={setSelectedType}>
              <SelectTrigger data-testid="select-type">
                <SelectValue placeholder="النوع" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">الكل</SelectItem>
                {TYPES.map(type => (
                  <SelectItem key={type} value={type}>{type}</SelectItem>
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
              {PRIORITY_FACILITIES.map(facility => (
                <Badge
                  key={facility}
                  variant={selectedFacilities.includes(facility) ? "default" : "outline"}
                  className="cursor-pointer hover-elevate active-elevate-2"
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {filteredProperties.map(property => (
              <Card
                key={property.propertyNumber}
                className={`relative overflow-visible ${
                  property.subscriptionType === 'موثوق'
                    ? 'property-card-premium'
                    : 'property-card-standard'
                }`}
                data-testid={`card-property-${property.propertyNumber}`}
              >
                {/* Property Number */}
                <div className="absolute top-3 left-3 bg-foreground/90 text-background px-2 py-1 rounded text-sm font-bold z-10">
                  {property.propertyNumber.padStart(5, '0')}
                </div>

                {/* Trusted Badge */}
                {property.subscriptionType === 'موثوق' && (
                  <Badge className="absolute top-3 right-3 bg-[#fff8d6] text-[#b38b00] font-bold border-none z-10">
                    موثوق ⭐
                  </Badge>
                )}

                <div className="p-4">
                  {/* Images */}
                  {property.imageUrls.length > 0 && (
                    <div className="mb-4 overflow-x-auto">
                      <div className="flex gap-2">
                        {property.imageUrls.map((url, idx) => (
                          <img
                            key={idx}
                            src={url}
                            alt={`${property.name} - ${idx + 1}`}
                            className="w-full h-48 object-cover rounded-lg cursor-pointer hover:opacity-90 transition-opacity flex-shrink-0"
                            onClick={() => setSelectedImage({ url, index: idx, total: property.imageUrls.length })}
                            data-testid={`img-property-${property.propertyNumber}-${idx}`}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Title */}
                  <h3 className="text-lg font-bold text-foreground mb-2">{property.name}</h3>

                  {/* Info */}
                  <div className="flex gap-2 mb-3 text-sm text-muted-foreground">
                    <span>{property.city}</span>
                    <span>•</span>
                    <span>{property.direction}</span>
                    <span>•</span>
                    <span>{property.type}</span>
                  </div>

                  {/* Prices */}
                  <div className="price-box rounded-lg p-3 mb-4 space-y-1 text-sm">
                    {property.prices.weekday && (
                      <div className="flex justify-between">
                        <span>وسط الأسبوع:</span>
                        <span className="font-bold text-green-600">{property.prices.weekday} ريال</span>
                      </div>
                    )}
                    {property.prices.weekend && (
                      <div className="flex justify-between">
                        <span>نهاية الأسبوع:</span>
                        <span className="font-bold text-green-600">{property.prices.weekend} ريال</span>
                      </div>
                    )}
                    {property.prices.overnight && (
                      <div className="flex justify-between">
                        <span>مبيت:</span>
                        <span className="font-bold text-green-600">{property.prices.overnight} ريال</span>
                      </div>
                    )}
                    {property.prices.holidays && (
                      <div className="flex justify-between">
                        <span>إجازات:</span>
                        <span className="font-bold text-green-600">{property.prices.holidays} ريال</span>
                      </div>
                    )}
                  </div>

                  {/* Facilities */}
                  <div className="mb-4">
                    <div className="flex flex-wrap gap-1">
                      {property.facilities.slice(0, 6).map((facility, idx) => (
                        <Badge key={idx} variant="secondary" className="text-xs">
                          {facility}
                        </Badge>
                      ))}
                      {property.facilities.length > 6 && (
                        <Badge variant="secondary" className="text-xs">
                          +{property.facilities.length - 6} المزيد
                        </Badge>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2 pt-3 border-t border-border">
                    {property.driveFolderId && (
                      <Button
                        variant="secondary"
                        size="sm"
                        className="flex-1"
                        onClick={() => window.open(`https://drive.google.com/drive/folders/${property.driveFolderId}`, '_blank')}
                        data-testid={`button-drive-${property.propertyNumber}`}
                      >
                        <ExternalLink className="w-4 h-4 ml-2" />
                        فتح ملف العقار
                      </Button>
                    )}
                    <Button
                      size="sm"
                      className="flex-1 bg-[#25D366] hover:bg-[#1da851] text-white"
                      onClick={() => handleWhatsApp(property)}
                      data-testid={`button-whatsapp-${property.propertyNumber}`}
                    >
                      واتساب
                    </Button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Image Modal */}
      <Dialog open={!!selectedImage} onOpenChange={() => setSelectedImage(null)}>
        <DialogContent className="max-w-4xl p-0">
          {selectedImage && (
            <div className="relative">
              <img
                src={selectedImage.url}
                alt="صورة العقار"
                className="w-full h-auto rounded-lg"
              />
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
