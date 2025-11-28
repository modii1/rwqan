// client/src/pages/admin/sections/requests.tsx
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Th, Td } from "../components/Table";
import { Loader2 } from "lucide-react";

type AdminRequest = {
  id: string;
  name: string;
  phone: string;
  message: string;
  createdAt: string;
};

export default function RequestsSection() {
  const { data, isLoading } = useQuery<AdminRequest[]>({
    queryKey: ["admin-requests"],
    queryFn: async () => {
      const res = await fetch("/api/admin/requests");
      if (!res.ok) throw new Error("فشل في جلب الطلبات");
      return res.json();
    },
  });

  return (
    <section className="space-y-3">
      {/* ================= عنوان ================= */}
      <div>
        <h2 className="text-lg font-semibold">طلبات العملاء</h2>
        <p className="text-xs text-muted-foreground">
          عرض جميع الطلبات والاقتراحات الواردة من العملاء.
        </p>
      </div>

      {/* ================= جدول ================= */}
      <Card className="overflow-x-auto">
        {isLoading ? (
          <div className="p-4 flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />
            جاري التحميل...
          </div>
        ) : (
          <table className="w-full text-xs md:text-sm">
            <thead className="bg-muted/50 text-right">
              <tr>
                <Th>الاسم</Th>
                <Th>رقم الجوال</Th>
                <Th>الرسالة</Th>
                <Th>التاريخ</Th>
              </tr>
            </thead>

            <tbody>
              {(data || []).map((req) => (
                <tr key={req.id} className="border-t hover:bg-muted/40">
                  <Td>{req.name}</Td>
                  <Td>{req.phone}</Td>
                  <Td>{req.message}</Td>
                  <Td>{req.createdAt}</Td>
                </tr>
              ))}

              {(data || []).length === 0 && (
                <tr>
                  <Td colSpan={4}>
                    <div className="p-4 text-center text-xs text-muted-foreground">
                      لا توجد طلبات حالياً.
                    </div>
                  </Td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </Card>
    </section>
  );
}
