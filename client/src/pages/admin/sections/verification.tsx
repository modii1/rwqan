import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { Loader2, RefreshCw, Search } from "lucide-react";
import type { Property } from "@shared/schema";

type Level = "ok" | "warning" | "danger";

type VerificationStatus = {
  level: Level;
  label: string;
  issues: string[];
};

// ⬇️ تنسيق رقم الواتساب
function normalizePhone(phone: string): string {
  const digits = phone.replace(/[^\d]/g, "");
  if (!digits) return "";
  if (digits.startsWith("00966")) return digits.slice(4);
  if (digits.startsWith("966")) return digits;
  if (digits.startsWith("0")) return `966${digits.slice(1)}`;
  return `966${digits}`;
}

// ⬇️ فتح واتساب
function openWhatsApp(phone: string, text: string) {
  const normalized = normalizePhone(phone);
  if (!normalized) return;
  const url = `https://wa.me/${normalized}?text=${encodeURIComponent(text)}`;
  window.open(url, "_blank");
}

// ⬇️ تحليل حالة التحقق
function getVerificationStatus(p: Property): VerificationStatus {
  const issues: string[] = [];

  if (!p.name?.trim()) issues.push("اسم العقار غير موجود");
  if (!p.propertyNumber?.toString().trim()) issues.push("رقم العقار غير موجود");
  if (!p.whatsappNumber?.toString().trim()) issues.push("لا يوجد رقم واتساب للمالك");
  if (!p.city?.trim()) issues.push("المدينة غير محددة");
  if (!p.location?.trim()) issues.push("الموقع غير محدد");
  if (!p.direction?.trim()) issues.push("الاتجاه غير محدد");
  if (!p.type?.trim()) issues.push("نوع العقار غير محدد");
  if (!p.imagesLink?.trim()) issues.push("لا يوجد رابط للصور");

  const hasAnyPrice =
    !!p.prices?.display ||
    !!p.prices?.weekday ||
    !!p.prices?.weekend ||
    !!p.prices?.overnight ||
    !!p.prices?.special ||
    !!p.prices?.holidays;

  if (!hasAnyPrice) issues.push("لم يتم إدخال أي أسعار للعقار");

  // التحقق من تاريخ آخر تحديث (أكثر من 3 أشهر)
  const threeMonthsAgo = new Date();
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  
  if (p.updatedAt) {
    const lastUpdate = new Date(p.updatedAt);
    if (lastUpdate < threeMonthsAgo) {
      issues.push("لم يُحدّث منذ أكثر من 3 أشهر");
    }
  }

  // التحقق من اشتراك منتهي منذ أكثر من 50 يوم (اشتراك عادي/مجاني قديم)
  const fiftyDaysAgo = new Date();
  fiftyDaysAgo.setDate(fiftyDaysAgo.getDate() - 50);
  
  if (p.subscriptionDate && p.subscriptionType === "عادي") {
    const subDate = new Date(p.subscriptionDate);
    if (subDate < fiftyDaysAgo) {
      issues.push("اشتراك عادي قديم (أكثر من 50 يوم)");
    }
  }

  let level: Level = "ok";
  if (issues.length > 0) level = "warning";
  
  // معايير "مراجعة" الجديدة
  if (
    issues.some((i) =>
      i.includes("لم يُحدّث منذ أكثر من 3 أشهر") ||
      i.includes("اشتراك عادي قديم")
    )
  ) {
    level = "danger";
  }

  const label =
    level === "ok"
      ? "مكتمل"
      : level === "warning"
      ? "يحتاج بيانات"
      : "مراجعة";

  return { level, label, issues };
}

export default function AdminVerificationSection() {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<Level | "all">("all");
  const [loadingApprove, setLoadingApprove] = useState<string | null>(null);
  const [loadingReject, setLoadingReject] = useState<string | null>(null);
  const { toast } = useToast();

  const { data, isLoading, refetch } = useQuery<Property[]>({
    queryKey: ["/api/admin/properties"],
  });

  const propertiesWithStatus = useMemo(() => {
    if (!data) return [];
    return data.map((p) => ({
      property: p,
      status: getVerificationStatus(p),
    }));
  }, [data]);

  const filtered = useMemo(() => {
    return propertiesWithStatus.filter(({ property, status }) => {
      if (filter !== "all" && status.level !== filter) return false;

      const q = search.trim();
      if (!q) return true;

      const qLower = q.toLowerCase();
      return (
        property.propertyNumber?.toString().includes(q) ||
        property.name?.toLowerCase().includes(qLower) ||
        property.city?.toLowerCase().includes(qLower)
      );
    });
  }, [propertiesWithStatus, search, filter]);

  const stats = useMemo(() => {
    const total = propertiesWithStatus.length;
    const ok = propertiesWithStatus.filter((p) => p.status.level === "ok").length;
    const warn = propertiesWithStatus.filter((p) => p.status.level === "warning").length;
    const danger = propertiesWithStatus.filter((p) => p.status.level === "danger").length;

    const noWhatsapp = propertiesWithStatus.filter(
      (p) => !p.property.whatsappNumber
    ).length;

    const noImages = propertiesWithStatus.filter(
      (p) => !p.property.imagesLink
    ).length;

    return { total, ok, warn, danger, noWhatsapp, noImages };
  }, [propertiesWithStatus]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64" dir="rtl">
        <Loader2 className="w-6 h-6 animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-4 space-y-6" dir="rtl">

      {/* 📊 الإحصائيات */}
      <Card className="p-4">
        <div className="flex justify-between items-center mb-4">
  <h2 className="font-bold text-xl">نظام التحقق من بيانات العقار</h2>

  <div className="flex items-center gap-2">
    {/* زر سجل التحقق */}
    <Button
      variant="secondary"
      size="sm"
      onClick={() => (window.location.href = "/admin/verification-logs")}
      className="flex items-center gap-1 bg-yellow-600 hover:bg-yellow-700 text-white"
    >
      📄 سجل التحقق
    </Button>

    {/* زر تحديث */}
    <Button
      variant="outline"
      size="sm"
      onClick={() => refetch()}
      className="flex items-center gap-1"
    >
      <RefreshCw className="w-4 h-4" />
      تحديث
    </Button>
  </div>
</div>


        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 text-center">
          <Card className="p-3">
            <p className="text-xs text-muted-foreground">إجمالي العقارات</p>
            <p className="font-bold text-lg">{stats.total}</p>
          </Card>

          <Card className="p-3">
            <p className="text-xs text-muted-foreground">مكتملة</p>
            <p className="font-bold text-lg text-green-600">{stats.ok}</p>
          </Card>

          <Card className="p-3">
            <p className="text-xs text-muted-foreground">تحتاج بيانات</p>
            <p className="font-bold text-lg text-yellow-600">{stats.warn}</p>
          </Card>

          <Card className="p-3">
            <p className="text-xs text-muted-foreground">مراجعة</p>
            <p className="font-bold text-lg text-orange-600">{stats.danger}</p>
          </Card>

          <Card className="p-3">
            <p className="text-xs text-muted-foreground">بدون واتساب</p>
            <p className="font-bold text-lg text-red-500">{stats.noWhatsapp}</p>
          </Card>

          <Card className="p-3">
            <p className="text-xs text-muted-foreground">بدون صور</p>
            <p className="font-bold text-lg text-red-500">{stats.noImages}</p>
          </Card>
        </div>
      </Card>

      {/* 🔎 البحث / الفلترة */}
      <div className="flex flex-col md:flex-row gap-3">
        <div className="flex-1 flex items-center gap-2">
          <Search className="w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="بحث برقم العقار، الاسم أو المدينة…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <div className="flex gap-2">
          <Button variant={filter === "all" ? "default" : "outline"} size="sm" onClick={() => setFilter("all")}>
            الكل
          </Button>
          <Button variant={filter === "ok" ? "default" : "outline"} size="sm" onClick={() => setFilter("ok")}>
            مكتملة
          </Button>
          <Button variant={filter === "warning" ? "default" : "outline"} size="sm" onClick={() => setFilter("warning")}>
            تحتاج بيانات
          </Button>
          <Button variant={filter === "danger" ? "default" : "outline"} size="sm" onClick={() => setFilter("danger")}>
            مراجعة
          </Button>
        </div>
      </div>

      {/* 🏡 قائمة العقارات */}
      <Card className="p-4">
        <div className="space-y-3 max-h-[520px] overflow-auto">

          {filtered.length === 0 && (
            <p className="text-sm text-muted-foreground">
              لا توجد عقارات مطابقة للبحث.
            </p>
          )}

          {filtered.map(({ property, status }) => (
            <Card key={property.propertyNumber} className="p-3 flex flex-col gap-2">

              {/* ———————————— معلومات العقار ———————————— */}
              <div className="flex justify-between flex-wrap gap-2">

                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">عقار #{property.propertyNumber}</span>
                    <Badge variant="outline">{property.city || "غير محدد"}</Badge>
                  </div>
                  <p className="text-sm text-muted-foreground">{property.name || "بدون اسم"}</p>
                </div>

                {/* الحالة + أزرار التحكم */}
                <div className="flex items-center gap-2 flex-wrap">

                  <Badge
                    className={
                      status.level === "ok"
                        ? "bg-green-600 text-white"
                        : status.level === "warning"
                        ? "bg-yellow-500 text-black"
                        : "bg-orange-600 text-white"
                    }
                  >
                    {status.label}
                  </Badge>

                  {/* ——— زر قبول ——— */}
                  <Button
                    size="sm"
                    className="bg-green-600 hover:bg-green-700 text-white"
                    disabled={loadingApprove === property.propertyNumber}
                    onClick={async () => {
                      setLoadingApprove(property.propertyNumber);

                      try {
                        const msg = `
شريكنا العزيز،
تم *قبول عقاركم* رقم ${property.propertyNumber} (${property.name || ""}).

العقار الآن ظاهر للعملاء في منصة روقـان ✔✨
`;
                        openWhatsApp(property.whatsappNumber as any, msg);

                        const res = await fetch(
                          `/api/admin/properties/${property.propertyNumber}/approve`,
                          { method: "PUT" }
                        );

                        if (!res.ok) throw new Error();

                        toast({
                          title: "✔️ تم قبول العقار",
                          description: `تم قبول #${property.propertyNumber} بنجاح`,
                        });

                        refetch();
                      } catch {
                        toast({
                          title: "خطأ",
                          description: "لم يتم قبول العقار",
                          variant: "destructive",
                        });
                      }

                      setLoadingApprove(null);
                    }}
                  >
                    {loadingApprove === property.propertyNumber ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      "قبول"
                    )}
                  </Button>

                  {/* ——— زر رفض ——— */}
                  <Button
                    size="sm"
                    className="bg-red-600 hover:bg-red-700 text-white"
                    disabled={loadingReject === property.propertyNumber}
                    onClick={async () => {
                      setLoadingReject(property.propertyNumber);

                      const autoReason =
                        status.issues.length > 0
                          ? status.issues.map((i) => `- ${i}`).join("\n")
                          : "بيانات غير مكتملة";

                      try {
                        const msg = `
شريكنا العزيز،
تم *رفض عقاركم* رقم ${property.propertyNumber} (${property.name || ""}).

أسباب الرفض:
${autoReason}

نرجو استكمال البيانات ثم طلب التحقق مرة أخرى.
`;
                        openWhatsApp(property.whatsappNumber as any, msg);

                        const res = await fetch(
                          `/api/admin/properties/${property.propertyNumber}/reject`,
                          {
                            method: "PUT",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ reason: autoReason }),
                          }
                        );

                        if (!res.ok) throw new Error();

                        toast({
                          title: "❌ تم رفض العقار",
                          description: `تم رفض #${property.propertyNumber}`,
                          variant: "destructive",
                        });

                        refetch();
                      } catch {
                        toast({
                          title: "خطأ",
                          description: "لم يتم رفض العقار",
                          variant: "destructive",
                        });
                      }

                      setLoadingReject(null);
                    }}
                  >
                    {loadingReject === property.propertyNumber ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      "رفض"
                    )}
                  </Button>
                </div>
              </div>

              {/* ——— قائمة المشاكل ——— */}
              {status.issues.length > 0 && (
                <ul className="list-disc pr-5 text-xs text-red-600 space-y-1">
                  {status.issues.map((issue, i) => (
                    <li key={i}>{issue}</li>
                  ))}
                </ul>
              )}
            </Card>
          ))}
        </div>
      </Card>
    </div>
  );
}
