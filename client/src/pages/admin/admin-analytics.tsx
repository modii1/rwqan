import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MessageCircle, BarChart3, Home, LogOut, TrendingUp, Users, Zap } from "lucide-react";
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
          <Card className="p-6 bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950 dark:to-blue-900 border-blue-200 dark:border-blue-800">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-muted-foreground mb-2 font-medium">إجمالي الطلبات</p>
                <p className="text-4xl font-bold text-blue-600 dark:text-blue-400">
                  {analyticsData?.totalRequests || 0}
                </p>
              </div>
              <TrendingUp className="w-8 h-8 text-blue-400 opacity-70" />
            </div>
          </Card>
          <Card className="p-6 bg-gradient-to-br from-emerald-50 to-emerald-100 dark:from-emerald-950 dark:to-emerald-900 border-emerald-200 dark:border-emerald-800">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-muted-foreground mb-2 font-medium">عدد العقارات</p>
                <p className="text-4xl font-bold text-emerald-600 dark:text-emerald-400">
                  {analyticsData?.totalProperties || 0}
                </p>
              </div>
              <Users className="w-8 h-8 text-emerald-400 opacity-70" />
            </div>
          </Card>
          <Card className="p-6 bg-gradient-to-br from-amber-50 to-amber-100 dark:from-amber-950 dark:to-amber-900 border-amber-200 dark:border-amber-800">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-muted-foreground mb-2 font-medium">متوسط الطلبات</p>
                <p className="text-4xl font-bold text-amber-600 dark:text-amber-400">
                  {analyticsData?.totalProperties
                    ? Math.round(analyticsData.totalRequests / analyticsData.totalProperties)
                    : 0}
                </p>
              </div>
              <Zap className="w-8 h-8 text-amber-400 opacity-70" />
            </div>
          </Card>
        </div>

        {/* Top Properties */}
        <Card className="p-6 border-2 border-primary/20">
          <div className="mb-6">
            <h2 className="text-xl font-bold text-primary mb-2 flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Home className="w-6 h-6 text-primary" />
              </div>
              أفضل العقارات طلباً
            </h2>
            <p className="text-sm text-muted-foreground">ترتيب العقارات حسب عدد الطلبات</p>
          </div>
          <div className="space-y-2">
            {analyticsData?.byProperty?.slice(0, 15)?.map((prop: any, idx: number) => (
              <div
                key={idx}
                className="flex items-center justify-between p-4 bg-gradient-to-r from-primary/5 to-transparent hover:from-primary/10 rounded-lg border border-primary/10 transition-colors"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-3">
                    <span className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary">
                      {idx + 1}
                    </span>
                    <div>
                      <p className="font-semibold text-foreground">{prop.propertyName}</p>
                      <p className="text-xs text-muted-foreground">#{prop.propertyNumber}</p>
                    </div>
                  </div>
                </div>
                <Badge className="bg-primary text-white px-3 py-1 text-sm">
                  {prop.requestCount}
                </Badge>
              </div>
            ))}
          </div>
        </Card>

        {/* Recent Requests */}
        <Card className="p-6 border-2 border-primary/20">
          <div className="mb-6">
            <h2 className="text-xl font-bold text-primary mb-2 flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <MessageCircle className="w-6 h-6 text-primary" />
              </div>
              آخر الطلبات
            </h2>
            <p className="text-sm text-muted-foreground">آخر {Math.min(analyticsData?.recentRequests?.length || 0, 20)} طلب</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-primary/20 bg-primary/5">
                  <th className="text-right p-4 font-semibold text-primary">رقم العقار</th>
                  <th className="text-right p-4 font-semibold text-primary">كود الطلب</th>
                  <th className="text-right p-4 font-semibold text-primary">التاريخ والوقت</th>
                </tr>
              </thead>
              <tbody>
                {analyticsData?.recentRequests?.slice(0, 20)?.map((req: any, idx: number) => (
                  <tr key={idx} className="border-b border-border/50 hover:bg-primary/5 transition-colors">
                    <td className="p-4 font-mono font-semibold">{req.propertyNumber}</td>
                    <td className="p-4 text-foreground">{req.requestCode || req.id}</td>
                    <td className="p-4 text-muted-foreground">
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
