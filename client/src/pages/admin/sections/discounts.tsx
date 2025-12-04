// client/src/pages/admin/sections/discounts.tsx
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Pencil, Plus } from "lucide-react";
import { Th, Td } from "../components/Table";

type AdminDiscount = {
  code: string;
  type: string;
  value: number;
  expiryDate?: string;
  isActive: boolean;
  usageCount: number;
  createdAt: string;
};

export default function DiscountsSection() {
  const queryClient = useQueryClient();
  const [editingCode, setEditingCode] = useState<AdminDiscount | null>(null);
  const [isNew, setIsNew] = useState(false);

  const { data, isLoading } = useQuery<AdminDiscount[]>({
    queryKey: ["admin-discounts"],
    queryFn: async () => {
      const res = await fetch("/api/admin/discounts");
      if (!res.ok) throw new Error("فشل في جلب الأكواد");
      return res.json();
    },
  });

  const mutation = useMutation({
    mutationFn: async (payload: AdminDiscount) => {
      if (isNew) {
        const res = await fetch("/api/admin/discounts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error("فشل في إنشاء الكود");
      } else {
        const res = await fetch(`/api/admin/discounts/${payload.code}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) throw new Error("فشل في تحديث الكود");
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-discounts"] });
      setEditingCode(null);
    },
  });

  const startNew = () => {
    setIsNew(true);
    setEditingCode({
      code: "",
      type: "نسبة",
      value: 10,
      expiryDate: "",
      isActive: true,
      usageCount: 0,
      createdAt: new Date().toISOString(),
    });
  };

  return (
    <section className="space-y-3">
      {/* ================= عنوان ================= */}
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">إدارة الأكواد والخصومات</h2>
          <p className="text-xs text-muted-foreground">
            إنشاء أكواد خصم للحملات التسويقية وربطها بالاشتراكات أو العقارات.
          </p>
        </div>
        <Button size="sm" onClick={startNew}>
          <Plus className="w-4 h-4 ml-1" /> كود جديد
        </Button>
      </div>

      {/* ================= جدول الأكواد ================= */}
      <Card className="overflow-x-auto">
        {isLoading ? (
          <div className="p-4 flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />
            جاري تحميل الأكواد...
          </div>
        ) : (
          <table className="w-full text-xs md:text-sm">
            <thead className="bg-muted/50 text-right">
              <tr>
                <Th>الكود</Th>
                <Th>النوع</Th>
                <Th>القيمة</Th>
                <Th>تاريخ الانتهاء</Th>
                <Th>الحالة</Th>
                <Th>تحكم</Th>
              </tr>
            </thead>
            <tbody>
              {(data || []).map((d) => (
                <tr key={d.code} className="border-t hover:bg-muted/40">
                  <Td>{d.code}</Td>
                  <Td>{d.type === "نسبة" ? "نسبة %" : "مبلغ ثابت"}</Td>
                  <Td>{d.value}{d.type === "نسبة" ? "%" : " ريال"}</Td>
                  <Td>{d.expiryDate || "-"}</Td>
                  <Td>
                    <span className={d.isActive ? "text-green-600" : "text-red-600"}>
                      {d.isActive ? "نشط" : "غير نشط"}
                    </span>
                  </Td>
                  <Td>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => {
                        setIsNew(false);
                        setEditingCode(d);
                      }}
                    >
                      <Pencil className="w-4 h-4" />
                    </Button>
                  </Td>
                </tr>
              ))}

              {(data || []).length === 0 && (
                <tr>
                  <Td colSpan={6}>
                    <div className="p-4 text-center text-xs text-muted-foreground">
                      لا توجد أكواد خصم حالياً.
                    </div>
                  </Td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </Card>

      {/* ================= مودال إضافة/تعديل ================= */}
      <Dialog open={!!editingCode} onOpenChange={() => setEditingCode(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{isNew ? "إضافة كود" : "تعديل الكود"}</DialogTitle>
          </DialogHeader>

          {editingCode && (
            <div className="space-y-3 text-xs">
              {/* الكود */}
              <div>
                <label className="block text-[11px] font-semibold text-muted-foreground mb-1">
                  الكود
                </label>
                <Input
                  value={editingCode.code}
                  disabled={!isNew}
                  onChange={(e) =>
                    setEditingCode({
                      ...editingCode,
                      code: e.target.value.toUpperCase(),
                    })
                  }
                />
              </div>

              {/* نوع الخصم */}
              <div>
                <label className="block text-[11px] font-semibold text-muted-foreground mb-1">
                  نوع الخصم
                </label>
                <select
                  className="w-full p-2 border rounded-md text-sm bg-background"
                  value={editingCode.type}
                  onChange={(e) =>
                    setEditingCode({
                      ...editingCode,
                      type: e.target.value,
                    })
                  }
                >
                  <option value="نسبة">نسبة مئوية %</option>
                  <option value="ثابت">مبلغ ثابت</option>
                </select>
              </div>

              {/* القيمة */}
              <div>
                <label className="block text-[11px] font-semibold text-muted-foreground mb-1">
                  {editingCode.type === "نسبة" ? "نسبة الخصم %" : "مبلغ الخصم (ريال)"}
                </label>
                <Input
                  type="number"
                  value={editingCode.value}
                  onChange={(e) =>
                    setEditingCode({
                      ...editingCode,
                      value: Number(e.target.value || 0),
                    })
                  }
                />
              </div>

              {/* تاريخ الانتهاء */}
              <div>
                <label className="block text-[11px] font-semibold text-muted-foreground mb-1">
                  تاريخ الانتهاء (اختياري)
                </label>
                <Input
                  type="date"
                  value={editingCode.expiryDate || ""}
                  onChange={(e) =>
                    setEditingCode({
                      ...editingCode,
                      expiryDate: e.target.value || undefined,
                    })
                  }
                />
              </div>

              {/* الحالة */}
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="isActive"
                  checked={editingCode.isActive}
                  onChange={(e) =>
                    setEditingCode({
                      ...editingCode,
                      isActive: e.target.checked,
                    })
                  }
                  className="w-4 h-4"
                />
                <label htmlFor="isActive" className="text-sm">
                  الكود نشط
                </label>
              </div>
            </div>
          )}

          {/* أزرار الحفظ */}
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEditingCode(null)}>
              إلغاء
            </Button>
            <Button
              onClick={() => editingCode && mutation.mutate(editingCode)}
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
