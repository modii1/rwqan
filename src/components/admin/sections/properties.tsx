"use client";
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Pencil, Plus, Trash2, UserX, Image, BellOff, Bell } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { FACILITIES } from "@shared/schema";
import { useRouter } from "next/navigation";
import { normalizeArabicText } from "@/lib/arabicSearch";

const CITIES = ['بريدة', 'عنيزة', 'الرس', 'البكيرية', 'المذنب', 'البدائع', 'الأسياح', 'رياض الخبراء'] as const;
const DIRECTIONS = ['شمال', 'جنوب', 'شرق', 'غرب'] as const;
const TYPES = ['قسم', 'قسمين'] as const;

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
  subscriptionType: string;
  subscriptionDate?: string | null;
  muteExpiryNotification?: boolean;
  prices?: {
    weekday?: string;
    weekend?: string;
    overnight?: string;
    holidays?: string;
  };
}

// جميع العقارات تستخدم R2 الآن - أظهر أيقونة الصور دائماً
function hasImages(): boolean {
  return true;
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
  subscriptionType: "نوع الاشتراك",
  subscriptionDate: "تاريخ الاشتراك",
  priceWeekday: "سعر وسط الأسبوع",
  priceWeekend: "سعر نهاية الأسبوع",
  priceOvernight: "سعر المبيت",
  priceHolidays: "سعر الإجازات",
};

// مكون SEO للأدمن
function SeoSection({ propertyNumber, propertyName }: { propertyNumber: string; propertyName: string }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [seoDescription, setSeoDescription] = useState("");
  const [metaTitle, setMetaTitle] = useState("");
  const [keywords, setKeywords] = useState("");

  const { data: seoData, isLoading } = useQuery<{
    seoDescription: string;
    metaTitle: string;
    keywords: string[];
  }>({
    queryKey: ["property-seo", propertyNumber],
    queryFn: async () => {
      const res = await fetch(`/api/properties/${propertyNumber}/seo`);
      if (res.ok) return res.json();
      return { seoDescription: "", metaTitle: "", keywords: [] };
    },
  });

  const seoMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/admin/properties/${propertyNumber}/seo`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          seoDescription,
          metaTitle,
          keywords: keywords.split(",").map(k => k.trim()).filter(Boolean),
        }),
      });
      if (!res.ok) throw new Error("فشل في حفظ بيانات SEO");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "تم حفظ بيانات SEO بنجاح" });
      queryClient.invalidateQueries({ queryKey: ["property-seo", propertyNumber] });
    },
    onError: () => {
      toast({ title: "فشل في حفظ بيانات SEO", variant: "destructive" });
    },
  });

  useEffect(() => {
    if (seoData) {
      setSeoDescription(seoData.seoDescription || "");
      setMetaTitle(seoData.metaTitle || "");
      setKeywords(seoData.keywords?.join(", ") || "");
    }
  }, [seoData]);

  return (
    <div>
      <h3 className="text-sm font-bold text-primary mb-3 border-b pb-1">SEO مخصص</h3>
      {isLoading ? (
        <div className="flex items-center justify-center p-4">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : (
        <div className="space-y-3 p-3 bg-muted/30 rounded-lg">
          <div>
            <label className="block text-xs font-medium mb-1">عنوان Meta (اختياري)</label>
            <Input
              value={metaTitle}
              onChange={(e) => setMetaTitle(e.target.value)}
              placeholder={`${propertyName || "عقار"} | روقان`}
              maxLength={70}
              data-testid="input-meta-title"
            />
            <p className="text-[10px] text-muted-foreground mt-1">{metaTitle.length}/70 حرف</p>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">وصف SEO مخصص</label>
            <textarea
              value={seoDescription}
              onChange={(e) => setSeoDescription(e.target.value)}
              placeholder="أدخل وصفاً مخصصاً للعقار يظهر في نتائج البحث..."
              maxLength={160}
              rows={3}
              className="w-full px-3 py-2 text-sm rounded-md border border-input bg-background"
              data-testid="input-seo-description"
            />
            <p className="text-[10px] text-muted-foreground mt-1">{seoDescription.length}/160 حرف</p>
          </div>
          <div>
            <label className="block text-xs font-medium mb-1">الكلمات المفتاحية (مفصولة بفواصل)</label>
            <Input
              value={keywords}
              onChange={(e) => setKeywords(e.target.value)}
              placeholder="شاليه, منتجع, استراحة, القصيم..."
              data-testid="input-keywords"
            />
          </div>
          <Button
            onClick={() => seoMutation.mutate()}
            disabled={seoMutation.isPending}
            size="sm"
            className="gradient-golden"
          >
            {seoMutation.isPending && <Loader2 className="w-3 h-3 ml-1 animate-spin" />}
            حفظ SEO
          </Button>
        </div>
      )}
    </div>
  );
}

export default function PropertiesSection() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const router = useRouter();

  const [editing, setEditing] = useState<PropertyData | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [filter, setFilter] = useState("");
  const [facilitySearch, setFacilitySearch] = useState("");
  const [selectedFacilities, setSelectedFacilities] = useState<string[]>([]);
  const [prices, setPrices] = useState({ weekday: "", weekend: "", overnight: "", holidays: "" });
  const [deleteConfirm, setDeleteConfirm] = useState<PropertyData | null>(null);

  const { data, isLoading } = useQuery<PropertyData[]>({
    queryKey: ["admin-properties"],
    queryFn: async () => {
      // Use admin endpoint so ALL properties are shown (not just approved ones)
      const res = await fetch("/api/admin/properties");
      if (!res.ok) throw new Error("فشل في جلب العقارات");
      return res.json();
    },
  });

  const mutation = useMutation({
    mutationFn: async (payload: PropertyData) => {
      // Send facilities as a native array — the server normalises it on write
      const facilitiesArr = Array.isArray(selectedFacilities) && selectedFacilities.length > 0
        ? selectedFacilities
        : Array.isArray(payload.facilities) ? payload.facilities : [];

      const body = {
        propertyNumber: payload.propertyNumber,
        name: payload.name,
        whatsappNumber: payload.whatsappNumber,
        location: payload.location || "",
        city: payload.city,
        direction: payload.direction,
        type: payload.type,
        facilities: facilitiesArr,
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

  const muteExpiryMutation = useMutation({
    mutationFn: async ({ propertyNumber, muted }: { propertyNumber: string; muted: boolean }) => {
      const res = await fetch(`/api/admin/properties/${propertyNumber}/mute-expiry`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ muted }),
      });
      if (!res.ok) throw new Error("فشل في تعديل حالة الإشعارات");
      return res.json();
    },
    onSuccess: (_, { muted }) => {
      queryClient.invalidateQueries({ queryKey: ["admin-properties"] });
      toast({
        title: muted ? "تم إيقاف الإشعارات ✓" : "تم تفعيل الإشعارات ✓",
        description: muted ? "لن يتم إرسال إشعارات انتهاء الاشتراك لهذا العقار" : "سيتم إرسال إشعارات انتهاء الاشتراك لهذا العقار"
      });
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
      subscriptionType: "عادي",
      subscriptionDate: null,
    });
  };

  const toggleFacility = (facility: string) => {
    setSelectedFacilities(prev =>
      prev.includes(facility) ? prev.filter(f => f !== facility) : [...prev, facility]
    );
  };

  const items = (data || []).filter((p) => {
    if (!filter) return true;
    const normalizedFilter = normalizeArabicText(filter);
    return (
      normalizeArabicText(p.name || "").includes(normalizedFilter) ||
      normalizeArabicText(p.propertyNumber || "").includes(normalizedFilter) ||
      normalizeArabicText(p.city || "").includes(normalizedFilter) ||
      normalizeArabicText(p.direction || "").includes(normalizedFilter) ||
      normalizeArabicText(p.type || "").includes(normalizedFilter) ||
      normalizeArabicText(p.location || "").includes(normalizedFilter) ||
      normalizeArabicText(p.subscriptionType || "").includes(normalizedFilter)
    );
  });

  return (
    <section className="space-y-3" dir="rtl">
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
                    <span className={`px-2 py-0.5 rounded text-xs ${(p.subscriptionType === "موثوق" || p.subscriptionType === "مميز") ? "bg-primary/20 text-primary" : "bg-muted"
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

                      <Button
                        size="icon"
                        variant="ghost"
                        onClick={() => router.push(`/admin/images/${p.propertyNumber}`)}
                        title="إدارة الصور (R2)"
                        data-testid={`button-images-${p.propertyNumber}`}
                      >
                        <Image className="w-4 h-4 text-blue-500" />
                      </Button>

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
                        onClick={() => muteExpiryMutation.mutate({
                          propertyNumber: p.propertyNumber,
                          muted: !p.muteExpiryNotification
                        })}
                        title={p.muteExpiryNotification ? "تفعيل إشعارات انتهاء الاشتراك" : "إيقاف إشعارات انتهاء الاشتراك"}
                        disabled={muteExpiryMutation.isPending}
                        data-testid={`button-mute-expiry-${p.propertyNumber}`}
                      >
                        {p.muteExpiryNotification ? (
                          <BellOff className="w-4 h-4 text-gray-400" />
                        ) : (
                          <Bell className="w-4 h-4 text-green-500" />
                        )}
                      </Button>

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
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" dir="rtl">
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
                      maxLength={25}
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
                      value={String(editing.type) || ""}
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

              {/* إدارة الصور */}
              <div>
                <h3 className="text-sm font-bold text-primary mb-3 border-b pb-1">
                  إدارة الصور
                </h3>
                <Button
                  variant="outline"
                  onClick={() => {
                    setEditing(null);
                    resetForm();
                    router.push(`/admin/images/${editing.propertyNumber}`);
                  }}
                  className="flex items-center gap-2"
                >
                  <Image className="w-4 h-4" />
                  إدارة صور العقار (R2)
                </Button>
              </div>

              {/* SEO مخصص */}
              {editing && !isNew && (
                <SeoSection propertyNumber={editing.propertyNumber} propertyName={editing.name} />
              )}

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


      {/* Delete Confirmation */}
      <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent dir="rtl">
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
