// client/src/pages/admin/sections/subscriptions.tsx
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { Th, Td } from "../components/Table";

type AdminSubscription = {
  id: string;
  propertyNumber: string;
  name: string;
  subscriptionType: string;
  startDate: string | null;
  endDate: string | null;
  remainingDays: number | null;
  status: "ساري" | "منتهي" | "قريب الانتهاء";
};

export default function SubscriptionsSection() {
  const { data, isLoading } = useQuery<AdminSubscription[]>({
    queryKey: ["admin-subscriptions"],
    queryFn: async () => {
      const res = await fetch("/api/admin/subscriptions");
      if (!res.ok) throw new Error("فشل في جلب الاشتراكات");
      return res.json();
    },
  });

  return (
    <section className="space-y-3">
      {/* ===== العنوان ===== */}
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">إدارة الاشتراكات</h2>
          <p className="text-xs text-muted-foreground">
            متابعة حالة الاشتراكات (ساري / منتهي / قريب الانتهاء) لكل عقار.
          </p>
        </div>
      </div>

      {/* ===== الجدول ===== */}
      <Card className="overflow-x-auto">
        {isLoading ? (
          <div className="p-4 flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />
            جاري تحميل الاشتراكات...
          </div>
        ) : (
          <table className="w-full text-xs md:text-sm">
            <thead className="bg-muted/50 text-right">
              <tr>
                <Th>رقم العقار</Th>
                <Th>الاسم</Th>
                <Th>نوع الاشتراك</Th>
                <Th>تاريخ البداية</Th>
                <Th>تاريخ الانتهاء</Th>
                <Th>الأيام المتبقية</Th>
                <Th>الحالة</Th>
              </tr>
            </thead>
            <tbody>
              {(data || []).map((s) => (
                <tr key={s.id} className="border-t hover:bg-muted/40">
                  <Td>{s.propertyNumber}</Td>
                  <Td>{s.name}</Td>
                  <Td>{s.subscriptionType}</Td>
                  <Td>{s.startDate || "-"}</Td>
                  <Td>{s.endDate || "-"}</Td>
                  <Td>{s.remainingDays ?? "-"}</Td>
                  <Td>
                    <span
                      className={
                        s.status === "ساري"
                          ? "text-green-600 text-xs font-semibold"
                          : s.status === "قريب الانتهاء"
                          ? "text-amber-600 text-xs font-semibold"
                          : "text-red-600 text-xs font-semibold"
                      }
                    >
                      {s.status}
                    </span>
                  </Td>
                </tr>
              ))}

              {(data || []).length === 0 && (
                <tr>
                  <Td colSpan={7}>
                    <div className="p-4 text-center text-xs text-muted-foreground">
                      لا توجد اشتراكات حالياً.
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
