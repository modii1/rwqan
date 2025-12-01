import { useEffect, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Property } from "@shared/schema";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";

export default function OwnerUpdateProperty() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [formData, setFormData] = useState<any>({});
  const [isLoading, setIsLoading] = useState(false);

  const { data: property } = useQuery<Property>({
    queryKey: ["/api/owner/property"],
    retry: false,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (property) {
      setFormData({
        name: property.name || "",
        location: property.location || "",
        city: property.city || "",
        direction: property.direction || "",
        type: property.type || "",
        weekday: property.prices?.weekday || "",
        weekend: property.prices?.weekend || "",
        overnight: property.prices?.overnight || "",
        holidays: property.prices?.holidays || "",
      });
    }
  }, [property]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData((prev: any) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const body = {
        name: formData.name,
        location: formData.location,
        city: formData.city,
        direction: formData.direction,
        type: formData.type,
        prices: {
          display: property?.prices?.display || "",
          weekday: formData.weekday,
          weekend: formData.weekend,
          overnight: formData.overnight,
          special: property?.prices?.special || "",
          holidays: formData.holidays,
        },
      };

      await apiRequest("PUT", "/api/owner/property", body);

      // Invalidate cache
      queryClient.invalidateQueries({ queryKey: ["/api/owner/property"] });

      toast({
        title: "تم التحديث بنجاح",
        description: "تم حفظ بيانات العقار في Google Sheets",
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

  if (!property) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-20">
      <div className="max-w-2xl mx-auto px-4 py-8">
        <Card className="p-6">
          <h1 className="text-2xl font-bold text-primary mb-6">تحديث بيانات العقار</h1>

          <form onSubmit={handleSubmit} className="space-y-6">
            {/* اسم العقار */}
            <div>
              <Label htmlFor="name" className="text-base">اسم العقار</Label>
              <Input
                id="name"
                name="name"
                value={formData.name}
                onChange={handleChange}
                placeholder="اسم العقار"
                className="mt-2"
              />
            </div>

            {/* الموقع */}
            <div>
              <Label htmlFor="location" className="text-base">الموقع</Label>
              <Input
                id="location"
                name="location"
                value={formData.location}
                onChange={handleChange}
                placeholder="الموقع أو العنوان"
                className="mt-2"
              />
            </div>

            {/* المدينة والاتجاه والنوع */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <Label htmlFor="city" className="text-base">المدينة</Label>
                <Input
                  id="city"
                  name="city"
                  value={formData.city}
                  onChange={handleChange}
                  placeholder="المدينة"
                  className="mt-2"
                />
              </div>
              <div>
                <Label htmlFor="direction" className="text-base">الاتجاه</Label>
                <Input
                  id="direction"
                  name="direction"
                  value={formData.direction}
                  onChange={handleChange}
                  placeholder="الاتجاه"
                  className="mt-2"
                />
              </div>
              <div>
                <Label htmlFor="type" className="text-base">النوع</Label>
                <Input
                  id="type"
                  name="type"
                  value={formData.type}
                  onChange={handleChange}
                  placeholder="النوع"
                  className="mt-2"
                />
              </div>
            </div>

            {/* الأسعار */}
            <div className="border-t pt-6">
              <h2 className="text-lg font-bold mb-4">الأسعار (ريال)</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <Label htmlFor="weekday" className="text-base">سعر وسط الأسبوع</Label>
                  <Input
                    id="weekday"
                    name="weekday"
                    type="number"
                    value={formData.weekday}
                    onChange={handleChange}
                    placeholder="0"
                    className="mt-2"
                  />
                </div>
                <div>
                  <Label htmlFor="weekend" className="text-base">سعر نهاية الأسبوع</Label>
                  <Input
                    id="weekend"
                    name="weekend"
                    type="number"
                    value={formData.weekend}
                    onChange={handleChange}
                    placeholder="0"
                    className="mt-2"
                  />
                </div>
                <div>
                  <Label htmlFor="overnight" className="text-base">سعر المبيت</Label>
                  <Input
                    id="overnight"
                    name="overnight"
                    type="number"
                    value={formData.overnight}
                    onChange={handleChange}
                    placeholder="0"
                    className="mt-2"
                  />
                </div>
                <div>
                  <Label htmlFor="holidays" className="text-base">سعر الإجازات</Label>
                  <Input
                    id="holidays"
                    name="holidays"
                    type="number"
                    value={formData.holidays}
                    onChange={handleChange}
                    placeholder="0"
                    className="mt-2"
                  />
                </div>
              </div>
            </div>

            {/* الأزرار */}
            <div className="flex gap-3 pt-6">
              <Button
                type="submit"
                disabled={isLoading}
                className="flex-1"
              >
                {isLoading ? "جاري الحفظ..." : "حفظ التغييرات"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setLocation("/owner/dashboard")}
                disabled={isLoading}
              >
                إلغاء
              </Button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
