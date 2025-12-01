import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MessageCircle, BarChart3, Home, LogOut } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function AdminAnalytics() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: analyticsData, isLoading } = useQuery<any>({
    queryKey: ["/api/admin/requests"],
    retry: false,
    refetchOnWindowFocus: false,
  });

  const handleLogout = async () => {
    await fetch("/api/owner/logout", { method: "POST", credentials: "include" });
    toast({ title: "تم تسجيل الخروج", description: "نراك قريباً!" });
    setLocation("/");
  };

  if (isLoading)
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">جاري التحميل...</p>
        </div>
      </div>
    );

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border shadow-sm bg-card">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full flex items-center justify-center bg-primary/10">
              <BarChart3 className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-primary">إحصائيات الطلبات</h1>
              <p className="text-sm text-muted-foreground">لوحة الإدارة</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={handleLogout}>
            <LogOut className="w-4 h-4 ml-2" />
            تسجيل الخروج
          </Button>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
        {/* KPIs */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="p-6">
            <p className="text-sm text-muted-foreground mb-2">إجمالي الطلبات</p>
            <p className="text-3xl font-bold text-primary">
              {analyticsData?.totalRequests || 0}
            </p>
          </Card>
          <Card className="p-6">
            <p className="text-sm text-muted-foreground mb-2">عدد العقارات</p>
            <p className="text-3xl font-bold text-primary">
              {analyticsData?.totalProperties || 0}
            </p>
          </Card>
          <Card className="p-6">
            <p className="text-sm text-muted-foreground mb-2">متوسط الطلبات</p>
            <p className="text-3xl font-bold text-primary">
              {analyticsData?.totalProperties
                ? Math.round(analyticsData.totalRequests / analyticsData.totalProperties)
                : 0}
            </p>
          </Card>
        </div>

        {/* Top Properties */}
        <Card className="p-6">
          <h2 className="text-lg font-bold text-primary mb-4 flex items-center gap-2">
            <Home className="w-5 h-5" />
            أفضل العقارات طلباً
          </h2>
          <div className="space-y-3">
            {analyticsData?.byProperty?.slice(0, 15)?.map((prop: any, idx: number) => (
              <div key={idx} className="flex items-center justify-between p-3 bg-secondary/5 rounded-lg">
                <div>
                  <p className="font-medium">{prop.propertyName}</p>
                  <p className="text-xs text-muted-foreground">رقم {prop.propertyNumber}</p>
                </div>
                <Badge className="bg-primary text-white">
                  {prop.requestCount} طلب
                </Badge>
              </div>
            ))}
          </div>
        </Card>

        {/* Recent Requests */}
        <Card className="p-6">
          <h2 className="text-lg font-bold text-primary mb-4 flex items-center gap-2">
            <MessageCircle className="w-5 h-5" />
            آخر الطلبات
          </h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border">
                <tr className="text-muted-foreground">
                  <th className="text-right p-3">رقم العقار</th>
                  <th className="text-right p-3">كود الطلب</th>
                  <th className="text-right p-3">التاريخ والوقت</th>
                </tr>
              </thead>
              <tbody>
                {analyticsData?.recentRequests?.slice(0, 20)?.map((req: any, idx: number) => (
                  <tr key={idx} className="border-b border-border/50 hover:bg-primary/5">
                    <td className="p-3 font-mono">{req.propertyNumber}</td>
                    <td className="p-3">{req.requestCode || req.id}</td>
                    <td className="p-3 text-muted-foreground">
                      {req.timestamp
                        ? new Date(req.timestamp).toLocaleString("ar-SA")
                        : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </div>
  );
}
