"use client";
// client/src/pages/admin/sections/packages.tsx
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Loader2, Pencil, Plus, Package, Puzzle, Star, Zap, Pin, ShieldCheck, Trash2, GripVertical, ArrowUp, ArrowDown, Sparkles, Search } from "lucide-react";
import { Th, Td } from "../components/Table";
import { useToast } from "@/hooks/use-toast";
import { MAX_ACTIVE_SUBSCRIPTION_PACKAGE_DAYS } from "@shared/subscriptionPackagePolicy";
import { normalizePackageFeatures, type PackageFeature } from "@shared/packageFeatures";
import {
  PACKAGE_ICON_CATEGORIES,
  PACKAGE_ICON_LIBRARY,
  getPackageIconLabel,
} from "@shared/packageIcons";
import { PackageIcon } from "@/components/package-icon";
import {
  PACKAGE_AUDIENCES,
  normalizePackageAudience,
  type PackageAudience,
} from "@shared/packageAudience";

type AdminPackage = {
  id: string;
  name: string;
  price: number;
  pricePerProperty?: number;
  durationDays: number;
  isActive: boolean;
  audience?: PackageAudience;
  description?: string;
  propertyCount?: number;
  maxProperties?: number;
  type?: string;
  features?: PackageFeature[];
  monthlyPrice?: number;
  quarterlyPrice?: number;
  monthlyDiscountPercent?: number;
  quarterlyDiscountPercent?: number;
  monthlyEnabled?: boolean;
  quarterlyEnabled?: boolean;
  quarterlyDurationDays?: number;
  isVisible?: boolean;
  sortOrder?: number;
  featuredBadge?: string;
  isRecommended?: boolean;
  discountStartsAt?: string;
  discountEndsAt?: string;
  archived?: boolean;
};

type AddOnPackage = {
  id: string;
  name: string;
  description: string;
  price: number;
  durationDays: number;
  isActive: boolean;
  category: string;
  createdAt: string;
};

const ADDON_CATEGORIES = [
  { value: "اعلان", label: "اعلان", icon: Star, color: "bg-amber-500" },
  { value: "ابراز", label: "ابراز", icon: Zap, color: "bg-purple-500" },
  { value: "تثبيت", label: "تثبيت", icon: Pin, color: "bg-blue-500" },
  { value: "توثيق", label: "توثيق", icon: ShieldCheck, color: "bg-emerald-500" },
];

async function getApiError(response: Response, fallback: string): Promise<string> {
  try {
    const body = await response.json();
    return typeof body?.error === "string" ? body.error : fallback;
  } catch {
    return fallback;
  }
}

function discountedPrice(price: number, discountPercent: number): number {
  const safePercent = Math.min(100, Math.max(0, Number(discountPercent) || 0));
  return Math.round(Math.max(0, price - (price * safePercent) / 100) * 100) / 100;
}

export default function PackagesSection() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("regular");
  
  // Regular packages state
  const [editingPackage, setEditingPackage] = useState<AdminPackage | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [iconPicker, setIconPicker] = useState<{
    open: boolean;
    featureIndex: number | null;
    search: string;
    category: string;
    selected: string;
  }>({
    open: false,
    featureIndex: null,
    search: "",
    category: "all",
    selected: "",
  });

  const updateFeature = (index: number, patch: Partial<PackageFeature>) => {
    setEditingPackage((previous) => {
      if (!previous) return previous;
      const features = (previous.features || []).map((feature, featureIndex) =>
        featureIndex === index ? { ...feature, ...patch } : feature,
      );
      return { ...previous, features };
    });
  };

  const addFeature = () => {
    setEditingPackage((previous) =>
      previous
        ? { ...previous, features: [...(previous.features || []), { text: "" }] }
        : previous,
    );
  };

  const removeFeature = (index: number) => {
    setEditingPackage((previous) =>
      previous
        ? {
            ...previous,
            features: (previous.features || []).filter(
              (_feature, featureIndex) => featureIndex !== index,
            ),
          }
        : previous,
    );
  };

  const moveFeature = (from: number, to: number) => {
    if (from === to) return;
    setEditingPackage((previous) => {
      if (!previous) return previous;
      const features = [...(previous.features || [])];
      if (from < 0 || from >= features.length || to < 0 || to >= features.length) {
        return previous;
      }
      const [moved] = features.splice(from, 1);
      features.splice(to, 0, moved);
      return { ...previous, features };
    });
  };

  const openIconPicker = (featureIndex: number) => {
    const feature = editingPackage?.features?.[featureIndex];
    setIconPicker({
      open: true,
      featureIndex,
      search: "",
      category: "all",
      selected: feature?.icon || "",
    });
  };

  const confirmIconSelection = () => {
    if (iconPicker.featureIndex === null || !iconPicker.selected) return;
    updateFeature(iconPicker.featureIndex, { icon: iconPicker.selected });
    setIconPicker((previous) => ({ ...previous, open: false }));
  };

  const clearFeatureIcon = () => {
    if (iconPicker.featureIndex === null) return;
    updateFeature(iconPicker.featureIndex, { icon: undefined });
    setIconPicker((previous) => ({ ...previous, open: false }));
  };

  // Add-on packages state
  const [editingAddOn, setEditingAddOn] = useState<AddOnPackage | null>(null);
  const [isNewAddOn, setIsNewAddOn] = useState(false);

  // Fetch regular packages
  const { data: regularPackages, isLoading: regularLoading } = useQuery<AdminPackage[]>({
    queryKey: ["admin-packages"],
    queryFn: async () => {
      const res = await fetch("/api/admin/packages");
      if (!res.ok) throw new Error("فشل في جلب الباقات");
      return res.json();
    },
  });

  // Fetch add-on packages
  const { data: addOnPackages, isLoading: addOnLoading } = useQuery<AddOnPackage[]>({
    queryKey: ["admin-addon-packages"],
    queryFn: async () => {
      const res = await fetch("/api/admin/addons");
      if (!res.ok) throw new Error("فشل في جلب باقات الإضافات");
      return res.json();
    },
  });

  // Regular package mutation
  const regularMutation = useMutation({
    mutationFn: async (payload: AdminPackage) => {
      if (isNew) {
        const res = await fetch("/api/admin/packages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(await getApiError(res, "فشل في إنشاء الباقة"));
      } else {
        const res = await fetch(`/api/admin/packages/${payload.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error(await getApiError(res, "فشل في تحديث الباقة"));
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-packages"] });
      setEditingPackage(null);
      toast({ title: isNew ? "تم إنشاء الباقة بنجاح" : "تم تحديث الباقة بنجاح" });
    },
    onError: (error: Error) => {
      toast({ title: "خطأ", description: error.message, variant: "destructive" });
    },
  });

  // Archive (soft delete) a regular package
  const archiveMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/admin/packages/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await getApiError(res, "فشل في أرشفة الباقة"));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-packages"] });
      setEditingPackage(null);
      toast({ title: "تمت أرشفة الباقة" });
    },
    onError: (error: Error) => {
      toast({ title: "خطأ", description: error.message, variant: "destructive" });
    },
  });

  // Add-on package mutation
  const addOnMutation = useMutation({
    mutationFn: async (payload: AddOnPackage) => {
      if (isNewAddOn) {
        const res = await fetch("/api/admin/addons/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error("فشل في إنشاء باقة الإضافة");
        return res.json();
      } else {
        const res = await fetch(`/api/admin/addons/${payload.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error("فشل في تحديث باقة الإضافة");
        return res.json();
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-addon-packages"] });
      setEditingAddOn(null);
      toast({ title: isNewAddOn ? "تم إنشاء باقة الإضافة بنجاح" : "تم تحديث باقة الإضافة بنجاح" });
    },
    onError: (error: Error) => {
      toast({ title: "خطأ", description: error.message, variant: "destructive" });
    },
  });

  const startNewRegular = () => {
    setIsNew(true);
    setEditingPackage({
      id: "",
      name: "",
      price: 0,
      monthlyPrice: 0,
      quarterlyPrice: 0,
      monthlyDiscountPercent: 0,
      quarterlyDiscountPercent: 0,
      monthlyEnabled: true,
      quarterlyEnabled: false,
      quarterlyDurationDays: 90,
      durationDays: 30,
      isActive: true,
      audience: "both",
      isVisible: true,
      sortOrder: 0,
      featuredBadge: "",
      isRecommended: false,
      discountStartsAt: "",
      discountEndsAt: "",
      type: "عادي",
      features: [],
      description: "",
    });
  };

  const startNewAddOn = () => {
    setIsNewAddOn(true);
    setEditingAddOn({
      id: "",
      name: "",
      description: "",
      price: 0,
      durationDays: 30,
      isActive: true,
      category: "اعلان",
      createdAt: "",
    });
  };

  const getCategoryInfo = (category: string) => {
    return ADDON_CATEGORIES.find(c => c.value === category) || ADDON_CATEGORIES[0];
  };

  const iconSearch = iconPicker.search.trim().toLowerCase();
  const filteredPackageIcons = PACKAGE_ICON_LIBRARY.filter((icon) => {
    const matchesCategory =
      iconPicker.category === "all" || icon.category === iconPicker.category;
    const haystack = `${icon.name} ${icon.label} ${icon.categoryLabel}`.toLowerCase();
    return matchesCategory && (!iconSearch || haystack.includes(iconSearch));
  });
  const selectedIconLabel = iconPicker.selected
    ? getPackageIconLabel(iconPicker.selected)
    : "";

  return (
    <section className="space-y-3" dir="rtl">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">إدارة الباقات</h2>
          <p className="text-xs text-muted-foreground">
            إدارة باقات الاشتراك وباقات الإضافات
          </p>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2 max-w-md">
          <TabsTrigger value="regular" className="gap-2" data-testid="tab-regular-packages">
            <Package className="w-4 h-4" />
            باقات الاشتراك
          </TabsTrigger>
          <TabsTrigger value="addons" className="gap-2" data-testid="tab-addon-packages">
            <Puzzle className="w-4 h-4" />
            باقات الإضافات
          </TabsTrigger>
        </TabsList>

        {/* Regular Packages Tab */}
        <TabsContent value="regular" className="space-y-3 mt-4">
          <div className="flex justify-end">
            <Button size="sm" onClick={startNewRegular} data-testid="button-new-regular-package">
              <Plus className="w-4 h-4 ml-1" /> باقة جديدة
            </Button>
          </div>

          <Card className="overflow-x-auto">
            {regularLoading ? (
              <div className="p-4 flex items-center gap-2 text-muted-foreground text-sm">
                <Loader2 className="w-4 h-4 animate-spin" />
                جاري تحميل الباقات...
              </div>
            ) : (
              <table className="w-full text-xs md:text-sm" dir="rtl">
                <thead className="bg-muted/50">
                  <tr>
                    <Th>اسم الباقة</Th>
                    <Th>شهري</Th>
                    <Th>3 أشهر</Th>
                    <Th>المدة</Th>
                    <Th>الحالة</Th>
                    <Th>الظهور</Th>
                    <Th>الترتيب</Th>
                    <Th>الشارة</Th>
                    <Th>تحكم</Th>
                  </tr>
                </thead>
                <tbody>
                  {(regularPackages || []).map((pkg) => {
                    const monthlyPrice = pkg.monthlyPrice ?? pkg.price ?? 0;
                    const monthlyDiscount = pkg.monthlyDiscountPercent ?? 0;
                    const quarterlyPrice = pkg.quarterlyPrice ?? 0;
                    const quarterlyDiscount = pkg.quarterlyDiscountPercent ?? 0;
                    return (
                      <tr
                        key={pkg.id}
                        className={`border-t hover:bg-muted/40 ${pkg.archived ? "opacity-60" : ""}`}
                      >
                        <Td className="font-medium">
                          {pkg.name}
                          {pkg.isRecommended && (
                            <Badge className="mr-1 bg-[#29372f] text-[10px] text-white">
                              موصى بها
                            </Badge>
                          )}
                          {pkg.archived && (
                            <Badge variant="secondary" className="mr-1 text-[10px]">
                              مؤرشفة
                            </Badge>
                          )}
                          <div className="mt-0.5 text-[10px] text-muted-foreground">
                            {
                              PACKAGE_AUDIENCES.find(
                                (audience) =>
                                  audience.value ===
                                  normalizePackageAudience(pkg.audience),
                              )?.label
                            }
                          </div>
                        </Td>
                        <Td>
                          <div className="font-bold">{monthlyPrice} ر.س</div>
                          {monthlyDiscount > 0 && (
                            <>
                              <div className="text-[10px] text-emerald-700">
                                خصم {monthlyDiscount}%
                              </div>
                              <div className="text-[10px] text-muted-foreground">
                                بعد الخصم {discountedPrice(monthlyPrice, monthlyDiscount)} ر.س
                              </div>
                            </>
                          )}
                          {pkg.monthlyEnabled === false && (
                            <div className="text-[10px] text-muted-foreground">موقوف</div>
                          )}
                        </Td>
                        <Td>
                          {pkg.quarterlyEnabled && quarterlyPrice > 0 ? (
                            <>
                              <div className="font-bold">{quarterlyPrice} ر.س</div>
                              {quarterlyDiscount > 0 && (
                                <>
                                  <div className="text-[10px] text-emerald-700">
                                    خصم {quarterlyDiscount}%
                                  </div>
                                  <div className="text-[10px] text-muted-foreground">
                                    بعد الخصم {discountedPrice(quarterlyPrice, quarterlyDiscount)} ر.س
                                  </div>
                                </>
                              )}
                            </>
                          ) : (
                            <span className="text-[11px] text-muted-foreground">غير مفعّل</span>
                          )}
                        </Td>
                        <Td>
                          <div>{pkg.durationDays} يوم</div>
                          {pkg.quarterlyEnabled && (
                            <div className="text-[10px] text-muted-foreground">
                              {pkg.quarterlyDurationDays ?? 90} يوم / 3 أشهر
                            </div>
                          )}
                        </Td>
                        <Td>
                          <Badge variant={pkg.isActive ? "default" : "secondary"}>
                            {pkg.isActive ? "مفعّلة" : "معطّلة"}
                          </Badge>
                        </Td>
                        <Td>
                          <Badge
                            variant="outline"
                            className={
                              pkg.isVisible === false
                                ? "text-muted-foreground"
                                : "text-emerald-700"
                            }
                          >
                            {pkg.isVisible === false ? "مخفية" : "ظاهرة"}
                          </Badge>
                        </Td>
                        <Td>{pkg.sortOrder ?? 0}</Td>
                        <Td className="max-w-[8rem] truncate">{pkg.featuredBadge || "-"}</Td>
                        <Td>
                          <div className="flex items-center gap-1">
                            <Button
                              size="icon"
                              variant="ghost"
                              onClick={() => {
                                setIsNew(false);
                                setEditingPackage({
                                  ...pkg,
                                  features: normalizePackageFeatures(pkg.features),
                                  audience: normalizePackageAudience(pkg.audience),
                                });
                              }}
                              data-testid={`button-edit-package-${pkg.id}`}
                            >
                              <Pencil className="w-4 h-4" />
                            </Button>
                            {!pkg.archived && (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="text-destructive"
                                onClick={() => archiveMutation.mutate(pkg.id)}
                                title="أرشفة الباقة"
                                data-testid={`button-archive-package-${pkg.id}`}
                              >
                                <Trash2 className="w-4 h-4" />
                              </Button>
                            )}
                          </div>
                        </Td>
                      </tr>
                    );
                  })}

                  {(regularPackages || []).length === 0 && (
                    <tr>
                      <Td colSpan={9}>
                        <div className="p-4 text-center text-xs text-muted-foreground">
                          لا توجد باقات مسجلة حالياً.
                        </div>
                      </Td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </Card>
        </TabsContent>

        {/* Add-on Packages Tab */}
        <TabsContent value="addons" className="space-y-3 mt-4">
          <div className="flex justify-end">
            <Button size="sm" onClick={startNewAddOn} data-testid="button-new-addon-package">
              <Plus className="w-4 h-4 ml-1" /> باقة إضافية جديدة
            </Button>
          </div>

          <Card className="overflow-x-auto">
            {addOnLoading ? (
              <div className="p-4 flex items-center gap-2 text-muted-foreground text-sm">
                <Loader2 className="w-4 h-4 animate-spin" />
                جاري تحميل باقات الإضافات...
              </div>
            ) : (
              <table className="w-full text-xs md:text-sm" dir="rtl">
                <thead className="bg-muted/50">
                  <tr>
                    <Th>اسم الباقة</Th>
                    <Th>الفئة</Th>
                    <Th>السعر (ريال)</Th>
                    <Th>المدة (يوم)</Th>
                    <Th>الحالة</Th>
                    <Th>الوصف</Th>
                    <Th>تحكم</Th>
                  </tr>
                </thead>
                <tbody>
                  {(addOnPackages || []).map((pkg) => {
                    const catInfo = getCategoryInfo(pkg.category);
                    return (
                      <tr key={pkg.id} className="border-t hover:bg-muted/40">
                        <Td className="font-medium">{pkg.name}</Td>
                        <Td>
                          <Badge variant="secondary" className={`${catInfo.color} text-white`}>
                            {pkg.category}
                          </Badge>
                        </Td>
                        <Td>{pkg.price}</Td>
                        <Td>{pkg.durationDays}</Td>
                        <Td>
                          <Badge variant={pkg.isActive ? "default" : "secondary"}>
                            {pkg.isActive ? "مفعّل" : "معطّل"}
                          </Badge>
                        </Td>
                        <Td className="max-w-xs truncate">{pkg.description || "-"}</Td>
                        <Td>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => {
                              setIsNewAddOn(false);
                              setEditingAddOn(pkg);
                            }}
                            data-testid={`button-edit-addon-${pkg.id}`}
                          >
                            <Pencil className="w-4 h-4" />
                          </Button>
                        </Td>
                      </tr>
                    );
                  })}

                  {(addOnPackages || []).length === 0 && (
                    <tr>
                      <Td colSpan={7}>
                        <div className="p-4 text-center text-xs text-muted-foreground">
                          لا توجد باقات إضافات مسجلة حالياً. أضف باقة جديدة للبدء.
                        </div>
                      </Td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </Card>
        </TabsContent>
      </Tabs>

      {/* Regular Package Dialog */}
      <Dialog open={!!editingPackage} onOpenChange={() => setEditingPackage(null)}>
        <DialogContent className="max-h-[90vh] max-w-md overflow-y-auto lg:!flex lg:w-[calc(100%-2rem)] lg:max-w-5xl lg:flex-col lg:gap-6 lg:overflow-hidden lg:p-8 xl:max-w-6xl 2xl:max-w-7xl" dir="rtl" data-testid="package-edit-dialog">
          <DialogHeader className="lg:shrink-0">
            <DialogTitle>{isNew ? "إضافة باقة اشتراك" : "تعديل الباقة"}</DialogTitle>
          </DialogHeader>

          {editingPackage && (
            <div className="lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-1">
              <div className="grid gap-4 text-xs lg:grid-cols-2 lg:gap-6" data-testid="package-form-grid">
              {/* البيانات الأساسية */}
              <div className="space-y-2 rounded-xl border p-3 lg:col-span-2">
                <p className="text-xs font-bold">البيانات الأساسية</p>
                <div>
                  <label className="block text-[11px] font-semibold text-muted-foreground mb-1">
                    اسم الباقة
                  </label>
                  <Input
                    value={editingPackage.name}
                    onChange={(e) => setEditingPackage({ ...editingPackage, name: e.target.value })}
                    data-testid="input-package-name"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-muted-foreground mb-1">
                    الوصف
                  </label>
                  <Input
                    value={editingPackage.description || ""}
                    onChange={(e) => setEditingPackage({ ...editingPackage, description: e.target.value })}
                    data-testid="input-package-description"
                  />
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <label className="block text-[11px] font-semibold text-muted-foreground">
                      المميزات
                    </label>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={addFeature}
                      data-testid="button-add-feature"
                    >
                      <Plus className="w-4 h-4 ml-1" />
                      إضافة ميزة
                    </Button>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    اسحب الميزة من المقبض لإعادة الترتيب، أو استخدم الأسهم. اختر أيقونة لكل ميزة.
                  </p>
                  <div className="space-y-2">
                    {(editingPackage.features || []).map((feature, index) => {
                      const iconName = feature.icon || "";
                      const iconLabel = iconName ? getPackageIconLabel(iconName) : "تلقائي";
                      return (
                        <div
                          key={index}
                          className="rounded-lg border bg-muted/20 p-2"
                          data-testid={`feature-row-${index}`}
                          onDragOver={(event) => event.preventDefault()}
                          onDrop={(event) => {
                            event.preventDefault();
                            const from = Number(event.dataTransfer.getData("text/plain"));
                            if (Number.isInteger(from)) moveFeature(from, index);
                          }}
                        >
                          <div className="flex items-center gap-2">
                            <div className="flex flex-col gap-0.5">
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="h-6 w-6"
                                disabled={index === 0}
                                onClick={() => moveFeature(index, index - 1)}
                                title="تحريك لأعلى"
                                data-testid={`button-feature-up-${index}`}
                              >
                                <ArrowUp className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="h-6 w-6"
                                disabled={index === (editingPackage.features || []).length - 1}
                                onClick={() => moveFeature(index, index + 1)}
                                title="تحريك لأسفل"
                                data-testid={`button-feature-down-${index}`}
                              >
                                <ArrowDown className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                            <div
                              draggable
                              onDragStart={(event) => {
                                event.dataTransfer.setData("text/plain", String(index));
                                event.dataTransfer.effectAllowed = "move";
                              }}
                              className="cursor-grab text-muted-foreground active:cursor-grabbing"
                              title="اسحب لإعادة الترتيب"
                              data-testid={`feature-drag-${index}`}
                            >
                              <GripVertical className="h-4 w-4" />
                            </div>
                            <Input
                              value={feature.text}
                              onChange={(event) =>
                                updateFeature(index, { text: event.target.value })
                              }
                              placeholder="اسم الميزة"
                              className="min-w-0 flex-1"
                              data-testid={`input-feature-text-${index}`}
                            />
                            <Button
                              type="button"
                              variant="outline"
                              className="min-w-0 gap-1 px-2"
                              onClick={() => openIconPicker(index)}
                              title="اختيار الأيقونة"
                              data-testid={`button-feature-icon-${index}`}
                            >
                              {iconName ? (
                                <PackageIcon name={iconName} className="h-4 w-4" />
                              ) : (
                                <Sparkles className="h-4 w-4 text-muted-foreground" />
                              )}
                              <span className="hidden max-w-24 truncate text-[11px] sm:inline">
                                {iconLabel}
                              </span>
                            </Button>
                            <Button
                              type="button"
                              size="icon"
                              variant="ghost"
                              className="text-destructive"
                              onClick={() => removeFeature(index)}
                              title="حذف الميزة"
                              data-testid={`button-feature-delete-${index}`}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                    {(editingPackage.features || []).length === 0 && (
                      <p className="rounded-lg border border-dashed p-3 text-center text-[11px] text-muted-foreground">
                        لا توجد مميزات بعد. اضغط «إضافة ميزة».
                      </p>
                    )}
                  </div>
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-muted-foreground mb-1">
                    نوع الباقة
                  </label>
                  <Select
                    value={editingPackage.type || "عادي"}
                    onValueChange={(value) => setEditingPackage({ ...editingPackage, type: value })}
                  >
                    <SelectTrigger data-testid="select-package-type">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="عادي">عادي</SelectItem>
                      <SelectItem value="مميز">مميز</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* الاشتراك الشهري */}
              <div className="space-y-2 rounded-xl border p-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold">الاشتراك الشهري</p>
                  <Switch
                    checked={editingPackage.monthlyEnabled !== false}
                    onCheckedChange={(checked) =>
                      setEditingPackage({ ...editingPackage, monthlyEnabled: checked })
                    }
                    data-testid="switch-package-monthly-enabled"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] font-semibold text-muted-foreground mb-1">
                      السعر الشهري (ريال)
                    </label>
                    <Input
                      type="number"
                      min={0}
                      value={editingPackage.monthlyPrice ?? editingPackage.price ?? 0}
                      onChange={(e) => {
                        const value = Number(e.target.value || 0);
                        setEditingPackage({
                          ...editingPackage,
                          monthlyPrice: value,
                          price: value,
                        });
                      }}
                      data-testid="input-package-monthly-price"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-muted-foreground mb-1">
                      خصم الشهري (%)
                    </label>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={editingPackage.monthlyDiscountPercent ?? 0}
                      onChange={(e) =>
                        setEditingPackage({
                          ...editingPackage,
                          monthlyDiscountPercent: Math.min(100, Math.max(0, Number(e.target.value || 0))),
                        })
                      }
                      data-testid="input-package-monthly-discount"
                    />
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground" data-testid="preview-monthly-final">
                  السعر بعد الخصم: {discountedPrice(
                    editingPackage.monthlyPrice ?? editingPackage.price ?? 0,
                    editingPackage.monthlyDiscountPercent ?? 0,
                  )} ر.س
                </p>
                <div>
                  <label className="block text-[11px] font-semibold text-muted-foreground mb-1">
                    مدة الشهر (يوم)
                  </label>
                  <Input
                    type="number"
                    min={1}
                    max={editingPackage.isActive ? MAX_ACTIVE_SUBSCRIPTION_PACKAGE_DAYS : undefined}
                    value={editingPackage.durationDays}
                    onChange={(e) =>
                      setEditingPackage({ ...editingPackage, durationDays: Number(e.target.value || 0) })
                    }
                    data-testid="input-package-duration"
                  />
                </div>
              </div>

              {/* اشتراك ثلاثة أشهر */}
              <div className="space-y-2 rounded-xl border p-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-bold">اشتراك ثلاثة أشهر</p>
                  <Switch
                    checked={editingPackage.quarterlyEnabled === true}
                    onCheckedChange={(checked) =>
                      setEditingPackage({ ...editingPackage, quarterlyEnabled: checked })
                    }
                    data-testid="switch-package-quarterly-enabled"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] font-semibold text-muted-foreground mb-1">
                      سعر 3 أشهر (ريال)
                    </label>
                    <Input
                      type="number"
                      min={0}
                      value={editingPackage.quarterlyPrice ?? 0}
                      onChange={(e) =>
                        setEditingPackage({
                          ...editingPackage,
                          quarterlyPrice: Number(e.target.value || 0),
                        })
                      }
                      data-testid="input-package-quarterly-price"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-muted-foreground mb-1">
                      خصم 3 أشهر (%)
                    </label>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      value={editingPackage.quarterlyDiscountPercent ?? 0}
                      onChange={(e) =>
                        setEditingPackage({
                          ...editingPackage,
                          quarterlyDiscountPercent: Math.min(100, Math.max(0, Number(e.target.value || 0))),
                        })
                      }
                      data-testid="input-package-quarterly-discount"
                    />
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground" data-testid="preview-quarterly-final">
                  السعر بعد الخصم: {discountedPrice(
                    editingPackage.quarterlyPrice ?? 0,
                    editingPackage.quarterlyDiscountPercent ?? 0,
                  )} ر.س
                </p>
                <div>
                  <label className="block text-[11px] font-semibold text-muted-foreground mb-1">
                    مدة 3 أشهر (يوم)
                  </label>
                  <Input
                    type="number"
                    min={1}
                    max={MAX_ACTIVE_SUBSCRIPTION_PACKAGE_DAYS}
                    value={editingPackage.quarterlyDurationDays ?? 90}
                    onChange={(e) =>
                      setEditingPackage({
                        ...editingPackage,
                        quarterlyDurationDays: Number(e.target.value || 0),
                      })
                    }
                    data-testid="input-package-quarterly-duration"
                  />
                </div>
              </div>

              {/* العقارات */}
              <div className="space-y-2 rounded-xl border p-3">
                <p className="text-xs font-bold">العقارات</p>
                <div className="grid grid-cols-3 gap-2">
                  <div>
                    <label className="block text-[11px] font-semibold text-muted-foreground mb-1">
                      المشمولة
                    </label>
                    <Input
                      type="number"
                      min={1}
                      value={editingPackage.propertyCount || 1}
                      onChange={(e) =>
                        setEditingPackage({
                          ...editingPackage,
                          propertyCount: Math.max(1, Number(e.target.value || 1)),
                        })
                      }
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-muted-foreground mb-1">
                      سعر الإضافي
                    </label>
                    <Input
                      type="number"
                      value={editingPackage.pricePerProperty || ""}
                      onChange={(e) =>
                        setEditingPackage({
                          ...editingPackage,
                          pricePerProperty: Number(e.target.value || 0) || undefined,
                        })
                      }
                      placeholder="25"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-muted-foreground mb-1">
                      الحد الأقصى
                    </label>
                    <Input
                      type="number"
                      value={editingPackage.maxProperties || ""}
                      onChange={(e) =>
                        setEditingPackage({
                          ...editingPackage,
                          maxProperties: Number(e.target.value || 0) || undefined,
                        })
                      }
                      placeholder="2"
                    />
                  </div>
                </div>
              </div>

              {/* الظهور والترتيب */}
              <div className="space-y-2 rounded-xl border p-3">
                <p className="text-xs font-bold">الظهور والترتيب</p>
                <div className="rounded-lg border border-dashed p-2">
                  <label className="mb-1 block text-[11px] font-semibold text-muted-foreground">
                    مكان ظهور الباقة
                  </label>
                  <Select
                    value={normalizePackageAudience(editingPackage.audience)}
                    onValueChange={(value) =>
                      setEditingPackage({
                        ...editingPackage,
                        audience: value as PackageAudience,
                      })
                    }
                  >
                    <SelectTrigger data-testid="select-package-audience">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PACKAGE_AUDIENCES.map((audience) => (
                        <SelectItem key={audience.value} value={audience.value}>
                          {audience.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    {
                      PACKAGE_AUDIENCES.find(
                        (audience) =>
                          audience.value ===
                          normalizePackageAudience(editingPackage.audience),
                      )?.description
                    }
                  </p>
                </div>
                <div className="flex items-center justify-between">
                  <Label htmlFor="package-active" className="text-xs font-medium">
                    الباقة مفعّلة (تسمح بالاشتراك)
                  </Label>
                  <Switch
                    id="package-active"
                    checked={editingPackage.isActive}
                    onCheckedChange={(checked) =>
                      setEditingPackage({ ...editingPackage, isActive: checked })
                    }
                    data-testid="switch-package-active"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="package-visible" className="text-xs font-medium">
                      ظاهرة في الصفحات المسموحة
                    </Label>
                    <p className="text-[10px] text-muted-foreground">
                      إخفاء الباقة يمنع عرضها دون حذفها.
                    </p>
                  </div>
                  <Switch
                    id="package-visible"
                    checked={editingPackage.isVisible !== false}
                    onCheckedChange={(checked) =>
                      setEditingPackage({ ...editingPackage, isVisible: checked })
                    }
                    data-testid="switch-package-visible"
                  />
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <Label htmlFor="package-recommended" className="text-xs font-medium">
                      موصى بها
                    </Label>
                    <p className="text-[10px] text-muted-foreground">
                      تظهر في منتصف البطاقات باللون الأخضر الداكن.
                    </p>
                  </div>
                  <Switch
                    id="package-recommended"
                    checked={editingPackage.isRecommended === true}
                    onCheckedChange={(checked) =>
                      setEditingPackage({ ...editingPackage, isRecommended: checked })
                    }
                    data-testid="switch-package-recommended"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <label className="block text-[11px] font-semibold text-muted-foreground mb-1">
                      ترتيب العرض
                    </label>
                    <Input
                      type="number"
                      value={editingPackage.sortOrder ?? 0}
                      onChange={(e) =>
                        setEditingPackage({ ...editingPackage, sortOrder: Number(e.target.value || 0) })
                      }
                      data-testid="input-package-sort"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-muted-foreground mb-1">
                      شارة الباقة
                    </label>
                    <Input
                      value={editingPackage.featuredBadge || ""}
                      onChange={(e) =>
                        setEditingPackage({ ...editingPackage, featuredBadge: e.target.value })
                      }
                      placeholder="الأكثر طلبًا"
                      data-testid="input-package-badge"
                    />
                  </div>
                </div>
                <div className="rounded-lg border border-dashed p-2">
                  <p className="mb-2 text-[11px] font-semibold text-muted-foreground">
                    فترة العرض (اختياري)
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] text-muted-foreground mb-1">
                        تبدأ في
                      </label>
                      <Input
                        type="date"
                        value={editingPackage.discountStartsAt || ""}
                        onChange={(e) =>
                          setEditingPackage({
                            ...editingPackage,
                            discountStartsAt: e.target.value,
                          })
                        }
                        data-testid="input-package-discount-start"
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] text-muted-foreground mb-1">
                        تنتهي في
                      </label>
                      <Input
                        type="date"
                        value={editingPackage.discountEndsAt || ""}
                        onChange={(e) =>
                          setEditingPackage({
                            ...editingPackage,
                            discountEndsAt: e.target.value,
                          })
                        }
                        data-testid="input-package-discount-end"
                      />
                    </div>
                  </div>
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    بعد انتهاء التاريخ يعود السعر الأصلي تلقائيًا.
                  </p>
                </div>
              </div>
            </div>
            </div>
          )}

          <div className="mt-4 flex items-center justify-between gap-2 lg:mt-0 lg:shrink-0 lg:border-t lg:bg-background/95 lg:pt-3">
            <div>
              {!isNew && editingPackage && !editingPackage.archived && (
                <Button
                  variant="outline"
                  className="text-destructive"
                  onClick={() => archiveMutation.mutate(editingPackage.id)}
                  disabled={archiveMutation.isPending}
                  data-testid="button-archive-package"
                >
                  <Trash2 className="w-4 h-4 ml-1" />
                  أرشفة
                </Button>
              )}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setEditingPackage(null)}>
                إلغاء
              </Button>
              <Button
                onClick={() => editingPackage && regularMutation.mutate(editingPackage)}
                disabled={regularMutation.isPending}
                data-testid="button-save-package"
              >
                {regularMutation.isPending && <Loader2 className="w-4 h-4 ml-1 animate-spin" />}
                حفظ
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Icon Library Dialog */}
      <Dialog
        open={iconPicker.open}
        onOpenChange={(open) => setIconPicker((previous) => ({ ...previous, open }))}
      >
        <DialogContent className="lg:w-[calc(100%-2rem)] lg:max-w-6xl lg:gap-6 lg:p-8 2xl:max-w-[90rem]" dir="rtl" data-testid="icon-picker-dialog">
          <DialogHeader>
            <DialogTitle>مكتبة الأيقونات</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={iconPicker.search}
                  onChange={(event) =>
                    setIconPicker((previous) => ({ ...previous, search: event.target.value }))
                  }
                  placeholder="ابحث عن أيقونة بالاسم أو الوصف..."
                  className="pr-9"
                  data-testid="input-icon-search"
                />
              </div>
              <Select
                value={iconPicker.category}
                onValueChange={(value) =>
                  setIconPicker((previous) => ({ ...previous, category: value }))
                }
              >
                <SelectTrigger className="w-full sm:w-56">
                  <SelectValue placeholder="التصنيف" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل التصنيفات</SelectItem>
                  {PACKAGE_ICON_CATEGORIES.map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      {category.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid max-h-[52vh] grid-cols-3 gap-2 overflow-y-auto p-1 sm:grid-cols-5 md:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10 2xl:grid-cols-12" data-testid="icon-grid">
              {filteredPackageIcons.map((icon) => {
                const isSelected = iconPicker.selected === icon.name;
                return (
                  <button
                    key={icon.name}
                    type="button"
                    onClick={() =>
                      setIconPicker((previous) => ({ ...previous, selected: icon.name }))
                    }
                    className={`flex min-h-20 flex-col items-center justify-center gap-1 rounded-lg border p-2 text-center transition ${
                      isSelected
                        ? "border-[#29372f] bg-[#29372f]/10 ring-2 ring-[#29372f]/20"
                        : "hover:border-[#29372f]/40"
                    }`}
                    title={icon.name}
                    data-testid={`button-icon-${icon.name}`}
                  >
                    <PackageIcon name={icon.name} className="h-5 w-5" />
                    <span className="text-[10px] font-semibold leading-tight">{icon.label}</span>
                    <span className="text-[9px] text-muted-foreground" dir="ltr">
                      {icon.name}
                    </span>
                  </button>
                );
              })}
              {filteredPackageIcons.length === 0 && (
                <p className="col-span-full p-6 text-center text-sm text-muted-foreground">
                  لا توجد أيقونات مطابقة.
                </p>
              )}
            </div>

            <div className="flex flex-col-reverse gap-2 border-t pt-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-xs text-muted-foreground">
                {iconPicker.selected ? (
                  <>
                    المختارة:{" "}
                    <span className="font-semibold text-foreground">{selectedIconLabel}</span>
                  </>
                ) : (
                  "لم يتم اختيار أيقونة"
                )}
              </div>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={clearFeatureIcon}
                  data-testid="button-clear-icon"
                >
                  استخدام التلقائي
                </Button>
                <Button
                  type="button"
                  onClick={confirmIconSelection}
                  disabled={!iconPicker.selected}
                  data-testid="button-confirm-icon"
                >
                  تأكيد الاختيار
                </Button>
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Add-on Package Dialog */}
      <Dialog open={!!editingAddOn} onOpenChange={() => setEditingAddOn(null)}>
        <DialogContent className="max-w-md lg:max-w-2xl lg:gap-6 lg:p-8" dir="rtl">
          <DialogHeader>
            <DialogTitle>{isNewAddOn ? "إضافة باقة إضافية" : "تعديل باقة الإضافة"}</DialogTitle>
          </DialogHeader>

          {editingAddOn && (
            <div className="space-y-3 text-xs">
              <div>
                <label className="block text-[11px] font-semibold text-muted-foreground mb-1">
                  اسم الباقة
                </label>
                <Input
                  value={editingAddOn.name}
                  onChange={(e) => setEditingAddOn({ ...editingAddOn, name: e.target.value })}
                  placeholder="مثال: إعلان مميز أسبوعي"
                  data-testid="input-addon-name"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-muted-foreground mb-1">
                  الفئة
                </label>
                <Select
                  value={editingAddOn.category}
                  onValueChange={(value) => setEditingAddOn({ ...editingAddOn, category: value })}
                >
                  <SelectTrigger data-testid="select-addon-category">
                    <SelectValue placeholder="اختر الفئة" />
                  </SelectTrigger>
                  <SelectContent>
                    {ADDON_CATEGORIES.map((cat) => (
                      <SelectItem key={cat.value} value={cat.value}>
                        <div className="flex items-center gap-2">
                          <cat.icon className="w-4 h-4" />
                          {cat.label}
                        </div>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-semibold text-muted-foreground mb-1">
                    السعر (ريال)
                  </label>
                  <Input
                    type="number"
                    value={editingAddOn.price}
                    onChange={(e) => setEditingAddOn({ ...editingAddOn, price: Number(e.target.value || 0) })}
                    data-testid="input-addon-price"
                  />
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-muted-foreground mb-1">
                    المدة (يوم)
                  </label>
                  <Input
                    type="number"
                    value={editingAddOn.durationDays}
                    onChange={(e) => setEditingAddOn({ ...editingAddOn, durationDays: Number(e.target.value || 0) })}
                    placeholder="0 = بدون مدة"
                    data-testid="input-addon-duration"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-muted-foreground mb-1">
                  الوصف
                </label>
                <Input
                  value={editingAddOn.description}
                  onChange={(e) => setEditingAddOn({ ...editingAddOn, description: e.target.value })}
                  placeholder="وصف مختصر للباقة"
                  data-testid="input-addon-description"
                />
              </div>

              <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                <div>
                  <Label htmlFor="addon-active" className="text-sm font-medium">
                    حالة التفعيل
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    {editingAddOn.isActive ? "الباقة متاحة للشراء" : "الباقة غير متاحة"}
                  </p>
                </div>
                <Switch
                  id="addon-active"
                  checked={editingAddOn.isActive}
                  onCheckedChange={(checked) => setEditingAddOn({ ...editingAddOn, isActive: checked })}
                  data-testid="switch-addon-active"
                />
              </div>
            </div>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEditingAddOn(null)}>
              إلغاء
            </Button>
            <Button
              onClick={() => editingAddOn && addOnMutation.mutate(editingAddOn)}
              disabled={addOnMutation.isPending}
              data-testid="button-save-addon"
            >
              {addOnMutation.isPending && <Loader2 className="w-4 h-4 ml-1 animate-spin" />}
              حفظ
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
