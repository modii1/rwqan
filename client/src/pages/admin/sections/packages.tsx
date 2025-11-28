// client/src/pages/admin/sections/packages.tsx
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Pencil, Plus } from "lucide-react";
import { Th, Td } from "../components/Table";

type AdminPackage = {
  id: string;
  name: string;
  price: number;
  durationDays: number;
  description?: string;
};

export default function PackagesSection() {
  const queryClient = useQueryClient();
  const [editingPackage, setEditingPackage] = useState<AdminPackage | null>(null);
  const [isNew, setIsNew] = useState(false);

  const { data, isLoading } = useQuery<AdminPackage[]>({
    queryKey: ["admin-packages"],
    queryFn: async () => {
      const res = await fetch("/api/admin/packages");
      if (!res.ok) throw new Error("فشل في جلب الباقات");
      return res.json();
    },
  });

  const mutation = useMutation({
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
    },
  });

  const startNew = () => {
    setIsNew(true);
    setEditingPackage({
      id: "",
      name: "",
      price: 0,
      durationDays: 30,
      description: "",
    });
  };

  return (
    <section className="space-y-3">
      {/* ===== عنوان ===== */}
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">إدارة الباقات</h2>
          <p className="text-xs text-muted-foreground">
            إضافة وتعديل باقات الاشتراك (مثلاً: باقة 35، باقة 60، باقة مميز...).
          </p>
        </div>
        <Button size="sm" onClick={startNew}>
          <Plus className="w-4 h-4 ml-1" /> باقة جديدة
        </Button>
      </div>

      {/* ===== جدول الباقات ===== */}
      <Card className="overflow-x-auto">
        {isLoading ? (
          <div className="p-4 flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />
            جاري تحميل الباقات...
          </div>
        ) : (
          <table className="w-full text-xs md:text-sm">
            <thead className="bg-muted/50 text-right">
              <tr>
                <Th>اسم الباقة</Th>
                <Th>السعر (ر.س)</Th>
                <Th>مدة الاشتراك (يوم)</Th>
                <Th>الوصف</Th>
                <Th>تحكم</Th>
              </tr>
            </thead>
            <tbody>
              {(data || []).map((pkg) => (
                <tr key={pkg.id} className="border-t hover:bg-muted/40">
                  <Td>{pkg.name}</Td>
                  <Td>{pkg.price}</Td>
                  <Td>{pkg.durationDays}</Td>
                  <Td className="max-w-xs truncate">
                    {pkg.description || "-"}
                  </Td>
                  <Td>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => {
                        setIsNew(false);
                        setEditingPackage(pkg);
                      }}
                    >
                      <Pencil className="w-4 h-4" />
                    </Button>
                  </Td>
                </tr>
              ))}

              {(data || []).length === 0 && (
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

      {/* ===== مودال إضافة/تعديل ===== */}
      <Dialog open={!!editingPackage} onOpenChange={() => setEditingPackage(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{isNew ? "إضافة باقة" : "تعديل الباقة"}</DialogTitle>
          </DialogHeader>

          {editingPackage && (
            <div className="space-y-2 text-xs">
              {/* اسم الباقة */}
              <div>
                <label className="block text-[11px] font-semibold text-muted-foreground">
                  اسم الباقة
                </label>
                <Input
                  value={editingPackage.name}
                  onChange={(e) =>
                    setEditingPackage({ ...editingPackage, name: e.target.value })
                  }
                />
              </div>

              {/* السعر */}
              <div>
                <label className="block text-[11px] font-semibold text-muted-foreground">
                  السعر (ر.س)
                </label>
                <Input
                  type="number"
                  value={editingPackage.price}
                  onChange={(e) =>
                    setEditingPackage({
                      ...editingPackage,
                      price: Number(e.target.value || 0),
                    })
                  }
                />
              </div>

              {/* عدد الأيام */}
              <div>
                <label className="block text-[11px] font-semibold text-muted-foreground">
                  مدة الاشتراك (يوم)
                </label>
                <Input
                  type="number"
                  value={editingPackage.durationDays}
                  onChange={(e) =>
                    setEditingPackage({
                      ...editingPackage,
                      durationDays: Number(e.target.value || 0),
                    })
                  }
                />
              </div>

              {/* وصف اختياري */}
              <div>
                <label className="block text-[11px] font-semibold text-muted-foreground">
                  الوصف (اختياري)
                </label>
                <Input
                  value={editingPackage.description || ""}
                  onChange={(e) =>
                    setEditingPackage({
                      ...editingPackage,
                      description: e.target.value,
                    })
                  }
                />
              </div>
            </div>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEditingPackage(null)}>
              إلغاء
            </Button>
            <Button
              onClick={() => editingPackage && mutation.mutate(editingPackage)}
              disabled={mutation.isPending}
            >
              {mutation.isPending && <Loader2 className="w-4 h-4 ml-1 animate-spin" />}
              حفظ
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
