import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Pencil, Plus, Trash2, UserX, Image } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { FACILITIES } from "@shared/schema";
import { useLocation } from "wouter"

const CITIES = ['بريدة', 'عنيزة', 'الرس', 'البكيرية', 'المذنب'] as const;
const DIRECTIONS = ['شمال', 'جنوب', 'شرق', 'غرب'] as const;
const TYPES = ['قسم', 'قسمين'] as const;

const R2_BASE = "https://pub-e2fc1c0a598f4f0e91e47af63219848e.r2.dev";


interface PropertyData {
  propertyNumber: string;
  name: string;
  pin?: string;
  city: string;
  direction: string;
  type: string;
  location?: string;
  whatsappNumber: string;
  facilities: string[] | string;
  imagesFolderUrl?: string;
  imagesLink?: string;
  subscriptionType: string;
  subscriptionDate?: string | null;
  imageUrls?: string[];
  prices?: {
    weekday?: string;
    weekend?: string;
    overnight?: string;
    holidays?: string;
  };
}

function getImageInfo(imagesLink?: string): { type: 'r2' | 'drive' | 'none'; count: number; driveUrl?: string } {
  if (!imagesLink) return { type: 'none', count: 0 };
  const trimmed = imagesLink.trim();
  
  if (trimmed.startsWith("[")) {
    try {
      const arr = JSON.parse(trimmed);
      return { type: 'r2', count: Array.isArray(arr) ? arr.length : 0 };
    } catch {
      return { type: 'none', count: 0 };
    }
  }
  
  if (trimmed.includes('drive.google.com')) {
    return { type: 'drive', count: 1, driveUrl: trimmed };
  }
  
  return { type: 'none', count: 0 };
}

function getR2Images(propertyNumber: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => 
    `${R2_BASE}/${propertyNumber}/${i + 1}.jpg`
  );
}

function hasImages(imagesLink?: string): boolean {
  const info = getImageInfo(imagesLink);
  return info.type !== 'none';
}

const FIELD_LABELS: Record<string, string> = {
  propertyNumber: "رقم العقار",
  name: "اسم العقار",
  pin: "الرقم السري",
  city: "المدينة",
  direction: "الاتجاه",
  type: "النوع",
  location: "الموقع / الحي",
  whatsappNumber: "رقم الواتساب",
  facilities: "المرافق",
  imagesFolderUrl: "رابط الصور",
  subscriptionType: "نوع الاشتراك",
  subscriptionDate: "تاريخ الاشتراك",
  priceWeekday: "سعر وسط الأسبوع",
  priceWeekend: "سعر نهاية الأسبوع",
  priceOvernight: "سعر المبيت",
  priceHolidays: "سعر الإجازات",
};

export default function PropertiesSection() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [, setLocation] = useLocation()

  const [editing, setEditing] = useState<PropertyData | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [filter, setFilter] = useState("");
  const [facilitySearch, setFacilitySearch] = useState("");
  const [selectedFacilities, setSelectedFacilities] = useState<string[]>([]);
  const [prices, setPrices] = useState({ weekday: "", weekend: "", overnight: "", holidays: "" });
  const [showImages, setShowImages] = useState<PropertyData | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<PropertyData | null>(null);

  const { data, isLoading } = useQuery<PropertyData[]>({
    queryKey: ["admin-properties"],
    queryFn: async () => {
      const res = await fetch("/api/properties");
      if (!res.ok) throw new Error("فشل في جلب العقارات");
      return res.json();
    },
  });

  const mutation = useMutation({
    mutationFn: async (payload: PropertyData) => {
      const facilitiesStr = Array.isArray(selectedFacilities) && selectedFacilities.length > 0
        ? JSON.stringify(selectedFacilities)
        : typeof payload.facilities === 'string' ? payload.facilities : JSON.stringify(payload.facilities || []);

      const body = {
        propertyNumber: payload.propertyNumber,
        name: payload.name,
        whatsappNumber: payload.whatsappNumber,
        location: payload.location || "",
        city: payload.city,
        direction: payload.direction,
        type: payload.type,
        facilities: facilitiesStr,
        imagesFolderUrl: payload.imagesFolderUrl || "",
        subscriptionType: payload.subscriptionType,
        subscriptionDate: payload.subscriptionDate || "",
        pin: payload.pin || "",
        priceWeekday: prices.weekday,
        priceWeekend: prices.weekend,
        priceOvernight: prices.overnight,
        priceHolidays: prices.holidays,
      };

      const url = isNew
        ? "/api/admin/properties"
        : `/api/admin/properties/${payload.propertyNumber}`;

      const res = await fetch(url, {
        method: isNew ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || "فشل في حفظ العقار");
      }

      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-properties"] });
      toast({ title: "تم الحفظ ✓", description: isNew ? "تمت إضافة العقار بنجاح" : "تم تحديث العقار بنجاح" });
      setEditing(null);
      resetForm();
    },
    onError: (error: Error) => {
      toast({ title: "خطأ", description: error.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (propertyNumber: string) => {
      const res = await fetch(`/api/admin/properties/${propertyNumber}`, { method: "DELETE" });
      if (!res.ok) throw new Error("فشل في حذف العقار");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-properties"] });
      toast({ title: "تم الحذف ✓", description: "تم حذف العقار بنجاح" });
      setDeleteConfirm(null);
    },
    onError: (error: Error) => {
      toast({ title: "خطأ في الحذف", description: error.message, variant: "destructive" });
    },
  });

  const stopSubscriptionMutation = useMutation({
    mutationFn: async (propertyNumber: string) => {
      const res = await fetch(`/api/admin/properties/${propertyNumber}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscriptionType: "عادي" }),
      });
      if (!res.ok) throw new Error("فشل في إيقاف الاشتراك");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-properties"] });
      toast({ title: "تم إيقاف الاشتراك ✓", description: "تم تحويل الاشتراك إلى عادي" });
    },
    onError: (error: Error) => {
      toast({ title: "خطأ", description: error.message, variant: "destructive" });
    },
  });

  const resetForm = () => {
    setSelectedFacilities([]);
    setPrices({ weekday: "", weekend: "", overnight: "", holidays: "" });
    setFacilitySearch("");
  };

  const openEdit = (p: PropertyData) => {
    setIsNew(false);
    setEditing(p);

    let facs: string[] = [];
    if (p.facilities) {
      if (Array.isArray(p.facilities)) {
        facs = p.facilities;
      } else if (typeof p.facilities === "string") {
        try {
          const parsed = JSON.parse(p.facilities);
          facs = Array.isArray(parsed) ? parsed : [];
        } catch {
          facs = p.facilities.split(",").map((s: string) => s.trim()).filter(Boolean);
        }
      }
    }
    setSelectedFacilities(facs);

    setPrices({
      weekday: p.prices?.weekday || "",
      weekend: p.prices?.weekend || "",
      overnight: p.prices?.overnight || "",
      holidays: p.prices?.holidays || "",
    });
  };

  const startNew = () => {
    setIsNew(true);
    resetForm();
    setEditing({
      propertyNumber: "",
      name: "",
      pin: "",
      city: "",
      direction: "",
      type: "",
      location: "",
      whatsappNumber: "",
      facilities: [],
      imagesFolderUrl: "",
      subscriptionType: "عادي",
      subscriptionDate: null,
      imageUrls: [],
    });
  };

  const toggleFacility = (facility: string) => {
    setSelectedFacilities(prev =>
      prev.includes(facility) ? prev.filter(f => f !== facility) : [...prev, facility]
    );
  };

  const items = (data || []).filter((p) =>
    filter
      ? p.name?.includes(filter) || p.propertyNumber?.includes(filter) || (p.city || "").includes(filter)
      : true
  );

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">إدارة العقارات</h2>
          <p className="text-xs text-muted-foreground">عرض وتعديل وحذف جميع العقارات</p>
        </div>

        <div className="flex items-center gap-2">
          <Input
            placeholder="بحث بالاسم / رقم العقار / المدينة"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-56"
            data-testid="input-search-properties"
          />
          <Button onClick={startNew} size="sm" data-testid="button-add-property">
            <Plus className="w-4 h-4 ml-1" /> عقار جديد
          </Button>
        </div>
      </div>

      <Card className="overflow-x-auto">
        {isLoading ? (
          <div className="p-4 flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />
            جاري تحميل العقارات...
          </div>
        ) : (
          <table className="w-full text-xs md:text-sm">
            <thead className="bg-muted/50 text-right">
              <tr>
                <Th>رقم العقار</Th>
                <Th>الاسم</Th>
                <Th>المدينة</Th>
                <Th>النوع</Th>
                <Th>نوع الاشتراك</Th>
                <Th>تحكم</Th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.propertyNumber} className="border-t hover:bg-muted/40">
                  <Td>{p.propertyNumber}</Td>
                  <Td>{p.name}</Td>
                  <Td>{p.city}</Td>
                  <Td>{p.type}</Td>
                  <Td>
                    <span className={`px-2 py-0.5 rounded text-xs ${
                      (p.subscriptionType === "موثوق" || p.subscriptionType === "مميز") ? "bg-primary/20 text-primary" : "bg-muted"
                    }`}>
                      {p.subscriptionType}
                    </span>
                  </Td>
                  <Td>
                    <div className="flex items-center gap-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => openEdit(p)}
                        title="تعديل"
                        data-testid={`button-edit-${p.propertyNumber}`}
                      >
                        <Pencil className="w-4 h-4" />
                      </Button>

                      {hasImages(p.imagesLink) && (
                        <Button
                         size="icon"
                         variant="ghost"
                        onClick={() => setLocation(`/admin/images/${p.propertyNumber}`)}
                        title="إدارة الصور (R2)"
                        data-testid={`button-images-${p.propertyNumber}`}
                        >
                        <Image className="w-4 h-4 text-blue-500" />
                        </Button>
                      )}

                      {(p.subscriptionType === "موثوق" || p.subscriptionType === "مميز") && (
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => stopSubscriptionMutation.mutate(p.propertyNumber)}
                          title="إيقاف الاشتراك (تحويل إلى عادي)"
                          disabled={stopSubscriptionMutation.isPending}
                          data-testid={`button-stop-sub-${p.propertyNumber}`}
                        >
                          <UserX className="w-4 h-4 text-orange-500" />
                        </Button>
                      )}

                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => setDeleteConfirm(p)}
                        title="حذف العقار"
                        data-testid={`button-delete-${p.propertyNumber}`}
                      >
                        <Trash2 className="w-4 h-4 text-red-500" />
                      </Button>
                    </div>
                  </Td>
                </tr>
              ))}

              {items.length === 0 && (
                <tr>
                  <Td colSpan={6}>
                    <div className="p-4 text-center text-xs text-muted-foreground">لا توجد عقارات.</div>
                  </Td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </Card>

      {/* Edit/Add Dialog */}
      <Dialog open={!!editing} onOpenChange={() => { setEditing(null); resetForm(); }}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{isNew ? "إضافة عقار جديد" : "تعديل العقار"}</DialogTitle>
            <DialogDescription>
              {isNew ? "أدخل بيانات العقار الجديد" : `تعديل بيانات العقار رقم ${editing?.propertyNumber}`}
            </DialogDescription>
          </DialogHeader>

          {editing && (
            <div className="space-y-6">
              {/* Basic Info */}
              <div>
                <h3 className="text-sm font-bold text-primary mb-3 border-b pb-1">البيانات الأساسية</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground mb-1 block">
                      {FIELD_LABELS.propertyNumber}
                    </label>
                    <Input
                      value={editing.propertyNumber}
                      onChange={(e) => setEditing({ ...editing, propertyNumber: e.target.value })}
                      placeholder="مثال: 88115"
                      maxLength={5}
                      disabled={!isNew}
                      data-testid="input-propertyNumber"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-muted-foreground mb-1 block">
                      {FIELD_LABELS.name}
                    </label>
                    <Input
                      value={editing.name}
                      onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                      placeholder="اسم العقار"
                      data-testid="input-name"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-muted-foreground mb-1 block">
                      {FIELD_LABELS.pin}
                    </label>
                    <Input
                      value={editing.pin || ""}
                      onChange={(e) => setEditing({ ...editing, pin: e.target.value })}
                      placeholder="الرقم السري"
                      type="password"
                      data-testid="input-pin"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-muted-foreground mb-1 block">
                      {FIELD_LABELS.whatsappNumber}
                    </label>
                    <Input
                      value={editing.whatsappNumber || ""}
                      onChange={(e) => setEditing({ ...editing, whatsappNumber: e.target.value })}
                      placeholder="966XXXXXXXXX"
                      data-testid="input-whatsapp"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-muted-foreground mb-1 block">
                      {FIELD_LABELS.city}
                    </label>
                    <Select
                      value={editing.city || ""}
                      onValueChange={(v) => setEditing({ ...editing, city: v })}
                    >
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
                    <label className="text-xs font-semibold text-muted-foreground mb-1 block">
                      {FIELD_LABELS.direction}
                    </label>
                    <Select
                      value={editing.direction || ""}
                      onValueChange={(v) => setEditing({ ...editing, direction: v })}
                    >
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
                    <label className="text-xs font-semibold text-muted-foreground mb-1 block">
                      {FIELD_LABELS.type}
                    </label>
                    <Select
                      value={editing.type || ""}
                      onValueChange={(v) => setEditing({ ...editing, type: v })}
                    >
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

                  <div>
                    <label className="text-xs font-semibold text-muted-foreground mb-1 block">
                      {FIELD_LABELS.location}
                    </label>
                    <Input
                      value={editing.location || ""}
                      onChange={(e) => setEditing({ ...editing, location: e.target.value })}
                      placeholder="اسم الحي أو الموقع"
                      data-testid="input-location"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-muted-foreground mb-1 block">
                      {FIELD_LABELS.subscriptionType}
                    </label>
                    <Select
                      value={editing.subscriptionType || "عادي"}
                      onValueChange={(v) => setEditing({ ...editing, subscriptionType: v })}
                    >
                      <SelectTrigger data-testid="select-subscription">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="عادي">عادي</SelectItem>
                        <SelectItem value="مميز">مميز (موثوق)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-muted-foreground mb-1 block">
                      {FIELD_LABELS.imagesFolderUrl}
                    </label>
                    <Input
                      value={editing.imagesFolderUrl || ""}
                      onChange={(e) => setEditing({ ...editing, imagesFolderUrl: e.target.value })}
                      placeholder="رابط مجلد الصور"
                      data-testid="input-imagesFolderUrl"
                    />
                  </div>
                </div>
              </div>

              {/* Prices */}
              <div>
                <h3 className="text-sm font-bold text-primary mb-3 border-b pb-1">الأسعار</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground mb-1 block">
                      {FIELD_LABELS.priceWeekday}
                    </label>
                    <Input
                      type="number"
                      value={prices.weekday}
                      onChange={(e) => setPrices({ ...prices, weekday: e.target.value })}
                      placeholder="500"
                      data-testid="input-price-weekday"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground mb-1 block">
                      {FIELD_LABELS.priceWeekend}
                    </label>
                    <Input
                      type="number"
                      value={prices.weekend}
                      onChange={(e) => setPrices({ ...prices, weekend: e.target.value })}
                      placeholder="800"
                      data-testid="input-price-weekend"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground mb-1 block">
                      {FIELD_LABELS.priceOvernight}
                    </label>
                    <Input
                      type="number"
                      value={prices.overnight}
                      onChange={(e) => setPrices({ ...prices, overnight: e.target.value })}
                      placeholder="1200"
                      data-testid="input-price-overnight"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-muted-foreground mb-1 block">
                      {FIELD_LABELS.priceHolidays}
                    </label>
                    <Input
                      type="number"
                      value={prices.holidays}
                      onChange={(e) => setPrices({ ...prices, holidays: e.target.value })}
                      placeholder="1000"
                      data-testid="input-price-holidays"
                    />
                  </div>
                </div>
              </div>

              {/* Facilities */}
              <div>
                <h3 className="text-sm font-bold text-primary mb-3 border-b pb-1">
                  المرافق ({selectedFacilities.length} مختار)
                </h3>
                <div className="p-3 bg-muted/30 rounded-lg">
                  <Input
                    placeholder="ابحث عن مرفق..."
                    value={facilitySearch}
                    onChange={(e) => setFacilitySearch(e.target.value)}
                    className="mb-3"
                    data-testid="input-facility-search"
                  />
                  <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 max-h-48 overflow-y-auto">
                    {FACILITIES
                      .filter(f => f.toLowerCase().includes(facilitySearch.toLowerCase()))
                      .map(facility => (
                        <div key={facility} className="flex items-center gap-2">
                          <Checkbox
                            checked={selectedFacilities.includes(facility)}
                            onCheckedChange={() => toggleFacility(facility)}
                            id={`fac-${facility}`}
                          />
                          <label htmlFor={`fac-${facility}`} className="text-xs cursor-pointer">
                            {facility}
                          </label>
                        </div>
                      ))}
                  </div>
                </div>
              </div>

              {/* Current Images */}
              {(() => {
                const info = getImageInfo(editing.imagesLink);
                if (info.type === 'none') return null;
                
                if (info.type === 'drive') {
                  return (
                    <div>
                      <h3 className="text-sm font-bold text-primary mb-3 border-b pb-1">
                        الصور (Google Drive)
                      </h3>
                      <a 
                        href={info.driveUrl} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100 transition"
                      >
                        <Image className="w-4 h-4" />
                        فتح مجلد الصور في Google Drive
                      </a>
                    </div>
                  );
                }
                
                const images = getR2Images(editing.propertyNumber, info.count);
                return (
                  <div>
                    <h3 className="text-sm font-bold text-primary mb-3 border-b pb-1">
                      الصور الحالية ({info.count})
                    </h3>
                    <div className="grid grid-cols-4 md:grid-cols-6 gap-2">
                      {images.slice(0, 12).map((url, i) => (
                        <img
                          key={i}
                          src={url}
                          alt={`صورة ${i + 1}`}
                          className="w-full h-16 object-cover rounded border"
                          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                        />
                      ))}
                      {info.count > 12 && (
                        <div className="w-full h-16 bg-muted rounded border flex items-center justify-center text-xs">
                          +{info.count - 12}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* Buttons */}
              <div className="flex justify-end gap-2 pt-4 border-t">
                <Button variant="outline" onClick={() => { setEditing(null); resetForm(); }}>
                  إلغاء
                </Button>
                <Button
                  onClick={() => editing && mutation.mutate(editing)}
                  disabled={mutation.isPending}
                  className="gradient-golden"
                  data-testid="button-save"
                >
                  {mutation.isPending && <Loader2 className="w-4 h-4 ml-1 animate-spin" />}
                  حفظ
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Images Modal */}
      <Dialog open={!!showImages} onOpenChange={() => setShowImages(null)}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>صور العقار: {showImages?.name}</DialogTitle>
            <DialogDescription>
              عرض جميع صور العقار رقم {showImages?.propertyNumber}
            </DialogDescription>
          </DialogHeader>
          {showImages && (() => {
            const info = getImageInfo(showImages.imagesLink);
            
            if (info.type === 'none') {
              return <p className="text-muted-foreground text-center py-4">لا توجد صور</p>;
            }
            
            if (info.type === 'drive') {
              return (
                <div className="text-center py-8">
                  <p className="text-muted-foreground mb-4">الصور مخزنة في Google Drive</p>
                  <a 
                    href={info.driveUrl} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition"
                  >
                    <Image className="w-5 h-5" />
                    فتح مجلد الصور
                  </a>
                </div>
              );
            }
            
            const images = getR2Images(showImages.propertyNumber, info.count);
            return (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 max-h-[60vh] overflow-y-auto">
                {images.map((url, i) => (
                  <img
                    key={i}
                    src={url}
                    alt={`صورة ${i + 1}`}
                    className="w-full h-32 object-cover rounded-lg border"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                ))}
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-red-600">تأكيد الحذف</DialogTitle>
            <DialogDescription>
              هل أنت متأكد من حذف العقار "{deleteConfirm?.name}" رقم {deleteConfirm?.propertyNumber}؟
              <br />
              <span className="text-red-500 font-bold">هذا الإجراء لا يمكن التراجع عنه!</span>
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>إلغاء</Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfirm && deleteMutation.mutate(deleteConfirm.propertyNumber)}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete"
            >
              {deleteMutation.isPending && <Loader2 className="w-4 h-4 ml-1 animate-spin" />}
              نعم، احذف
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 text-[11px] md:text-xs font-bold">{children}</th>;
}

function Td({ children, colSpan }: { children: React.ReactNode; colSpan?: number }) {
  return <td colSpan={colSpan} className="px-3 py-2 whitespace-nowrap">{children}</td>;
}
