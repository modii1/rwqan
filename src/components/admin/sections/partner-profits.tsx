"use client";
import React, { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Wallet,
  Plus,
  Loader2,
  Calendar,
  CreditCard,
  TrendingUp,
  Check,
  Clock,
  RefreshCw,
  DollarSign,
  Receipt,
  AlertCircle,
  MinusCircle,
  Banknote,
  ChevronDown,
  ChevronUp,
  Lock,
  Edit3,
  Trash2,
  AlertTriangle,
} from "lucide-react";
import type { PartnerProfit, Payment, Expense } from "@shared/schema";
import type { LiveDataStatus } from "@shared/liveData";
import { formatLiveSaudiDate } from "@/lib/dateUtils";

const EXPENSE_CATEGORIES = [
  { value: "صيانة", label: "صيانة" },
  { value: "إعلانات", label: "إعلانات" },
  { value: "رواتب", label: "رواتب" },
  { value: "استضافة", label: "استضافة" },
  { value: "أخرى", label: "أخرى" },
];

const EXPENSE_TYPES = [
  { value: "مرة واحدة", label: "مرة واحدة", description: "تُحسب كاملة في تاريخها" },
  { value: "شهرية", label: "شهرية", description: "تُحسب كل شهر" },
  { value: "موزعة", label: "موزعة", description: "مدفوعة مسبقاً وتُوزع على أشهر" },
];

function formatMonthYearInput(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function isEffectivelyClosed(profit: PartnerProfit): boolean {
  return profit.status === "closed" || !profit.status;
}

function canDeleteCycle(profit: PartnerProfit): boolean {
  const transfers = profit.transfers || [];
  return (
    !isEffectivelyClosed(profit) &&
    transfers.length === 0 &&
    (profit.transferredToPartner || 0) === 0
  );
}

function extractApiError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  let message = raw;
  const start = raw.indexOf("{");
  if (start >= 0) {
    try {
      const parsed = JSON.parse(raw.slice(start));
      if (typeof parsed?.error === "string" && parsed.error.trim()) {
        message = parsed.error;
      }
    } catch {
      // Fall through to the raw message.
    }
  }
  // Make the LIVE IAM failure understandable instead of surfacing a raw
  // Firestore PERMISSION_DENIED string.
  if (/PERMISSION_DENIED|permission-denied|Missing or insufficient permissions/i.test(message)) {
    return "صلاحيات Firebase في بيئة LIVE لا تسمح بالكتابة على دورات الأرباح. راجع صلاحيات حساب الخدمة (IAM) ثم أعد المحاولة.";
  }
  return message;
}

function formatAmount(value: number | undefined): string {
  return (value || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function EnvironmentBadge({
  environment,
  testId,
}: {
  environment: string;
  testId?: string;
}) {
  const live = environment === "LIVE";
  return (
    <Badge
      variant={live ? "destructive" : "secondary"}
      className="text-xs"
      data-testid={testId ?? "environment-badge"}
    >
      {live ? "بيئة LIVE" : "بيئة TEST"}
    </Badge>
  );
}

export default function PartnerProfitsSection() {
  const { toast } = useToast();
  // Use the provider's client, not the disconnected singleton in
  // @/lib/queryClient, so invalidations actually refetch the visible page.
  const queryClient = useQueryClient();
  const [isExpenseDialogOpen, setIsExpenseDialogOpen] = useState(false);
  const [transferProfitId, setTransferProfitId] = useState<string | null>(null);
  const [transferForm, setTransferForm] = useState({ amount: "", reference: "" });
  const [expandedProfitId, setExpandedProfitId] = useState<string | null>(null);
  const [expandedPayments, setExpandedPayments] = useState(false);
  const [notesEditId, setNotesEditId] = useState<string | null>(null);
  const [notesDraft, setNotesDraft] = useState("");
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [manualMonthYear, setManualMonthYear] = useState(formatMonthYearInput());
  const [manualNotes, setManualNotes] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<PartnerProfit | null>(null);

  const { data: profits = [], isLoading, refetch: refetchProfits } = useQuery<PartnerProfit[]>({
    queryKey: ["/api/admin/partner-profits"],
  });

  const { data: liveData } = useQuery<{ status: LiveDataStatus }>({
    queryKey: ["/api/admin/live/status"],
    retry: false,
    staleTime: 30_000,
  });
  const environment = liveData?.status?.environment ?? "TEST";

  const { data: payments = [], isLoading: isLoadingPayments } = useQuery<Payment[]>({
    queryKey: ["/api/admin/payments"],
  });

  const { data: expenses = [], isLoading: isLoadingExpenses, refetch: refetchExpenses } = useQuery<Expense[]>({
    queryKey: ["/api/admin/expenses"],
  });

  const currentMonthStr = formatMonthYearInput();
  const currentCycle = useMemo(
    () => profits.find((p) => p.monthYear.replace("/", "-") === currentMonthStr),
    [profits, currentMonthStr]
  );

  const completedPayments = useMemo(
    () =>
      payments.filter(
        (p) =>
          ["مكتمل", "نجح", "نجاح", "completed"].includes(p.status) &&
          (p.completedAt || p.createdAt || "").startsWith(currentMonthStr)
      ),
    [payments, currentMonthStr]
  );

  const pendingPaymentsCount = useMemo(
    () => payments.filter((p) => ["قيد المراجعة", "معلق", "نجح - قيد التحقق"].includes(p.status)).length,
    [payments]
  );

  // ─── Mutations ───────────────────────────────────────────────────────────────

  const createExpenseMutation = useMutation({
    mutationFn: async (data: any) => apiRequest("POST", "/api/admin/expenses", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/expenses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/partner-profits"] });
      setIsExpenseDialogOpen(false);
      toast({ title: "تمت الإضافة", description: "تم إضافة التكلفة بنجاح" });
    },
    onError: () => toast({ title: "خطأ", description: "فشل في إضافة التكلفة", variant: "destructive" }),
  });

  const deleteExpenseMutation = useMutation({
    mutationFn: async (id: string) => apiRequest("DELETE", `/api/admin/expenses/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/expenses"] });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/partner-profits"] });
      toast({ title: "تم الحذف", description: "تم حذف التكلفة بنجاح" });
    },
    onError: () => toast({ title: "خطأ", description: "فشل في حذف التكلفة", variant: "destructive" }),
  });

  const prepareCycleMutation = useMutation({
    mutationFn: async (monthYear?: string) => {
      const res = await apiRequest("POST", "/api/admin/partner-profits/prepare", { monthYear });
      return (await res.json()) as PartnerProfit;
    },
    onSuccess: (profit) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/partner-profits"] });
      toast({
        title: `تم إعادة حساب دورة ${profit.monthYear}`,
        description: `${environment} · صافي الإيرادات ${formatAmount(profit.revenueAfterFees)} ر.س · صافي الربح ${formatAmount(profit.netProfitAfterExpenses)} ر.س · حصة الشريك ${formatAmount(profit.partnerShare)} ر.س`,
      });
    },
    onError: (error) =>
      toast({
        title: "خطأ",
        description: extractApiError(error) || "فشل في إعادة حساب دورة الأرباح",
        variant: "destructive",
      }),
  });

  const createManualCycleMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/admin/partner-profits/prepare", { monthYear: manualMonthYear });
      return (await res.json()) as PartnerProfit;
    },
    onSuccess: (profit) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/partner-profits"] });
      setIsAddDialogOpen(false);
      toast({
        title: `تم تجهيز دورة ${profit.monthYear}`,
        description: `${environment} · صافي الإيرادات ${formatAmount(profit.revenueAfterFees)} ر.س`,
      });
    },
    onError: (error) =>
      toast({ title: "خطأ", description: extractApiError(error), variant: "destructive" }),
  });

  const deleteCycleMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await apiRequest("DELETE", `/api/admin/partner-profits/${id}`);
      return (await res.json()) as { success: boolean; id: string; message?: string };
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/partner-profits"] });
      setDeleteTarget(null);
      toast({
        title: "تم حذف الدورة",
        description: `${result.message || "تم حذف سجل دورة الأرباح المشتقة فقط."} (${environment})`,
      });
    },
    onError: (error) =>
      toast({
        title: "تعذّر الحذف",
        description: extractApiError(error),
        variant: "destructive",
      }),
  });

  const closeCycleMutation = useMutation({
    mutationFn: async (id: string) =>
      apiRequest("POST", `/api/admin/partner-profits/${id}/close`, {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/partner-profits"] });
      toast({ title: "تم الإقفال", description: "تم إقفال الدورة الشهرية نهائيًا" });
    },
    onError: () => toast({ title: "خطأ", description: "فشل في إقفال الدورة", variant: "destructive" }),
  });

  const recordTransferMutation = useMutation({
    mutationFn: async ({ id, amount, reference }: { id: string; amount: number; reference: string }) =>
      apiRequest("POST", `/api/admin/partner-profits/${id}/transfers`, { amount, reference }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/partner-profits"] });
      setTransferProfitId(null);
      setTransferForm({ amount: "", reference: "" });
      toast({ title: "تم التسجيل", description: "تم تسجيل التحويل بنجاح" });
    },
    onError: () => toast({ title: "خطأ", description: "فشل في تسجيل التحويل", variant: "destructive" }),
  });

  const updateNotesMutation = useMutation({
    mutationFn: async ({ id, notes }: { id: string; notes: string }) =>
      apiRequest("PUT", `/api/admin/partner-profits/${id}`, { notes }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/partner-profits"] });
      setNotesEditId(null);
      setNotesDraft("");
      toast({ title: "تم الحفظ", description: "تم تحديث الملاحظات" });
    },
    onError: () => toast({ title: "خطأ", description: "فشل في تحديث الملاحظات", variant: "destructive" }),
  });

  // ─── Handlers ─────────────────────────────────────────────────────────────────

  const handlePrepareCurrent = () => prepareCycleMutation.mutate(currentMonthStr);

  const handleRecalculate = (profit: PartnerProfit) => {
    if (isEffectivelyClosed(profit)) return;
    prepareCycleMutation.mutate(profit.monthYear.replace("/", "-"));
  };

  const handleRequestDelete = (profit: PartnerProfit) => {
    if (!canDeleteCycle(profit)) return;
    setDeleteTarget(profit);
  };

  const confirmDelete = () => {
    if (!deleteTarget) return;
    deleteCycleMutation.mutate(deleteTarget.id);
  };

  const handleMarkTransferred = (profit: PartnerProfit) => {
    if (isEffectivelyClosed(profit)) return;
    setTransferProfitId(profit.id);
  };

  const handleSubmitTransfer = (e: React.FormEvent) => {
    e.preventDefault();
    if (!transferProfitId) return;
    const amount = parseFloat(transferForm.amount);
    if (!amount || amount <= 0) {
      toast({ title: "خطأ", description: "مبلغ التحويل يجب أن يكون أكبر من صفر", variant: "destructive" });
      return;
    }
    recordTransferMutation.mutate({
      id: transferProfitId,
      amount,
      reference: transferForm.reference.trim(),
    });
  };

  const startNotesEdit = (profit: PartnerProfit) => {
    if (isEffectivelyClosed(profit)) return;
    setNotesEditId(profit.id);
    setNotesDraft(profit.notes || "");
  };

  const saveNotes = (id: string) => updateNotesMutation.mutate({ id, notes: notesDraft });

  const getCycleStatusBadge = (profit: PartnerProfit) => {
    if (isEffectivelyClosed(profit)) return <Badge className="bg-green-600">مقفلة</Badge>;
    if (profit.status === "pending_review") return <Badge variant="secondary">بانتظار المراجعة</Badge>;
    return <Badge variant="outline">مسودة</Badge>;
  };

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

  if (isLoading || isLoadingPayments || isLoadingExpenses) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6" dir="rtl">
      {/* ===================== الدورة الحالية ===================== */}
      <Card className="border-2 border-primary/20">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                <Calendar className="w-5 h-5 text-primary" />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <CardTitle className="text-lg">الدورة الحالية: {currentMonthStr.replace("-", "/")}</CardTitle>
                  <EnvironmentBadge environment={environment} testId="environment-badge-current" />
                </div>
                <CardDescription>
                  {currentCycle
                    ? `حالة الدورة: ${isEffectivelyClosed(currentCycle) ? "مقفلة" : currentCycle.status === "pending_review" ? "بانتظار المراجعة" : "مسودة"}`
                    : "لم تُجهّز دورة لهذا الشهر بعد"}
                </CardDescription>
              </div>
            </div>
            <div className="flex gap-2 flex-wrap items-center">
              <EnvironmentBadge environment={environment} testId="environment-badge-current-actions" />
              <Button
                size="sm"
                variant="outline"
                onClick={() => refetchProfits()}
                className="gap-2"
                data-testid="button-refresh-profits"
              >
                <RefreshCw className="w-4 h-4" />
                تحديث
              </Button>
              <Button
                size="sm"
                variant="default"
                onClick={handlePrepareCurrent}
                disabled={prepareCycleMutation.isPending || (currentCycle ? isEffectivelyClosed(currentCycle) : false)}
                className="gap-2"
                data-testid="button-prepare-current"
              >
                {prepareCycleMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <TrendingUp className="w-4 h-4" />}
                {currentCycle ? "إعادة حساب الدورة" : "تجهيز الدورة"}
              </Button>
              {currentCycle && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleRequestDelete(currentCycle)}
                  disabled={deleteCycleMutation.isPending || !canDeleteCycle(currentCycle)}
                  className="gap-2 text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
                  data-testid="button-delete-current"
                  title={
                    canDeleteCycle(currentCycle)
                      ? "حذف سجل الدورة المشتقة فقط"
                      : "لا يمكن حذف دورة مقفلة أو مرتبطة بتحويلات"
                  }
                >
                  {deleteCycleMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  حذف الدورة
                </Button>
              )}
              <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
                <DialogTrigger asChild>
                  <Button size="sm" variant="outline" className="gap-2" data-testid="button-add-profit">
                    <Plus className="w-4 h-4" />
                    شهر آخر
                  </Button>
                </DialogTrigger>
                <DialogContent dir="rtl">
                  <DialogHeader>
                    <DialogTitle>تجهيز دورة شهرية يدويًا</DialogTitle>
                    <DialogDescription>
                      اختر الشهر/السنة لحساب الدورة من المدفوعات والتكاليف المسجلة.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>الشهر/السنة</Label>
                      <Input
                        type="month"
                        value={manualMonthYear}
                        onChange={(e) => setManualMonthYear(e.target.value)}
                        data-testid="input-manual-month"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>ملاحظات (اختياري)</Label>
                      <Textarea
                        value={manualNotes}
                        onChange={(e) => setManualNotes(e.target.value)}
                        placeholder="أي ملاحظات إدارية..."
                        data-testid="input-manual-notes"
                      />
                    </div>
                    <Button
                      className="w-full"
                      onClick={() => createManualCycleMutation.mutate()}
                      disabled={createManualCycleMutation.isPending}
                      data-testid="button-submit-manual"
                    >
                      {createManualCycleMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin ml-2" /> : null}
                      تجهيز
                    </Button>
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {currentCycle ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <MetricBox label="إيرادات الشهر (صافي)" value={currentCycle.revenueAfterFees || 0} icon={<Banknote className="w-4 h-4" />} color="blue" />
                <MetricBox label="تكاليف الشهر" value={-(currentCycle.totalExpenses || 0)} icon={<MinusCircle className="w-4 h-4" />} color="red" />
                <MetricBox label="صافي نتيجة الشهر" value={currentCycle.netProfitAfterExpenses || 0} icon={<TrendingUp className="w-4 h-4" />} color={currentCycle.netProfitAfterExpenses >= 0 ? "emerald" : "red"} />
                <MetricBox label="حصة الشريك (50%)" value={currentCycle.partnerShare || 0} icon={<Wallet className="w-4 h-4" />} color="amber" />
              </div>

              {prepareCycleMutation.data && (
                <div
                  className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800"
                  data-testid="recalc-result"
                >
                  <div className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-400">
                    <Check className="w-4 h-4" />
                    نتيجة إعادة الحساب · {environment} · {prepareCycleMutation.data.monthYear}
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-2 text-sm text-emerald-800 dark:text-emerald-300">
                    <span>صافي الإيرادات: {formatAmount(prepareCycleMutation.data.revenueAfterFees)} ر.س</span>
                    <span>التكاليف: {formatAmount(prepareCycleMutation.data.totalExpenses)} ر.س</span>
                    <span>صافي الربح: {formatAmount(prepareCycleMutation.data.netProfitAfterExpenses)} ر.س</span>
                    <span>حصة الشريك: {formatAmount(prepareCycleMutation.data.partnerShare)} ر.س</span>
                  </div>
                </div>
              )}

              {(currentCycle.carriedLossForward > 0 || currentCycle.carriedLossRemaining > 0) && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-4 rounded-lg bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800">
                    <div className="text-sm text-orange-700 dark:text-orange-400 mb-1">خسارة مرحّلة من السابق</div>
                    <p className="text-2xl font-bold text-orange-600" dir="ltr">{currentCycle.carriedLossForward.toLocaleString("en-US")} ر.س</p>
                  </div>
                  <div className="p-4 rounded-lg bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800">
                    <div className="text-sm text-orange-700 dark:text-orange-400 mb-1">خسارة متبقية للأشهر القادمة</div>
                    <p className="text-2xl font-bold text-orange-600" dir="ltr">{currentCycle.carriedLossRemaining.toLocaleString("en-US")} ر.س</p>
                  </div>
                </div>
              )}

              <TransferPanel profit={currentCycle} onTransfer={() => handleMarkTransferred(currentCycle)} />

              {!isEffectivelyClosed(currentCycle) && (
                <div className="flex gap-2 flex-wrap">
                  <Button size="sm" variant="default" onClick={() => closeCycleMutation.mutate(currentCycle.id)} disabled={closeCycleMutation.isPending} className="gap-2" data-testid="button-close-current">
                    <Lock className="w-4 h-4" />
                    إقفال نهائي
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => startNotesEdit(currentCycle)} className="gap-2" data-testid="button-edit-notes-current">
                    <Edit3 className="w-4 h-4" />
                    تعديل الملاحظات
                  </Button>
                </div>
              )}

              {notesEditId === currentCycle.id && (
                <div className="space-y-2">
                  <Label>ملاحظات الدورة</Label>
                  <Textarea value={notesDraft} onChange={(e) => setNotesDraft(e.target.value)} />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => saveNotes(currentCycle.id)} disabled={updateNotesMutation.isPending}>حفظ</Button>
                    <Button size="sm" variant="outline" onClick={() => setNotesEditId(null)}>إلغاء</Button>
                  </div>
                </div>
              )}

              {currentCycle.notes && !notesEditId && (
                <p className="text-sm text-muted-foreground bg-muted/50 p-3 rounded">{currentCycle.notes}</p>
              )}
            </div>
          ) : (
            <div className="text-center py-8 text-muted-foreground">
              <Calendar className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>لم تُجهّز دورة لهذا الشهر بعد</p>
              <p className="text-sm mt-2">اضغط "تجهيز الدورة" لحساب الأرباح من المدفوعات والتكاليف</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ===================== ملخص سريع ===================== */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <DollarSign className="w-4 h-4" />
            ملخص مالي
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <QuickStat label="الدورات المسجلة" value={profits.length} suffix="" />
            <QuickStat label="المستحق للشريك" value={profits.reduce((s, p) => s + (p.partnerShare || 0), 0)} suffix="ر.س" />
            <QuickStat label="المحوّل" value={profits.reduce((s, p) => s + (p.transferredToPartner || 0), 0)} suffix="ر.س" />
            <QuickStat label="المتبقي" value={profits.reduce((s, p) => s + (p.remainingToTransfer || 0), 0)} suffix="ر.س" />
          </div>
          {pendingPaymentsCount > 0 && (
            <div className="mt-4 p-3 rounded-lg bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800 flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-orange-600" />
              <span className="text-sm text-orange-700 dark:text-orange-400">{pendingPaymentsCount} دفعة في انتظار المراجعة ولم تُحسب بعد</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ===================== سجل الدورات ===================== */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2">
            <Wallet className="w-5 h-5" />
            سجل الدورات الشهرية
          </CardTitle>
        </CardHeader>
        <CardContent>
          {profits.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Wallet className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p>لا توجد دورات محفوظة بعد</p>
            </div>
          ) : (
            <div className="space-y-3">
              {profits.map((profit) => {
                const closed = isEffectivelyClosed(profit);
                const expanded = expandedProfitId === profit.id;
                return (
                  <div key={profit.id} data-testid={`cycle-row-${profit.id}`} className={`rounded-lg border ${closed ? "bg-muted/30" : ""}`}>
                    <button
                      onClick={() => setExpandedProfitId(expanded ? null : profit.id)}
                      className="w-full p-4 flex items-center justify-between text-right hover:bg-muted/40 transition"
                      data-testid={`cycle-header-${profit.id}`}
                    >
                      <div className="flex items-center gap-4">
                        <div className={`p-2 rounded-lg ${closed ? "bg-green-100 dark:bg-green-900/30" : "bg-primary/10"}`}>
                          <Calendar className={`w-5 h-5 ${closed ? "text-green-600" : "text-primary"}`} />
                        </div>
                        <div className="text-start">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold">{profit.monthYear}</span>
                            {getCycleStatusBadge(profit)}
                            {closed && <Badge variant="outline" className="text-xs"><Lock className="w-3 h-3 ml-1" /> مقفلة</Badge>}
                          </div>
                          <div className="text-sm text-muted-foreground mt-1">
                            {profit.activeSubscriptions} دفعة | مستحق: <span dir="ltr">{(profit.partnerShare || 0).toLocaleString("en-US")}</span> ر.س | متبقي: <span dir="ltr">{(profit.remainingToTransfer || 0).toLocaleString("en-US")}</span> ر.س
                          </div>
                        </div>
                      </div>
                      {expanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                    </button>

                    {expanded && (
                      <div className="p-4 pt-0 border-t">
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
                          <MetricBox label="إيرادات" value={profit.totalRevenue || 0} color="blue" compact />
                          <MetricBox label="صافي" value={profit.revenueAfterFees || 0} color="blue" compact />
                          <MetricBox label="تكاليف" value={-(profit.totalExpenses || 0)} color="red" compact />
                          <MetricBox label="صافي الشهر" value={profit.netProfitAfterExpenses || 0} color={profit.netProfitAfterExpenses >= 0 ? "emerald" : "red"} compact />
                        </div>

                        {(profit.carriedLossForward > 0 || profit.carriedLossRemaining > 0) && (
                          <div className="grid grid-cols-2 gap-3 mt-3">
                            <div className="p-3 rounded-lg bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800 text-center">
                              <div className="text-xs text-orange-600 mb-1">خسارة مرحّلة</div>
                              <p className="font-bold text-orange-600" dir="ltr">{profit.carriedLossForward.toLocaleString("en-US")} ر.س</p>
                            </div>
                            <div className="p-3 rounded-lg bg-orange-50 dark:bg-orange-950/20 border border-orange-200 dark:border-orange-800 text-center">
                              <div className="text-xs text-orange-600 mb-1">خسارة متبقية</div>
                              <p className="font-bold text-orange-600" dir="ltr">{profit.carriedLossRemaining.toLocaleString("en-US")} ر.س</p>
                            </div>
                          </div>
                        )}

                        <TransferPanel profit={profit} onTransfer={() => handleMarkTransferred(profit)} className="mt-3" />

                        {!closed && (
                          <div className="flex gap-2 mt-3 flex-wrap items-center">
                            <EnvironmentBadge
                              environment={environment}
                              testId={`environment-badge-${profit.id}`}
                            />
                            <Button size="sm" variant="outline" onClick={() => handleRecalculate(profit)} disabled={prepareCycleMutation.isPending} className="gap-2" data-testid={`button-recalc-${profit.id}`}>
                              {prepareCycleMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} إعادة حساب
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => handleRequestDelete(profit)}
                              disabled={deleteCycleMutation.isPending || !canDeleteCycle(profit)}
                              className="gap-2 text-red-600 border-red-200 hover:bg-red-50 hover:text-red-700"
                              data-testid={`button-delete-${profit.id}`}
                              title={canDeleteCycle(profit) ? "حذف سجل الدورة المشتقة فقط" : "لا يمكن حذف دورة مقفلة أو مرتبطة بتحويلات"}
                            >
                              {deleteCycleMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />} حذف
                            </Button>
                            <Button size="sm" variant="default" onClick={() => closeCycleMutation.mutate(profit.id)} disabled={closeCycleMutation.isPending} className="gap-2" data-testid={`button-close-${profit.id}`}>
                              <Lock className="w-4 h-4" /> إقفال
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => startNotesEdit(profit)} className="gap-2" data-testid={`button-edit-notes-${profit.id}`}>
                              <Edit3 className="w-4 h-4" /> تعديل ملاحظات
                            </Button>
                          </div>
                        )}

                        {closed && (
                          <div className="flex gap-2 mt-3 flex-wrap items-center">
                            <EnvironmentBadge
                              environment={environment}
                              testId={`environment-badge-${profit.id}`}
                            />
                            <Badge variant="outline" className="text-xs">
                              <Lock className="w-3 h-3 ml-1" /> دورة مقفلة — لا يمكن إعادة حسابها أو حذفها
                            </Badge>
                          </div>
                        )}

                        {!closed && ((profit.transfers || []).length > 0 || (profit.transferredToPartner || 0) > 0) && (
                          <div className="mt-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400">
                            <AlertTriangle className="w-4 h-4" />
                            مرتبطة بتحويلات مالية — الحذف محظور، وإعادة الحساب تحافظ على التحويلات.
                          </div>
                        )}

                        {notesEditId === profit.id && (
                          <div className="space-y-2 mt-3">
                            <Label>ملاحظات الدورة</Label>
                            <Textarea value={notesDraft} onChange={(e) => setNotesDraft(e.target.value)} />
                            <div className="flex gap-2">
                              <Button size="sm" onClick={() => saveNotes(profit.id)} disabled={updateNotesMutation.isPending}>حفظ</Button>
                              <Button size="sm" variant="outline" onClick={() => setNotesEditId(null)}>إلغاء</Button>
                            </div>
                          </div>
                        )}

                        {profit.notes && !notesEditId && (
                          <p className="text-sm text-muted-foreground bg-muted/50 p-3 rounded mt-3">{profit.notes}</p>
                        )}

                        {(profit.transfers || []).length > 0 && (
                          <div className="mt-3">
                            <p className="text-sm font-medium mb-2">سجل التحويلات</p>
                            <div className="space-y-2">
                              {(profit.transfers || []).map((t) => (
                                <div key={t.id} className="flex items-center justify-between p-2 rounded bg-muted/50 text-sm">
                                  <div className="flex items-center gap-2">
                                    <Banknote className="w-4 h-4 text-primary" />
                                    <span dir="ltr">{t.amount.toLocaleString("en-US")} ر.س</span>
                                    {t.reference && <Badge variant="outline" className="text-xs">مرجع: {t.reference}</Badge>}
                                  </div>
                                  <span className="text-xs text-muted-foreground">{formatLiveSaudiDate(t.date)}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ===================== المدفوعات ===================== */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Receipt className="w-5 h-5" />
              مدفوعات الشهر الحالي
            </CardTitle>
            <Button size="sm" variant="ghost" onClick={() => setExpandedPayments((v) => !v)} className="gap-2">
              {expandedPayments ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              {expandedPayments ? "إخفاء" : "عرض"}
            </Button>
          </div>
        </CardHeader>
        {expandedPayments && (
          <CardContent>
            {completedPayments.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground">
                <Receipt className="w-10 h-10 mx-auto mb-2 opacity-30" />
                <p>لا توجد مدفوعات مكتملة في هذا الشهر</p>
              </div>
            ) : (
              <div className="space-y-2">
                {completedPayments.map((payment) => (
                  <div key={payment.id} className="flex items-center justify-between p-3 rounded-lg border">
                    <div className="flex items-center gap-3">
                      <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/30">
                        <CreditCard className="w-4 h-4 text-green-600" />
                      </div>
                      <div>
                        <div className="text-sm font-medium">عقار: {payment.propertyNumber}</div>
                        <div className="text-xs text-muted-foreground">{payment.paymentMethod} | {formatLiveSaudiDate(payment.completedAt || payment.createdAt || "")}</div>
                      </div>
                    </div>
                    <div className="text-left" dir="ltr">
                      <p className="font-bold">{(payment.finalAmount || 0).toLocaleString("en-US")} ر.س</p>
                      <p className="text-xs text-muted-foreground">صافي: {(payment.netAmount || 0).toLocaleString("en-US")} ر.س</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        )}
      </Card>

      {/* ===================== إدارة التكاليف ===================== */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <CardTitle className="flex items-center gap-2">
                <MinusCircle className="w-5 h-5 text-red-500" />
                إدارة التكاليف والمصروفات
              </CardTitle>
              <CardDescription>التكاليف المعتمدة تُخصم من إيرادات الشهر</CardDescription>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => refetchExpenses()} className="gap-2" data-testid="button-refresh-expenses">
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
                <DialogContent dir="rtl" className="max-h-[85vh] flex flex-col p-0">
                  <DialogHeader className="px-6 pt-6 pb-2">
                    <DialogTitle>إضافة تكلفة جديدة</DialogTitle>
                    <DialogDescription>أدخل بيانات التكلفة لخصمها من الأرباح</DialogDescription>
                  </DialogHeader>
                  <AddExpenseForm onSubmit={(data) => createExpenseMutation.mutate(data)} isPending={createExpenseMutation.isPending} onCancel={() => setIsExpenseDialogOpen(false)} />
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
            </div>
          ) : (
            <div className="space-y-3">
              {expenses.map((expense) => (
                <div key={expense.id} className="flex items-center justify-between p-4 rounded-lg border hover-elevate" data-testid={`expense-row-${expense.id}`}>
                  <div className="flex items-center gap-4">
                    <div className={`p-2 rounded-lg ${expense.expenseType === "شهرية" ? "bg-green-100 dark:bg-green-900/30" : expense.expenseType === "موزعة" ? "bg-purple-100 dark:bg-purple-900/30" : "bg-red-100 dark:bg-red-900/30"}`}>
                      <MinusCircle className={`w-5 h-5 ${expense.expenseType === "شهرية" ? "text-green-600" : expense.expenseType === "موزعة" ? "text-purple-600" : "text-red-600"}`} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold">{expense.title}</span>
                        {getCategoryBadge(expense.category)}
                        {expense.expenseType && expense.expenseType !== "مرة واحدة" && (
                          <Badge variant="outline" className={expense.expenseType === "شهرية" ? "border-green-500 text-green-600" : "border-purple-500 text-purple-600"}>{expense.expenseType}</Badge>
                        )}
                      </div>
                      <div className="text-sm text-muted-foreground mt-1">
                        {expense.description && <span>{expense.description} | </span>}
                        <span>{formatLiveSaudiDate(expense.date)}</span>
                        {expense.expenseType === "موزعة" && expense.durationMonths && <span> | {expense.durationMonths} شهر</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-left">
                      {expense.expenseType === "موزعة" && expense.monthlyAmount ? (
                        <div>
                          <p className="font-bold text-purple-600" dir="ltr">-{expense.monthlyAmount.toLocaleString("en-US")} ر.س/شهر</p>
                          <p className="text-xs text-muted-foreground" dir="ltr">إجمالي: {expense.amount.toLocaleString("en-US")} ر.س</p>
                        </div>
                      ) : expense.expenseType === "شهرية" ? (
                        <p className="font-bold text-green-600" dir="ltr">-{expense.amount.toLocaleString("en-US")} ر.س/شهر</p>
                      ) : (
                        <p className="font-bold text-red-600" dir="ltr">-{expense.amount.toLocaleString("en-US")} ر.س</p>
                      )}
                    </div>
                    <Button size="icon" variant="ghost" className="text-red-500 hover:text-red-700 hover:bg-red-100" onClick={() => deleteExpenseMutation.mutate(expense.id)} disabled={deleteExpenseMutation.isPending} data-testid={`button-delete-expense-${expense.id}`}>
                      <TrashIcon />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ===================== شرح النظام ===================== */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">كيف يعمل نظام الأرباح</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="p-4 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800">
            <ul className="space-y-2 text-sm text-muted-foreground list-disc list-inside">
              <li>يتم حساب الأرباح من المدفوعات المكتملة بعد خصم رسوم الدفع</li>
              <li>تُخصم التكاليف المعتمدة للشهر، ثم تُغطى الخسارة المرحّلة أولاً</li>
              <li>لا توزيع قبل تغطية الخسائر بالكامل</li>
              <li>الربح المتبقي يُقسّم <strong>50%</strong> للشريك و<strong>50%</strong> لنا</li>
              <li>"تجهيز الدورة" يحسب/يُعيد حساب الشهر دون حفظ نهائي</li>
              <li>"إقفال" يُثبت الدورة نهائيًا ويمنع إعادة احتسابها</li>
              <li>"تسجيل تحويل" يسجل مبلغًا ومرجعًا ويُحدّث المتبقي</li>
              <li>الدورات المقفلة أو التاريخية لا تُعدّل</li>
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* ===================== تأكيد حذف دورة ===================== */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <DialogContent dir="rtl" data-testid="dialog-delete-cycle">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <AlertTriangle className="w-5 h-5" />
              تأكيد حذف دورة الأرباح
            </DialogTitle>
            <DialogDescription>
              سيتم حذف سجل دورة الأرباح المشتقة المحدد فقط. لا يمكن التراجع عن هذه العملية.
            </DialogDescription>
          </DialogHeader>
          {deleteTarget && (
            <div className="space-y-4">
              <div className="rounded-lg border p-3 text-sm space-y-1">
                <div>
                  الشهر: <strong>{deleteTarget.monthYear}</strong>
                </div>
                <div className="flex items-center gap-2">
                  البيئة: <EnvironmentBadge environment={environment} testId="environment-badge-delete-dialog" />
                </div>
                <div>
                  معرّف الدورة: <code dir="ltr" className="text-xs">{deleteTarget.id}</code>
                </div>
              </div>
              <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 text-sm text-amber-700 dark:text-amber-400">
                لن يتم حذف المدفوعات أو التكاليف أو التحويلات أو أي قيود مالية أخرى. بعد الحذف يمكن تجهيز الدورة من جديد من مصادر البيانات الفعلية.
              </div>
              <div className="flex gap-2 justify-end">
                <Button
                  variant="outline"
                  onClick={() => setDeleteTarget(null)}
                  disabled={deleteCycleMutation.isPending}
                  data-testid="button-cancel-delete"
                >
                  إلغاء
                </Button>
                <Button
                  variant="destructive"
                  onClick={confirmDelete}
                  disabled={deleteCycleMutation.isPending}
                  className="gap-2"
                  data-testid="button-confirm-delete"
                >
                  {deleteCycleMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                  حذف الدورة
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ===================== نموذج تسجيل تحويل ===================== */}
      <Dialog open={!!transferProfitId} onOpenChange={(open) => { if (!open) setTransferProfitId(null); }}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>تسجيل تحويل للشريك</DialogTitle>
            <DialogDescription>
              {(() => {
                const profit = profits.find((p) => p.id === transferProfitId);
                return profit ? (
                  <span>المستحق: {(profit.partnerShare || 0).toLocaleString("en-US")} ر.س | المتبقي: {(profit.remainingToTransfer || 0).toLocaleString("en-US")} ر.س</span>
                ) : null;
              })()}
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmitTransfer} className="space-y-4">
            <div className="space-y-2">
              <Label>المبلغ (ر.س)</Label>
              <Input type="number" step="0.01" value={transferForm.amount} onChange={(e) => setTransferForm({ ...transferForm, amount: e.target.value })} required data-testid="input-transfer-amount" />
            </div>
            <div className="space-y-2">
              <Label>مرجع/رقم العملية (اختياري)</Label>
              <Input value={transferForm.reference} onChange={(e) => setTransferForm({ ...transferForm, reference: e.target.value })} data-testid="input-transfer-reference" />
            </div>
            <Button type="submit" className="w-full" disabled={recordTransferMutation.isPending} data-testid="button-submit-transfer">
              {recordTransferMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "تسجيل التحويل"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Helper components ────────────────────────────────────────────────────────

function MetricBox({
  label,
  value,
  icon,
  color,
  compact,
}: {
  label: string;
  value: number;
  icon?: React.ReactNode;
  color: "blue" | "red" | "emerald" | "amber";
  compact?: boolean;
}) {
  const palette: Record<string, { bg: string; border: string; text: string }> = {
    blue: { bg: "bg-blue-50 dark:bg-blue-950/20", border: "border-blue-200 dark:border-blue-800", text: "text-blue-700 dark:text-blue-400" },
    red: { bg: "bg-red-50 dark:bg-red-950/20", border: "border-red-200 dark:border-red-800", text: "text-red-700 dark:text-red-400" },
    emerald: { bg: "bg-emerald-50 dark:bg-emerald-950/20", border: "border-emerald-200 dark:border-emerald-800", text: "text-emerald-700 dark:text-emerald-400" },
    amber: { bg: "bg-amber-50 dark:bg-amber-950/20", border: "border-amber-200 dark:border-amber-800", text: "text-amber-700 dark:text-amber-400" },
  };
  const p = palette[color];
  return (
    <div className={`${compact ? "p-2" : "p-4"} rounded-lg ${p.bg} border ${p.border}`}>
      <div className={`flex items-center gap-2 mb-1 ${compact ? "justify-center" : ""}`}>
        {icon}
        <span className={`text-xs font-medium ${p.text}`}>{label}</span>
      </div>
      <p className={`font-bold ${p.text} ${compact ? "text-sm" : "text-2xl"}`} dir="ltr">
        {value.toLocaleString("en-US", { maximumFractionDigits: 2 })} {compact ? "ر.س" : "ر.س"}
      </p>
    </div>
  );
}

function QuickStat({ label, value, suffix }: { label: string; value: number; suffix: string }) {
  return (
    <div className="p-3 rounded-lg border text-center">
      <div className="text-xs text-muted-foreground mb-1">{label}</div>
      <p className="font-bold text-lg" dir="ltr">
        {suffix ? `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${suffix}` : value}
      </p>
    </div>
  );
}

function TransferPanel({
  profit,
  onTransfer,
  className = "",
}: {
  profit: PartnerProfit;
  onTransfer: () => void;
  className?: string;
}) {
  const transferred = profit.transferredToPartner || 0;
  const remaining = profit.remainingToTransfer || 0;
  const owed = profit.partnerShare || 0;
  const closed = isEffectivelyClosed(profit);
  return (
    <div className={`p-4 rounded-lg border ${className}`}>
      <div className="flex items-center justify-between mb-3">
        <span className="font-medium">حالة التحويل</span>
        {!closed && remaining > 0 && (
          <Button size="sm" variant="outline" onClick={onTransfer} className="gap-2">
            <Banknote className="w-4 h-4" />
            تسجيل تحويل
          </Button>
        )}
        {!closed && remaining <= 0 && owed > 0 && (
          <Badge className="bg-green-600">تم التحويل بالكامل</Badge>
        )}
        {closed && <Badge variant="outline">مقفلة</Badge>}
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="text-center p-2 rounded bg-emerald-50 dark:bg-emerald-950/20">
          <div className="text-xs text-emerald-600 mb-1">مستحق الشريك</div>
          <p className="font-semibold text-emerald-600" dir="ltr">{owed.toLocaleString("en-US")} ر.س</p>
        </div>
        <div className="text-center p-2 rounded bg-blue-50 dark:bg-blue-950/20">
          <div className="text-xs text-blue-600 mb-1">المحوّل</div>
          <p className="font-semibold text-blue-600" dir="ltr">{transferred.toLocaleString("en-US")} ر.س</p>
        </div>
        <div className="text-center p-2 rounded bg-amber-50 dark:bg-amber-950/20">
          <div className="text-xs text-amber-600 mb-1">المتبقي</div>
          <p className="font-semibold text-amber-600" dir="ltr">{remaining.toLocaleString("en-US")} ر.س</p>
        </div>
      </div>
    </div>
  );
}

function TrashIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
    </svg>
  );
}

// ─── Expense form ─────────────────────────────────────────────────────────────

type ExpenseFormData = {
  title: string;
  amount: number;
  category: string;
  description: string;
  date: string;
  expenseType: "مرة واحدة" | "شهرية" | "موزعة";
  durationMonths?: number;
  startDate?: string;
  isActive?: boolean;
};

function AddExpenseForm({ onSubmit, isPending, onCancel }: { onSubmit: (data: ExpenseFormData) => void; isPending: boolean; onCancel?: () => void }) {
  const [formData, setFormData] = useState<ExpenseFormData>({
    title: "",
    amount: 0,
    category: "أخرى",
    description: "",
    date: new Date().toISOString().split("T")[0],
    expenseType: "مرة واحدة",
    durationMonths: 12,
    startDate: new Date().toISOString().split("T")[0],
    isActive: true,
  });
  const [currency, setCurrency] = useState<"SAR" | "USD">("SAR");
  const [usdAmount, setUsdAmount] = useState(0);
  const [exchangeRate, setExchangeRate] = useState(3.75);
  const [isLoadingRate, setIsLoadingRate] = useState(false);

  const fetchExchangeRate = async () => {
    setIsLoadingRate(true);
    try {
      const response = await fetch("/api/currency/rate");
      const data = await response.json();
      setExchangeRate(data.rate || 3.75);
    } catch {
      setExchangeRate(3.75);
    }
    setIsLoadingRate(false);
  };

  const handleUsdChange = (value: number) => {
    setUsdAmount(value);
    setFormData({ ...formData, amount: Math.round(value * exchangeRate * 100) / 100 });
  };

  const monthlyAmount = formData.expenseType === "موزعة" && formData.durationMonths ? Math.round((formData.amount / formData.durationMonths) * 100) / 100 : formData.amount;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    let description = formData.description;
    if (currency === "USD" && usdAmount > 0) {
      description = `${description ? description + " | " : ""}تحويل من $${usdAmount} بسعر ${exchangeRate}`;
    }
    onSubmit({ ...formData, description });
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0">
      <div className="flex-1 overflow-y-auto px-6 space-y-4">
        <div className="space-y-2">
          <Label>عنوان التكلفة</Label>
          <Input placeholder="مثال: صيانة السيرفر" value={formData.title} onChange={(e) => setFormData({ ...formData, title: e.target.value })} required data-testid="input-expense-title" />
        </div>

        <div className="grid grid-cols-3 gap-4">
          <div className="space-y-2">
            <Label>نوع التكلفة</Label>
            <Select value={formData.expenseType} onValueChange={(value: "مرة واحدة" | "شهرية" | "موزعة") => setFormData({ ...formData, expenseType: value })}>
              <SelectTrigger data-testid="select-expense-type"><SelectValue placeholder="اختر النوع" /></SelectTrigger>
              <SelectContent>
                {EXPENSE_TYPES.map((type) => <SelectItem key={type.value} value={type.value}>{type.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>العملة</Label>
            <Select value={currency} onValueChange={(value: "SAR" | "USD") => { setCurrency(value); if (value === "USD") fetchExchangeRate(); }}>
              <SelectTrigger data-testid="select-expense-currency"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="SAR">ريال (ر.س)</SelectItem>
                <SelectItem value="USD">دولار ($)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>التصنيف</Label>
            <Select value={formData.category} onValueChange={(value) => setFormData({ ...formData, category: value })}>
              <SelectTrigger data-testid="select-expense-category"><SelectValue placeholder="اختر التصنيف" /></SelectTrigger>
              <SelectContent>
                {EXPENSE_CATEGORIES.map((cat) => <SelectItem key={cat.value} value={cat.value}>{cat.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {currency === "USD" ? (
          <div className="space-y-3">
            <div className="space-y-2">
              <Label>المبلغ {formData.expenseType === "موزعة" ? "الإجمالي" : ""} بالدولار ($)</Label>
              <Input type="number" step="0.01" min="0" value={usdAmount || ""} onChange={(e) => handleUsdChange(parseFloat(e.target.value) || 0)} required data-testid="input-expense-usd" />
            </div>
            <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">سعر الصرف: {isLoadingRate ? <Loader2 className="inline w-3 h-3 animate-spin" /> : `$1 = ${exchangeRate} ر.س`}</span>
                <Button type="button" variant="ghost" size="sm" onClick={fetchExchangeRate} disabled={isLoadingRate} className="h-6 px-2"><RefreshCw className={`w-3 h-3 ${isLoadingRate ? "animate-spin" : ""}`} /></Button>
              </div>
              <div className="flex items-center justify-between mt-2">
                <span className="text-sm text-muted-foreground">المبلغ بالريال:</span>
                <span className="font-bold text-blue-600" dir="ltr">{formData.amount.toLocaleString()} ر.س</span>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <Label>المبلغ {formData.expenseType === "موزعة" ? "الإجمالي" : ""} (ريال)</Label>
            <Input type="number" step="0.01" min="0" value={formData.amount || ""} onChange={(e) => setFormData({ ...formData, amount: parseFloat(e.target.value) || 0 })} required data-testid="input-expense-amount" />
          </div>
        )}

        <div className="space-y-2">
          <Label>{formData.expenseType === "مرة واحدة" ? "تاريخ تسجيل التكلفة" : formData.expenseType === "شهرية" ? "تاريخ بداية الاحتساب" : "تاريخ بداية التوزيع"}</Label>
          <Input type="date" value={formData.date} onChange={(e) => setFormData({ ...formData, date: e.target.value })} required data-testid="input-expense-date" />
        </div>

        <div className="min-h-[120px]">
          {formData.expenseType === "موزعة" && (
            <div className="space-y-4 p-4 rounded-lg bg-purple-50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-800">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>عدد أشهر التوزيع</Label>
                  <Input type="number" min="1" max="60" value={formData.durationMonths || ""} onChange={(e) => setFormData({ ...formData, durationMonths: parseInt(e.target.value) || 12 })} required data-testid="input-expense-duration" />
                </div>
                <div className="flex items-center justify-center">
                  <div className="text-center">
                    <span className="text-xs text-muted-foreground block">المبلغ الشهري</span>
                    <span className="font-bold text-purple-600" dir="ltr">{monthlyAmount.toLocaleString()} ر.س</span>
                  </div>
                </div>
              </div>
            </div>
          )}
          {formData.expenseType === "شهرية" && (
            <div className="p-4 rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800">
              <p className="text-sm text-muted-foreground">سيتم احتساب {formData.amount.toLocaleString()} ر.س شهرياً بدءاً من التاريخ المحدد</p>
            </div>
          )}
          {formData.expenseType === "مرة واحدة" && (
            <div className="p-4 rounded-lg bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800">
              <p className="text-sm text-muted-foreground">سيتم خصم {formData.amount.toLocaleString()} ر.س في شهر التاريخ المحدد فقط</p>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <Label>الوصف (اختياري)</Label>
          <Textarea value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} placeholder="تفاصيل إضافية عن التكلفة..." data-testid="input-expense-description" />
        </div>
      </div>

      <div className="px-6 py-4 border-t flex gap-3">
        <Button type="button" variant="outline" className="flex-1" onClick={onCancel}>إلغاء</Button>
        <Button type="submit" className="flex-1" disabled={isPending} data-testid="button-submit-expense">
          {isPending ? <Loader2 className="w-4 h-4 animate-spin ml-2" /> : null}
          إضافة التكلفة
        </Button>
      </div>
    </form>
  );
}
