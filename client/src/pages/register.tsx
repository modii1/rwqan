import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { FACILITIES } from "@shared/schema";

const CITIES = ['بريدة', 'عنيزة', 'الرس', 'البكيرية', 'المذنب'];
const DIRECTIONS = ['شمال', 'جنوب', 'شرق', 'غرب'];
const TYPES = ['قسم', 'قسمين'];

export default function RegisterPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [formData, setFormData] = useState({
    propertyNumber: "",
    name: "",
    pin: "",
    city: "",
    direction: "",
    type: "",
    location: "",
    whatsappNumber: "",
    imagesFolderUrl: "",   // ← الحل هنا
  });

  const [facilities, setFacilities] = useState<string[]>([]);
  const [prices, setPrices] = useState({
    weekday: "",
    weekend: "",
    overnight: "",
    holidays: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [facilitySearch, setFacilitySearch] = useState("");


  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    try {
      await apiRequest('POST', '/api/properties/register', {
        ...formData,
        facilities,
        prices,
        subscriptionType: 'عادي', // جميع العقارات الجديدة تبدأ بنوع "عادي"
      });

      toast({
        title: "تم تسجيل العقار بنجاح ✓",
        description: "يمكنك الآن تسجيل الدخول وإدارة عقارك",
      });

      setLocation('/owner/login');
    } catch (error: any) {
      toast({
        title: "خطأ في التسجيل",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const toggleFacility = (facility: string) => {
    setFacilities(prev =>
      prev.includes(facility)
        ? prev.filter(f => f !== facility)
        : [...prev, facility]
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="bg-card border-b border-border shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <h1 className="text-2xl font-bold text-primary">اشترك معنا</h1>
          <p className="text-sm text-muted-foreground">سجل عقارك في مودي الذكي</p>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-8">
        <Card className="p-8">
          <form onSubmit={handleSubmit} className="space-y-6">
            {/* Basic Info */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

              <div>
                <label className="block text-sm font-semibold mb-2">رقم العقار (5 أرقام)</label>
                <Input
                  placeholder="00123"
                  value={formData.propertyNumber}
                  onChange={(e) => setFormData({ ...formData, propertyNumber: e.target.value })}
                  maxLength={5}
                  required
                  data-testid="input-property-number"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold mb-2">اسم العقار</label>
                <Input
                  placeholder="شالية مودي"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  required
                  data-testid="input-name"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold mb-2">الرقم السري</label>
                <Input
                  type="password"
                  placeholder="اختر رقماً سرياً"
                  value={formData.pin}
                  onChange={(e) => setFormData({ ...formData, pin: e.target.value })}
                  required
                  data-testid="input-pin"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold mb-2">رقم واتساب</label>
                <Input
                  type="tel"
                  placeholder="966XXXXXXXXX"
                  value={formData.whatsappNumber}
                  onChange={(e) => setFormData({ ...formData, whatsappNumber: e.target.value })}
                  required
                  data-testid="input-whatsapp"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold mb-2">المدينة</label>
                <Select value={formData.city} onValueChange={(v) => setFormData({ ...formData, city: v })}>
                  <SelectTrigger data-testid="select-city">
                    <SelectValue placeholder="اختر المدينة" />
                  </SelectTrigger>
                  <SelectContent>
                    {CITIES.map(city => (
                      <SelectItem key={city} value={city}>{city}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="block text-sm font-semibold mb-2">الاتجاه</label>
                <Select value={formData.direction} onValueChange={(v) => setFormData({ ...formData, direction: v })}>
                  <SelectTrigger data-testid="select-direction">
                    <SelectValue placeholder="اختر الاتجاه" />
                  </SelectTrigger>
                  <SelectContent>
                    {DIRECTIONS.map(dir => (
                      <SelectItem key={dir} value={dir}>{dir}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <label className="block text-sm font-semibold mb-2">النوع</label>
                <Select value={formData.type} onValueChange={(v) => setFormData({ ...formData, type: v })}>
                  <SelectTrigger data-testid="select-type">
                    <SelectValue placeholder="اختر النوع" />
                  </SelectTrigger>
                  <SelectContent>
                    {TYPES.map(type => (
                      <SelectItem key={type} value={type}>{type}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* الموقع / الحي — نفس الحقول بدون أي ستايل إضافي */}
              <div>
                <label className="block text-sm font-semibold mb-2">الموقع / الحي</label>
                <Input
                  placeholder="اكتب اسم الحي أو الموقع"
                  value={formData.location}
                  onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                  data-testid="input-location"
                />
              </div>

            </div>




            {/* Prices */}
            <div>
              <h3 className="text-lg font-bold text-primary mb-3">الأسعار (مطلوبة)</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold mb-2">وسط الأسبوع *</label>
                  <Input
                    placeholder="500"
                    type="number"
                    value={prices.weekday}
                    onChange={(e) => setPrices({...prices, weekday: e.target.value})}
                    required
                    data-testid="input-price-weekday"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-2">نهاية الأسبوع *</label>
                  <Input
                    placeholder="800"
                    type="number"
                    value={prices.weekend}
                    onChange={(e) => setPrices({...prices, weekend: e.target.value})}
                    required
                    data-testid="input-price-weekend"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-2">مبيت *</label>
                  <Input
                    placeholder="1200"
                    type="number"
                    value={prices.overnight}
                    onChange={(e) => setPrices({...prices, overnight: e.target.value})}
                    required
                    data-testid="input-price-overnight"
                  />
                </div>
                <div>
                  <label className="block text-sm font-semibold mb-2">إجازات *</label>
                  <Input
                    placeholder="1000"
                    type="number"
                    value={prices.holidays}
                    onChange={(e) => setPrices({...prices, holidays: e.target.value})}
                    required
                    data-testid="input-price-holidays"
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground mt-2">* جميع حقول الأسعار مطلوبة</p>
            </div>

            {/* Facilities */}
            <div>
              <h3 className="text-lg font-bold text-primary mb-3">المرافق</h3>

              {/* صندوق كامل للمرافق مع البحث */}
              <div className="p-4 bg-muted/30 rounded-lg max-h-96 overflow-y-auto">

                {/* حقل البحث */}
                <div className="mb-4">
                  <Input
                    placeholder="ابحث عن مرفق..."
                    value={facilitySearch}
                    onChange={(e) => setFacilitySearch(e.target.value)}
                    className="bg-white"
                  />
                </div>

                {/* شبكة المرافق */}
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                  {FACILITIES
                    .filter(f =>
                      f.toLowerCase().includes(facilitySearch.toLowerCase())
                    )
                    .map(facility => (
                      <div key={facility} className="flex items-center gap-2">
                        <Checkbox
                          checked={facilities.includes(facility)}
                          onCheckedChange={() => toggleFacility(facility)}
                          id={facility}
                        />
                        <label htmlFor={facility} className="text-sm cursor-pointer">
                          {facility}
                        </label>
                      </div>
                    ))}
                </div>

              </div>
            </div>

            <Button
              type="submit"
              className="w-full gradient-golden"
              disabled={isSubmitting}
              data-testid="button-register"
            >
              {isSubmitting ? 'جاري التسجيل...' : 'تسجيل العقار'}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
