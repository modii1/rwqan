import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MessageCircle, BarChart3, Home, LogOut, TrendingUp, Users, Zap, Smartphone, Monitor, Tablet, MapPin, Clock, Eye, Eye as EyeIcon } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function AdminAnalytics() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: analyticsData, isLoading } = useQuery<any>({
    queryKey: ["/api/admin/analytics"],
    retry: false,
    refetchOnWindowFocus: false,
  });

  const { data: visitorsData } = useQuery<any>({
    queryKey: ["/api/admin/visitors"],
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
      <header className="border-b border-border shadow-sm bg-gradient-to-r from-primary/5 to-primary/10">
        <div className="max-w-7xl mx-auto px-4 py-6 flex items-center justify-between gap-3">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-lg flex items-center justify-center bg-gradient-to-br from-primary to-primary/70 shadow-lg">
              <BarChart3 className="w-8 h-8 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-primary">لوحة الإحصائيات</h1>
              <p className="text-sm text-muted-foreground">إدارة شاملة للزيارات والطلبات</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={handleLogout}>
            <LogOut className="w-4 h-4 ml-2" />
            تسجيل الخروج
          </Button>
        </div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-8 space-y-6">
        {/* KPIs - Row 1 */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="p-6 bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-950 dark:to-blue-900 border-blue-200 dark:border-blue-800">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-muted-foreground mb-2 font-medium">إجمالي الزوار</p>
                <p className="text-4xl font-bold text-blue-600 dark:text-blue-400">
                  {analyticsData?.visitors || 0}
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
              <Home className="w-8 h-8 text-emerald-400 opacity-70" />
            </div>
          </Card>
          <Card className="p-6 bg-gradient-to-br from-purple-50 to-purple-100 dark:from-purple-950 dark:to-purple-900 border-purple-200 dark:border-purple-800">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-sm text-muted-foreground mb-2 font-medium">زوار فريدون</p>
                <p className="text-4xl font-bold text-purple-600 dark:text-purple-400">
                  {analyticsData?.uniqueVisitors || 0}
                </p>
              </div>
              <Eye className="w-8 h-8 text-purple-400 opacity-70" />
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

        {/* Devices & Cities Row */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Devices */}
          <Card className="p-6 border-2 border-primary/20">
            <h2 className="text-xl font-bold text-primary mb-6 flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Smartphone className="w-6 h-6 text-primary" />
              </div>
              توزيع الأجهزة
            </h2>
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 bg-gradient-to-r from-blue-50 to-transparent dark:from-blue-950/30 rounded-lg border border-blue-200 dark:border-blue-800">
                <div className="flex items-center gap-3">
                  <Monitor className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  <span className="font-semibold">أجهزة سطح المكتب</span>
                </div>
                <Badge className="bg-blue-600">{analyticsData?.devices?.desktop || 0}</Badge>
              </div>
              <div className="flex items-center justify-between p-4 bg-gradient-to-r from-green-50 to-transparent dark:from-green-950/30 rounded-lg border border-green-200 dark:border-green-800">
                <div className="flex items-center gap-3">
                  <Smartphone className="w-5 h-5 text-green-600 dark:text-green-400" />
                  <span className="font-semibold">الأجهزة المحمولة</span>
                </div>
                <Badge className="bg-green-600">{analyticsData?.devices?.mobile || 0}</Badge>
              </div>
              <div className="flex items-center justify-between p-4 bg-gradient-to-r from-purple-50 to-transparent dark:from-purple-950/30 rounded-lg border border-purple-200 dark:border-purple-800">
                <div className="flex items-center gap-3">
                  <Tablet className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                  <span className="font-semibold">الأجهزة اللوحية</span>
                </div>
                <Badge className="bg-purple-600">{analyticsData?.devices?.tablet || 0}</Badge>
              </div>
            </div>
          </Card>

          {/* Cities */}
          <Card className="p-6 border-2 border-primary/20">
            <h2 className="text-xl font-bold text-primary mb-6 flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <MapPin className="w-6 h-6 text-primary" />
              </div>
              توزيع المدن
            </h2>
            <div className="space-y-2">
              {analyticsData?.cities?.slice(0, 8)?.map((city: any, idx: number) => (
                <div key={idx} className="flex items-center justify-between p-3 bg-gradient-to-r from-primary/5 to-transparent hover:from-primary/10 rounded-lg border border-primary/10 transition-colors">
                  <div className="flex items-center gap-2">
                    <span className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary">
                      {idx + 1}
                    </span>
                    <span className="font-semibold">{city.name}</span>
                  </div>
                  <Badge variant="outline">{city.count}</Badge>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* Last Updated */}
        <Card className="p-4 bg-gradient-to-r from-primary/5 to-transparent border-primary/20">
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-primary" />
            <span className="text-sm font-semibold">آخر تحديث: {analyticsData?.lastUpdated}</span>
          </div>
        </Card>

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

        {/* Visitor Details */}
        <Card className="p-6 border-2 border-primary/20">
          <div className="mb-6">
            <h2 className="text-xl font-bold text-primary mb-2 flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <Eye className="w-6 h-6 text-primary" />
              </div>
              تفاصيل الزوار
            </h2>
            <p className="text-sm text-muted-foreground">آخر {Math.min(visitorsData?.visitors?.length || 0, 100)} زائر</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b-2 border-primary/20 bg-primary/5">
                  <th className="text-right p-4 font-semibold text-primary">اسم العقار</th>
                  <th className="text-right p-4 font-semibold text-primary">الجهاز</th>
                  <th className="text-right p-4 font-semibold text-primary">IP العميل</th>
                  <th className="text-right p-4 font-semibold text-primary">اليوم والساعة</th>
                  <th className="text-right p-4 font-semibold text-primary">التاريخ والوقت</th>
                </tr>
              </thead>
              <tbody>
                {visitorsData?.visitors?.slice(0, 50)?.map((visitor: any, idx: number) => (
                  <tr key={idx} className="border-b border-border/50 hover:bg-primary/5 transition-colors">
                    <td className="p-4 font-semibold text-foreground">{visitor.propertyName}</td>
                    <td className="p-4">
                      <Badge variant="outline" className="flex w-fit gap-1">
                        {visitor.deviceType === 'mobile' && <Smartphone className="w-3 h-3" />}
                        {visitor.deviceType === 'desktop' && <Monitor className="w-3 h-3" />}
                        {visitor.deviceType === 'tablet' && <Tablet className="w-3 h-3" />}
                        <span>{
                          visitor.deviceType === 'mobile' ? 'جوال' :
                          visitor.deviceType === 'tablet' ? 'تابلت' :
                          'سطح المكتب'
                        }</span>
                      </Badge>
                    </td>
                    <td className="p-4 font-mono text-muted-foreground text-xs">{visitor.ipAddress}</td>
                    <td className="p-4 text-muted-foreground text-xs">{visitor.dayOfWeek} {visitor.hourOfDay}:00</td>
                    <td className="p-4 text-muted-foreground">
                      {visitor.timestamp
                        ? new Date(visitor.timestamp).toLocaleString('en-US', {
                            timeZone: 'Asia/Riyadh',
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit',
                            hour12: true
                          })
                        : "-"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
                        ? new Date(req.timestamp).toLocaleString('en-US', {
                            timeZone: 'Asia/Riyadh',
                            year: 'numeric',
                            month: 'short',
                            day: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit',
                            hour12: true
                          })
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
