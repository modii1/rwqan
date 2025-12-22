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
  const { data, isLoading } = useQuery<any>({
    queryKey: ["admin-requests"],
    queryFn: async () => {
      const res = await fetch("/api/admin/requests");
      if (!res.ok) throw new Error("فشل في جلب الطلبات");
      return res.json();
    },
  });

  const requests = data?.recentRequests || [];

  return (
    <section className="space-y-3">
      {/* ================= عنوان ================= */}
      <div>
        <h2 className="text-lg font-semibold">طلبات واتساب</h2>
        <p className="text-xs text-muted-foreground">
          إجمالي الطلبات: {data?.totalRequests || 0} | العقارات: {data?.totalProperties || 0}
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
                <Th>رقم العقار</Th>
                <Th>كود الطلب</Th>
                <Th>التاريخ والوقت</Th>
              </tr>
            </thead>

            <tbody>
              {requests && requests.length > 0 ? (
                requests.map((req: any, idx: number) => (
                  <tr key={idx} className="border-t hover:bg-muted/40">
                    <Td>{req.propertyNumber}</Td>
                    <Td className="font-mono">{req.requestCode || req.id}</Td>
                    <Td>{req.timestamp ? new Date(req.timestamp).toLocaleString('en-US', { 
                      timeZone: 'UTC',
                      year: 'numeric',
                      month: '2-digit',
                      day: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                      hour12: true
                    }) : '-'}</Td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={3} className="p-4 text-center text-xs text-muted-foreground">
                    لا توجد طلبات حالياً.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </Card>
    </section>
  );
}
