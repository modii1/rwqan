// client/src/pages/admin/sections/payments.tsx
import { useState, Fragment } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2, Calculator, TrendingUp, CreditCard, Percent, ChevronDown, ChevronUp } from "lucide-react";
import { Th, Td } from "../components/Table";
import { PriceDisplay } from "@/components/price-display";

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

function getPackageNameArabic(packageId: string) {
  const packageNames: Record<string, string> = {
    'pkg-month': 'اشتراك شهر',
    'pkg-2months': 'عرض خاص شهرين',
    'pkg-2properties': 'اشتراك شهر لعقارين',
    'pkg-camps': 'باقة المخيمات',
    'pkg-free': 'باقة مجانية',
  };
  return packageNames[packageId] || packageId || '-';
}

function formatDate(dateStr: string) {
  if (!dateStr) return "-";
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString("ar-SA", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return dateStr;
  }
}

export default function PaymentsSection() {
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  
  const { data, isLoading } = useQuery<Payment[]>({
    queryKey: ["admin-payments"],
    queryFn: async () => {
      const res = await fetch("/api/admin/payments");
      if (!res.ok) throw new Error("فشل في جلب المدفوعات");
      return res.json();
    },
  });

  const completedPayments = (data || []).filter(p => p.status === "مكتمل");
  
  const totals = completedPayments.reduce((acc, p) => {
    const amount = p.finalAmount || p.amount || 0;
    const fees = calculateFees(amount, p.paymentMethod || "default");
    
    return {
      totalAmount: acc.totalAmount + amount,
      totalFees: acc.totalFees + fees.totalFees,
      totalNet: acc.totalNet + fees.netAmount,
      partnerProfit: acc.partnerProfit + fees.partnerProfit,
      ourProfit: acc.ourProfit + fees.ourProfit,
    };
  }, { totalAmount: 0, totalFees: 0, totalNet: 0, partnerProfit: 0, ourProfit: 0 });

  return (
    <section className="space-y-4">
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

          <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>أرباح الشريك</DialogTitle>
            </DialogHeader>

            <div className="mt-2">
              <PartnerProfitsSection />
            </div>
          </DialogContent>
        </Dialog>
      </div>

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
                <Th>الباقة</Th>
                <Th>المبلغ</Th>
                <Th>طريقة الدفع</Th>
                <Th>الرسوم</Th>
                <Th>الصافي</Th>
                <Th>الحالة</Th>
                <Th>التاريخ</Th>
                <Th></Th>
              </tr>
            </thead>

            <tbody>
              {(data || []).map((p) => {
                const amount = p.finalAmount || p.amount || 0;
                const fees = calculateFees(amount, p.paymentMethod || "default");
                const isExpanded = expandedRow === p.id;
                const isCompleted = p.status === "مكتمل";

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
                        <span className="text-xs">{getPackageNameArabic(p.packageId || '')}</span>
                      </Td>
                      <Td>
                        <PriceDisplay amount={amount} size="sm" />
                      </Td>
                      <Td>
                        <span className="text-xs">{p.paymentMethod || '-'}</span>
                      </Td>
                      <Td>
                        {isCompleted ? (
                          <span className="text-red-600 text-xs font-medium">
                            -{fees.totalFees.toFixed(2)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-xs">-</span>
                        )}
                      </Td>
                      <Td>
                        {isCompleted ? (
                          <span className="text-green-600 font-semibold text-xs">
                            {fees.netAmount.toFixed(2)}
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-xs">-</span>
                        )}
                      </Td>
                      <Td>
                        <Badge
                          variant={
                            p.status === "مكتمل" ? "default" :
                            p.status === "قيد المراجعة" ? "outline" : "destructive"
                          }
                          className={`text-[10px] ${
                            p.status === "مكتمل" ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400" :
                            p.status === "قيد المراجعة" ? "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" :
                            ""
                          }`}
                        >
                          {p.status}
                        </Badge>
                      </Td>
                      <Td>{formatDate(p.createdAt)}</Td>
                      <Td>
                        {isCompleted && (
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6"
                            onClick={() => setExpandedRow(isExpanded ? null : p.id)}
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
                    
                    {/* صف التفاصيل الموسعة */}
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
                        <Td colSpan={9}>
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
                            
                            <div className="text-xs font-semibold mb-3 text-muted-foreground">تفاصيل الرسوم والأرباح</div>
                            <div className={`grid grid-cols-2 ${hasSeparateFees ? 'md:grid-cols-7' : 'md:grid-cols-6'} gap-3 text-xs`}>
                              <div className="bg-card p-2 rounded border">
                                <div className="text-muted-foreground mb-1">المبلغ المدفوع</div>
                                <div className="font-bold text-primary">{amount.toFixed(2)} ر.س</div>
                              </div>
                              <div className="bg-card p-2 rounded border">
                                <div className="text-muted-foreground mb-1">طريقة الدفع</div>
                                <div className="font-semibold">{p.paymentMethod || fees.feeLabel}</div>
                              </div>
                              {hasSeparateFees ? (
                                <>
                                  <div className="bg-card p-2 rounded border">
                                    <div className="text-muted-foreground mb-1">رسوم التاجر</div>
                                    <div className="font-semibold text-red-600">-{actualMerchantFees.toFixed(2)} ر.س</div>
                                  </div>
                                  <div className="bg-card p-2 rounded border">
                                    <div className="text-muted-foreground mb-1">رسوم البنك (acq)</div>
                                    <div className="font-semibold text-red-600">-{actualAcqFees.toFixed(2)} ر.س</div>
                                  </div>
                                </>
                              ) : (
                                <div className="bg-card p-2 rounded border">
                                  <div className="text-muted-foreground mb-1">رسوم البنك</div>
                                  <div className="font-semibold text-red-600">-{(p.feeAmount || fees.feeAmount).toFixed(2)} ر.س</div>
                                </div>
                              )}
                              <div className="bg-card p-2 rounded border">
                                <div className="text-muted-foreground mb-1">ضريبة الرسوم (15%)</div>
                                <div className="font-semibold text-red-600">-{actualVatAmount.toFixed(2)} ر.س</div>
                              </div>
                              <div className="bg-card p-2 rounded border">
                                <div className="text-muted-foreground mb-1">إجمالي الرسوم</div>
                                <div className="font-bold text-red-600">-{actualTotalFees.toFixed(2)} ر.س</div>
                              </div>
                              <div className="bg-card p-2 rounded border border-green-300 bg-green-50 dark:bg-green-900/20">
                                <div className="text-muted-foreground mb-1">الصافي</div>
                                <div className="font-bold text-green-600">{actualNetAmount.toFixed(2)} ر.س</div>
                              </div>
                            </div>
                            
                            <div className="mt-3 pt-3 border-t grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                              <div className="bg-amber-50 dark:bg-amber-900/20 p-2 rounded border border-amber-200">
                                <div className="text-amber-600 mb-1">حصة الشريك (50%)</div>
                                <div className="font-bold text-amber-700">{actualPartnerProfit.toFixed(2)} ر.س</div>
                              </div>
                              <div className="bg-primary/10 p-2 rounded border border-primary/30">
                                <div className="text-primary mb-1">أرباحنا (50%)</div>
                                <div className="font-bold text-primary">{actualOurProfit.toFixed(2)} ر.س</div>
                              </div>
                              {p.discountCode && (
                                <div className="bg-card p-2 rounded border">
                                  <div className="text-muted-foreground mb-1">كود الخصم</div>
                                  <div className="font-semibold text-green-600">{p.discountCode}</div>
                                </div>
                              )}
                              {p.receiptUrl && (
                                <div className="bg-card p-2 rounded border">
                                  <div className="text-muted-foreground mb-1">الإيصال</div>
                                  <a
                                    href={p.receiptUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-blue-600 underline text-xs"
                                  >
                                    عرض الإيصال
                                  </a>
                                </div>
                              )}
                            </div>
                          </div>
                        </Td>
                      </tr>
                    );
                    })()}
                  </Fragment>
                );
              })}

              {(data || []).length === 0 && (
                <tr>
                  <Td colSpan={9}>
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
