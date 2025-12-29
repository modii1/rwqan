import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { 
  Puzzle, 
  Loader2, 
  Check, 
  RefreshCw,
  Search,
  Star,
  DollarSign,
  Calendar,
  Package,
  Zap,
  CheckCircle,
  History,
  Home,
  X,
  ExternalLink,
  Clock
} from "lucide-react";
import { formatLiveSaudiTime, formatLiveSaudiDate } from "@/lib/dateUtils";
import type { AddOnPackage, PropertyAddOn } from "@shared/schema";
import { Th, Td } from "../components/Table";
import riyal from "@/assets/riyal-symbol.png";

export default function AdminAddonsSection() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [approveDialogOpen, setApproveDialogOpen] = useState(false);
  const [selectedAddOnId, setSelectedAddOnId] = useState("");
  const [activeTab, setActiveTab] = useState("packages");

  const { data: packages = [], isLoading: packagesLoading, refetch: refetchPackages } = useQuery<AddOnPackage[]>({
    queryKey: ["/api/owner/addons"],
  });

  const { data: propertyAddOns = [], isLoading: propertyAddOnsLoading, refetch: refetchPropertyAddOns } = useQuery<PropertyAddOn[]>({
    queryKey: ["/api/admin/property-addons"],
  });

  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);

  const approveMutation = useMutation({
    mutationFn: async (propertyAddOnId: string) => {
      setApprovingId(propertyAddOnId);
      return apiRequest("POST", "/api/admin/addons/approve", { propertyAddOnId });
    },
    onSuccess: () => {
      toast({
        title: "تم التفعيل بنجاح",
        description: "تم تفعيل الإضافة للعقار",
      });
      setApproveDialogOpen(false);
      setSelectedAddOnId("");
      setApprovingId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/property-addons"] });
    },
    onError: (error: any) => {
      toast({
        title: "خطأ في التفعيل",
        description: error?.message || "حدث خطأ أثناء تفعيل الإضافة",
        variant: "destructive",
      });
      setApprovingId(null);
    },
  });

  const rejectMutation = useMutation({
    mutationFn: async (propertyAddOnId: string) => {
      setRejectingId(propertyAddOnId);
      return apiRequest("POST", "/api/admin/addons/reject", { propertyAddOnId });
    },
    onSuccess: () => {
      toast({
        title: "تم الرفض",
        description: "تم رفض طلب الإضافة",
      });
      setRejectingId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/admin/property-addons"] });
    },
    onError: (error: any) => {
      toast({
        title: "خطأ في الرفض",
        description: error?.message || "حدث خطأ أثناء رفض الإضافة",
        variant: "destructive",
      });
      setRejectingId(null);
    },
  });

  const handleApprove = () => {
    if (!selectedAddOnId) {
      toast({
        title: "خطأ",
        description: "يرجى إدخال معرف الإضافة",
        variant: "destructive",
      });
      return;
    }
    approveMutation.mutate(selectedAddOnId);
  };

  // فصل الإضافات المعلقة عن الباقي
  const pendingAddOns = propertyAddOns.filter(a => a.status === "pending");
  const otherAddOns = propertyAddOns.filter(a => a.status !== "pending");

  const filteredPackages = packages.filter(pkg =>
    pkg.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    pkg.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const getCategoryColor = (category: string) => {
    switch (category) {
      case "اعلان": return "bg-amber-500";
      case "ابراز": return "bg-purple-500";
      case "تثبيت": return "bg-blue-500";
      case "توثيق": return "bg-emerald-500";
      default: return "bg-slate-500";
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "active":
        return <Badge className="bg-emerald-500 text-white">نشط</Badge>;
      case "expired":
        return <Badge variant="secondary">منتهي</Badge>;
      case "pending":
        return <Badge className="bg-amber-500 text-white">معلق</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const getPackageName = (addOnPackageId: string) => {
    const pkg = packages.find(p => p.id === addOnPackageId);
    return pkg?.name || addOnPackageId;
  };

  if (packagesLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <Loader2 className="w-10 h-10 animate-spin text-primary mx-auto mb-3" />
          <p className="text-muted-foreground text-sm">جاري تحميل الإضافات...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center shadow-lg">
            <Puzzle className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold">إدارة الإضافات</h1>
            <p className="text-sm text-muted-foreground">باقات الإضافات وسجل العقارات</p>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              refetchPackages();
              refetchPropertyAddOns();
            }}
            className="gap-2"
            data-testid="button-refresh-addons"
          >
            <RefreshCw className="w-4 h-4" />
            تحديث
          </Button>

        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-4 bg-gradient-to-br from-violet-50 to-purple-100 dark:from-violet-950/50 dark:to-purple-900/50 border-violet-200 dark:border-violet-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-violet-500/20 flex items-center justify-center">
              <Package className="w-5 h-5 text-violet-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-violet-600">{packages.length}</p>
              <p className="text-xs text-violet-700/70 dark:text-violet-400/70">إجمالي الباقات</p>
            </div>
          </div>
        </Card>

        <Card className="p-4 bg-gradient-to-br from-amber-50 to-orange-100 dark:from-amber-950/50 dark:to-orange-900/50 border-amber-200 dark:border-amber-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center">
              <History className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-amber-600">{propertyAddOns.length}</p>
              <p className="text-xs text-amber-700/70 dark:text-amber-400/70">إجمالي المشتريات</p>
            </div>
          </div>
        </Card>

        <Card className="p-4 bg-gradient-to-br from-emerald-50 to-green-100 dark:from-emerald-950/50 dark:to-green-900/50 border-emerald-200 dark:border-emerald-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 flex items-center justify-center">
              <Zap className="w-5 h-5 text-emerald-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-emerald-600">
                {propertyAddOns.filter(a => a.status === "active").length}
              </p>
              <p className="text-xs text-emerald-700/70 dark:text-emerald-400/70">إضافات نشطة</p>
            </div>
          </div>
        </Card>

        <Card className="p-4 bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-blue-950/50 dark:to-indigo-900/50 border-blue-200 dark:border-blue-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center">
              <Home className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-blue-600">
                {new Set(propertyAddOns.map(a => a.propertyNumber)).size}
              </p>
              <p className="text-xs text-blue-700/70 dark:text-blue-400/70">عقارات مشتركة</p>
            </div>
          </div>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="grid w-full grid-cols-2 max-w-md">
          <TabsTrigger value="packages" className="gap-2" data-testid="tab-addon-packages">
            <Package className="w-4 h-4" />
            باقات الإضافات
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-2" data-testid="tab-addon-history">
            <History className="w-4 h-4" />
            سجل العقارات
          </TabsTrigger>
        </TabsList>

        <TabsContent value="packages" className="space-y-4 mt-4">
          <div className="relative">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="بحث في الباقات..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pr-10"
              data-testid="input-search-addons"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredPackages.map((pkg) => (
              <Card key={pkg.id} className="overflow-hidden" data-testid={`addon-package-${pkg.id}`}>
                <div className={`h-2 ${getCategoryColor(pkg.category)}`} />
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1">
                      <CardTitle className="text-base flex items-center gap-2 flex-wrap">
                        {pkg.name}
                        {pkg.isActive ? (
                          <Badge variant="outline" className="text-emerald-600 border-emerald-300 bg-emerald-50 text-xs">
                            نشط
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-red-600 border-red-300 bg-red-50 text-xs">
                            غير نشط
                          </Badge>
                        )}
                      </CardTitle>
                      <CardDescription className="text-xs mt-1">{pkg.description}</CardDescription>
                    </div>
                    <Badge className={`${getCategoryColor(pkg.category)} text-white text-xs`}>
                      {pkg.category}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <span className="font-semibold text-foreground">{pkg.price}</span>
                      <img src={riyal} alt="ريال" className="w-4 h-4 inline-block opacity-85" />
                    </div>
                    <div className="flex items-center gap-2 text-muted-foreground">
                      <Calendar className="w-4 h-4" />
                      <span>{pkg.durationDays === 0 ? "دائم" : `${pkg.durationDays} يوم`}</span>
                    </div>
                  </div>

                  <div className="mt-3 pt-3 border-t text-xs text-muted-foreground">
                    <span>المعرف: {pkg.id}</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {filteredPackages.length === 0 && (
            <Card className="p-8 text-center">
              <Puzzle className="w-12 h-12 text-muted-foreground/50 mx-auto mb-3" />
              <p className="text-muted-foreground">لا توجد باقات إضافات متاحة</p>
              <p className="text-xs text-muted-foreground mt-1">اذهب إلى قسم الباقات لإنشاء باقة إضافية جديدة</p>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="history" className="space-y-4 mt-4">
          {propertyAddOnsLoading ? (
            <div className="p-4 flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="w-4 h-4 animate-spin" />
              جاري تحميل سجل الإضافات...
            </div>
          ) : (
            <>
              {/* طلبات الإضافات المعلقة */}
              {pendingAddOns.length > 0 && (
                <Card className="border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base flex items-center gap-2">
                      <Clock className="w-5 h-5 text-amber-600" />
                      طلبات معلقة ({pendingAddOns.length})
                    </CardTitle>
                    <CardDescription className="text-xs">
                      إضافات بانتظار الموافقة بعد التحويل البنكي
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="space-y-3">
                      {pendingAddOns.map((addon) => {
                        const pkg = packages.find(p => p.id === addon.addOnPackageId);
                        return (
                          <div 
                            key={addon.id} 
                            className="flex flex-col md:flex-row md:items-center justify-between gap-3 p-3 bg-white dark:bg-background rounded-lg border"
                          >
                            <div className="flex-1 space-y-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <Badge className="bg-amber-500 text-white text-xs">معلق</Badge>
                                <span className="font-bold">{addon.propertyNumber}</span>
                                <span className="text-muted-foreground">-</span>
                                <span className="text-sm">{pkg?.name || addon.addOnPackageId}</span>
                                {pkg && (
                                  <Badge variant="outline" className="text-xs flex items-center gap-1">
                                    <span>{pkg.price}</span>
                                    <img src={riyal} alt="ريال" className="w-3 h-3 inline-block opacity-85" />
                                    <span>/ {pkg.durationDays === 0 ? "دائم" : `${pkg.durationDays} يوم`}</span>
                                  </Badge>
                                )}
                              </div>
                              <div className="text-xs text-muted-foreground flex items-center gap-3 flex-wrap">
                                <span>المعرف: {addon.id}</span>
                                {addon.createdAt && (
                                  <span>التاريخ: {formatLiveSaudiDate(addon.createdAt)}</span>
                                )}
                                {(addon as any).receiptUrl && (
                                  <a 
                                    href={(addon as any).receiptUrl} 
                                    target="_blank" 
                                    rel="noopener noreferrer"
                                    className="text-blue-600 hover:underline flex items-center gap-1"
                                  >
                                    <ExternalLink className="w-3 h-3" />
                                    عرض الإيصال
                                  </a>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <Button
                                size="sm"
                                onClick={() => approveMutation.mutate(addon.id)}
                                disabled={approvingId === addon.id || rejectingId === addon.id}
                                className="gap-1 bg-emerald-600 hover:bg-emerald-700"
                                data-testid={`button-approve-${addon.id}`}
                              >
                                {approvingId === addon.id ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                  <Check className="w-3 h-3" />
                                )}
                                قبول
                              </Button>
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => rejectMutation.mutate(addon.id)}
                                disabled={approvingId === addon.id || rejectingId === addon.id}
                                className="gap-1"
                                data-testid={`button-reject-${addon.id}`}
                              >
                                {rejectingId === addon.id ? (
                                  <Loader2 className="w-3 h-3 animate-spin" />
                                ) : (
                                  <X className="w-3 h-3" />
                                )}
                                رفض
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* سجل الإضافات */}
              <Card className="overflow-x-auto">
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">سجل الإضافات</CardTitle>
                </CardHeader>
                <table className="w-full text-xs md:text-sm" dir="rtl">
                  <thead className="bg-muted/50">
                    <tr>
                      <Th>رقم العقار</Th>
                      <Th>الباقة</Th>
                      <Th>الحالة</Th>
                      <Th>تاريخ البدء</Th>
                      <Th>تاريخ الانتهاء</Th>
                      <Th>المصدر</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {otherAddOns.map((addon) => (
                      <tr key={addon.id} className="border-t hover:bg-muted/40">
                        <Td className="font-medium">{addon.propertyNumber}</Td>
                        <Td>{getPackageName(addon.addOnPackageId)}</Td>
                        <Td>{getStatusBadge(addon.status)}</Td>
                        <Td>{addon.startDate ? formatLiveSaudiDate(addon.startDate) : "-"}</Td>
                        <Td>{addon.endDate ? formatLiveSaudiDate(addon.endDate) : "دائم"}</Td>
                        <Td>
                          <Badge variant="outline" className="text-xs">
                            {addon.source === "paymob" ? "دفع إلكتروني" : 
                             addon.source === "admin" ? "تفعيل يدوي" : 
                             (addon.source === "bank" || addon.source === "bank_transfer") ? "تحويل بنكي" : addon.source || "-"}
                          </Badge>
                        </Td>
                      </tr>
                    ))}

                    {otherAddOns.length === 0 && (
                      <tr>
                        <Td colSpan={6}>
                          <div className="p-4 text-center text-xs text-muted-foreground">
                            لا توجد إضافات عقارات مسجلة حالياً
                          </div>
                        </Td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </Card>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
