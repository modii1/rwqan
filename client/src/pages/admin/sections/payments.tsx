// client/src/pages/admin/sections/payments.tsx
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Loader2 } from "lucide-react";
import { Th, Td } from "../components/Table";

type Payment = {
  id: string;
  propertyNumber: string;
  name: string;
  amount: number;
  method: string; // Mada / Apple Pay / Visa / MasterCard / تحصيل يدوي
  status: string; // Paid / Failed / Pending
  date: string;
  receiptUrl?: string;
};

export default function PaymentsSection() {
  const { data, isLoading } = useQuery<Payment[]>({
    queryKey: ["admin-payments"],
    queryFn: async () => {
      const res = await fetch("/api/admin/payments");
      if (!res.ok) throw new Error("فشل في جلب المدفوعات");
      return res.json();
    },
  });

  return (
    <section className="space-y-3">
      {/* ====== العنوان ====== */}
      <div>
        <h2 className="text-lg font-semibold">المدفوعات</h2>
        <p className="text-xs text-muted-foreground">
          عرض جميع عمليات الدفع — اشتراكات، تجديدات، معاملات Paymob.
        </p>
      </div>

      {/* ====== الجدول ====== */}
      <Card className="overflow-x-auto">
        {isLoading ? (
          <div className="p-4 flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />
            جاري تحميل المدفوعات...
          </div>
        ) : (
          <table className="w-full text-xs md:text-sm">
            <thead className="bg-muted/50 text-right">
              <tr>
                <Th>رقم العملية</Th>
                <Th>رقم العقار</Th>
                <Th>الاسم</Th>
                <Th>المبلغ</Th>
                <Th>طريقة الدفع</Th>
                <Th>الحالة</Th>
                <Th>التاريخ</Th>
                <Th>الإيصال</Th>
              </tr>
            </thead>

            <tbody>
              {(data || []).map((p) => (
                <tr key={p.id} className="border-t hover:bg-muted/40">
                  <Td>{p.id}</Td>
                  <Td>{p.propertyNumber}</Td>
                  <Td>{p.name}</Td>
                  <Td className="font-semibold text-green-700">
                    {p.amount} ريال
                  </Td>
                  <Td>{p.method}</Td>
                  <Td>
                    <span
                      className={
                        p.status === "Paid"
                          ? "text-green-600 font-semibold"
                          : p.status === "Pending"
                          ? "text-amber-600 font-semibold"
                          : "text-red-600 font-semibold"
                      }
                    >
                      {p.status}
                    </span>
                  </Td>
                  <Td>{p.date}</Td>
                  <Td>
                    {p.receiptUrl ? (
                      <a
                        href={p.receiptUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-600 underline text-xs"
                      >
                        عرض الإيصال
                      </a>
                    ) : (
                      "-"
                    )}
                  </Td>
                </tr>
              ))}

              {(data || []).length === 0 && (
                <tr>
                  <Td colSpan={8}>
                    <div className="p-4 text-center text-xs text-muted-foreground">
                      لا توجد مدفوعات حتى الآن.
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
