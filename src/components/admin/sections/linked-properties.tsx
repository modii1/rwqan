"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Pencil, Trash2, Unlink, Home, Link, Search, Building, Clock, CheckCircle, AlertCircle, Plus, Users } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { LinkIcon } from "lucide-react";

interface LinkedProperty {
  propertyNumber: string;
  name: string;
  city: string;
  direction: string;
  type: string;
  whatsappNumber: string;
  subscriptionType: string;
  linkedProperty: string;
  mainPropertyName: string;
  mainPropertyCity: string;
  mainPropertyWhatsapp: string;
  verificationStatus: string;
  subscriptionStatus: string;
  endDate: string | undefined;
  startDate: string | undefined;
  packageId: string | undefined;
  facilities: string[];
  location?: string;
  prices?: {
    weekday?: string;
    weekend?: string;
    overnight?: string;
    holidays?: string;
  };
  createdAt?: string;
  updatedAt?: string;
}

interface LinkedPropertiesResponse {
  success: boolean;
  data: LinkedProperty[];
  count: number;
  mainPropertyCount: number;
}

export default function LinkedPropertiesSection() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [filter, setFilter] = useState("");
  const [selectedProperty, setSelectedProperty] = useState<LinkedProperty | null>(null);
  const [editingProperty, setEditingProperty] = useState<LinkedProperty | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<LinkedProperty | null>(null);
  const [unlinkConfirm, setUnlinkConfirm] = useState<LinkedProperty | null>(null);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [newGroup, setNewGroup] = useState({ propertyNumber1: "", propertyNumber2: "", packageId: "" });

  // Fetch linked properties
  const { data, isLoading, refetch } = useQuery<LinkedPropertiesResponse>({
    queryKey: ["admin-linked-properties"],
    queryFn: async () => {
      const res = await fetch("/api/admin/linked-properties");
      if (!res.ok) throw new Error("فشل في جلب العقارات المضافة");
      return res.json();
    },
  });

  // Fetch packages for group creation
  const { data: packages } = useQuery<any[]>({
    queryKey: ["admin-packages"],
    queryFn: async () => {
      const res = await fetch("/api/admin/packages");
      if (!res.ok) throw new Error("فشل في جلب الباقات");
      return res.json();
    },
  });

  // Unlink mutation
  const unlinkMutation = useMutation({
    mutationFn: async (propertyNumber: string) => {
      const res = await fetch(`/api/admin/linked-properties/${propertyNumber}/unlink`, {
        method: "PUT",
      });
      if (!res.ok) throw new Error("فشل في فك الارتباط");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "تم فك الارتباط ✓", description: "تم فك ارتباط العقار بنجاح" });
      queryClient.invalidateQueries({ queryKey: ["admin-linked-properties"] });
      queryClient.invalidateQueries({ queryKey: ["admin-properties"] });
      setUnlinkConfirm(null);
    },
    onError: (error: Error) => {
      toast({ title: "خطأ", description: error.message, variant: "destructive" });
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (propertyNumber: string) => {
      const res = await fetch(`/api/admin/linked-properties/${propertyNumber}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("فشل في حذف العقار");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "تم الحذف ✓", description: "تم حذف العقار بنجاح" });
      queryClient.invalidateQueries({ queryKey: ["admin-linked-properties"] });
      queryClient.invalidateQueries({ queryKey: ["admin-properties"] });
      setDeleteConfirm(null);
    },
    onError: (error: Error) => {
      toast({ title: "خطأ", description: error.message, variant: "destructive" });
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async ({ propertyNumber, updates }: { propertyNumber: string; updates: Partial<LinkedProperty> }) => {
      const res = await fetch(`/api/admin/linked-properties/${propertyNumber}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
      if (!res.ok) throw new Error("فشل في تحديث العقار");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "تم التحديث ✓", description: "تم تحديث بيانات العقار بنجاح" });
      queryClient.invalidateQueries({ queryKey: ["admin-linked-properties"] });
      setEditingProperty(null);
    },
    onError: (error: Error) => {
      toast({ title: "خطأ", description: error.message, variant: "destructive" });
    },
  });

  // Create Group mutation
  const createGroupMutation = useMutation({
    mutationFn: async (data: { propertyNumber1: string; propertyNumber2: string; packageId: string }) => {
      const res = await fetch("/api/admin/linked-properties/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "فشل في إنشاء المجموعة");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "تم الإنشاء ✓", description: "تم إنشاء مجموعة العقارات بنجاح" });
      queryClient.invalidateQueries({ queryKey: ["admin-linked-properties"] });
      queryClient.invalidateQueries({ queryKey: ["admin-properties"] });
      setShowCreateGroup(false);
      setNewGroup({ propertyNumber1: "", propertyNumber2: "", packageId: "" });
    },
    onError: (error: Error) => {
      toast({ title: "خطأ", description: error.message, variant: "destructive" });
    },
  });

  const filteredData = (data?.data || []).filter((p) => {
    if (!filter) return true;
    const normalizedFilter = filter.toLowerCase();
    return (
      (p.name || "").includes(normalizedFilter) ||
      (p.propertyNumber || "").includes(normalizedFilter) ||
      (p.city || "").includes(normalizedFilter) ||
      (p.mainPropertyName || "").includes(normalizedFilter) ||
      (p.linkedProperty || "").includes(normalizedFilter)
    );
  });

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'نشط':
        return <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300">نشط</Badge>;
      case 'منتهي':
        return <Badge variant="secondary" className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300">منتهي</Badge>;
      case 'pending':
        return <Badge variant="secondary" className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300">معلق</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
    }
  };

  const formatDate = (dateStr: string | undefined | null) => {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleDateString('ar-SA');
  };

  return (
    <section className="space-y-4" dir="rtl">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <LinkIcon className="w-6 h-6 text-primary" />
            العقارات المضافة
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            إدارة العقارات المربوطة بباقة نخبة وعرض كامل بياناتها
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => setShowCreateGroup(true)} className="gap-2">
            <Plus className="w-4 h-4" />
            إنشاء مجموعة
          </Button>
          <div className="relative">
            <Search className="w-4 h-4 absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="بحث بالاسم / رقم العقار / المدينة"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="w-72 pr-10"
            />
          </div>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-4 bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950/50 dark:to-blue-900/50 border-blue-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
              <LinkIcon className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-blue-600">{data?.count || 0}</p>
              <p className="text-sm text-blue-700/70">عقار مضاف</p>
            </div>
          </div>
        </Card>
        <Card className="p-4 bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-emerald-950/50 dark:to-emerald-900/50 border-emerald-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-500/20 flex items-center justify-center">
              <Building className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-emerald-600">{data?.mainPropertyCount || 0}</p>
              <p className="text-sm text-emerald-700/70">عقار رئيسي</p>
            </div>
          </div>
        </Card>
        <Card className="p-4 bg-gradient-to-br from-amber-50 to-amber-100 dark:from-amber-950/50 dark:to-amber-900/50 border-amber-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-amber-500/20 flex items-center justify-center">
              <CheckCircle className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-amber-600">
                {data?.data?.filter(p => p.subscriptionStatus === 'نشط').length || 0}
              </p>
              <p className="text-sm text-amber-700/70">نشط</p>
            </div>
          </div>
        </Card>
      </div>

      {/* Table */}
      <Card className="overflow-x-auto">
        {isLoading ? (
          <div className="p-8 flex items-center justify-center gap-2 text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span>جاري تحميل العقارات المضافة...</span>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-right">
              <tr>
                <Th>رقم العقار</Th>
                <Th>اسم العقار</Th>
                <Th>المدينة</Th>
                <Th>النوع</Th>
                <Th>العقار الرئيسي</Th>
                <Th>حالة الاشتراك</Th>
                <Th>تاريخ الانتهاء</Th>
                <Th>تحكم</Th>
              </tr>
            </thead>
            <tbody>
              {filteredData.length > 0 ? (
                filteredData.map((p) => (
                  <tr key={p.propertyNumber} className="border-t hover:bg-muted/30 transition-colors">
                    <Td>
                      <div className="font-mono font-bold text-primary">#{p.propertyNumber}</div>
                    </Td>
                    <Td>
                      <div className="font-medium">{p.name}</div>
                      <div className="text-xs text-muted-foreground">{p.whatsappNumber}</div>
                    </Td>
                    <Td>{p.city}</Td>
                    <Td>{p.type}</Td>
                    <Td>
                      <div className="flex flex-col">
                        <span className="font-medium">{p.mainPropertyName}</span>
                        <span className="text-xs text-muted-foreground">#{p.linkedProperty}</span>
                      </div>
                    </Td>
                    <Td>{getStatusBadge(p.subscriptionStatus)}</Td>
                    <Td>
                      {p.endDate ? (
                        <div className="flex items-center gap-1">
                          <Clock className="w-3 h-3 text-muted-foreground" />
                          <span>{formatDate(p.endDate)}</span>
                        </div>
                      ) : (
                        "-"
                      )}
                    </Td>
                    <Td>
                      <div className="flex items-center gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setSelectedProperty(p)}
                          title="عرض التفاصيل"
                        >
                          <Home className="w-4 h-4 text-blue-500" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setEditingProperty(p)}
                          title="تعديل"
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setUnlinkConfirm(p)}
                          title="فك الارتباط"
                        >
                          <Unlink className="w-4 h-4 text-amber-500" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          onClick={() => setDeleteConfirm(p)}
                          title="حذف"
                        >
                          <Trash2 className="w-4 h-4 text-red-500" />
                        </Button>
                      </div>
                    </Td>
                  </tr>
                ))
              ) : (
                <tr>
                  <Td colSpan={8}>
                    <div className="p-8 text-center text-muted-foreground">
                      <Home className="w-12 h-12 mx-auto mb-3 text-muted-foreground/50" />
                      <p className="text-lg font-medium mb-1">لا توجد عقارات مضافة</p>
                      <p className="text-sm">عقارات باقة نخبة ستظهر هنا عند إضافتها</p>
                    </div>
                  </Td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </Card>

      {/* Property Details Dialog */}
      <Dialog open={!!selectedProperty} onOpenChange={() => setSelectedProperty(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LinkIcon className="w-5 h-5 text-primary" />
              تفاصيل العقار المضاف
            </DialogTitle>
            <DialogDescription>
              رقم العقار: {selectedProperty?.propertyNumber}
            </DialogDescription>
          </DialogHeader>
          {selectedProperty && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <DetailItem label="اسم العقار" value={selectedProperty.name} />
                <DetailItem label="رقم العقار" value={selectedProperty.propertyNumber} />
                <DetailItem label="المدينة" value={selectedProperty.city} />
                <DetailItem label="الاتجاه" value={selectedProperty.direction} />
                <DetailItem label="النوع" value={selectedProperty.type} />
                <DetailItem label="رقم الواتساب" value={selectedProperty.whatsappNumber} />
              </div>
              <div className="border-t pt-4">
                <h3 className="font-bold text-primary mb-3">العقار الرئيسي</h3>
                <div className="grid grid-cols-2 gap-4">
                  <DetailItem label="اسم العقار الرئيسي" value={selectedProperty.mainPropertyName} />
                  <DetailItem label="رقم العقار الرئيسي" value={selectedProperty.linkedProperty} />
                  <DetailItem label="مدينة العقار الرئيسي" value={selectedProperty.mainPropertyCity} />
                  <DetailItem label="واتساب العقار الرئيسي" value={selectedProperty.mainPropertyWhatsapp} />
                </div>
              </div>
              <div className="border-t pt-4">
                <h3 className="font-bold text-primary mb-3">الاشتراك</h3>
                <div className="grid grid-cols-2 gap-4">
                  <DetailItem label="نوع الاشتراك" value={selectedProperty.subscriptionType} />
                  <DetailItem label="حالة الاشتراك" value={selectedProperty.subscriptionStatus} />
                  <DetailItem label="تاريخ البدء" value={formatDate(selectedProperty.startDate)} />
                  <DetailItem label="تاريخ الانتهاء" value={formatDate(selectedProperty.endDate)} />
                  <DetailItem label="الباقة" value={selectedProperty.packageId} />
                </div>
              </div>
              {selectedProperty.prices && (
                <div className="border-t pt-4">
                  <h3 className="font-bold text-primary mb-3">الأسعار</h3>
                  <div className="grid grid-cols-2 gap-4">
                    <DetailItem label="وسط الأسبوع" value={selectedProperty.prices?.weekday} />
                    <DetailItem label="نهاية الأسبوع" value={selectedProperty.prices?.weekend} />
                    <DetailItem label="المبيت" value={selectedProperty.prices?.overnight} />
                    <DetailItem label="الإجازات" value={selectedProperty.prices?.holidays} />
                  </div>
                </div>
              )}
              <div className="border-t pt-4">
                <h3 className="font-bold text-primary mb-3">المرافق</h3>
                <div className="flex flex-wrap gap-2">
                  {selectedProperty.facilities?.map((facility) => (
                    <Badge key={facility} variant="secondary" className="text-xs">
                      {facility}
                    </Badge>
                  )) || "لا توجد مرافق"}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={!!editingProperty} onOpenChange={() => setEditingProperty(null)}>
        <DialogContent className="max-w-lg" dir="rtl">
          <DialogHeader>
            <DialogTitle>تعديل العقار المضاف</DialogTitle>
            <DialogDescription>
              رقم العقار: {editingProperty?.propertyNumber}
            </DialogDescription>
          </DialogHeader>
          {editingProperty && (
            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-1 block">اسم العقار</label>
                <Input
                  defaultValue={editingProperty.name}
                  onChange={(e) => setEditingProperty({ ...editingProperty, name: e.target.value })}
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">رقم الواتساب</label>
                <Input
                  defaultValue={editingProperty.whatsappNumber}
                  onChange={(e) => setEditingProperty({ ...editingProperty, whatsappNumber: e.target.value })}
                />
              </div>
              <div>
                <label className="text-sm font-medium mb-1 block">الموقع</label>
                <Input
                  defaultValue={editingProperty.location || ""}
                  onChange={(e) => setEditingProperty({ ...editingProperty, location: e.target.value })}
                />
              </div>
              <div className="flex justify-end gap-2 pt-4">
                <Button variant="outline" onClick={() => setEditingProperty(null)}>
                  إلغاء
                </Button>
                <Button
                  onClick={() => {
                    if (editingProperty) {
                      updateMutation.mutate({
                        propertyNumber: editingProperty.propertyNumber,
                        updates: {
                          name: editingProperty.name,
                          whatsappNumber: editingProperty.whatsappNumber,
                          location: editingProperty.location,
                        },
                      });
                    }
                  }}
                  disabled={updateMutation.isPending}
                  className="gradient-golden"
                >
                  {updateMutation.isPending && <Loader2 className="w-4 h-4 ml-1 animate-spin" />}
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
            <DialogTitle className="text-red-600 flex items-center gap-2">
              <AlertCircle className="w-5 h-5" />
              تأكيد الحذف
            </DialogTitle>
            <DialogDescription>
              هل أنت متأكد من حذف العقار "{deleteConfirm?.name}" رقم {deleteConfirm?.propertyNumber}؟
              <br />
              <span className="text-red-500 font-bold">هذا الإجراء لا يمكن التراجع عنه!</span>
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setDeleteConfirm(null)}>
              إلغاء
            </Button>
            <Button
              variant="destructive"
              onClick={() => deleteConfirm && deleteMutation.mutate(deleteConfirm.propertyNumber)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending && <Loader2 className="w-4 h-4 ml-1 animate-spin" />}
              نعم، احذف
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Unlink Confirmation */}
      <Dialog open={!!unlinkConfirm} onOpenChange={() => setUnlinkConfirm(null)}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle className="text-amber-600 flex items-center gap-2">
              <Unlink className="w-5 h-5" />
              فك الارتباط
            </DialogTitle>
            <DialogDescription>
              هل أنت متأكد من فك ارتباط العقار "{unlinkConfirm?.name}" من العقار الرئيسي "{unlinkConfirm?.mainPropertyName}"؟
              <br />
              <span className="text-amber-600">سيتم إعادة تعيين الاشتراك إلى عادي.</span>
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2 mt-4">
            <Button variant="outline" onClick={() => setUnlinkConfirm(null)}>
              إلغاء
            </Button>
            <Button
              variant="default"
              onClick={() => unlinkConfirm && unlinkMutation.mutate(unlinkConfirm.propertyNumber)}
              disabled={unlinkMutation.isPending}
              className="bg-amber-600 hover:bg-amber-700"
            >
              {unlinkMutation.isPending && <Loader2 className="w-4 h-4 ml-1 animate-spin" />}
              فك الارتباط
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Create Group Dialog */}
      <Dialog open={showCreateGroup} onOpenChange={setShowCreateGroup}>
        <DialogContent className="max-w-lg" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Users className="w-5 h-5 text-primary" />
              إنشاء مجموعة عقارات مرتبطة
            </DialogTitle>
            <DialogDescription>
              أدخل أرقام العقارين لربطهما في مجموعة واحدة (باقة نخبة)
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium mb-1 block">رقم العقار الرئيسي</label>
              <Input
                placeholder="مثال: 12345"
                value={newGroup.propertyNumber1}
                onChange={(e) => setNewGroup({ ...newGroup, propertyNumber1: e.target.value })}
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">رقم العقار الثاني (المضاف)</label>
              <Input
                placeholder="مثال: 67890"
                value={newGroup.propertyNumber2}
                onChange={(e) => setNewGroup({ ...newGroup, propertyNumber2: e.target.value })}
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1 block">الباقة</label>
              <Select
                value={newGroup.packageId}
                onValueChange={(val) => setNewGroup({ ...newGroup, packageId: val })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="اختر الباقة" />
                </SelectTrigger>
                <SelectContent>
                  {(packages || []).map((pkg: any) => (
                    <SelectItem key={pkg.id} value={pkg.id}>
                      {pkg.name} - {pkg.price} ريال ({pkg.duration} يوم)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2 pt-4">
              <Button variant="outline" onClick={() => setShowCreateGroup(false)}>
                إلغاء
              </Button>
              <Button
                onClick={() => {
                  if (!newGroup.propertyNumber1 || !newGroup.propertyNumber2) {
                    toast({ title: "خطأ", description: "أدخل أرقام العقارين", variant: "destructive" });
                    return;
                  }
                  createGroupMutation.mutate(newGroup);
                }}
                disabled={createGroupMutation.isPending}
              >
                {createGroupMutation.isPending && <Loader2 className="w-4 h-4 ml-1 animate-spin" />}
                إنشاء المجموعة
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="px-4 py-3 text-xs font-bold text-muted-foreground">{children}</th>;
}

function Td({ children, colSpan }: { children: React.ReactNode; colSpan?: number }) {
  return <td colSpan={colSpan} className="px-4 py-3">{children}</td>;
}

function DetailItem({ label, value }: { label: string; value: string | undefined }) {
  return (
    <div className="p-3 bg-muted/30 rounded-lg">
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className="font-medium">{value || "-"}</p>
    </div>
  );
}
