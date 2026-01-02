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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Wallet, Plus, Loader2, Calendar, CreditCard, TrendingUp, Check, Clock, RefreshCw, DollarSign, ArrowUpRight, Receipt, AlertCircle, Percent, Calculator, Trash2, MinusCircle, Banknote } from "lucide-react";
import type { PartnerProfit, Payment, Expense } from "@shared/schema";
import { formatLiveSaudiTime, formatLiveSaudiDate } from "@/lib/dateUtils";

// رسوم Paymob
const PAYMOB_FEE_RATES: Record<string, { percentage: number; fixedFee: number; label: string }> = {
  "mada": { percentage: 1.0, fixedFee: 1, label: "مدى (1% + 1 ر.س)" },
  "visa-local": { percentage: 2.7, fixedFee: 1, label: "Visa/MC (2.7% + 1 ر.س)" },
  "stc": { percentage: 1.0, fixedFee: 1, label: "STC Pay (1% + 1 ر.س)" },
  "apple": { percentage: 2.7, fixedFee: 1, label: "Apple Pay (2.7% + 1 ر.س)" },
  "بطاقة": { percentage: 2.7, fixedFee: 1, label: "بطاقة (2.7% + 1 ر.س)" },
  "Visa": { percentage: 2.7, fixedFee: 1, label: "Visa (2.7% + 1 ر.س)" },
  "MasterCard": { percentage: 2.7, fixedFee: 1, label: "MasterCard (2.7% + 1 ر.س)" },
  "Mada": { percentage: 1.0, fixedFee: 1, label: "مدى (1% + 1 ر.س)" },
  "Apple Pay": { percentage: 2.7, fixedFee: 1, label: "Apple Pay (2.7% + 1 ر.س)" },
  "تحويل بنكي": { percentage: 0, fixedFee: 0, label: "تحويل بنكي (0%)" },
  "default": { percentage: 2.7, fixedFee: 1, label: "افتراضي (2.7% + 1 ر.س)" },
};

const VAT_RATE = 0.15;
const PARTNER_SHARE = 0.50;

function calculateFees(amount: number, paymentMethod: string) {
  const method = (paymentMethod || "").toLowerCase();
  
  let config = PAYMOB_FEE_RATES["default"];
  if (method.includes("mada") || method.includes("مدى")) {
    config = PAYMOB_FEE_RATES["mada"];
  } else if (method.includes("stc")) {
    config = PAYMOB_FEE_RATES["stc"];
  } else if (method.includes("apple")) {
    config = PAYMOB_FEE_RATES["apple"];
  } else if (method.includes("تحويل") || method.includes("bank")) {
    config = PAYMOB_FEE_RATES["تحويل بنكي"];
  } else {
    config = PAYMOB_FEE_RATES[paymentMethod] || PAYMOB_FEE_RATES["default"];
  }
  
  const baseFee = (amount * config.percentage / 100) + config.fixedFee;
  const vatOnFee = baseFee * VAT_RATE;
  const totalFees = baseFee + vatOnFee;
  const netAmount = amount - totalFees;
  const partnerProfit = netAmount * PARTNER_SHARE;
  const ourProfit = netAmount * PARTNER_SHARE;
  
  return {
    feeRate: config.percentage / 100,
    fixedFee: config.fixedFee,
    feeLabel: config.label,
    feeAmount: baseFee,
    vatOnFee,
    totalFees,
    netAmount,
    partnerProfit,
    ourProfit,
  };
}

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
      totalExpenses: number;
      netProfitAfterExpenses: number;
    };
    allTime: {
      totalRevenue: number;
      partnerShare: number;
      paymentsCount: number;
      totalExpenses: number;
      netProfitAfterExpenses: number;
    };
    pendingPayments: number;
    recentPayments: Payment[];
    recentExpenses: Expense[];
  }>({
    queryKey: ["/api/admin/partner-profits/summary"],
  });

  const { data: expenses = [], isLoading: isLoadingExpenses, refetch: refetchExpenses } = useQuery<Expense[]>({
    queryKey: ["/api/admin/expenses"],
  });

  const [isExpenseDialogOpen, setIsExpenseDialogOpen] = useState(false);
  const [isMigrationDialogOpen, setIsMigrationDialogOpen] = useState(false);
  const [migrationData, setMigrationData] = useState<{
    paidSubscriptions: any[];
    totalRevenue: number;
    partnerShare: number;
    isLoading: boolean;
  }>({ paidSubscriptions: [], totalRevenue: 0, partnerShare: 0, isLoading: false });

  const createExpenseMutation = useMutation({
    mutationFn: async (data: any) => {
      return apiRequest("POST", "/api/admin/expenses", data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/expenses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/partner-profits/summary"] });
      setIsExpenseDialogOpen(false);
      toast({
        title: "تمت الإضافة",
        description: "تم إضافة التكلفة بنجاح",
      });
    },
    onError: () => {
      toast({
        title: "خطأ",
        description: "فشل في إضافة التكلفة",
        variant: "destructive",
      });
    },
  });

  const deleteExpenseMutation = useMutation({
    mutationFn: async (id: string) => {
      return apiRequest("DELETE", `/api/admin/expenses/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/expenses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/partner-profits/summary"] });
      toast({
        title: "تم الحذف",
        description: "تم حذف التكلفة بنجاح",
      });
    },
    onError: () => {
      toast({
        title: "خطأ",
        description: "فشل في حذف التكلفة",
        variant: "destructive",
      });
    },
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
      totalExpenses: summary.currentMonth.totalExpenses || 0,
      netProfitAfterExpenses: summary.currentMonth.netProfitAfterExpenses || 0,
      transferStatus: "pending",
    });
  };

  // فتح modal الترحيل وجلب البيانات
  const handleOpenMigration = async () => {
    setMigrationData(prev => ({ ...prev, isLoading: true }));
    setIsMigrationDialogOpen(true);
    
    try {
      const response = await fetch('/api/admin/subscriptions');
      const subscriptions = await response.json();
      
      // جمع الاشتراكات التي لها رسوم (price > 0)
      const paidSubscriptions = subscriptions.filter((sub: any) => {
        const price = parseFloat(String(sub.price || 0));
        return price > 0;
      });
      
      // حساب الإجماليات
      const totalRevenue = paidSubscriptions.reduce((sum: number, sub: any) => {
        const price = parseFloat(String(sub.price || 0));
        return sum + price;
      }, 0);
      const partnerShare = totalRevenue * PARTNER_SHARE;
      
      setMigrationData({
        paidSubscriptions,
        totalRevenue,
        partnerShare,
        isLoading: false,
      });
    } catch (error) {
      toast({
        title: "خطأ",
        description: "فشل في جلب بيانات الاشتراكات",
        variant: "destructive",
      });
      setIsMigrationDialogOpen(false);
      setMigrationData(prev => ({ ...prev, isLoading: false }));
    }
  };

  // تنفيذ الترحيل الفعلي
  const handleConfirmMigration = () => {
    if (migrationData.paidSubscriptions.length === 0) {
      toast({
        title: "لا توجد بيانات",
        description: "لا توجد اشتراكات قديمة للترحيل",
        variant: "destructive",
      });
      return;
    }
    
    createMutation.mutate({
      monthYear: "ترحيل الدورة السابقة",
      activeSubscriptions: migrationData.paidSubscriptions.length,
      totalRevenue: migrationData.totalRevenue,
      partnerShare: migrationData.partnerShare,
      partnerPercentage: 50,
      totalExpenses: 0,
      netProfitAfterExpenses: migrationData.partnerShare,
      transferStatus: "pending",
      notes: `تم ترحيل ${migrationData.paidSubscriptions.length} اشتراك من شيت الاشتراكات | الإجمالي: ${migrationData.totalRevenue.toFixed(2)} ر.س`,
    });
    
    setIsMigrationDialogOpen(false);
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

  const getCategoryBadge = (category: string) => {
    const colors: Record<string, string> = {
      "صيانة": "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
      "إعلانات": "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
      "رواتب": "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
      "استضافة": "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
      "أخرى": "bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400",
    };
    return <Badge className={colors[category] || colors["أخرى"]}>{category}</Badge>;
  };

  return (
    <div className="space-y-6" dir="rtl">
      {/* ملخص الأرباح - الصف الأول */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card className="bg-gradient-to-l from-blue-50 to-sky-50 dark:from-blue-950/20 dark:to-sky-950/20 border-blue-200 dark:border-blue-800">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">الإيرادات (الشهر)</p>
                <p className="text-2xl font-bold text-blue-700 dark:text-blue-400" dir="ltr">
                  {(summary?.currentMonth.totalRevenue || 0).toLocaleString("en-US")} ر.س
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {summary?.currentMonth.paymentsCount || 0} دفعة مكتملة
                </p>
              </div>
              <div className="p-3 rounded-full bg-blue-100 dark:bg-blue-900/30">
                <Banknote className="w-6 h-6 text-blue-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-l from-emerald-50 to-green-50 dark:from-emerald-950/20 dark:to-green-950/20 border-emerald-200 dark:border-emerald-800">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">حصة الشريك (50%)</p>
                <p className="text-2xl font-bold text-emerald-700 dark:text-emerald-400" dir="ltr">
                  {(summary?.currentMonth.partnerShare || 0).toLocaleString("en-US")} ر.س
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  قبل خصم التكاليف
                </p>
              </div>
              <div className="p-3 rounded-full bg-emerald-100 dark:bg-emerald-900/30">
                <TrendingUp className="w-6 h-6 text-emerald-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-l from-red-50 to-rose-50 dark:from-red-950/20 dark:to-rose-950/20 border-red-200 dark:border-red-800">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">التكاليف (الشهر)</p>
                <p className="text-2xl font-bold text-red-600 dark:text-red-400" dir="ltr">
                  -{(summary?.currentMonth.totalExpenses || 0).toLocaleString("en-US")} ر.س
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {expenses.filter(e => {
                    const expDate = new Date(e.date);
                    const now = new Date();
                    return expDate.getMonth() === now.getMonth() && expDate.getFullYear() === now.getFullYear();
                  }).length} تكلفة هذا الشهر
                </p>
              </div>
              <div className="p-3 rounded-full bg-red-100 dark:bg-red-900/30">
                <MinusCircle className="w-6 h-6 text-red-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-l from-amber-50 to-yellow-50 dark:from-amber-950/20 dark:to-yellow-950/20 border-amber-200 dark:border-amber-800">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">صافي الربح (الشهر)</p>
                <p className="text-2xl font-bold text-amber-700 dark:text-amber-400" dir="ltr">
                  {(summary?.currentMonth.netProfitAfterExpenses || 0).toFixed(2)} ر.س
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  بعد خصم التكاليف
                </p>
              </div>
              <div className="p-3 rounded-full bg-amber-100 dark:bg-amber-900/30">
                <Wallet className="w-6 h-6 text-amber-600" />
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* الإجماليات - الصف الثاني */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">إجمالي حصة الشريك</p>
                <p className="text-2xl font-bold" dir="ltr">
                  {(summary?.allTime.partnerShare || 0).toLocaleString("en-US")} ر.س
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
                <p className="text-sm text-muted-foreground">إجمالي التكاليف</p>
                <p className="text-2xl font-bold text-red-600" dir="ltr">
                  -{(summary?.allTime.totalExpenses || 0).toLocaleString("en-US")} ر.س
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  {expenses.length} تكلفة مسجلة
                </p>
              </div>
              <div className="p-3 rounded-full bg-red-100 dark:bg-red-900/30">
                <MinusCircle className="w-6 h-6 text-red-600" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">في انتظار المراجعة</p>
                <p className="text-2xl font-bold text-orange-600" dir="ltr">
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

      {/* قسم إدارة التكاليف */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <CardTitle className="flex items-center gap-2">
                <MinusCircle className="w-5 h-5 text-red-500" />
                إدارة التكاليف والمصروفات
              </CardTitle>
              <CardDescription>
                أضف التكاليف التي يجب خصمها من الأرباح
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetchExpenses()}
                className="gap-2"
                data-testid="button-refresh-expenses"
              >
                <RefreshCw className="w-4 h-4" />
                تحديث
              </Button>
              <Dialog open={isExpenseDialogOpen} onOpenChange={setIsExpenseDialogOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" className="gap-2" data-testid="button-add-expense">
                    <Plus className="w-4 h-4" />
                    إضافة تكلفة
                  </Button>
                </DialogTrigger>
                <DialogContent dir="rtl">
                  <DialogHeader>
                    <DialogTitle>إضافة تكلفة جديدة</DialogTitle>
                    <DialogDescription>
                      أدخل بيانات التكلفة لخصمها من الأرباح
                    </DialogDescription>
                  </DialogHeader>
                  <AddExpenseForm
                    onSubmit={(data) => createExpenseMutation.mutate(data)}
                    isPending={createExpenseMutation.isPending}
                  />
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {isLoadingExpenses ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          ) : expenses.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <MinusCircle className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>لا توجد تكاليف مسجلة</p>
              <p className="text-sm mt-2">اضغط على "إضافة تكلفة" لإضافة أول تكلفة</p>
            </div>
          ) : (
            <div className="space-y-3">
              {expenses.map((expense) => (
                <div
                  key={expense.id}
                  className="flex items-center justify-between p-4 rounded-lg border hover-elevate"
                  data-testid={`expense-row-${expense.id}`}
                >
                  <div className="flex items-center gap-4">
                    <div className="p-2 rounded-lg bg-red-100 dark:bg-red-900/30">
                      <MinusCircle className="w-5 h-5 text-red-600" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold">{expense.title}</span>
                        {getCategoryBadge(expense.category)}
                      </div>
                      <div className="text-sm text-muted-foreground mt-1">
                        {expense.description && <span>{expense.description} | </span>}
                        <span>{formatLiveSaudiDate(expense.date)}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-left">
                      <p className="font-bold text-red-600" dir="ltr">
                        -{expense.amount.toLocaleString("en-US")} ر.س
                      </p>
                    </div>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="text-red-500 hover:text-red-700 hover:bg-red-100"
                      onClick={() => deleteExpenseMutation.mutate(expense.id)}
                      disabled={deleteExpenseMutation.isPending}
                      data-testid={`button-delete-expense-${expense.id}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

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
              {summary.recentPayments.map((payment, index) => {
                const amount = payment.finalAmount || 0;
                const calculatedFees = calculateFees(amount, payment.paymentMethod || '');
                
                // استخدام بيانات Paymob الفعلية إن وُجدت (مثل المدفوعات)
                const paymentData = payment as any;
                const totalFees = paymentData.totalFees !== undefined 
                  ? paymentData.totalFees 
                  : calculatedFees.totalFees;
                const netAmount = paymentData.netAmount !== undefined 
                  ? paymentData.netAmount 
                  : amount - totalFees;
                const partnerProfit = netAmount * PARTNER_SHARE;
                const ourProfit = netAmount * PARTNER_SHARE;
                
                return (
                  <div
                    key={payment.id || index}
                    className="p-4 rounded-lg border"
                  >
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-3">
                        <div
                          className={`p-2 rounded-lg ${
                            payment.status === "مكتمل"
                              ? "bg-green-100 dark:bg-green-900/30"
                              : "bg-gray-100 dark:bg-gray-800"
                          }`}
                        >
                          <CreditCard
                            className={`w-4 h-4 ${
                              payment.status === "مكتمل"
                                ? "text-green-600"
                                : "text-gray-500"
                            }`}
                          />
                        </div>

                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-sm">
                              عقار: {payment.propertyNumber}
                            </span>
                            {getPaymentStatusBadge(payment.status)}
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {payment.paymentMethod} |{" "}
                            {formatLiveSaudiDate(payment.createdAt || "")}
                          </div>
                        </div>
                      </div>

                      <div className="text-left" dir="ltr">
                        <p className="font-bold text-lg">
                          {amount.toLocaleString("en-US")} ريال
                        </p>
                      </div>
                    </div>
                    
                    {payment.status === "مكتمل" && (
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-3 border-t">
                        <div className="text-center p-2 rounded bg-red-50 dark:bg-red-950/20">
                          <div className="flex items-center justify-center gap-1 text-xs text-red-600 mb-1">
                            <Percent className="w-3 h-3" />
                            <span>الرسوم + ض.ق.م</span>
                          </div>
                          <p className="font-semibold text-red-600" dir="ltr">
                            -{totalFees.toFixed(2)} ر.س
                          </p>
                        </div>
                        
                        <div className="text-center p-2 rounded bg-blue-50 dark:bg-blue-950/20">
                          <div className="flex items-center justify-center gap-1 text-xs text-blue-600 mb-1">
                            <Calculator className="w-3 h-3" />
                            <span>الصافي</span>
                          </div>
                          <p className="font-semibold text-blue-600" dir="ltr">
                            {netAmount.toFixed(2)} ر.س
                          </p>
                        </div>
                        
                        <div className="text-center p-2 rounded bg-emerald-50 dark:bg-emerald-950/20">
                          <div className="flex items-center justify-center gap-1 text-xs text-emerald-600 mb-1">
                            <Wallet className="w-3 h-3" />
                            <span>حصة الشريك (50%)</span>
                          </div>
                          <p className="font-semibold text-emerald-600" dir="ltr">
                            {partnerProfit.toFixed(2)} ر.س
                          </p>
                        </div>
                        
                        <div className="text-center p-2 rounded bg-amber-50 dark:bg-amber-950/20">
                          <div className="flex items-center justify-center gap-1 text-xs text-amber-600 mb-1">
                            <TrendingUp className="w-3 h-3" />
                            <span>حصتنا (50%)</span>
                          </div>
                          <p className="font-semibold text-amber-600" dir="ltr">
                            {ourProfit.toFixed(2)} ر.س
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
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
              <Button
                size="sm"
                variant="default"
                onClick={handleOpenMigration}
                disabled={createMutation.isPending || migrationData.isLoading}
                className="gap-2 bg-amber-600 hover:bg-amber-700"
                data-testid="button-migration"
              >
                {migrationData.isLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
                ترحيل
              </Button>
              <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" className="gap-2" data-testid="button-add-profit">
                    <Plus className="w-4 h-4" />
                    إضافة يدوي
                  </Button>
                </DialogTrigger>
                <DialogContent dir="rtl">
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

              {/* Modal تأكيد الترحيل */}
              <Dialog open={isMigrationDialogOpen} onOpenChange={setIsMigrationDialogOpen}>
                <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto" dir="rtl">
                  <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                      <RefreshCw className="w-5 h-5 text-amber-600" />
                      ترحيل الاشتراكات القديمة
                    </DialogTitle>
                    <DialogDescription>
                      سيتم ترحيل جميع الاشتراكات المدفوعة من شيت "الاشتراكات" إلى سجل أرباح الشريك
                    </DialogDescription>
                  </DialogHeader>
                  
                  {migrationData.isLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Loader2 className="w-8 h-8 animate-spin text-amber-600" />
                      <span className="mr-3 text-muted-foreground">جاري جلب البيانات...</span>
                    </div>
                  ) : migrationData.paidSubscriptions.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <AlertCircle className="w-12 h-12 mx-auto mb-3 text-amber-500" />
                      <p>لا توجد اشتراكات مدفوعة للترحيل</p>
                    </div>
                  ) : (
                    <div className="space-y-4">
                      {/* ملخص الترحيل */}
                      <div className="grid grid-cols-3 gap-3">
                        <div className="p-4 rounded-lg bg-blue-50 dark:bg-blue-950/20 text-center">
                          <div className="text-2xl font-bold text-blue-600">
                            {migrationData.paidSubscriptions.length}
                          </div>
                          <div className="text-xs text-muted-foreground">اشتراك مدفوع</div>
                        </div>
                        <div className="p-4 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 text-center">
                          <div className="text-2xl font-bold text-emerald-600" dir="ltr">
                            {migrationData.totalRevenue.toFixed(2)}
                          </div>
                          <div className="text-xs text-muted-foreground">ر.س إجمالي الإيرادات</div>
                        </div>
                        <div className="p-4 rounded-lg bg-amber-50 dark:bg-amber-950/20 text-center">
                          <div className="text-2xl font-bold text-amber-600" dir="ltr">
                            {migrationData.partnerShare.toFixed(2)}
                          </div>
                          <div className="text-xs text-muted-foreground">ر.س حصة الشريك (50%)</div>
                        </div>
                      </div>

                      {/* قائمة الاشتراكات */}
                      <div className="border rounded-lg max-h-60 overflow-y-auto">
                        <table className="w-full text-sm">
                          <thead className="bg-muted/50 sticky top-0">
                            <tr>
                              <th className="p-2 text-right">رقم العقار</th>
                              <th className="p-2 text-right">اسم العقار</th>
                              <th className="p-2 text-right">النوع</th>
                              <th className="p-2 text-left">الرسوم</th>
                            </tr>
                          </thead>
                          <tbody>
                            {migrationData.paidSubscriptions.map((sub: any, idx: number) => (
                              <tr key={idx} className="border-t hover:bg-muted/30">
                                <td className="p-2 font-mono">{sub.propertyNumber}</td>
                                <td className="p-2">{sub.name || "غير معروف"}</td>
                                <td className="p-2">
                                  <Badge variant={sub.subscriptionType === "مميز" ? "default" : "secondary"}>
                                    {sub.subscriptionType || "عادي"}
                                  </Badge>
                                </td>
                                <td className="p-2 text-left font-semibold text-emerald-600" dir="ltr">
                                  {parseFloat(String(sub.price || 0)).toFixed(2)} ر.س
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {/* أزرار التأكيد */}
                      <div className="flex gap-3 pt-4 border-t">
                        <Button
                          variant="outline"
                          className="flex-1"
                          onClick={() => setIsMigrationDialogOpen(false)}
                          data-testid="button-cancel-migration"
                        >
                          إلغاء
                        </Button>
                        <Button
                          className="flex-1 bg-amber-600 hover:bg-amber-700 gap-2"
                          onClick={handleConfirmMigration}
                          disabled={createMutation.isPending}
                          data-testid="button-confirm-migration"
                        >
                          {createMutation.isPending ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            <Check className="w-4 h-4" />
                          )}
                          تأكيد الترحيل
                        </Button>
                      </div>
                    </div>
                  )}
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
                  className="p-4 rounded-lg border hover-elevate"
                >
                  <div className="flex items-center justify-between mb-3">
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
                          {profit.activeSubscriptions} دفعة | <span dir="ltr">{profit.totalRevenue.toLocaleString("en-US")}</span> ر.س إيرادات
                        </div>
                      </div>
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
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-3 border-t">
                    <div className="text-center p-2 rounded bg-emerald-50 dark:bg-emerald-950/20">
                      <div className="text-xs text-emerald-600 mb-1">حصة الشريك</div>
                      <p className="font-semibold text-emerald-600" dir="ltr">
                        {profit.partnerShare.toLocaleString("en-US")} ر.س
                      </p>
                    </div>
                    <div className="text-center p-2 rounded bg-red-50 dark:bg-red-950/20">
                      <div className="text-xs text-red-600 mb-1">التكاليف</div>
                      <p className="font-semibold text-red-600" dir="ltr">
                        -{(profit.totalExpenses || 0).toLocaleString("en-US")} ر.س
                      </p>
                    </div>
                    <div className="text-center p-2 rounded bg-amber-50 dark:bg-amber-950/20">
                      <div className="text-xs text-amber-600 mb-1">صافي الربح</div>
                      <p className="font-semibold text-amber-600" dir="ltr">
                        {(profit.netProfitAfterExpenses || 0).toFixed(2)} ر.س
                      </p>
                    </div>
                    <div className="text-center p-2 rounded bg-blue-50 dark:bg-blue-950/20">
                      <div className="text-xs text-blue-600 mb-1">نسبة الشريك</div>
                      <p className="font-semibold text-blue-600">
                        {profit.partnerPercentage}%
                      </p>
                    </div>
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

const EXPENSE_CATEGORIES = [
  { value: "صيانة", label: "صيانة" },
  { value: "إعلانات", label: "إعلانات" },
  { value: "رواتب", label: "رواتب" },
  { value: "استضافة", label: "استضافة" },
  { value: "أخرى", label: "أخرى" },
];

function AddExpenseForm({ 
  onSubmit, 
  isPending 
}: { 
  onSubmit: (data: { title: string; amount: number; category: string; description: string; date: string }) => void; 
  isPending: boolean;
}) {
  const [formData, setFormData] = useState({
    title: "",
    amount: 0,
    category: "أخرى",
    description: "",
    date: new Date().toISOString().split('T')[0],
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label>عنوان التكلفة</Label>
        <Input
          placeholder="مثال: صيانة السيرفر"
          value={formData.title}
          onChange={(e) => setFormData({ ...formData, title: e.target.value })}
          required
          data-testid="input-expense-title"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>المبلغ (ريال)</Label>
          <Input
            type="number"
            step="0.01"
            min="0"
            value={formData.amount}
            onChange={(e) => setFormData({ ...formData, amount: parseFloat(e.target.value) || 0 })}
            required
            data-testid="input-expense-amount"
          />
        </div>
        <div className="space-y-2">
          <Label>التصنيف</Label>
          <Select
            value={formData.category}
            onValueChange={(value) => setFormData({ ...formData, category: value })}
          >
            <SelectTrigger data-testid="select-expense-category">
              <SelectValue placeholder="اختر التصنيف" />
            </SelectTrigger>
            <SelectContent>
              {EXPENSE_CATEGORIES.map((cat) => (
                <SelectItem key={cat.value} value={cat.value}>
                  {cat.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label>التاريخ</Label>
        <Input
          type="date"
          value={formData.date}
          onChange={(e) => setFormData({ ...formData, date: e.target.value })}
          required
          data-testid="input-expense-date"
        />
      </div>

      <div className="space-y-2">
        <Label>الوصف (اختياري)</Label>
        <Textarea
          value={formData.description}
          onChange={(e) => setFormData({ ...formData, description: e.target.value })}
          placeholder="تفاصيل إضافية عن التكلفة..."
          data-testid="input-expense-description"
        />
      </div>

      <div className="p-4 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">سيتم خصم:</span>
          <span className="font-bold text-red-600" dir="ltr">-{formData.amount.toLocaleString()} ر.س</span>
        </div>
      </div>

      <Button type="submit" className="w-full" disabled={isPending} data-testid="button-submit-expense">
        {isPending ? (
          <Loader2 className="w-4 h-4 animate-spin ml-2" />
        ) : null}
        إضافة التكلفة
      </Button>
    </form>
  );
}
