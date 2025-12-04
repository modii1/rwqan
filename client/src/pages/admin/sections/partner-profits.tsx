import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Wallet, Plus, Loader2, Calendar, CreditCard, TrendingUp, Check, Clock, RefreshCw, DollarSign } from "lucide-react";
import type { PartnerProfit } from "@shared/schema";

export default function PartnerProfitsSection() {
  const { toast } = useToast();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [selectedProfit, setSelectedProfit] = useState<PartnerProfit | null>(null);

  const { data: profits = [], isLoading } = useQuery<PartnerProfit[]>({
    queryKey: ["/api/admin/partner-profits"],
  });

  const { data: currentProfit, isLoading: isLoadingCurrent, refetch: refetchCurrent } = useQuery<{
    monthYear: string;
    activeSubscriptions: number;
    totalRevenue: number;
    partnerShare: number;
  }>({
    queryKey: ["/api/admin/partner-profits/current"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiRequest("POST", "/api/admin/partner-profits", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/partner-profits"] });
      setIsAddDialogOpen(false);
      toast({
        title: "تم الإضافة",
        description: "تم إضافة سجل الأرباح بنجاح",
      });
    },
    onError: () => {
      toast({
        title: "خطأ",
        description: "فشل في إضافة سجل الأرباح",
        variant: "destructive",
      });
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      return apiRequest("PUT", `/api/admin/partner-profits/${id}`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/partner-profits"] });
      setSelectedProfit(null);
      toast({
        title: "تم التحديث",
        description: "تم تحديث سجل الأرباح بنجاح",
      });
    },
    onError: () => {
      toast({
        title: "خطأ",
        description: "فشل في تحديث سجل الأرباح",
        variant: "destructive",
      });
    },
  });

  const handleCreateFromCurrent = () => {
    if (!currentProfit) return;
    
    createMutation.mutate({
      monthYear: currentProfit.monthYear,
      activeSubscriptions: currentProfit.activeSubscriptions,
      totalRevenue: currentProfit.totalRevenue,
      partnerShare: currentProfit.partnerShare,
      partnerPercentage: 50,
      transferStatus: "pending",
    });
  };

  const handleMarkTransferred = (profit: PartnerProfit) => {
    updateMutation.mutate({
      id: profit.id,
      data: {
        transferStatus: "completed",
        transferDate: new Date().toISOString(),
      },
    });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "completed":
        return <Badge variant="default" className="bg-green-600">تم التحويل</Badge>;
      case "pending":
        return <Badge variant="secondary">معلق</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card className="bg-gradient-to-l from-emerald-50 to-green-50 dark:from-emerald-950/20 dark:to-green-950/20 border-emerald-200 dark:border-emerald-800">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
            <TrendingUp className="w-5 h-5" />
            أرباح الشهر الحالي
          </CardTitle>
          <CardDescription>
            حساب تلقائي للأرباح بناءً على المدفوعات المكتملة
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoadingCurrent ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin" />
            </div>
          ) : currentProfit ? (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="p-4 rounded-lg bg-white/50 dark:bg-black/20">
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                  <Calendar className="w-4 h-4" />
                  الشهر
                </div>
                <p className="text-lg font-bold">{currentProfit.monthYear}</p>
              </div>
              <div className="p-4 rounded-lg bg-white/50 dark:bg-black/20">
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                  <CreditCard className="w-4 h-4" />
                  الاشتراكات
                </div>
                <p className="text-lg font-bold">{currentProfit.activeSubscriptions}</p>
              </div>
              <div className="p-4 rounded-lg bg-white/50 dark:bg-black/20">
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                  <DollarSign className="w-4 h-4" />
                  الإيرادات
                </div>
                <p className="text-lg font-bold">{currentProfit.totalRevenue.toLocaleString()} ريال</p>
              </div>
              <div className="p-4 rounded-lg bg-emerald-100 dark:bg-emerald-900/30">
                <div className="flex items-center gap-2 text-sm text-emerald-700 dark:text-emerald-400 mb-1">
                  <Wallet className="w-4 h-4" />
                  نصيب الشريك (50%)
                </div>
                <p className="text-lg font-bold text-emerald-700 dark:text-emerald-400">
                  {currentProfit.partnerShare.toLocaleString()} ريال
                </p>
              </div>
            </div>
          ) : (
            <p className="text-center text-muted-foreground py-4">لا توجد بيانات</p>
          )}
          
          <div className="flex gap-2 mt-4 pt-4 border-t">
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetchCurrent()}
              className="gap-2"
              data-testid="button-refresh-current"
            >
              <RefreshCw className="w-4 h-4" />
              تحديث
            </Button>
            <Button
              size="sm"
              onClick={handleCreateFromCurrent}
              disabled={!currentProfit || createMutation.isPending}
              className="gap-2 bg-emerald-600 hover:bg-emerald-700"
              data-testid="button-create-from-current"
            >
              {createMutation.isPending ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Plus className="w-4 h-4" />
              )}
              حفظ كسجل جديد
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Wallet className="w-5 h-5" />
                سجل الأرباح الشهرية
              </CardTitle>
              <CardDescription>
                تتبع أرباح الشريك بنسبة 50% من الإيرادات
              </CardDescription>
            </div>
            <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="gap-2" data-testid="button-add-profit">
                  <Plus className="w-4 h-4" />
                  إضافة سجل
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>إضافة سجل أرباح جديد</DialogTitle>
                  <DialogDescription>
                    أدخل بيانات الأرباح للشهر
                  </DialogDescription>
                </DialogHeader>
                <AddProfitForm
                  onSubmit={(data) => createMutation.mutate(data)}
                  isPending={createMutation.isPending}
                />
              </DialogContent>
            </Dialog>
          </div>
        </CardHeader>
        <CardContent>
          {profits.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Wallet className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>لا توجد سجلات أرباح بعد</p>
            </div>
          ) : (
            <div className="space-y-3">
              {profits.map((profit) => (
                <div
                  key={profit.id}
                  className="flex items-center justify-between p-4 rounded-lg border hover-elevate"
                >
                  <div className="flex items-center gap-4">
                    <div className="p-2 rounded-lg bg-primary/10">
                      <Calendar className="w-5 h-5 text-primary" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{profit.monthYear}</span>
                        {getStatusBadge(profit.transferStatus)}
                      </div>
                      <div className="text-sm text-muted-foreground mt-1">
                        {profit.activeSubscriptions} اشتراك | {profit.totalRevenue.toLocaleString()} ريال إيرادات
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-left">
                      <p className="text-sm text-muted-foreground">نصيب الشريك</p>
                      <p className="font-bold text-emerald-600">{profit.partnerShare.toLocaleString()} ريال</p>
                    </div>
                    {profit.transferStatus === "pending" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => handleMarkTransferred(profit)}
                        disabled={updateMutation.isPending}
                        className="gap-2"
                        data-testid={`button-mark-transferred-${profit.id}`}
                      >
                        <Check className="w-4 h-4" />
                        تم التحويل
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">معلومات النظام</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="p-4 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800">
            <ul className="space-y-2 text-sm text-muted-foreground list-disc list-inside">
              <li>يتم حساب الأرباح تلقائياً بناءً على المدفوعات المكتملة</li>
              <li>نسبة الشريك الافتراضية: 50% من الإيرادات</li>
              <li>يمكن تحويل الأرباح شهرياً في تاريخ محدد</li>
              <li>تأكد من تحديث حالة التحويل بعد إتمام العملية</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function AddProfitForm({ 
  onSubmit, 
  isPending 
}: { 
  onSubmit: (data: any) => void; 
  isPending: boolean;
}) {
  const [formData, setFormData] = useState({
    monthYear: "",
    activeSubscriptions: 0,
    totalRevenue: 0,
    partnerPercentage: 50,
    notes: "",
  });

  const partnerShare = Math.round(formData.totalRevenue * (formData.partnerPercentage / 100) * 100) / 100;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({
      ...formData,
      partnerShare,
      transferStatus: "pending",
    });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>الشهر/السنة</Label>
          <Input
            placeholder="مثال: 2025/01"
            value={formData.monthYear}
            onChange={(e) => setFormData({ ...formData, monthYear: e.target.value })}
            required
            data-testid="input-month-year"
          />
        </div>
        <div className="space-y-2">
          <Label>عدد الاشتراكات</Label>
          <Input
            type="number"
            value={formData.activeSubscriptions}
            onChange={(e) => setFormData({ ...formData, activeSubscriptions: parseInt(e.target.value) || 0 })}
            required
            data-testid="input-subscriptions"
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>إجمالي الإيرادات (ريال)</Label>
          <Input
            type="number"
            step="0.01"
            value={formData.totalRevenue}
            onChange={(e) => setFormData({ ...formData, totalRevenue: parseFloat(e.target.value) || 0 })}
            required
            data-testid="input-revenue"
          />
        </div>
        <div className="space-y-2">
          <Label>نسبة الشريك (%)</Label>
          <Input
            type="number"
            min="0"
            max="100"
            value={formData.partnerPercentage}
            onChange={(e) => setFormData({ ...formData, partnerPercentage: parseFloat(e.target.value) || 50 })}
            required
            data-testid="input-percentage"
          />
        </div>
      </div>

      <div className="p-4 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">نصيب الشريك المحسوب:</span>
          <span className="font-bold text-emerald-600">{partnerShare.toLocaleString()} ريال</span>
        </div>
      </div>

      <div className="space-y-2">
        <Label>ملاحظات (اختياري)</Label>
        <Textarea
          value={formData.notes}
          onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
          placeholder="أي ملاحظات إضافية..."
          data-testid="input-notes"
        />
      </div>

      <Button type="submit" className="w-full" disabled={isPending} data-testid="button-submit-profit">
        {isPending ? (
          <Loader2 className="w-4 h-4 animate-spin ml-2" />
        ) : null}
        إضافة السجل
      </Button>
    </form>
  );
}
