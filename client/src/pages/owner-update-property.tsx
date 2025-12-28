import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Property, FACILITIES } from "@shared/schema";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { ArrowRight, Search, KeyRound, Loader2 } from "lucide-react";

// المدن المتاحة
const CITIES = ['بريدة', 'عنيزة', 'الرس', 'البكيرية', 'المذنب'] as const;

// الاتجاهات المتاحة
const DIRECTIONS = ['شمال', 'جنوب', 'شرق', 'غرب', 'وسط'] as const;

// أنواع العقارات
const TYPES = ['قسمين' , 'قسم'] as const;

export default function OwnerUpdateProperty() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [isLoading, setIsLoading] = useState(false);
  const [facilitySearch, setFacilitySearch] = useState("");
  
  // حالة تغيير الرقم السري
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isChangingPassword, setIsChangingPassword] = useState(false);

  // بيانات النموذج
  const [formData, setFormData] = useState({
    name: "",
    location: "",
    city: "",
    direction: "",
    type: "",
    whatsappNumber: "",
  });

  // الأسعار
  const [prices, setPrices] = useState({
    weekday: "",
    weekend: "",
    overnight: "",
    holidays: "",
  });

  // المرافق المختارة
  const [selectedFacilities, setSelectedFacilities] = useState<string[]>([]);

  const { data: property, isLoading: isLoadingProperty } = useQuery<Property>({
    queryKey: ["/api/owner/property"],
    retry: false,
    refetchOnWindowFocus: false,
  });

  // تحميل البيانات الحالية
  useEffect(() => {
    if (property) {
      setFormData({
        name: property.name || "",
        location: property.location || "",
        city: property.city || "",
        direction: property.direction || "",
        type: property.type || "",
        whatsappNumber: property.whatsappNumber || "",
      });

      setPrices({
        weekday: property.prices?.weekday || "",
        weekend: property.prices?.weekend || "",
        overnight: property.prices?.overnight || "",
        holidays: property.prices?.holidays || "",
      });

      // تحليل المرافق
      let facs: string[] = [];
      const rawFacilities = property.facilities as string[] | string | undefined;
      if (rawFacilities) {
        if (Array.isArray(rawFacilities)) {
          facs = rawFacilities;
        } else if (typeof rawFacilities === "string") {
          try {
            const parsed = JSON.parse(rawFacilities);
            facs = Array.isArray(parsed) ? parsed : [];
          } catch {
            facs = rawFacilities.split(",").map((s: string) => s.trim()).filter(Boolean);
          }
        }
      }
      setSelectedFacilities(facs);
    }
  }, [property]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const toggleFacility = (facility: string) => {
    setSelectedFacilities((prev) =>
      prev.includes(facility)
        ? prev.filter((f) => f !== facility)
        : [...prev, facility]
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // التحقق من صحة اسم العقار
    if (formData.name.trim().length < 3 || formData.name.trim().length > 25) {
      toast({
        title: "خطأ في البيانات",
        description: "اسم العقار يجب أن يكون بين 3 و 25 حرف",
        variant: "destructive",
      });
      return;
    }
    
    setIsLoading(true);

    try {
      const body = {
        name: formData.name,
        location: formData.location,
        city: formData.city,
        direction: formData.direction,
        type: formData.type,
        whatsappNumber: formData.whatsappNumber,
        facilities: selectedFacilities,
        prices: {
          display: property?.prices?.display || "",
          weekday: prices.weekday,
          weekend: prices.weekend,
          overnight: prices.overnight,
          special: property?.prices?.special || "",
          holidays: prices.holidays,
        },
      };

      await apiRequest("PUT", "/api/owner/property", body);

      queryClient.invalidateQueries({ queryKey: ["/api/owner/property"] });

      toast({
        title: "تم التحديث بنجاح",
        description: "تم حفظ بيانات العقار",
      });

      setTimeout(() => setLocation("/owner/dashboard"), 1000);
    } catch (err: any) {
      toast({
        title: "خطأ",
        description: err?.message || "فشل في تحديث البيانات",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!currentPassword || !newPassword) {
      toast({
        title: "خطأ",
        description: "الرجاء إدخال الرقم السري الحالي والجديد",
        variant: "destructive",
      });
      return;
    }
    
    if (newPassword.length < 4) {
      toast({
        title: "خطأ",
        description: "الرقم السري يجب أن يكون 4 أرقام على الأقل",
        variant: "destructive",
      });
      return;
    }
    
    if (newPassword !== confirmPassword) {
      toast({
        title: "خطأ",
        description: "الرقم السري غير متطابق",
        variant: "destructive",
      });
      return;
    }
    
    setIsChangingPassword(true);
    
    try {
      const response = await fetch("/api/owner/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        toast({
          title: "خطأ",
          description: data.message || "فشل في تغيير الرقم السري",
          variant: "destructive",
        });
        return;
      }
      
      toast({
        title: "تم بنجاح",
        description: "تم تغيير الرقم السري بنجاح",
      });
      
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      
    } catch (error) {
      console.error("Change password error:", error);
      toast({
        title: "خطأ",
        description: "تعذر الاتصال بالخادم",
        variant: "destructive",
      });
    } finally {
      setIsChangingPassword(false);
    }
  };

  if (isLoadingProperty) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!property) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Card className="p-6 text-center">
          <p className="text-muted-foreground">لم يتم العثور على بيانات العقار</p>
          <Button onClick={() => setLocation("/owner/dashboard")} className="mt-4">
            العودة للوحة التحكم
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-20">
      {/* Header */}
      <header className="bg-card border-b border-border shadow-sm sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => window.history.back()}
            data-testid="button-back"
          >
            <ArrowRight className="w-5 h-5" />
          </Button>
          <div className="flex-1">
            <h1 className="text-lg font-bold text-primary">تحديث بيانات العقار</h1>
            <p className="text-xs text-muted-foreground">عقار رقم {property.propertyNumber}</p>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-6">
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* البيانات الأساسية */}
          <Card className="p-5">
            <h2 className="text-base font-bold text-primary mb-4 border-b pb-2">البيانات الأساسية</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <Label htmlFor="name" className="text-sm font-medium">اسم العقار</Label>
                <Input
                  id="name"
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  placeholder="اسم العقار"
                  className="mt-1"
                  maxLength={25}
                  data-testid="input-name"
                />
                {formData.name && (formData.name.length < 3 || formData.name.length > 25) && (
                  <p className="text-xs text-amber-600 mt-1">اسم العقار يجب أن يكون بين 3 و 25 حرف</p>
                )}
              </div>

              <div>
                <Label htmlFor="whatsappNumber" className="text-sm font-medium">رقم الواتساب</Label>
                <Input
                  id="whatsappNumber"
                  name="whatsappNumber"
                  value={formData.whatsappNumber}
                  onChange={handleChange}
                  placeholder="966XXXXXXXXX"
                  className="mt-1"
                  dir="ltr"
                  data-testid="input-whatsapp"
                />
              </div>

              <div>
                <Label htmlFor="location" className="text-sm font-medium">الموقع / الحي</Label>
                <Input
                  id="location"
                  name="location"
                  value={formData.location}
                  onChange={handleChange}
                  placeholder="الحي أو الموقع"
                  className="mt-1"
                  data-testid="input-location"
                />
              </div>

              <div>
                <Label htmlFor="city" className="text-sm font-medium">المدينة</Label>
                <select
                  id="city"
                  name="city"
                  value={formData.city}
                  onChange={handleChange}
                  className="mt-1 w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
                  data-testid="select-city"
                >
                  <option value="">اختر المدينة</option>
                  {CITIES.map((city) => (
                    <option key={city} value={city}>{city}</option>
                  ))}
                </select>
              </div>

              <div>
                <Label htmlFor="direction" className="text-sm font-medium">الاتجاه</Label>
                <select
                  id="direction"
                  name="direction"
                  value={formData.direction}
                  onChange={handleChange}
                  className="mt-1 w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
                  data-testid="select-direction"
                >
                  <option value="">اختر الاتجاه</option>
                  {DIRECTIONS.map((dir) => (
                    <option key={dir} value={dir}>{dir}</option>
                  ))}
                </select>
              </div>

              <div>
                <Label htmlFor="type" className="text-sm font-medium">نوع العقار</Label>
                <select
                  id="type"
                  name="type"
                  value={formData.type}
                  onChange={handleChange}
                  className="mt-1 w-full h-9 rounded-md border border-input bg-background px-3 py-1 text-sm"
                  data-testid="select-type"
                >
                  <option value="">اختر النوع</option>
                  {TYPES.map((type) => (
                    <option key={type} value={type}>{type}</option>
                  ))}
                </select>
              </div>
            </div>
          </Card>

          {/* الأسعار */}
          <Card className="p-5">
            <h2 className="text-base font-bold text-primary mb-4 border-b pb-2">الأسعار (ريال)</h2>
            
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <Label htmlFor="weekday" className="text-sm font-medium">وسط الأسبوع</Label>
                <Input
                  id="weekday"
                  type="number"
                  value={prices.weekday}
                  onChange={(e) => setPrices({ ...prices, weekday: e.target.value })}
                  placeholder="0"
                  className="mt-1"
                  data-testid="input-price-weekday"
                />
              </div>
              <div>
                <Label htmlFor="weekend" className="text-sm font-medium">نهاية الأسبوع</Label>
                <Input
                  id="weekend"
                  type="number"
                  value={prices.weekend}
                  onChange={(e) => setPrices({ ...prices, weekend: e.target.value })}
                  placeholder="0"
                  className="mt-1"
                  data-testid="input-price-weekend"
                />
              </div>
              <div>
                <Label htmlFor="overnight" className="text-sm font-medium">المبيت</Label>
                <Input
                  id="overnight"
                  type="number"
                  value={prices.overnight}
                  onChange={(e) => setPrices({ ...prices, overnight: e.target.value })}
                  placeholder="0"
                  className="mt-1"
                  data-testid="input-price-overnight"
                />
              </div>
              <div>
                <Label htmlFor="holidays" className="text-sm font-medium">الإجازات</Label>
                <Input
                  id="holidays"
                  type="number"
                  value={prices.holidays}
                  onChange={(e) => setPrices({ ...prices, holidays: e.target.value })}
                  placeholder="0"
                  className="mt-1"
                  data-testid="input-price-holidays"
                />
              </div>
            </div>
          </Card>

          {/* المرافق */}
          <Card className="p-5">
            <h2 className="text-base font-bold text-primary mb-4 border-b pb-2">
              المرافق ({selectedFacilities.length} مختار)
            </h2>
            
            {/* البحث في المرافق */}
            <div className="relative mb-4">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="ابحث عن مرفق..."
                value={facilitySearch}
                onChange={(e) => setFacilitySearch(e.target.value)}
                className="pr-10"
                data-testid="input-facility-search"
              />
            </div>

            {/* المرافق المختارة */}
            {selectedFacilities.length > 0 && (
              <div className="mb-4 p-3 bg-primary/5 rounded-lg border border-primary/20">
                <p className="text-xs font-medium text-primary mb-2">المرافق المختارة:</p>
                <div className="flex flex-wrap gap-2">
                  {selectedFacilities.map((f) => (
                    <span
                      key={f}
                      className="text-xs bg-primary/10 text-primary px-2 py-1 rounded-full cursor-pointer hover:bg-primary/20"
                      onClick={() => toggleFacility(f)}
                    >
                      {f} ✕
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* قائمة المرافق */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 max-h-64 overflow-y-auto p-2 bg-muted/30 rounded-lg">
              {FACILITIES
                .filter((f) => f.toLowerCase().includes(facilitySearch.toLowerCase()))
                .map((facility) => (
                  <div key={facility} className="flex items-center gap-2">
                    <Checkbox
                      checked={selectedFacilities.includes(facility)}
                      onCheckedChange={() => toggleFacility(facility)}
                      id={`fac-${facility}`}
                      data-testid={`checkbox-facility-${facility}`}
                    />
                    <label
                      htmlFor={`fac-${facility}`}
                      className="text-xs cursor-pointer select-none"
                    >
                      {facility}
                    </label>
                  </div>
                ))}
            </div>
          </Card>

          {/* أزرار الحفظ */}
          <div className="flex gap-3">
            <Button
              type="submit"
              disabled={isLoading}
              className="flex-1"
              data-testid="button-save"
            >
              {isLoading ? "جاري الحفظ..." : "حفظ التغييرات"}
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => setLocation("/owner/dashboard")}
              disabled={isLoading}
              data-testid="button-cancel"
            >
              إلغاء
            </Button>
          </div>
        </form>

        {/* قسم تغيير الرقم السري */}
        <Card className="p-4 mt-6">
          <div className="flex items-center gap-2 mb-4">
            <KeyRound className="w-5 h-5 text-primary" />
            <h3 className="font-semibold text-primary">تغيير الرقم السري</h3>
          </div>
          
          <form onSubmit={handleChangePassword} className="space-y-4">
            <div>
              <Label htmlFor="currentPassword">الرقم السري الحالي</Label>
              <Input
                id="currentPassword"
                type="password"
                placeholder="أدخل الرقم السري الحالي"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                disabled={isChangingPassword}
                data-testid="input-current-password"
              />
            </div>
            
            <div>
              <Label htmlFor="newPassword">الرقم السري الجديد</Label>
              <Input
                id="newPassword"
                type="password"
                placeholder="أدخل الرقم السري الجديد (4 أرقام على الأقل)"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={isChangingPassword}
                data-testid="input-new-password"
              />
            </div>
            
            <div>
              <Label htmlFor="confirmPassword">تأكيد الرقم السري</Label>
              <Input
                id="confirmPassword"
                type="password"
                placeholder="أعد إدخال الرقم السري الجديد"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={isChangingPassword}
                data-testid="input-confirm-password"
              />
            </div>
            
            <Button
              type="submit"
              disabled={isChangingPassword || !currentPassword || !newPassword || newPassword !== confirmPassword}
              className="w-full"
              data-testid="button-change-password"
            >
              {isChangingPassword ? (
                <>
                  <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                  جاري التغيير...
                </>
              ) : (
                "تغيير الرقم السري"
              )}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
