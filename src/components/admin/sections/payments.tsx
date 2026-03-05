"use client";
// client/src/pages/admin/sections/payments.tsx
import { useState, Fragment, useMemo } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Loader2, Calculator, TrendingUp, CreditCard, Percent, ChevronDown, ChevronUp, CheckCircle2, XCircle, Search, Filter, X } from "lucide-react";
import { Th, Td } from "../components/Table";
import { PriceDisplay } from "@/components/price-display";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { AIReceiptScanner } from "@/components/ai-receipt-scanner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

import PartnerProfitsSection from "./partner-profits";

type Payment = {
  id: string;
  propertyNumber: string;
  propertyName?: string;
  packageId?: string;
  amount: number;
  discountCode?: string;
  discountAmount?: number;
  finalAmount: number;
  paymentMethod?: string;
  status: string;
  createdAt: string;
  completedAt?: string;
  receiptUrl?: string;
  transactionId?: string;
  merchantFees?: number;
  acqFees?: number;
  feeAmount?: number;
  vatAmount?: number;
  totalFees?: number;
  netAmount?: number;
  action?: string;
};

type AddOnPackage = {
  id: string;
  name: string;
  price: number;
};

const PAYMOB_FEE_RATES: Record<string, { percentage: number; fixedFee: number; label: string }> = {
  "mada": { percentage: 1.0, fixedFee: 1, label: "مدى (1% + 1 ر.س)" },
  "visa-local": { percentage: 2.7, fixedFee: 1, label: "Visa/MC محلي (2.7% + 1 ر.س)" },
  "visa-intl": { percentage: 3.7, fixedFee: 1, label: "Visa/MC دولي (3.7% + 1 ر.س)" },
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

const subscriptionPackageNames: Record<string, string> = {
  'pkg-monthly': 'اشتراك شهري',
  'pkg-month': 'الباقة الذهبية',
  'pkg-month1': 'الباقة الفضية',
  'pkg-special': 'عرض خاص شهرين',
  'pkg-special-2months': 'عرض خاص شهرين',
  'pkg-2months': 'عرض خاص شهرين',
  'pkg-camps': 'باقة المخيمات',
  'pkg-2properties': 'باقة النخبة - عقارين',
  'pkg-month-2properties': 'باقة النخبة - عقارين',
  'pkg-month-2prop': 'باقة النخبة - عقارين',
  'pkg-free': 'الباقة المجانية',
};

function getPackageNameArabic(packageId: string, addOnPackages: AddOnPackage[] = []) {
  // أولاً: تحقق من باقات الاشتراكات
  if (subscriptionPackageNames[packageId]) {
    return subscriptionPackageNames[packageId];
  }
  
  // ثانياً: تحقق من باقات الإضافات
  const addOnPkg = addOnPackages.find(p => p.id === packageId);
  if (addOnPkg) {
    return addOnPkg.name;
  }
  
  return packageId || '-';
}

import { formatLiveSaudiTime, formatLiveSaudiDate } from "@/lib/dateUtils";

function formatDate(dateStr: string) {
  return formatLiveSaudiDate(dateStr);
}

export default function PaymentsSection() {
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [methodFilter, setMethodFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const { toast } = useToast();
  
  // Mutation للموافقة على التحويل البنكي
  const approvePaymentMutation = useMutation({
    mutationFn: async (paymentId: string) => {
      const response = await apiRequest("POST", "/api/admin/payment/approve", { paymentId });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
      toast({
        title: "✅ تم قبول التحويل",
        description: "تم تفعيل الاشتراك بنجاح",
      });
    },
    onError: () => {
      toast({
        title: "❌ خطأ",
        description: "فشل قبول التحويل",
        variant: "destructive",
      });
    },
  });

  // Mutation لرفض التحويل البنكي
  const rejectPaymentMutation = useMutation({
    mutationFn: async (paymentId: string) => {
      const response = await apiRequest("POST", "/api/admin/payment/reject", { paymentId });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/payments"] });
      toast({
        title: "✅ تم رفض التحويل",
        description: "تم رفض الدفع بنجاح",
      });
    },
    onError: () => {
      toast({
        title: "❌ خطأ",
        description: "فشل رفض التحويل",
        variant: "destructive",
      });
    },
  });
  
  const { data, isLoading } = useQuery<Payment[]>({
    queryKey: ["admin-payments"],
    queryFn: async () => {
      const res = await fetch("/api/admin/payments");
      if (!res.ok) throw new Error("فشل في جلب المدفوعات");
      return res.json();
    },
  });

  // جلب باقات الإضافات لعرض أسمائها
  const { data: addOnPackages = [] } = useQuery<AddOnPackage[]>({
    queryKey: ["/api/owner/addons"],
  });

  // استخراج القيم الفريدة للفلاتر
  const uniqueStatuses = useMemo(() => {
    const statuses = new Set((data || []).map(p => p.status));
    return Array.from(statuses).sort();
  }, [data]);

  const uniqueMethods = useMemo(() => {
    const methods = new Set((data || []).map(p => p.paymentMethod || "-").filter(Boolean));
    return Array.from(methods).sort();
  }, [data]);

  // تطبيق الفلاتر
  const filteredData = useMemo(() => {
    let filtered = data || [];

    // بحث برقم العقار أو اسمه
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      filtered = filtered.filter(p =>
        p.propertyNumber.toLowerCase().includes(q) ||
        (p.propertyName || "").toLowerCase().includes(q)
      );
    }

    // فلتر الحالة
    if (statusFilter !== "all") {
      filtered = filtered.filter(p => p.status === statusFilter);
    }

    // فلتر طريقة الدفع
    if (methodFilter !== "all") {
      filtered = filtered.filter(p => (p.paymentMethod || "-") === methodFilter);
    }

    // فلتر التاريخ من
    if (dateFrom) {
      const fromDate = new Date(dateFrom);
      fromDate.setHours(0, 0, 0, 0);
      filtered = filtered.filter(p => new Date(p.createdAt) >= fromDate);
    }

    // فلتر التاريخ إلى
    if (dateTo) {
      const toDate = new Date(dateTo);
      toDate.setHours(23, 59, 59, 999);
      filtered = filtered.filter(p => new Date(p.createdAt) <= toDate);
    }

    return filtered;
  }, [data, searchQuery, statusFilter, methodFilter, dateFrom, dateTo]);

  const hasActiveFilters = searchQuery || statusFilter !== "all" || methodFilter !== "all" || dateFrom || dateTo;

  const clearFilters = () => {
    setSearchQuery("");
    setStatusFilter("all");
    setMethodFilter("all");
    setDateFrom("");
    setDateTo("");
  };

  const completedPayments = (filteredData || []).filter(p => p.status === "مكتمل");
  
const totals = completedPayments.reduce((acc, p) => {
  const amount = p.finalAmount || p.amount || 0;

  // استخدام بيانات Paymob الفعلية إن وُجدت
  const totalFees = p.totalFees !== undefined
    ? p.totalFees
    : calculateFees(amount, p.paymentMethod || "default").totalFees;

  const netAmount = p.netAmount !== undefined
    ? p.netAmount
    : amount - totalFees;

  const partnerProfit = netAmount * 0.5;
  const ourProfit = netAmount * 0.5;

  return {
    totalAmount: acc.totalAmount + amount,
    totalFees: acc.totalFees + totalFees,
    totalNet: acc.totalNet + netAmount,
    partnerProfit: acc.partnerProfit + partnerProfit,
    ourProfit: acc.ourProfit + ourProfit,
  };
}, { totalAmount: 0, totalFees: 0, totalNet: 0, partnerProfit: 0, ourProfit: 0 });


  return (
    <section className="space-y-4" dir="rtl">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h2 className="text-lg font-semibold">المدفوعات</h2>
          <p className="text-xs text-muted-foreground">
            عرض جميع عمليات الدفع — اشتراكات، تجديدات، معاملات Paymob.
          </p>
        </div>

        <Dialog>
          <DialogTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="text-xs md:text-sm"
            >
              أرباح الشريك
            </Button>
          </DialogTrigger>

          <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto" dir="rtl">
            <DialogHeader>
              <DialogTitle>أرباح الشريك</DialogTitle>
            </DialogHeader>

            <div className="mt-2">
              <PartnerProfitsSection />
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* فلاتر البحث */}
      <Card className="p-3">
        <div className="flex items-center gap-2 flex-wrap">
          {/* بحث برقم العقار */}
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="بحث برقم العقار..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="pr-9 h-9 text-sm"
            />
          </div>

          {/* فلتر الحالة */}
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="h-9 px-3 rounded-md border text-sm bg-background min-w-[120px]"
          >
            <option value="all">كل الحالات</option>
            {uniqueStatuses.map(s => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>

          {/* فلتر طريقة الدفع */}
          <select
            value={methodFilter}
            onChange={e => setMethodFilter(e.target.value)}
            className="h-9 px-3 rounded-md border text-sm bg-background min-w-[120px]"
          >
            <option value="all">كل الطرق</option>
            {uniqueMethods.map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
          </select>

          <Button
            variant="outline"
            size="sm"
            className="h-9 text-xs"
            onClick={() => setShowFilters(!showFilters)}
          >
            <Filter className="w-3.5 h-3.5 ml-1" />
            تاريخ
          </Button>

          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              className="h-9 text-xs text-red-600 hover:text-red-700"
              onClick={clearFilters}
            >
              <X className="w-3.5 h-3.5 ml-1" />
              مسح الفلاتر
            </Button>
          )}
        </div>

        {/* فلاتر التاريخ */}
        {showFilters && (
          <div className="flex items-center gap-2 mt-3 flex-wrap">
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground whitespace-nowrap">من:</label>
              <Input
                type="date"
                value={dateFrom}
                onChange={e => setDateFrom(e.target.value)}
                className="h-9 text-sm w-auto"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-muted-foreground whitespace-nowrap">إلى:</label>
              <Input
                type="date"
                value={dateTo}
                onChange={e => setDateTo(e.target.value)}
                className="h-9 text-sm w-auto"
              />
            </div>
          </div>
        )}

        {hasActiveFilters && (
          <div className="mt-2 text-xs text-muted-foreground">
            عرض {filteredData.length} من {(data || []).length} عملية
          </div>
        )}
      </Card>

      {/* ملخص الأرباح والرسوم */}
      {completedPayments.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <Card className="p-3 bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800">
            <div className="flex items-center gap-2 mb-1">
              <CreditCard className="w-4 h-4 text-blue-600" />
              <span className="text-xs text-blue-600 font-medium">إجمالي المدفوعات</span>
            </div>
            <div className="text-lg font-bold text-blue-700 dark:text-blue-400">
              {totals.totalAmount.toFixed(2)} ر.س
            </div>
            <div className="text-[10px] text-blue-600/70">{completedPayments.length} عملية مكتملة</div>
          </Card>

          <Card className="p-3 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800">
            <div className="flex items-center gap-2 mb-1">
              <Percent className="w-4 h-4 text-red-600" />
              <span className="text-xs text-red-600 font-medium">رسوم البنوك</span>
            </div>
            <div className="text-lg font-bold text-red-700 dark:text-red-400">
              -{totals.totalFees.toFixed(2)} ر.س
            </div>
            <div className="text-[10px] text-red-600/70">رسوم + ضريبة 15%</div>
          </Card>

          <Card className="p-3 bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800">
            <div className="flex items-center gap-2 mb-1">
              <Calculator className="w-4 h-4 text-emerald-600" />
              <span className="text-xs text-emerald-600 font-medium">الصافي</span>
            </div>
            <div className="text-lg font-bold text-emerald-700 dark:text-emerald-400">
              {totals.totalNet.toFixed(2)} ر.س
            </div>
            <div className="text-[10px] text-emerald-600/70">بعد خصم الرسوم</div>
          </Card>

          <Card className="p-3 bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="w-4 h-4 text-amber-600" />
              <span className="text-xs text-amber-600 font-medium">حصة الشريك (50%)</span>
            </div>
            <div className="text-lg font-bold text-amber-700 dark:text-amber-400">
              {totals.partnerProfit.toFixed(2)} ر.س
            </div>
            <div className="text-[10px] text-amber-600/70">من الصافي</div>
          </Card>

          <Card className="p-3 bg-primary/10 border-primary/30">
            <div className="flex items-center gap-2 mb-1">
              <TrendingUp className="w-4 h-4 text-primary" />
              <span className="text-xs text-primary font-medium">أرباحنا (50%)</span>
            </div>
            <div className="text-lg font-bold text-primary">
              {totals.ourProfit.toFixed(2)} ر.س
            </div>
            <div className="text-[10px] text-primary/70">من الصافي</div>
          </Card>
        </div>
      )}

      {/* جدول المدفوعات */}
      <Card className="overflow-x-auto">
        {isLoading ? (
          <div className="p-4 flex items-center gap-2 text-muted-foreground text-sm">
            <Loader2 className="w-4 h-4 animate-spin" />
            جاري تحميل المدفوعات...
          </div>
        ) : (
          <table className="w-full text-xs md:text-sm">
            <thead className="bg-muted/50 text-right">
              <tr>
                <Th>العقار</Th>
                <Th>النوع</Th>
                <Th>الباقة</Th>
                <Th>المبلغ</Th>
                <Th>طريقة الدفع</Th>
                <Th>الحالة</Th>
                <Th>الرسوم والصافي</Th>
                <Th>التاريخ</Th>
                <Th></Th>
              </tr>
            </thead>

            <tbody>
              {(filteredData || []).map((p) => {
                const amount = p.finalAmount || p.amount || 0;
                const fees = calculateFees(amount, p.paymentMethod || "default");
                const isExpanded = expandedRow === p.id;
                const isCompleted = p.status === "مكتمل";
                const isPendingVerification = p.status === "نجح - قيد التحقق";
                const showFees = isCompleted || isPendingVerification;

                return (
                  <Fragment key={p.id}>
                    <tr className="border-t hover:bg-muted/40">
                      <Td>
                        <div>
                          <div className="font-semibold">{p.propertyNumber}</div>
                          {p.propertyName && (
                            <div className="text-[10px] text-muted-foreground truncate max-w-[100px]">
                              {p.propertyName}
                            </div>
                          )}
                        </div>
                      </Td>
                      <Td>
                        <Badge 
                          variant="outline" 
                          className={`text-[10px] ${
                            p.action === "addon" 
                              ? "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400" 
                              : "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400"
                          }`}
                        >
                          {p.action === "addon" ? "إضافة" : "اشتراك"}
                        </Badge>
                      </Td>
                      <Td>
                        <span className="text-xs">{getPackageNameArabic(p.packageId || '', addOnPackages)}</span>
                      </Td>
                      <Td>
                        <PriceDisplay amount={amount} size="sm" />
                      </Td>
                      <Td>
                        <span className="text-xs">{p.paymentMethod || '-'}</span>
                      </Td>
                      <Td>
                        <Badge
                          variant={
                            p.status === "مكتمل" ? "default" :
                            p.status === "نجح - قيد التحقق" ? "outline" :
                            p.status === "قيد المراجعة" ? "outline" :
                            p.status === "مرفوض" ? "destructive" : "destructive"
                          }
                          className={`text-[10px] ${
                            p.status === "مكتمل" ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" :
                            p.status === "نجح - قيد التحقق" ? "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400" :
                            p.status === "قيد المراجعة" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" :
                            p.status === "مرفوض" ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" :
                            ""
                          }`}
                        >
                          {p.status}
                        </Badge>
                      </Td>
                      <Td>
                        <div className="flex flex-col gap-1 min-w-[100px]">
                          <div className="flex items-center justify-between gap-2 border-b border-border/30 pb-1">
                            <span className="text-muted-foreground text-[10px]">الرسوم:</span>
                            {showFees ? (
                              <span className={`text-[11px] font-medium ${isPendingVerification ? "text-orange-600" : "text-red-600"}`}>
                                -{(p.totalFees ?? fees.totalFees).toFixed(2)} ر.س
                              </span>
                            ) : (
                              <span className="text-muted-foreground text-[11px]">-</span>
                            )}
                          </div>
                          <div className="flex items-center justify-between gap-2 pt-0.5">
                            <span className="text-muted-foreground text-[10px]">الصافي:</span>
                            {showFees ? (
                              <span className={`font-bold text-[11px] ${isPendingVerification ? "text-orange-600" : "text-emerald-600"}`}>
                                {(p.netAmount ?? (amount - (p.totalFees ?? fees.totalFees))).toFixed(2)} ر.س
                              </span>
                            ) : (
                              <span className="text-muted-foreground text-[11px]">-</span>
                            )}
                          </div>
                        </div>
                      </Td>
                      <Td>{formatDate(p.createdAt)}</Td>
                      <Td>
                        {(isCompleted || isPendingVerification || p.status === "قيد المراجعة" || p.status === "قيد التحقق" || p.status === "معلق" || p.status === "مرفوض") && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6"
                            onClick={() => setExpandedRow(isExpanded ? null : p.id)}
                            data-testid={`button-expand-payment-${p.id}`}
                          >
                            {isExpanded ? (
                              <ChevronUp className="w-3 h-3" />
                            ) : (
                              <ChevronDown className="w-3 h-3" />
                            )}
                          </Button>
                        )}
                      </Td>
                    </tr>
                    
                    {/* صف التفاصيل الموسعة - للمدفوعات المعلقة والمرفوضة */}
                    {isExpanded && (p.status === "قيد المراجعة" || p.status === "قيد التحقق" || p.status === "نجح - قيد التحقق" || p.status === "معلق" || p.status === "مرفوض" || p.status === "مكتمل") && (
                      <tr key={`${p.id}-pending-details`} className={`${p.status === "مرفوض" ? "bg-red-50 dark:bg-red-900/10 border-t-2 border-red-300" : "bg-amber-50 dark:bg-amber-900/10 border-t-2 border-amber-300"}`}>
                        <Td colSpan={10}>
                          <div className="py-4 px-3">
                            <div className={`text-sm font-bold mb-3 ${p.status === "مرفوض" ? "text-red-700 dark:text-red-400" : "text-amber-700 dark:text-amber-400"}`}>
                              {p.status === "مرفوض" ? "تحويل بنكي مرفوض" : "تحويل بنكي معلق - يحتاج مراجعة"}
                            </div>
                            
                            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4 text-xs">
                              <div className="bg-card p-3 rounded border">
                                <div className="text-muted-foreground mb-1">رقم العقار</div>
                                <div className="font-bold">{p.propertyNumber}</div>
                              </div>
                              <div className="bg-card p-3 rounded border">
                                <div className="text-muted-foreground mb-1">النوع</div>
                                <div className="font-semibold">{p.action === "addon" ? "إضافة" : "اشتراك"}</div>
                              </div>
                              <div className="bg-card p-3 rounded border">
                                <div className="text-muted-foreground mb-1">الباقة</div>
                                <div className="font-semibold">{getPackageNameArabic(p.packageId || '', addOnPackages)}</div>
                              </div>
                              <div className="bg-card p-3 rounded border">
                                <div className="text-muted-foreground mb-1">المبلغ النهائي</div>
                                <div className="font-bold text-green-600">{amount.toFixed(2)} ر.س</div>
                              </div>
                              <div className="bg-card p-3 rounded border">
                                <div className="text-muted-foreground mb-1">تاريخ الدفع</div>
                                <div className="font-semibold">{formatDate(p.createdAt)}</div>
                              </div>
                            </div>

                            {p.receiptUrl && (
                              <div className="mb-4">
                                <a
                                  href={p.receiptUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="text-blue-600 underline text-sm hover:text-blue-800"
                                >
                                  عرض إيصال التحويل البنكي
                                </a>
                              </div>
                            )}

                            {/* نتائج الفحص الذكي للإيصال */}
                            {p.receiptUrl && (
                              <div className="mb-4">
                                <AIReceiptScanner
                                  paymentId={p.id}
                                  receiptUrl={p.receiptUrl}
                                  autoScan={true}
                                />
                              </div>
                            )}

                            <div className="flex gap-3 mt-4">
                              {/* Accept button: show for pending and rejected (can re-accept a rejected) */}
                              {p.status !== "مكتمل" && (
                              <Button
                                size="sm"
                                variant="default"
                                className="bg-green-600 hover:bg-green-700 text-white"
                                onClick={() => approvePaymentMutation.mutate(p.id)}
                                disabled={approvePaymentMutation.isPending}
                                data-testid={`button-approve-payment-${p.id}`}
                              >
                                {approvePaymentMutation.isPending ? (
                                  <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                                ) : (
                                  <CheckCircle2 className="w-4 h-4 ml-2" />
                                )}
                                {p.action === "addon" ? "قبول وتفعيل الإضافة" : "قبول التحويل وتفعيل الاشتراك"}
                              </Button>
                              )}
                              {/* Reject button: only show for pending statuses, NOT for already rejected */}
                              {p.status !== "مرفوض" && p.status !== "مكتمل" && (
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => rejectPaymentMutation.mutate(p.id)}
                                disabled={rejectPaymentMutation.isPending}
                                data-testid={`button-reject-payment-${p.id}`}
                              >
                                {rejectPaymentMutation.isPending ? (
                                  <Loader2 className="w-4 h-4 ml-2 animate-spin" />
                                ) : (
                                  <XCircle className="w-4 h-4 ml-2" />
                                )}
                                رفض التحويل
                              </Button>
                            )}
                            </div>
                          </div>
                        </Td>
                      </tr>
                    )}
                    
                    {/* صف التفاصيل الموسعة - للمدفوعات المكتملة */}
                    {isExpanded && isCompleted && (() => {
                      const hasPaymobFees = p.totalFees !== undefined && p.totalFees > 0;
                      const hasSeparateFees = p.merchantFees !== undefined || p.acqFees !== undefined;
                      
                      const actualMerchantFees = p.merchantFees || 0;
                      const actualAcqFees = p.acqFees || 0;
                      const actualVatAmount = hasPaymobFees ? (p.vatAmount || 0) : fees.vatOnFee;
                      const actualTotalFees = hasPaymobFees ? (p.totalFees || 0) : fees.totalFees;
                      const actualNetAmount = hasPaymobFees ? (p.netAmount || amount - actualTotalFees) : fees.netAmount;
                      const actualPartnerProfit = actualNetAmount * PARTNER_SHARE;
                      const actualOurProfit = actualNetAmount * PARTNER_SHARE;
                      
                      return (
                      <tr key={`${p.id}-details`} className="bg-muted/20">
                        <Td colSpan={10}>
                          <div className="py-3 px-2">
                            {/* رقم المعاملة من Paymob */}
                            {p.transactionId && (
                              <div className="mb-3 flex items-center gap-2 text-xs">
                                <span className="text-muted-foreground">رقم المعاملة (Paymob):</span>
                                <code className="bg-primary/10 px-2 py-1 rounded font-mono font-bold text-primary">{p.transactionId}</code>
                                {hasPaymobFees && (
                                  <Badge variant="outline" className="text-[9px] text-green-600 border-green-300">
                                    رسوم حقيقية
                                  </Badge>
                                )}
                              </div>
                            )}
                          </div>
                        </Td>
                      </tr>
                    );
                    })()}
                  </Fragment>
                );
              })}

              {(filteredData || []).length === 0 && (
                <tr>
                  <Td colSpan={10}>
                    <div className="p-4 text-center text-xs text-muted-foreground">
                      لا توجد مدفوعات حتى الآن.
                    </div>
                  </Td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </Card>

      {/* ملاحظة توضيحية */}
      <div className="text-[10px] text-muted-foreground bg-muted/30 p-3 rounded-lg">
        <strong>ملاحظة:</strong> الرسوم الرسمية من Paymob KSA:
        <ul className="mt-1 mr-4 list-disc">
          <li>مدى (Mada): 1% + 1 ر.س + ضريبة 15%</li>
          <li>STC Pay: 1% + 1 ر.س + ضريبة 15%</li>
          <li>Visa/MasterCard محلي: 2.7% + 1 ر.س + ضريبة 15%</li>
          <li>Visa/MasterCard دولي: 3.7% + 1 ر.س + ضريبة 15%</li>
          <li>Apple Pay: 2.7% + 1 ر.س + ضريبة 15%</li>
          <li>تحويل بنكي: 0%</li>
        </ul>
        <div className="mt-2">
          الأرباح تُقسم 50% للشريك و 50% لنا من الصافي بعد خصم الرسوم.
        </div>
      </div>
    </section>
  );
}
