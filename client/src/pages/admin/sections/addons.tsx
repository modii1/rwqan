import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
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
  CheckCircle
} from "lucide-react";
import { formatLiveSaudiTime, formatLiveSaudiDate } from "@/lib/dateUtils";
import type { AddOnPackage, PropertyAddOn } from "@shared/schema";

export default function AdminAddonsSection() {
  const { toast } = useToast();
  const [searchQuery, setSearchQuery] = useState("");
  const [approveDialogOpen, setApproveDialogOpen] = useState(false);
  const [selectedAddOnId, setSelectedAddOnId] = useState("");
  const [propertyNumberToApprove, setPropertyNumberToApprove] = useState("");

  const { data: packages = [], isLoading: packagesLoading, refetch: refetchPackages } = useQuery<AddOnPackage[]>({
    queryKey: ["/api/owner/addons"],
  });

  const approveMutation = useMutation({
    mutationFn: async (propertyAddOnId: string) => {
      return apiRequest("POST", "/api/admin/addons/approve", { propertyAddOnId });
    },
    onSuccess: () => {
      toast({
        title: "تم التفعيل بنجاح",
        description: "تم تفعيل الإضافة للعقار",
      });
      setApproveDialogOpen(false);
      setSelectedAddOnId("");
      queryClient.invalidateQueries({ queryKey: ["/api/owner/addons"] });
    },
    onError: (error: any) => {
      toast({
        title: "خطأ في التفعيل",
        description: error?.message || "حدث خطأ أثناء تفعيل الإضافة",
        variant: "destructive",
      });
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
            <p className="text-sm text-muted-foreground">باقات الإضافات المتاحة للعقارات</p>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <Button
            variant="outline"
            size="sm"
            onClick={() => refetchPackages()}
            className="gap-2"
            data-testid="button-refresh-addons"
          >
            <RefreshCw className="w-4 h-4" />
            تحديث
          </Button>

          <Dialog open={approveDialogOpen} onOpenChange={setApproveDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-2" data-testid="button-approve-addon">
                <CheckCircle className="w-4 h-4" />
                تفعيل إضافة
              </Button>
            </DialogTrigger>
            <DialogContent dir="rtl">
              <DialogHeader>
                <DialogTitle>تفعيل إضافة بعد التحويل البنكي</DialogTitle>
                <DialogDescription>
                  أدخل معرف الإضافة لتفعيلها بعد التأكد من استلام التحويل البنكي
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <Label htmlFor="addonId">معرف الإضافة (Property Add-On ID)</Label>
                  <Input
                    id="addonId"
                    placeholder="مثال: pa-1234567890"
                    value={selectedAddOnId}
                    onChange={(e) => setSelectedAddOnId(e.target.value)}
                    data-testid="input-addon-id"
                  />
                  <p className="text-xs text-muted-foreground">
                    يمكنك الحصول على هذا المعرف من شيت "إضافات العقارات" في Google Sheets
                  </p>
                </div>
                <Button
                  onClick={handleApprove}
                  disabled={approveMutation.isPending || !selectedAddOnId}
                  className="w-full gap-2"
                  data-testid="button-confirm-approve"
                >
                  {approveMutation.isPending ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      جاري التفعيل...
                    </>
                  ) : (
                    <>
                      <Check className="w-4 h-4" />
                      تفعيل الإضافة
                    </>
                  )}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
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
              <Star className="w-5 h-5 text-amber-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-amber-600">
                {packages.filter(p => p.category === "اعلان").length}
              </p>
              <p className="text-xs text-amber-700/70 dark:text-amber-400/70">باقات إعلان</p>
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
                {packages.filter(p => p.isActive).length}
              </p>
              <p className="text-xs text-emerald-700/70 dark:text-emerald-400/70">باقات نشطة</p>
            </div>
          </div>
        </Card>

        <Card className="p-4 bg-gradient-to-br from-blue-50 to-indigo-100 dark:from-blue-950/50 dark:to-indigo-900/50 border-blue-200 dark:border-blue-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center">
              <DollarSign className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-blue-600">
                {packages.reduce((sum, p) => sum + p.price, 0)} ر.س
              </p>
              <p className="text-xs text-blue-700/70 dark:text-blue-400/70">إجمالي الأسعار</p>
            </div>
          </div>
        </Card>
      </div>

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
                  <CardTitle className="text-base flex items-center gap-2">
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
                <div className="flex items-center gap-2 text-muted-foreground">
                  <DollarSign className="w-4 h-4" />
                  <span className="font-semibold text-foreground">{pkg.price} ر.س</span>
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
        </Card>
      )}
    </div>
  );
}
