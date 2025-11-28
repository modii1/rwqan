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
  id: string;
  code: string;
  percentage: number;
  maxUsage?: number | null;
  expiresAt?: string | null;
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
        const res = await fetch(`/api/admin/discounts/${payload.id}`, {
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
      id: "",
      code: "",
      percentage: 10,
      maxUsage: null,
      expiresAt: null,
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
                <Th>نسبة الخصم %</Th>
                <Th>الحد الأقصى للاستخدام</Th>
                <Th>تاريخ الانتهاء</Th>
                <Th>تحكم</Th>
              </tr>
            </thead>
            <tbody>
              {(data || []).map((d) => (
                <tr key={d.id} className="border-t hover:bg-muted/40">
                  <Td>{d.code}</Td>
                  <Td>{d.percentage}</Td>
                  <Td>{d.maxUsage ?? "-"}</Td>
                  <Td>{d.expiresAt || "-"}</Td>
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
                  <Td colSpan={5}>
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
            <div className="space-y-2 text-xs">
              {/* الكود */}
              <div>
                <label className="block text-[11px] font-semibold text-muted-foreground">
                  الكود
                </label>
                <Input
                  value={editingCode.code}
                  onChange={(e) =>
                    setEditingCode({
                      ...editingCode,
                      code: e.target.value.toUpperCase(),
                    })
                  }
                />
              </div>

              {/* نسبة الخصم */}
              <div>
                <label className="block text-[11px] font-semibold text-muted-foreground">
                  نسبة الخصم %
                </label>
                <Input
                  type="number"
                  value={editingCode.percentage}
                  onChange={(e) =>
                    setEditingCode({
                      ...editingCode,
                      percentage: Number(e.target.value || 0),
                    })
                  }
                />
              </div>

              {/* الحد الأقصى */}
              <div>
                <label className="block text-[11px] font-semibold text-muted-foreground">
                  الحد الأقصى للاستخدام (اختياري)
                </label>
                <Input
                  type="number"
                  value={editingCode.maxUsage ?? ""}
                  onChange={(e) =>
                    setEditingCode({
                      ...editingCode,
                      maxUsage: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                />
              </div>

              {/* تاريخ الانتهاء */}
              <div>
                <label className="block text-[11px] font-semibold text-muted-foreground">
                  تاريخ الانتهاء (اختياري)
                </label>
                <Input
                  placeholder="مثال: 2025-12-31"
                  value={editingCode.expiresAt || ""}
                  onChange={(e) =>
                    setEditingCode({
                      ...editingCode,
                      expiresAt: e.target.value || null,
                    })
                  }
                />
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
