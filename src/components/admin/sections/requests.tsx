"use client";
// client/src/pages/admin/sections/requests.tsx
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Th, Td } from "../components/Table";
import { Loader2, Search, Smartphone, Monitor, Tablet } from "lucide-react";
import { formatRequestDate } from "@/lib/dateUtils";

type AdminRequest = {
  id: string;
  name: string;
  phone: string;
  message: string;
  createdAt: string;
};

export default function RequestsSection() {
  const [searchQuery, setSearchQuery] = useState("");
  const [deviceFilter, setDeviceFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  const { data, isLoading } = useQuery<any>({
    queryKey: ["admin-requests"],
    queryFn: async () => {
      const res = await fetch("/api/admin/requests");
      if (!res.ok) throw new Error("فشل في جلب الطلبات");
      return res.json();
    },
  });

  const requests = data?.recentRequests || [];

  const filteredRequests = useMemo(() => {
    let filtered = requests;

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      filtered = filtered.filter((r: any) =>
        (r.propertyNumber || "").toLowerCase().includes(q) ||
        (r.propertyName || "").toLowerCase().includes(q) ||
        (r.requestCode || r.id || "").toLowerCase().includes(q)
      );
    }

    if (deviceFilter !== "all") {
      filtered = filtered.filter((r: any) => {
        const device = r.device || r.deviceType || "";
        return device.toLowerCase() === deviceFilter;
      });
    }

    if (dateFrom) {
      const from = new Date(dateFrom).getTime();
      filtered = filtered.filter((r: any) => {
        const ts = parseInt(r.timestamp);
        return !isNaN(ts) && ts >= from;
      });
    }

    if (dateTo) {
      const to = new Date(dateTo).getTime() + 86400000;
      filtered = filtered.filter((r: any) => {
        const ts = parseInt(r.timestamp);
        return !isNaN(ts) && ts <= to;
      });
    }

    return filtered;
  }, [requests, searchQuery, deviceFilter, dateFrom, dateTo]);

  const activeFiltersCount = 
    (searchQuery ? 1 : 0) + 
    (deviceFilter !== "all" ? 1 : 0) + 
    (dateFrom ? 1 : 0) + 
    (dateTo ? 1 : 0);

  const clearFilters = () => {
    setSearchQuery("");
    setDeviceFilter("all");
    setDateFrom("");
    setDateTo("");
  };

  return (
    <section className="space-y-3" dir="rtl">
      {/* ================= عنوان ================= */}
      <div>
        <h2 className="text-lg font-semibold">طلبات واتساب</h2>
        <p className="text-xs text-muted-foreground">
          إجمالي الطلبات: {data?.totalRequests || 0} | العقارات: {data?.totalProperties || 0}
        </p>
      </div>

      {/* ================= فلاتر البحث ================= */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="بحث برقم أو اسم العقار أو كود الطلب..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-3 pr-9"
          />
        </div>

        <select
          value={deviceFilter}
          onChange={(e) => setDeviceFilter(e.target.value)}
          className="h-10 px-3 rounded-md border border-input bg-background text-sm"
        >
          <option value="all">كل الأجهزة</option>
          <option value="desktop">
            <span className="flex items-center gap-1"><Monitor className="w-3 h-3" /> مكتبي</span>
          </option>
          <option value="mobile">جوال</option>
          <option value="tablet">جهاز لوحي</option>
        </select>

        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground">من:</span>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="h-10 px-3 rounded-md border border-input bg-background text-sm"
          />
        </div>

        <div className="flex items-center gap-1">
          <span className="text-xs text-muted-foreground">إلى:</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="h-10 px-3 rounded-md border border-input bg-background text-sm"
          />
        </div>

        {activeFiltersCount > 0 && (
          <button
            onClick={clearFilters}
            className="h-10 px-3 rounded-md border border-destructive text-destructive text-sm hover:bg-destructive/10"
          >
            مسح ({activeFiltersCount})
          </button>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        عرض {filteredRequests.length} من {requests.length} طلب
      </p>

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
                <Th>اسم العقار</Th>
                <Th>كود الطلب</Th>
                <Th>التاريخ والوقت</Th>
              </tr>
            </thead>

            <tbody>
              {filteredRequests && filteredRequests.length > 0 ? (
                filteredRequests.map((req: any, idx: number) => (
                  <tr key={idx} className="border-t hover:bg-muted/40">
                    <Td>{req.propertyNumber}</Td>
                    <Td>{req.propertyName || "-"}</Td>
                    <Td className="font-mono">{req.requestCode || req.id}</Td>
                    <Td>{formatRequestDate(req.timestamp, true)}</Td>
                  </tr>
                ))
              ) : (
                  <tr>
                    <td colSpan={4} className="p-4 text-center text-xs text-muted-foreground">
                      {activeFiltersCount > 0 ? "لا توجد نتائج مطابقة للفلاتر" : "لا توجد طلبات حالياً."}
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
