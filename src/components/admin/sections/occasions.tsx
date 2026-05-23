"use client";
import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import {
  Calendar,
  Plus,
  Trash2,
  Edit,
  Loader2,
  Star,
  Check,
  X,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Occasion, OccasionProperty, Property } from "@shared/schema";

interface OccasionWithProps {
  occasion: Occasion;
  properties: OccasionProperty[];
}

export default function AdminOccasionsSection() {
  const { toast } = useToast();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingOccasion, setEditingOccasion] = useState<Occasion | null>(null);
  const [selectedOccasion, setSelectedOccasion] = useState<string | null>(null);
  const [showAddProperty, setShowAddProperty] = useState(false);
  const [addPropertyNumber, setAddPropertyNumber] = useState("");
  const [bulkPropertyNumbers, setBulkPropertyNumbers] = useState("");

  // Fetch occasions
  const { data: occasions = [], isLoading, isError, error } = useQuery<Occasion[]>({
    queryKey: ["/api/admin/occasions"],
  });

  // Fetch properties for selected occasion
  const { data: fetchedProperties, dataUpdatedAt } = useQuery<OccasionProperty[]>({
    queryKey: ["/api/admin/occasions", selectedOccasion, "properties"],
    queryFn: async () => {
      if (!selectedOccasion) return [];
      const res = await fetch(`/api/admin/occasions/${selectedOccasion}/properties`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: !!selectedOccasion,
    staleTime: 0,
  });

  const [occasionProperties, setOccasionProperties] = useState<OccasionProperty[]>([]);
  useEffect(() => {
    if (fetchedProperties) {
      setOccasionProperties(fetchedProperties);
    }
  }, [dataUpdatedAt]);

  // Fetch all properties for reference
  const { data: allProperties = [] } = useQuery<Property[]>({
    queryKey: ["/api/properties"],
  });

  // Create occasion mutation
  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/admin/occasions", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/occasions"] });
      setShowCreateForm(false);
      toast({ title: "تم", description: "تم إنشاء المناسبة بنجاح" });
    },
    onError: (error: Error) => {
      toast({ title: "خطأ", description: error.message, variant: "destructive" });
    },
  });

  // Update occasion mutation
  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const res = await apiRequest("PUT", `/api/admin/occasions/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/occasions"] });
      setEditingOccasion(null);
      toast({ title: "تم", description: "تم تحديث المناسبة" });
    },
    onError: (error: Error) => {
      toast({ title: "خطأ", description: error.message, variant: "destructive" });
    },
  });

  // Delete occasion mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/admin/occasions/${id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/occasions"] });
      setSelectedOccasion(null);
      toast({ title: "تم", description: "تم حذف المناسبة" });
    },
    onError: (error: Error) => {
      toast({ title: "خطأ", description: error.message, variant: "destructive" });
    },
  });

  // Add property to occasion
  const addPropertyMutation = useMutation({
    mutationFn: async ({ occasionId, propertyNumber }: { occasionId: string; propertyNumber: string }) => {
      const res = await apiRequest("POST", `/api/admin/occasions/${occasionId}/properties`, { propertyNumber });
      return res.json();
    },
    onSuccess: (newProp) => {
      setOccasionProperties(prev => [...prev, newProp]);
      setAddPropertyNumber("");
      toast({ title: "تم", description: "تم إضافة العقار" });
    },
    onError: (error: Error) => {
      toast({ title: "خطأ", description: error.message, variant: "destructive" });
    },
  });

  // Bulk add properties
  const bulkAddMutation = useMutation({
    mutationFn: async ({ occasionId, propertyNumbers }: { occasionId: string; propertyNumbers: string[] }) => {
      const res = await apiRequest("POST", `/api/admin/occasions/${occasionId}/properties/bulk`, { propertyNumbers });
      return res.json();
    },
    onSuccess: () => {
      setBulkPropertyNumbers("");
      toast({ title: "تم", description: "تم إضافة العقارات" });
      // Refetch to get full data
      queryClient.resetQueries({ queryKey: ["/api/admin/occasions", selectedOccasion, "properties"] });
    },
    onError: (error: Error) => {
      toast({ title: "خطأ", description: error.message, variant: "destructive" });
    },
  });

  // Remove property from occasion
  const removePropertyMutation = useMutation({
    mutationFn: async ({ occasionId, propertyNumber }: { occasionId: string; propertyNumber: string }) => {
      const res = await apiRequest("DELETE", `/api/admin/occasions/${occasionId}/properties/${propertyNumber}`);
      return res.json();
    },
    onMutate: ({ propertyNumber }) => {
      setOccasionProperties(prev => prev.filter(op => op.propertyNumber !== propertyNumber));
    },
    onSuccess: () => {
      toast({ title: "تم", description: "تم إزالة العقار" });
    },
    onError: (error: Error) => {
      toast({ title: "خطأ", description: error.message, variant: "destructive" });
    },
  });

  // Update property availability
  const updatePropertyMutation = useMutation({
    mutationFn: async ({ occasionId, propertyNumber, data }: { occasionId: string; propertyNumber: string; data: any }) => {
      const res = await apiRequest("PUT", `/api/admin/occasions/${occasionId}/properties/${propertyNumber}`, data);
      return res.json();
    },
    onMutate: ({ propertyNumber, data }) => {
      // Immediately update local state
      setOccasionProperties(prev => prev.map(op =>
        op.propertyNumber === propertyNumber
          ? { ...op, ...(data.availability && { availability: data.availability }), ...(data.prices && { prices: data.prices }) }
          : op
      ));
    },
    onError: (error: Error) => {
      toast({ title: "خطأ", description: error.message, variant: "destructive" });
      // Refetch to get correct state
      queryClient.refetchQueries({ queryKey: ["/api/admin/occasions", selectedOccasion, "properties"] });
    },
  });

  const selectedOccasionData = occasions.find(o => o.id === selectedOccasion);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center p-8">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="text-center p-8 text-red-600">
        <p className="font-bold">خطأ في تحميل المناسبات</p>
        <p className="text-sm mt-2">{(error as Error)?.message || "فشل الاتصال بالخادم"}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Calendar className="w-6 h-6 text-amber-600" />
          <div>
            <h2 className="text-xl font-bold">إدارة المناسبات</h2>
            <p className="text-sm text-muted-foreground">إدارة عروض العيد والمناسبات الخاصة</p>
          </div>
        </div>
        <Button onClick={() => setShowCreateForm(true)} className="gap-2">
          <Plus className="w-4 h-4" />
          مناسبة جديدة
        </Button>
      </div>

      {/* Create Form */}
      {showCreateForm && (
        <CreateOccasionForm
          onSubmit={(data) => createMutation.mutate(data)}
          onCancel={() => setShowCreateForm(false)}
          isLoading={createMutation.isPending}
        />
      )}

      {/* Occasions List */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {occasions.map(occasion => (
          <Card
            key={occasion.id}
            className={`cursor-pointer transition-all hover:shadow-md ${
              selectedOccasion === occasion.id ? "ring-2 ring-amber-500" : ""
            }`}
            onClick={() => setSelectedOccasion(occasion.id)}
          >
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">{occasion.name}</CardTitle>
                <div className="flex items-center gap-2">
                  <Badge variant={occasion.isActive ? "default" : "secondary"}>
                    {occasion.isActive ? "نشطة" : "غير نشطة"}
                  </Badge>
                  {occasion.theme === "eid" && <Star className="w-4 h-4 text-amber-500" />}
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-2 text-sm text-muted-foreground">
                <p>النوع: {occasion.type === "eid" ? "عيد" : occasion.type === "national_day" ? "يوم وطني" : occasion.type}</p>
                <p>الأيام: {occasion.days?.length || 0} أيام</p>
                <p>من: {occasion.startDate?.split("T")[0]} - إلى: {occasion.endDate?.split("T")[0]}</p>
              </div>
              <div className="flex gap-2 mt-3">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={(e) => { e.stopPropagation(); setEditingOccasion(occasion); }}
                >
                  <Edit className="w-3 h-3" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="text-red-600"
                  onClick={(e) => { e.stopPropagation(); deleteMutation.mutate(occasion.id); }}
                >
                  <Trash2 className="w-3 h-3" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={(e) => {
                    e.stopPropagation();
                    updateMutation.mutate({ id: occasion.id, data: { isActive: !occasion.isActive } });
                  }}
                >
                  {occasion.isActive ? "إيقاف" : "تفعيل"}
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Edit Occasion Modal */}
      {editingOccasion && (
        <CreateOccasionForm
          initialData={editingOccasion}
          onSubmit={(data) => updateMutation.mutate({ id: editingOccasion.id, data })}
          onCancel={() => setEditingOccasion(null)}
          isLoading={updateMutation.isPending}
        />
      )}

      {/* Selected Occasion Properties */}
      {selectedOccasion && selectedOccasionData && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">
                عقارات: {selectedOccasionData.name}
              </CardTitle>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => setShowAddProperty(!showAddProperty)} className="gap-1">
                  <Plus className="w-3 h-3" />
                  إضافة عقار
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Add Property Form */}
            {showAddProperty && (
              <div className="border rounded-lg p-4 space-y-3 bg-muted/30">
                <div className="flex gap-2">
                  <Input
                    placeholder="رقم العقار"
                    value={addPropertyNumber}
                    onChange={(e) => setAddPropertyNumber(e.target.value)}
                    className="w-40"
                  />
                  <Button
                    size="sm"
                    onClick={() => {
                      if (addPropertyNumber && selectedOccasion) {
                        addPropertyMutation.mutate({ occasionId: selectedOccasion, propertyNumber: addPropertyNumber });
                      }
                    }}
                    disabled={!addPropertyNumber || addPropertyMutation.isPending}
                  >
                    إضافة
                  </Button>
                </div>
                <div className="flex gap-2">
                  <Input
                    placeholder="أرقام عقارات متعددة (مفصولة بفاصلة)"
                    value={bulkPropertyNumbers}
                    onChange={(e) => setBulkPropertyNumbers(e.target.value)}
                    className="flex-1"
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => {
                      if (bulkPropertyNumbers && selectedOccasion) {
                        const nums = bulkPropertyNumbers.split(",").map(n => n.trim()).filter(Boolean);
                        bulkAddMutation.mutate({ occasionId: selectedOccasion, propertyNumbers: nums });
                      }
                    }}
                    disabled={!bulkPropertyNumbers || bulkAddMutation.isPending}
                  >
                    {bulkAddMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : "إضافة دفعة"}
                  </Button>
                </div>
              </div>
            )}

            {/* Properties Availability & Prices Grid */}
            {occasionProperties.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b">
                      <th className="text-right py-2 px-3 font-medium">العقار</th>
                      {selectedOccasionData.days?.map(day => (
                        <th key={day.key} className="text-center py-2 px-2 font-medium text-xs">
                          {day.label}
                        </th>
                      ))}
                      <th className="text-center py-2 px-2">إجراءات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {occasionProperties.map(op => {
                      const property = allProperties.find(p => p.propertyNumber === op.propertyNumber);
                      return (
                        <tr key={op.id} className="border-b hover:bg-muted/30">
                          <td className="py-2 px-3">
                            <div>
                              <span className="font-medium">{property?.name || op.propertyNumber}</span>
                              <span className="text-xs text-muted-foreground mr-2">#{op.propertyNumber}</span>
                            </div>
                          </td>
                          {selectedOccasionData.days?.map(day => (
                            <td key={day.key} className="text-center py-2 px-2">
                              <div className="flex flex-col items-center gap-1">
                                <button
                                  onClick={() => {
                                    const newAvailability = { ...op.availability, [day.key]: !op.availability[day.key] };
                                    updatePropertyMutation.mutate({
                                      occasionId: selectedOccasion!,
                                      propertyNumber: op.propertyNumber,
                                      data: { availability: newAvailability },
                                    });
                                  }}
                                  className={`w-6 h-6 rounded-full border-2 transition-colors ${
                                    op.availability[day.key]
                                      ? "bg-green-500 border-green-600"
                                      : "bg-gray-200 border-gray-300"
                                  }`}
                                  title={op.availability[day.key] ? "متوفر - اضغط للإيقاف" : "غير متوفر - اضغط للتفعيل"}
                                />
                                <Input
                                  className="w-16 h-6 text-[10px] text-center px-1"
                                  placeholder="السعر"
                                  defaultValue={op.prices?.[day.key] || ""}
                                  onBlur={(e) => {
                                    const val = e.target.value;
                                    if (val !== (op.prices?.[day.key] || "")) {
                                      const newPrices = { ...op.prices, [day.key]: val };
                                      updatePropertyMutation.mutate({
                                        occasionId: selectedOccasion!,
                                        propertyNumber: op.propertyNumber,
                                        data: { prices: newPrices },
                                      });
                                    }
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                                  }}
                                />
                              </div>
                            </td>
                          ))}
                          <td className="text-center py-2 px-2">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-red-500 h-7 w-7 p-0"
                              onClick={() => removePropertyMutation.mutate({
                                occasionId: selectedOccasion!,
                                propertyNumber: op.propertyNumber,
                              })}
                            >
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">
                <Calendar className="w-12 h-12 mx-auto mb-3 opacity-30" />
                <p>لا توجد عقارات مضافة لهذه المناسبة</p>
                <p className="text-xs mt-1">أضف عقارات بالضغط على زر &quot;إضافة عقار&quot;</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// ─── Create/Edit Occasion Form ─────────────────────────────────────────────

function CreateOccasionForm({
  initialData,
  onSubmit,
  onCancel,
  isLoading,
}: {
  initialData?: Occasion;
  onSubmit: (data: any) => void;
  onCancel: () => void;
  isLoading: boolean;
}) {
  const [name, setName] = useState(initialData?.name || "");
  const [slug, setSlug] = useState(initialData?.slug || "");
  const [type, setType] = useState(initialData?.type || "eid");
  const [theme, setTheme] = useState(initialData?.theme || "eid");
  const [startDate, setStartDate] = useState(initialData?.startDate?.split("T")[0] || "");
  const [endDate, setEndDate] = useState(initialData?.endDate?.split("T")[0] || "");
  const [description, setDescription] = useState(initialData?.description || "");
  const [daysCount, setDaysCount] = useState(initialData?.days?.length || 6);
  const [dayLabels, setDayLabels] = useState<string[]>(
    initialData?.days?.map(d => d.label) || ["أول العيد", "ثاني العيد", "ثالث العيد", "رابع العيد", "خامس العيد", "سادس العيد"]
  );

  const handleSubmit = () => {
    const days = dayLabels.slice(0, daysCount).map((label, i) => ({
      key: `day${i + 1}`,
      label,
    }));

    onSubmit({
      name,
      slug,
      type,
      theme,
      startDate: startDate ? new Date(startDate).toISOString() : "",
      endDate: endDate ? new Date(endDate).toISOString() : "",
      days,
      description,
      isActive: initialData?.isActive ?? false,
    });
  };

  return (
    <Card className="border-amber-200 bg-amber-50/30">
      <CardHeader>
        <CardTitle className="text-base">{initialData ? "تعديل المناسبة" : "إنشاء مناسبة جديدة"}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-sm font-medium">اسم المناسبة</label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="عيد الأضحى 1447" />
          </div>
          <div>
            <label className="text-sm font-medium">المعرف (slug)</label>
            <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="eid-adha-1447" dir="ltr" />
          </div>
          <div>
            <label className="text-sm font-medium">النوع</label>
            <Select value={type} onValueChange={setType}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="eid">عيد</SelectItem>
                <SelectItem value="national_day">يوم وطني</SelectItem>
                <SelectItem value="ramadan">رمضان</SelectItem>
                <SelectItem value="custom">مخصص</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium">الثيم</label>
            <Select value={theme} onValueChange={setTheme}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="eid">عيد (ذهبي/أخضر)</SelectItem>
                <SelectItem value="national">وطني</SelectItem>
                <SelectItem value="ramadan">رمضان</SelectItem>
                <SelectItem value="default">افتراضي</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label className="text-sm font-medium">تاريخ البداية</label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} dir="ltr" />
          </div>
          <div>
            <label className="text-sm font-medium">تاريخ النهاية</label>
            <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} dir="ltr" />
          </div>
          <div>
            <label className="text-sm font-medium">عدد الأيام</label>
            <Input
              type="number"
              min={1}
              max={10}
              value={daysCount}
              onChange={(e) => {
                const count = parseInt(e.target.value) || 1;
                setDaysCount(count);
                // Expand labels if needed
                if (count > dayLabels.length) {
                  const newLabels = [...dayLabels];
                  for (let i = dayLabels.length; i < count; i++) {
                    newLabels.push(`اليوم ${i + 1}`);
                  }
                  setDayLabels(newLabels);
                }
              }}
            />
          </div>
          <div className="md:col-span-2">
            <label className="text-sm font-medium">وصف (اختياري)</label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="وصف المناسبة..." />
          </div>
        </div>

        {/* Day Labels */}
        <div>
          <label className="text-sm font-medium mb-2 block">أسماء الأيام</label>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {dayLabels.slice(0, daysCount).map((label, i) => (
              <Input
                key={i}
                value={label}
                onChange={(e) => {
                  const newLabels = [...dayLabels];
                  newLabels[i] = e.target.value;
                  setDayLabels(newLabels);
                }}
                placeholder={`يوم ${i + 1}`}
              />
            ))}
          </div>
        </div>

        <div className="flex gap-2">
          <Button onClick={handleSubmit} disabled={isLoading || !name || !slug}>
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : initialData ? "حفظ" : "إنشاء"}
          </Button>
          <Button variant="outline" onClick={onCancel}>إلغاء</Button>
        </div>
      </CardContent>
    </Card>
  );
}
