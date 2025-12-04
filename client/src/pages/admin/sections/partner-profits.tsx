import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Wallet, Plus, Loader2, Calendar, CreditCard, TrendingUp, Check, Clock, RefreshCw, DollarSign, ArrowUpRight, Receipt, AlertCircle } from "lucide-react";
import type { PartnerProfit, Payment } from "@shared/schema";

export default function PartnerProfitsSection() {
  const { toast } = useToast();
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);

  const { data: profits = [], isLoading } = useQuery<PartnerProfit[]>({
    queryKey: ["/api/admin/partner-profits"],
  });

  const { data: summary, isLoading: isLoadingSummary, refetch: refetchSummary } = useQuery<{
    currentMonth: {
      monthYear: string;
      totalRevenue: number;
      partnerShare: number;
      paymentsCount: number;
    };
    allTime: {
      totalRevenue: number;
      partnerShare: number;
      paymentsCount: number;
    };
    pendingPayments: number;
    recentPayments: Payment[];
  }>({
    queryKey: ["/api/admin/partner-profits/summary"],
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
    if (!summary?.currentMonth) return;
    
    createMutation.mutate({
      monthYear: summary.currentMonth.monthYear,
      activeSubscriptions: summary.currentMonth.paymentsCount,
      totalRevenue: summary.currentMonth.totalRevenue,
      partnerShare: summary.currentMonth.partnerShare,
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

  const getPaymentStatusBadge = (status: string) => {
    switch (status) {
      case "مكتمل":
      case "نجحت":
        return <Badge variant="default" className="bg-green-600">مكتمل</Badge>;
      case "قيد المراجعة":
        return <Badge variant="secondary">قيد المراجعة</Badge>;
      case "معلق":
        return <Badge variant="outline">معلق</Badge>;
      case "فشل":
        return <Badge variant="destructive">فشل</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  if (isLoading || isLoadingSummary) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-gradient-to-l from-emerald-50 to-green-50 dark:from-emerald-950/20 dark:to-green-950/20 border-emerald-200 dark:border-emerald-800">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">الشهر الحالي</p>
                <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-400">
                  {summary?.currentMonth.partnerShare.toLocaleString() || 0} ريال
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {summary?.currentMonth.paymentsCount || 0} دفعة مكتملة
                </p>
              </div>
              <div className="p-3 rounded-full bg-emerald-100 dark:bg-emerald-900/30">
                <TrendingUp className="w-6 h-6 text-emerald-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">إجمالي الأرباح</p>
                <p className="text-2xl font-bold">
                  {summary?.allTime.partnerShare.toLocaleString() || 0} ريال
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {summary?.allTime.paymentsCount || 0} دفعة إجمالية
                </p>
              </div>
              <div className="p-3 rounded-full bg-primary/10">
                <Wallet className="w-6 h-6 text-primary" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">في انتظار المراجعة</p>
                <p className="text-2xl font-bold text-orange-600">
                  {summary?.pendingPayments || 0}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  دفعات تحتاج موافقة
                </p>
              </div>
              <div className="p-3 rounded-full bg-orange-100 dark:bg-orange-900/30">
                <AlertCircle className="w-6 h-6 text-orange-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Receipt className="w-5 h-5" />
                آخر المدفوعات
              </CardTitle>
              <CardDescription>
                المدفوعات التي تؤثر على حساب الأرباح
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => refetchSummary()}
              className="gap-2"
              data-testid="button-refresh-payments"
            >
              <RefreshCw className="w-4 h-4" />
              تحديث
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {summary?.recentPayments && summary.recentPayments.length > 0 ? (
            <div className="space-y-3">
              {summary.recentPayments.map((payment, index) => (
                <div
                  key={payment.id || index}
                  className="flex items-center justify-between p-3 rounded-lg border"
                >
                  <div className="flex items-center gap-3">
                    <div className={`p-2 rounded-lg ${
                      payment.status === "مكتمل"
                        ? "bg-green-100 dark:bg-green-900/30"
                        : "bg-gray-100 dark:bg-gray-800"
                    }`}>
                      <CreditCard className={`w-4 h-4 ${
                        payment.status === "مكتمل"
                          ? "text-green-600"
                          : "text-gray-500"
                      }`} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">عقار: {payment.propertyNumber}</span>
                        {getPaymentStatusBadge(payment.status)}
                      </div>
                      <div className="text-xs text-muted-foreground mt-0.5">
                        {payment.paymentMethod} | {new Date(payment.createdAt || "").toLocaleDateString("ar-SA")}
                      </div>
                    </div>
                  </div>
                  <div className="text-left">
                    <p className="font-bold">{payment.finalAmount?.toLocaleString()} ريال</p>
                    {payment.status === "مكتمل" && (
                      <p className="text-xs text-emerald-600">
                        الشريك: {((payment.finalAmount || 0) * 0.5).toLocaleString()} ريال
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Receipt className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>لا توجد مدفوعات بعد</p>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Wallet className="w-5 h-5" />
                سجل أرباح الشريك
              </CardTitle>
              <CardDescription>
                تتبع أرباح الشريك بنسبة 50% من الإيرادات شهرياً
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={handleCreateFromCurrent}
                disabled={!summary?.currentMonth || createMutation.isPending}
                className="gap-2"
                data-testid="button-save-current-month"
              >
                {createMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <ArrowUpRight className="w-4 h-4" />
                )}
                حفظ الشهر الحالي
              </Button>
              <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" className="gap-2" data-testid="button-add-profit">
                    <Plus className="w-4 h-4" />
                    إضافة يدوي
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>إضافة سجل أرباح يدوي</DialogTitle>
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
          </div>
        </CardHeader>
        <CardContent>
          {profits.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Wallet className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>لا توجد سجلات أرباح محفوظة بعد</p>
              <p className="text-sm mt-2">اضغط على "حفظ الشهر الحالي" لحفظ أول سجل</p>
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
                        {profit.activeSubscriptions} دفعة | {profit.totalRevenue.toLocaleString()} ريال إيرادات
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
          <CardTitle className="text-base">كيف يعمل نظام الأرباح</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="p-4 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800">
            <ul className="space-y-2 text-sm text-muted-foreground list-disc list-inside">
              <li>يتم حساب الأرباح تلقائياً من المدفوعات المكتملة (حالة: مكتمل أو نجحت)</li>
              <li>نسبة الشريك الافتراضية: <strong>50%</strong> من كل دفعة</li>
              <li>يمكنك حفظ أرباح الشهر الحالي كسجل ثابت في أي وقت</li>
              <li>بعد تحويل الأرباح للشريك، اضغط "تم التحويل" لتوثيق العملية</li>
              <li>المدفوعات "قيد المراجعة" لا تُحسب في الأرباح حتى يتم اعتمادها</li>
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
          <Label>عدد الدفعات</Label>
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
