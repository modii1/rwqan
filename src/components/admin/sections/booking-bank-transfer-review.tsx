"use client";

import { useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { bookingApiRequest } from "@/components/booking/booking-api";
import type { BookingAdminPaymentAttempt } from "@/components/booking/booking-display";

type BankTransferAttempt = BookingAdminPaymentAttempt & {
  receiptUrl?: string | null;
  receiptContentType?: string | null;
  receiptSizeBytes?: number | null;
  receiptSubmittedAt?: string | null;
  bankReviewDecision?: string | null;
  bankReviewReason?: string | null;
  bankReviewedAt?: string | null;
};

function normalized(value: unknown): string {
  return String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function safeReceiptUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ||
      (url.protocol === "http:" && process.env.NODE_ENV !== "production")
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

function formatDateTime(value: unknown): string {
  const date = new Date(String(value || ""));
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", {
        timeZone: "Asia/Riyadh",
        dateStyle: "long",
        timeStyle: "short",
      }).format(date);
}

function formatReceiptSize(value: unknown): string {
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function receiptTypeLabel(value: unknown): string {
  const type = normalized(value);
  if (type === "application/pdf") return "PDF";
  if (type === "image/jpeg") return "JPEG";
  if (type === "image/png") return "PNG";
  if (type === "image/webp") return "WebP";
  return String(value || "—");
}

function reviewDecisionLabel(value: unknown): string {
  const decision = normalized(value);
  if (decision === "approved") return "معتمد";
  if (decision === "rejected") return "مرفوض";
  if (decision === "refund_review") return "مراجعة استرداد";
  return "بانتظار القرار";
}

function reviewReasonLabel(value: unknown): string {
  const reason = normalized(value);
  if (!reason) return "—";
  if (reason === "receipt_rejected_by_admin") return "رفض الإيصال من الإدارة";
  if (reason === "booking_free_eligibility_lost") return "لم يعد الحجز مؤهلاً لمسار العقار المجاني";
  if (reason === "owner_identity_changed") return "تغيّرت هوية مالك العقار";
  if (reason === "commission_disputed_during_receipt_upload") return "سُجل اعتراض أثناء رفع الإيصال";
  if (reason === "commission_no_longer_payable") return "لم تعد العمولة قابلة للاحتساب على هذا الحجز";
  return String(value || "—");
}

export default function BookingBankTransferReview({
  bookingId,
  attempt,
  onChanged,
}: {
  bookingId: string;
  attempt: BankTransferAttempt;
  onChanged: () => void | Promise<void>;
}) {
  const [pending, setPending] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  if (normalized(attempt.paymentMethod) !== "bank_transfer") return null;

  const status = normalized(attempt.status);
  const receiptUrl = safeReceiptUrl(attempt.receiptUrl);
  const review = async (resolution: "approve" | "reject") => {
    if (!attempt.id) return;
    setPending(resolution);
    setError("");
    setNotice("");
    try {
      const result = await bookingApiRequest<{
        status: "approved" | "rejected" | "review_required";
      }>(
        `/api/admin/booking-commissions/${encodeURIComponent(bookingId)}/bank-transfer-review`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ attemptId: attempt.id, resolution }),
        },
      );
      setNotice(result.status === "approved"
        ? "تم اعتماد التحويل البنكي وتسجيل سداد العمولة."
        : result.status === "rejected"
          ? "تم رفض الإيصال ويمكن لصاحب العقار إنشاء محاولة دفع جديدة."
          : "لم يتم احتساب الإيصال، وتم تحويله إلى مراجعة مالية يدوية.");
      await onChanged();
    } catch (reviewError) {
      setError(reviewError instanceof Error
        ? reviewError.message
        : "تعذر مراجعة التحويل البنكي.");
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="mt-4 rounded-xl border border-blue-200 bg-blue-50/50 p-4">
      <h4 className="text-sm font-bold text-blue-900">إيصال التحويل البنكي</h4>
      {receiptUrl ? (
        <a
          href={receiptUrl}
          target="_blank"
          rel="noopener noreferrer"
          referrerPolicy="no-referrer"
          className="mt-3 inline-flex items-center gap-2 text-sm font-semibold text-blue-700 underline underline-offset-4"
        >
          <ExternalLink className="h-4 w-4" />
          عرض الإيصال في صفحة جديدة
        </a>
      ) : (
        <p className="mt-2 text-xs text-red-700">رابط الإيصال غير متاح.</p>
      )}

      <dl className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <div className="rounded-lg border bg-white p-3">
          <dt className="text-[11px] text-muted-foreground">وقت رفع الإيصال</dt>
          <dd className="mt-1 text-xs font-semibold text-slate-800">{formatDateTime(attempt.receiptSubmittedAt)}</dd>
        </div>
        <div className="rounded-lg border bg-white p-3">
          <dt className="text-[11px] text-muted-foreground">نوع الملف</dt>
          <dd className="mt-1 text-xs font-semibold text-slate-800">{receiptTypeLabel(attempt.receiptContentType)}</dd>
        </div>
        <div className="rounded-lg border bg-white p-3">
          <dt className="text-[11px] text-muted-foreground">حجم الملف</dt>
          <dd className="mt-1 text-xs font-semibold text-slate-800">{formatReceiptSize(attempt.receiptSizeBytes)}</dd>
        </div>
        <div className="rounded-lg border bg-white p-3">
          <dt className="text-[11px] text-muted-foreground">قرار المراجعة</dt>
          <dd className="mt-1 text-xs font-semibold text-slate-800">{reviewDecisionLabel(attempt.bankReviewDecision)}</dd>
        </div>
        <div className="rounded-lg border bg-white p-3">
          <dt className="text-[11px] text-muted-foreground">سبب القرار</dt>
          <dd className="mt-1 text-xs font-semibold text-slate-800">{reviewReasonLabel(attempt.bankReviewReason)}</dd>
        </div>
        <div className="rounded-lg border bg-white p-3">
          <dt className="text-[11px] text-muted-foreground">وقت المراجعة</dt>
          <dd className="mt-1 text-xs font-semibold text-slate-800">{formatDateTime(attempt.bankReviewedAt)}</dd>
        </div>
      </dl>

      {(status === "review_required" ||
        normalized(attempt.bankReviewDecision) === "refund_review") && (
        <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-800" role="alert">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <p className="text-xs leading-5">لا يمكن احتساب الإيصال على العمولة الحالية. يلزم التحقق من التحويل ومراجعة الاسترداد يدوياً.</p>
        </div>
      )}

      {status === "pending_review" && (
        <div className="mt-4 flex flex-wrap gap-2">
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                type="button"
                disabled={!receiptUrl || pending !== null}
                className="gap-2 bg-emerald-700 hover:bg-emerald-800"
                data-testid={`button-approve-booking-bank-${attempt.id}`}
              >
                {pending === "approve"
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <CheckCircle2 className="h-4 w-4" />}
                اعتماد الإيصال
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent dir="rtl">
              <AlertDialogHeader>
                <AlertDialogTitle>اعتماد التحويل البنكي؟</AlertDialogTitle>
                <AlertDialogDescription>سيتم تسجيل العمولة كمدفوعة ورفع إيقاف هذا الالتزام فقط إن كان العقار موقوفاً بسببه.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>إلغاء</AlertDialogCancel>
                <AlertDialogAction onClick={() => void review("approve")}>اعتماد التحويل</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                type="button"
                variant="destructive"
                disabled={pending !== null}
                className="gap-2"
                data-testid={`button-reject-booking-bank-${attempt.id}`}
              >
                {pending === "reject"
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <XCircle className="h-4 w-4" />}
                رفض الإيصال
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent dir="rtl">
              <AlertDialogHeader>
                <AlertDialogTitle>رفض إيصال التحويل؟</AlertDialogTitle>
                <AlertDialogDescription>سيبقى سجل الإيصال محفوظاً، وسيتمكن صاحب العقار من إنشاء محاولة دفع جديدة.</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>إلغاء</AlertDialogCancel>
                <AlertDialogAction onClick={() => void review("reject")} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">رفض الإيصال</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      )}

      {notice && <p className="mt-3 rounded-lg bg-emerald-50 p-3 text-xs font-medium text-emerald-800" role="status">{notice}</p>}
      {error && <p className="mt-3 rounded-lg bg-red-50 p-3 text-xs font-medium text-destructive" role="alert">{error}</p>}
    </div>
  );
}
