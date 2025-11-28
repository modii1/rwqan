import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Loader2, Pencil, Plus } from "lucide-react";
import type { Property } from "@shared/schema";

export default function PropertiesSection() {
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState<Property | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [filter, setFilter] = useState("");

  // ========= Load Properties =========
  const { data, isLoading } = useQuery<Property[]>({
    queryKey: ["admin-properties"],
    queryFn: async () => {
      const res = await fetch("/api/properties");
      if (!res.ok) throw new Error("فشل في جلب العقارات");
      return res.json();
    },
  });

  // ========= Save =========
const mutation = useMutation({
  mutationFn: async (payload: Property) => {
    const body = {
      propertyNumber: payload.propertyNumber,
      name: payload.name,
      whatsappNumber: payload.whatsappNumber,
      location: payload.location,
      city: payload.city,
      direction: payload.direction,
      type: payload.type,
      facilities: payload.facilities || "",
      imagesLink: payload.imagesLink || "",
      subscriptionType: payload.subscriptionType,
      subscriptionDate: payload.subscriptionDate || "",
      pin: payload.pin || "",
    };

    const res = await fetch(`/api/admin/properties/${payload.propertyNumber}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || "فشل في تحديث العقار");
    }

    return res.json();
  },

  onSuccess: () => {
    queryClient.invalidateQueries({ queryKey: ["admin-properties"] });

    import("@/hooks/use-toast").then(({ toast }) => {
      toast({
        title: "تم الحفظ",
        description: "تم تحديث العقار بنجاح",
      });
    });

    setEditing(null); // يغلق النافذة فقط بعد نجاح فعلي
  },

  onError: (error: any) => {
    console.error("❌ Update Error:", error);

    import("@/hooks/use-toast").then(({ toast }) => {
      toast({
        title: "فشل في التحديث",
        description: error?.message || "حدث خطأ غير متوقع",
        variant: "destructive",
      });
    });
  },
});



  const items = (data || []).filter((p) =>
    filter
      ? p.name.includes(filter) ||
        p.propertyNumber.includes(filter) ||
        (p.city || "").includes(filter)
      : true
  );

  const startNew = () => {
    setIsNew(true);
    setEditing({
      propertyNumber: "",
      name: "",
      pin: "",
      city: "",
      direction: "",
      type: "",
      location: "",
      whatsappNumber: "",
      facilities: "",
      imagesLink: "",
      subscriptionType: "عادي",
      subscriptionDate: null,
      imageUrls: [],
    } as Property);
  };

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">إدارة العقارات</h2>
          <p className="text-xs text-muted-foreground">عرض وتعديل جميع العقارات.</p>
        </div>

        <div className="flex items-center gap-2">
          <Input
            placeholder="بحث بالاسم / رقم العقار / المدينة"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            className="w-56"
          />
          <Button onClick={startNew} size="sm">
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
                  <Td>{p.subscriptionType}</Td>
                  <Td>
                    <Button
                      size="icon"
                      variant="ghost"
                      onClick={() => {
                        setIsNew(false);
                        setEditing(p);
                      }}
                    >
                      <Pencil className="w-4 h-4" />
                    </Button>
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

      <Dialog open={!!editing} onOpenChange={() => setEditing(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{isNew ? "إضافة عقار" : "تعديل العقار"}</DialogTitle>
          </DialogHeader>

          {editing && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {(
                [
                  "propertyNumber",
                  "name",
                  "pin",
                  "city",
                  "direction",
                  "type",
                  "location",
                  "whatsappNumber",
                  "facilities",
                  "imagesLink",
                  "subscriptionType",
                ] as (keyof Property)[]
              ).map((key) => (
                <div key={key}>
                  <label className="text-[11px] font-semibold text-muted-foreground">{key}</label>
                  <Input
                    value={(editing[key] as any) ?? ""}
                    onChange={(e) => setEditing({ ...editing, [key]: e.target.value } as Property)}
                  />
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEditing(null)}>إلغاء</Button>
            <Button onClick={() => editing && mutation.mutate(editing)} disabled={mutation.isPending}>
              {mutation.isPending && <Loader2 className="w-4 h-4 ml-1 animate-spin" />}
              حفظ
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function Th({ children }: any) {
  return <th className="px-3 py-2 text-[11px] md:text-xs font-bold">{children}</th>;
}

function Td({ children, colSpan }: any) {
  return <td colSpan={colSpan} className="px-3 py-2 whitespace-nowrap">{children}</td>;
}
