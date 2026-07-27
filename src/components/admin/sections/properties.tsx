"use client";
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Pencil, Plus, Trash2, Image, BellOff, Bell, Link, Home, Check, X, Clock, Unlink, Eye, Search } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { FACILITIES } from "@shared/schema";
import { useRouter } from "next/navigation";
import { normalizeArabicText } from "@/lib/arabicSearch";
import AdminLinkedPropertiesSection from "./linked-properties";
import { getSubscriptionTypeLabel, isPremiumSubscriptionType, normalizeSubscriptionStatus } from "@shared/subscriptionType";
import {
  AdminActionError,
  getAdminActionErrorMessage,
  readAdminActionResponse,
} from "@/lib/admin-action-response";

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
  subscriptionStatus?: string | null;
  subscriptionDate?: string | null;
  muteExpiryNotification?: boolean;
  linkedProperty?: string;
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
  const [linkedPropertyView, setLinkedPropertyView] = useState<{ propertyNumber: string; subscription: any } | null>(null);
  const [showAdditionalRequests, setShowAdditionalRequests] = useState(false);
  const [viewMode, setViewMode] = useState<'all' | 'linked'>('all');
  const [linkedPropertiesList, setLinkedPropertiesList] = useState<{ propertyNumber: string; data: any[]; loading?: boolean } | null>(null);
  const [additionalApprovalErrors, setAdditionalApprovalErrors] = useState<
    Record<string, { message: string; partial: boolean; warnings: string[] }>
  >({});

  // Query for additional property requests
  const { data: additionalRequests, isLoading: additionalRequestsLoading, refetch: refetchAdditionalRequests } = useQuery<any[]>({
    queryKey: ["admin-additional-property-requests"],
    queryFn: async () => {
      const res = await fetch("/api/admin/additional-property-requests");
      if (!res.ok) throw new Error("فشل في جلب الطلبات");
      const data = await res.json();
      // Support both old format (requests) and new format (pendingRequests)
      return data.pendingRequests || data.requests || [];
    },
    enabled: showAdditionalRequests,
  });

  // Query for all linked properties relationships
  const { data: linkedPropertiesData } = useQuery<any>({
    queryKey: ["admin-linked-properties"],
    queryFn: async () => {
      const res = await fetch("/api/admin/additional-property-requests");
      if (!res.ok) throw new Error("فشل في جلب البيانات");
      return res.json();
    },
    enabled: showAdditionalRequests,
  });

  // Approve additional property mutation
  const approveAdditionalMutation = useMutation({
    mutationFn: async (propertyNumber: string) => {
      const res = await fetch(`/api/admin/properties/${propertyNumber}/approve-additional`, {
        method: "PUT",
      });
      return readAdminActionResponse<{ success: boolean }>(
        res,
        "تعذر قبول العقار الإضافي حالياً. حاول مرة أخرى.",
      );
    },
    onMutate: (propertyNumber: string) => {
      setAdditionalApprovalErrors((current) => {
        const next = { ...current };
        delete next[propertyNumber];
        return next;
      });
    },
    onSuccess: (_result, propertyNumber) => {
      setAdditionalApprovalErrors((current) => {
        const next = { ...current };
        delete next[propertyNumber];
        return next;
      });
      queryClient.invalidateQueries({ queryKey: ["admin-properties"] });
      queryClient.invalidateQueries({ queryKey: ["admin-additional-property-requests"] });
      toast({ title: "تم الموافقة ✓", description: "تمت الموافقة على إضافة العقار" });
    },
    onError: (error: unknown, propertyNumber) => {
      const message = getAdminActionErrorMessage(
        error,
        "تعذر قبول العقار الإضافي حالياً. حاول مرة أخرى.",
      );
      setAdditionalApprovalErrors((current) => ({
        ...current,
        [propertyNumber]: {
          message,
          partial: error instanceof AdminActionError && error.partial,
          warnings:
            error instanceof AdminActionError ? error.warnings : [],
        },
      }));
      toast({
        title: "تعذر قبول العقار الإضافي",
        description: message,
        variant: "destructive",
      });
    },
  });

  // Reject additional property mutation
  const rejectAdditionalMutation = useMutation({
    mutationFn: async ({ propertyNumber, reason }: { propertyNumber: string; reason?: string }) => {
      const res = await fetch(`/api/admin/properties/${propertyNumber}/reject-additional`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) throw new Error("فشل في الرفض");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-properties"] });
      queryClient.invalidateQueries({ queryKey: ["admin-additional-property-requests"] });
      toast({ title: "تم الرفض ✓", description: "تم رفض طلب إضافة العقار" });
    },
    onError: (error: Error) => {
      toast({ title: "خطأ", description: error.message, variant: "destructive" });
    },
  });

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
      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-border pb-1">
        <button
          onClick={() => setViewMode('all')}
          className={`px-4 py-2 text-sm font-medium rounded-t-lg transition ${
            viewMode === 'all'
              ? 'bg-primary/10 text-primary border-b-2 border-primary'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
          }`}
        >
          <Home className="w-4 h-4 inline ml-1" />
          كل العقارات
        </button>
        <button
          onClick={() => setViewMode('linked')}
          className={`px-4 py-2 text-sm font-medium rounded-t-lg transition ${
            viewMode === 'linked'
              ? 'bg-primary/10 text-primary border-b-2 border-primary'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
          }`}
        >
          <Link className="w-4 h-4 inline ml-1" />
          العقارات المضافة
        </button>
      </div>

      {viewMode === 'linked' ? (
        <AdminLinkedPropertiesSection />
      ) : (
        <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">إدارة العقارات</h2>
          <p className="text-xs text-muted-foreground">عرض وتعديل وحذف جميع العقارات</p>
        </div>

        <div className="flex items-center gap-2">
          <Button 
            onClick={() => {
              setShowAdditionalRequests(!showAdditionalRequests);
              if (!showAdditionalRequests) {
                refetchAdditionalRequests();
              }
            }} 
            variant="outline" 
            size="sm"
            className={showAdditionalRequests ? "bg-blue-50 border-blue-300" : ""}
          >
            <Clock className="w-4 h-4 ml-1" /> طلبات الإضافة
          </Button>
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

      {/* Additional Property Requests Section */}
      {showAdditionalRequests && (
        <Card className="p-4 border-blue-300 bg-blue-50">
          <h3 className="font-bold text-blue-800 mb-4 flex items-center gap-2">
            <Home className="w-5 h-5" />
            طلبات إضافة عقارات إضافية (في انتظار الموافقة)
          </h3>
          
          {additionalRequestsLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              جاري التحميل...
            </div>
          ) : additionalRequests && additionalRequests.length > 0 ? (
            <div className="space-y-3">
              {additionalRequests.map((req: any) => (
                <div key={req.propertyNumber} className="bg-white p-3 rounded-lg border border-blue-200">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-4">
                      <div>
                        <p className="font-bold">{req.propertyNumber}</p>
                        <p className="text-xs text-muted-foreground">{req.name} - {req.city}</p>
                        <p className="text-xs text-blue-600 mt-1">
                          مضاف من العقار: {req.pendingApprovalFrom} ({req.mainPropertyName})
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        onClick={() => approveAdditionalMutation.mutate(req.propertyNumber)}
                        disabled={approveAdditionalMutation.isPending}
                        className="bg-green-600 hover:bg-green-700"
                      >
                        {approveAdditionalMutation.isPending &&
                          approveAdditionalMutation.variables === req.propertyNumber ? (
                          <Loader2 className="w-4 h-4 ml-1 animate-spin" />
                        ) : (
                          <Check className="w-4 h-4 ml-1" />
                        )}
                        موافقة
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          if (confirm("هل أنت متأكد من رفض هذا الطلب؟")) {
                            rejectAdditionalMutation.mutate({ propertyNumber: req.propertyNumber });
                          }
                        }}
                        disabled={rejectAdditionalMutation.isPending}
                        className="border-red-300 text-red-600 hover:bg-red-50"
                      >
                        <X className="w-4 h-4 ml-1" /> رفض
                      </Button>
                    </div>
                  </div>
                  {additionalApprovalErrors[req.propertyNumber] && (
                    <div
                      role="alert"
                      className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800"
                    >
                      <p className="font-semibold">
                        {additionalApprovalErrors[req.propertyNumber].partial
                          ? "قد يكون القبول نُفّذ جزئياً؛ حدّث الصفحة وراجع حالة العقارين قبل إعادة المحاولة."
                          : "سبب تعذر القبول:"}
                      </p>
                      <p className="mt-1">
                        {additionalApprovalErrors[req.propertyNumber].message}
                      </p>
                      {additionalApprovalErrors[req.propertyNumber].warnings.length > 0 && (
                        <p className="mt-1 text-amber-800">
                          {additionalApprovalErrors[req.propertyNumber].warnings.join("، ")}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">لا توجد طلبات في انتظار الموافقة</p>
          )}
        </Card>
      )}

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
                  <Th>العقارات المضافة (عدد)</Th>
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
                    <div className="flex flex-col gap-1">
                      {(() => {
                        const displayType = getSubscriptionTypeLabel(p.subscriptionType);
                        const statusLabel = p.subscriptionStatus ? normalizeSubscriptionStatus(p.subscriptionStatus) : "";
                        const isPremium = isPremiumSubscriptionType(displayType);
                        return (
                          <>
                            <span className={`px-2 py-0.5 rounded text-xs inline-flex items-center gap-1 ${isPremium ? "bg-primary/20 text-primary" : "bg-muted"}`}>
                              {displayType}
                            </span>
                            {statusLabel && (
                              <span className="text-[11px] text-muted-foreground">
                                حالة الاشتراك: {statusLabel}
                              </span>
                            )}
                          </>
                        );
                      })()}
                      {p.linkedProperty && (
                        <button
                          onClick={async () => {
                            try {
                              const linkedProp = p.linkedProperty!;
                              const res = await fetch(`/api/admin/property/${linkedProp}/subscription`);
                              const data = await res.json();
                              setLinkedPropertyView({ propertyNumber: linkedProp, subscription: data });
                            } catch (err) {
                              console.error("Failed to fetch linked property subscription:", err);
                            }
                          }}
                          className="text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 dark:hover:text-blue-300 flex items-center gap-1"
                        >
                          <Link className="w-3 h-3" />
                          مربوط بـ: {p.linkedProperty}
                        </button>
                      )}
                    </div>
                  </Td>
                  <Td>
                    {(p as any).linkedPropertyCount > 0 ? (
                      <button
                        onClick={async () => {
                          setLinkedPropertiesList({ propertyNumber: p.propertyNumber, data: [], loading: true });
                          try {
                            const res = await fetch(`/api/admin/properties/${p.propertyNumber}/linked-properties`);
                            const result = await res.json();
                            setLinkedPropertiesList({ propertyNumber: p.propertyNumber, data: result.data || [], loading: false });
                          } catch (err) {
                            setLinkedPropertiesList({ propertyNumber: p.propertyNumber, data: [], loading: false });
                          }
                        }}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-amber-100 text-amber-800 hover:bg-amber-200 transition text-xs font-medium"
                      >
                        <Link className="w-3 h-3" />
                        {(p as any).linkedPropertyCount}
                      </button>
                    ) : p.linkedProperty ? (
                      <Badge variant="secondary" className="bg-blue-100 text-blue-800 text-xs">
                        <Link className="w-3 h-3" />
                        مضاف
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
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
                  <Td colSpan={7}>
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
                      maxLength={30}
                      data-testid="input-name"
                    />
                    <span className="text-xs text-muted-foreground">{editing.name?.length || 0}/30 حرف</span>
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
                      onValueChange={(v) => { if (v) setEditing({ ...editing, city: v }); }}
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
                      onValueChange={(v) => { if (v) setEditing({ ...editing, direction: v }); }}
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

      {/* Linked Property Subscription Details */}
      <Dialog open={!!linkedPropertyView} onOpenChange={() => setLinkedPropertyView(null)}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Home className="w-5 h-5 text-blue-500" />
              بيانات العقار المربوط
            </DialogTitle>
            <DialogDescription>
              معلومات الاشتراك للعقار رقم: {linkedPropertyView?.propertyNumber}
            </DialogDescription>
          </DialogHeader>
          {linkedPropertyView?.subscription?.found ? (
            <div className="space-y-3 mt-4">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">اسم العقار:</span>
                <span className="font-medium">{linkedPropertyView.subscription.property?.name || '-'}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">المدينة:</span>
                <span className="font-medium">{linkedPropertyView.subscription.property?.city || '-'}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">نوع الاشتراك:</span>
                <span className={`font-medium px-2 py-0.5 rounded text-xs ${
                  isPremiumSubscriptionType(linkedPropertyView.subscription.subscription.subscriptionType)
                    ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                    : 'bg-muted'
                }`}>
                  {getSubscriptionTypeLabel(linkedPropertyView.subscription.subscription.subscriptionType)}
                </span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">الحالة:</span>
                <span className={`font-medium ${
                  linkedPropertyView.subscription.subscription.status === 'نشط' || 
                  linkedPropertyView.subscription.subscription.status === 'ساري'
                    ? 'text-green-600'
                    : 'text-red-600'
                }`}>
                  {linkedPropertyView.subscription.subscription.status === 'نشط' ? 'نشط' : 
                   linkedPropertyView.subscription.subscription.status === 'ساري' ? 'ساري' :
                   linkedPropertyView.subscription.subscription.status === 'منتهي' ? 'منتهي' :
                   linkedPropertyView.subscription.subscription.status || '-'}
                </span>
              </div>
              {linkedPropertyView.subscription.subscription.startDate && (
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">من:</span>
                  <span className="font-medium">
                    {new Date(linkedPropertyView.subscription.subscription.startDate).toLocaleDateString('en-US', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' })}
                  </span>
                </div>
              )}
              {linkedPropertyView.subscription.subscription.endDate && (
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">إلى:</span>
                  <span className="font-medium">
                    {new Date(linkedPropertyView.subscription.subscription.endDate).toLocaleDateString('en-US', { timeZone: 'Asia/Riyadh', year: 'numeric', month: '2-digit', day: '2-digit' })}
                  </span>
                </div>
              )}
              {(() => {
                const endDate = linkedPropertyView?.subscription?.subscription?.endDate 
                  ? new Date(linkedPropertyView.subscription.subscription.endDate) 
                  : null;
                const today = new Date();
                if (endDate) {
                  const diffTime = endDate.getTime() - today.getTime();
                  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                  if (diffDays >= 0) {
                    return (
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">متبقي:</span>
                        <span className="font-medium text-green-600">{diffDays} يوم</span>
                      </div>
                    );
                  } else {
                    return (
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">منذ:</span>
                        <span className="font-medium text-red-600">{Math.abs(diffDays)} يوم</span>
                      </div>
                    );
                  }
                }
                return null;
              })()}
            </div>
          ) : (
            <div className="text-center py-4 text-muted-foreground">
              <p>لا توجد بيانات اشتراك للعقار المربوط</p>
            </div>
          )}
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setLinkedPropertyView(null)}>إغلاق</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Linked Properties List Dialog */}
      <Dialog open={!!linkedPropertiesList} onOpenChange={() => setLinkedPropertiesList(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Link className="w-5 h-5 text-primary" />
              العقارات المضافة للعقار رقم: {linkedPropertiesList?.propertyNumber}
            </DialogTitle>
            <DialogDescription>
              إدارة العقارات المضافة المرتبطة بهذا العقار
            </DialogDescription>
          </DialogHeader>
          {linkedPropertiesList && (
            <div className="space-y-3">
              {linkedPropertiesList.loading ? (
                <div className="flex items-center justify-center gap-2 text-muted-foreground py-8">
                  <Loader2 className="w-5 h-5 animate-spin" />
                  جاري التحميل...
                </div>
              ) : linkedPropertiesList.data.length === 0 ? (
                <div className="text-center text-muted-foreground py-8">
                  <Link className="w-12 h-12 mx-auto mb-3 text-muted-foreground/50" />
                  <p className="text-lg font-medium mb-1">لا توجد عقارات مضافة</p>
                  <p className="text-sm">هذا العقار ليس لديه عقارات إضافية مرتبطة به</p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-right">
                    <tr>
                      <Th>رقم العقار</Th>
                      <Th>الاسم</Th>
                      <Th>المدينة</Th>
                      <Th>النوع</Th>
                      <Th>حالة الاشتراك</Th>
                      <Th>تحكم</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {linkedPropertiesList.data.map((lp: any) => (
                      <tr key={lp.propertyNumber} className="border-t hover:bg-muted/30">
                        <Td><span className="font-mono text-primary">#{lp.propertyNumber}</span></Td>
                        <Td>
                          <div className="font-medium">{lp.name}</div>
                          <div className="text-xs text-muted-foreground">{lp.whatsappNumber}</div>
                        </Td>
                        <Td>{lp.city}</Td>
                        <Td>{lp.type}</Td>
                        <Td>
                          <Badge className={lp.subscriptionStatus === 'نشط' ? 'bg-green-100 text-green-800 dark:bg-green-900/30' : 'bg-red-100 text-red-800 dark:bg-red-900/30'}>
                            {lp.subscriptionStatus === 'نشط' ? 'نشط' : lp.subscriptionStatus === 'منتهي' ? 'منتهي' : lp.subscriptionStatus || 'غير نشط'}
                          </Badge>
                        </Td>
                        <Td>
                          <div className="flex items-center gap-1">
                            <Button
                              size="icon" variant="ghost"
                              onClick={() => {
                                setLinkedPropertyView({
                                  propertyNumber: lp.propertyNumber,
                                  subscription: {
                                    found: true,
                                    propertyNumber: lp.propertyNumber,
                                    subscription: {
                                      subscriptionType: lp.subscriptionType,
                                      status: lp.subscriptionStatus,
                                      startDate: lp.startDate,
                                      endDate: lp.endDate,
                                      packageId: lp.packageId,
                                    },
                                    property: {
                                      name: lp.name,
                                      city: lp.city,
                                    }
                                  }
                                });
                              }}
                              title="عرض التفاصيل"
                            >
                              <Eye className="w-4 h-4 text-blue-500" />
                            </Button>
                          </div>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
    )}
    </section>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-3 py-2 text-[11px] md:text-xs font-bold">{children}</th>;
}

function Td({ children, colSpan }: { children: React.ReactNode; colSpan?: number }) {
  return <td colSpan={colSpan} className="px-3 py-2 whitespace-nowrap">{children}</td>;
}
