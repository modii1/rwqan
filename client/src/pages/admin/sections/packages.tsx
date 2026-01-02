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
import { Loader2, Pencil, Plus, Package, Puzzle, Star, Zap, Pin, ShieldCheck } from "lucide-react";
import { Th, Td } from "../components/Table";
import { useToast } from "@/hooks/use-toast";

type AdminPackage = {
  id: string;
  name: string;
  price: number;
  durationDays: number;
  description?: string;
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

export default function PackagesSection() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("regular");
  
  // Regular packages state
  const [editingPackage, setEditingPackage] = useState<AdminPackage | null>(null);
  const [isNew, setIsNew] = useState(false);

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
        if (!res.ok) throw new Error("فشل في إنشاء الباقة");
      } else {
        const res = await fetch(`/api/admin/packages/${payload.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error("فشل في تحديث الباقة");
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
      durationDays: 30,
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
                    <Th>السعر (ريال)</Th>
                    <Th>مدة الاشتراك (يوم)</Th>
                    <Th>الوصف</Th>
                    <Th>تحكم</Th>
                  </tr>
                </thead>
                <tbody>
                  {(regularPackages || []).map((pkg) => (
                    <tr key={pkg.id} className="border-t hover:bg-muted/40">
                      <Td>{pkg.name}</Td>
                      <Td>{pkg.price}</Td>
                      <Td>{pkg.durationDays}</Td>
                      <Td className="max-w-xs truncate">{pkg.description || "-"}</Td>
                      <Td>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => {
                            setIsNew(false);
                            setEditingPackage(pkg);
                          }}
                          data-testid={`button-edit-package-${pkg.id}`}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                      </Td>
                    </tr>
                  ))}

                  {(regularPackages || []).length === 0 && (
                    <tr>
                      <Td colSpan={5}>
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
        <DialogContent className="max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>{isNew ? "إضافة باقة اشتراك" : "تعديل الباقة"}</DialogTitle>
          </DialogHeader>

          {editingPackage && (
            <div className="space-y-3 text-xs">
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
                  السعر (ريال)
                </label>
                <Input
                  type="number"
                  value={editingPackage.price}
                  onChange={(e) => setEditingPackage({ ...editingPackage, price: Number(e.target.value || 0) })}
                  data-testid="input-package-price"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-muted-foreground mb-1">
                  مدة الاشتراك (يوم)
                </label>
                <Input
                  type="number"
                  value={editingPackage.durationDays}
                  onChange={(e) => setEditingPackage({ ...editingPackage, durationDays: Number(e.target.value || 0) })}
                  data-testid="input-package-duration"
                />
              </div>

              <div>
                <label className="block text-[11px] font-semibold text-muted-foreground mb-1">
                  الوصف (اختياري)
                </label>
                <Input
                  value={editingPackage.description || ""}
                  onChange={(e) => setEditingPackage({ ...editingPackage, description: e.target.value })}
                  data-testid="input-package-description"
                />
              </div>
            </div>
          )}

          <div className="mt-4 flex justify-end gap-2">
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
        </DialogContent>
      </Dialog>

      {/* Add-on Package Dialog */}
      <Dialog open={!!editingAddOn} onOpenChange={() => setEditingAddOn(null)}>
        <DialogContent className="max-w-md" dir="rtl">
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
