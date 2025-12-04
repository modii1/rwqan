import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, Search } from "lucide-react";

type LogEntry = {
  propertyNumber: string;
  action: string;
  reason?: string;
  date: string;
  admin?: string;
};

export default function VerificationLogsPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "قبول" | "رفض">("all");
  const [loading, setLoading] = useState(true);

  async function loadLogs() {
    setLoading(true);
    const res = await fetch("/api/admin/verification/logs");
    const data = await res.json();
    setLogs(data.reverse()); // ترتيب من الأحدث للأقدم
    setLoading(false);
  }

  useEffect(() => {
    loadLogs();
  }, []);

  const filteredLogs = logs.filter((log) => {
    if (filter !== "all" && log.action !== filter) return false;
    if (search && !log.propertyNumber.includes(search)) return false;
    return true;
  });

  return (
    <div className="p-4 space-y-6" dir="rtl">
      {/* العنوان + زر التحديث */}
      <div className="flex justify-between items-center">
        <h2 className="font-bold text-xl">سجل عمليات التحقق</h2>
        <Button
          size="sm"
          variant="outline"
          onClick={loadLogs}
          className="flex items-center gap-2"
        >
          <RefreshCw className="w-4 h-4" />
          تحديث
        </Button>
      </div>

      {/* البحث والفلاتر */}
      <div className="flex flex-col md:flex-row gap-3">
        <div className="flex flex-1 items-center gap-2">
          <Search className="w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="بحث برقم العقار…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex gap-2">
          <Button
            size="sm"
            variant={filter === "all" ? "default" : "outline"}
            onClick={() => setFilter("all")}
          >
            الكل
          </Button>

          <Button
            size="sm"
            variant={filter === "قبول" ? "default" : "outline"}
            onClick={() => setFilter("قبول")}
          >
            المقبولة
          </Button>

          <Button
            size="sm"
            variant={filter === "رفض" ? "default" : "outline"}
            onClick={() => setFilter("رفض")}
          >
            المرفوضة
          </Button>
        </div>
      </div>

      {/* محتوى السجل */}
      <Card className="p-4">
        {loading ? (
          <div className="flex justify-center py-10">
            <Loader2 className="w-8 h-8 animate-spin" />
          </div>
        ) : filteredLogs.length === 0 ? (
          <p className="text-muted-foreground text-center py-6">
            لا توجد نتائج مطابقة.
          </p>
        ) : (
          <div className="space-y-3 max-h-[550px] overflow-auto">
            {filteredLogs.map((log, i) => (
              <Card key={i} className="p-3">
                <div className="flex justify-between items-center">
                  <div>
                    <p className="font-semibold">عقار #{log.propertyNumber}</p>
                    <p className="text-xs text-muted-foreground">
                      {log.date}
                    </p>
                    {log.admin && (
                      <p className="text-xs text-muted-foreground">
                        بواسطة: {log.admin}
                      </p>
                    )}
                  </div>

                  <Badge
                    className={
                      log.action === "قبول"
                        ? "bg-green-600 text-white"
                        : "bg-red-600 text-white"
                    }
                  >
                    {log.action === "قبول" ? "تم القبول" : "تم الرفض"}
                  </Badge>
                </div>

                {log.reason && (
                  <p className="text-xs text-red-600 mt-2 whitespace-pre-line">
                    السبب: {log.reason}
                  </p>
                )}
              </Card>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
