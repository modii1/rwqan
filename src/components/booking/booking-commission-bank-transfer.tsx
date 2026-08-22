"use client";

import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  Banknote,
  CheckCircle2,
  Loader2,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { bookingApiRequest } from "./booking-api";

const MAX_RECEIPT_BYTES = 5 * 1024 * 1024;
const ALLOWED_RECEIPT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

export interface BookingCommissionOwnerPaymentAttempt {
  paymentMethod?: string | null;
  status?: string | null;
  receiptSubmittedAt?: string | null;
  bankReviewDecision?: string | null;
  bankReviewReason?: string | null;
  bankReviewedAt?: string | null;
}

interface BankAccount {
  bankName?: string | null;
  beneficiaryName?: string | null;
  iban?: string | null;
  accountNumber?: string | null;
  barcodeUrl?: string | null;
  isActive?: boolean | null;
}

function normalized(value: unknown): string {
  return String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function validReceipt(file: File): string | null {
  if (!ALLOWED_RECEIPT_TYPES.has(file.type)) {
    return "صيغة الإيصال غير مدعومة.";
  }
  if (file.size <= 0) return "الإيصال مطلوب.";
  if (file.size > MAX_RECEIPT_BYTES) {
    return "حجم الإيصال يتجاوز الحد المسموح.";
  }
  return null;
}

export default function BookingCommissionBankTransfer({
  token,
  checkoutAvailable,
  attempt,
  disabled,
  onChanged,
  onError,
}: {
  token: string;
  checkoutAvailable: boolean;
  attempt?: BookingCommissionOwnerPaymentAttempt | null;
  disabled?: boolean;
  onChanged: () => void | Promise<void>;
  onError: (message: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const attemptMethod = normalized(attempt?.paymentMethod);
  const status = normalized(attempt?.status);
  const isBankAttempt = attemptMethod === "bank_transfer";
  const uploadInProgress = isBankAttempt && ["creating", "unknown"].includes(status);
  const pendingReview = isBankAttempt && status === "pending_review";
  const refundReview = isBankAttempt && (
    status === "review_required" ||
    normalized(attempt?.bankReviewDecision) === "refund_review"
  );

  const bankAccount = useQuery<BankAccount>({
    queryKey: ["booking-commission-bank-account"],
    queryFn: () => bookingApiRequest<BankAccount>("/api/bank-accounts/default"),
    enabled: expanded && checkoutAvailable && !pendingReview && !refundReview,
    retry: false,
    refetchOnWindowFocus: false,
  });
  const normalizedIban = String(bankAccount.data?.iban || "")
    .replace(/\s+/g, "")
    .toUpperCase();
  const bankAccountReady = Boolean(
    String(bankAccount.data?.bankName || "").trim() &&
    String(bankAccount.data?.beneficiaryName || "").trim() &&
    bankAccount.data?.isActive === true &&
    /^SA\d{22}$/.test(normalizedIban),
  );

  if (uploadInProgress) {
    return (
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-blue-800" role="status">
        <div className="flex items-start gap-3">
          <Loader2 className="mt-0.5 h-5 w-5 flex-shrink-0 animate-spin" aria-hidden="true" />
          <div>
            <p className="text-sm font-bold">جاري التحقق من محاولة التحويل</p>
            <p className="mt-1 text-xs leading-5">انتظر حتى يكتمل حفظ الإيصال أو التحقق من حالته قبل إنشاء محاولة أخرى.</p>
          </div>
        </div>
      </div>
    );
  }

  if (pendingReview) {
    return (
      <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-blue-800" role="status">
        <div className="flex items-start gap-3">
          <CheckCircle2 className="mt-0.5 h-5 w-5 flex-shrink-0" aria-hidden="true" />
          <div>
            <p className="text-sm font-bold">تم استلام إيصال التحويل</p>
            <p className="mt-1 text-xs leading-5">الإيصال بانتظار مراجعة الإدارة، ولن تحتاج إلى رفعه مرة أخرى.</p>
          </div>
        </div>
      </div>
    );
  }

  if (refundReview) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-800" role="alert">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0" aria-hidden="true" />
          <div>
            <p className="text-sm font-bold">الإيصال يحتاج مراجعة مالية</p>
            <p className="mt-1 text-xs leading-5">تم حفظ الإيصال ولن يتم احتساب العمولة أو تغيير حالة العقار حتى تنتهي مراجعة الإدارة.</p>
          </div>
        </div>
      </div>
    );
  }

  if (!checkoutAvailable) return null;

  const submit = async () => {
    if (!file) {
      onError("اختر إيصال التحويل قبل الإرسال.");
      return;
    }
    const validationError = validReceipt(file);
    if (validationError) {
      onError(validationError);
      return;
    }
    setPending(true);
    onError("");
    try {
      const formData = new FormData();
      formData.append("receipt", file);
      await bookingApiRequest<{
        status: "pending_review" | "review_required";
      }>(`/api/booking-commissions/${encodeURIComponent(token)}/bank-transfer`, {
        method: "POST",
        body: formData,
      });
      setExpanded(false);
      await onChanged();
    } catch (error) {
      onError(error instanceof Error
        ? error.message
        : "تعذر رفع الإيصال. حاول مرة أخرى.");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="mt-3 rounded-xl border border-blue-200 bg-blue-50/40 p-4">
      <Button
        type="button"
        variant="outline"
        onClick={() => setExpanded((value) => !value)}
        disabled={disabled || pending}
        className="h-12 w-full gap-2 border-blue-300 text-blue-800 hover:bg-blue-50"
        data-testid="button-commission-pay-bank-transfer"
      >
        <Banknote className="h-4 w-4" />
        تحويل بنكي مع رفع الإيصال
      </Button>

      {expanded && (
        <div className="mt-4 space-y-4">
          {bankAccount.isLoading && (
            <p className="flex items-center justify-center gap-2 py-3 text-sm text-blue-700">
              <Loader2 className="h-4 w-4 animate-spin" />
              جاري تحميل بيانات الحساب...
            </p>
          )}
          {(bankAccount.isError ||
            (!bankAccount.isLoading && bankAccount.isFetched && !bankAccountReady)) && (
            <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700" role="alert">
              بيانات الحساب البنكي غير متاحة أو غير مكتملة.
            </p>
          )}
          {bankAccountReady && bankAccount.data && (
            <div className="space-y-2 rounded-xl border border-blue-200 bg-white p-4 text-sm">
              <p className="font-bold text-blue-900">معلومات التحويل البنكي</p>
              <p><span className="text-muted-foreground">البنك: </span>{bankAccount.data.bankName || "—"}</p>
              <p><span className="text-muted-foreground">اسم المستفيد: </span>{bankAccount.data.beneficiaryName || "—"}</p>
              <p dir="ltr" className="break-all text-right font-mono"><span className="font-sans text-muted-foreground">IBAN: </span>{bankAccount.data.iban || "—"}</p>
              {bankAccount.data.accountNumber && (
                <p dir="ltr" className="break-all text-right font-mono"><span className="font-sans text-muted-foreground">رقم الحساب: </span>{bankAccount.data.accountNumber}</p>
              )}
              {bankAccount.data.barcodeUrl && (
                <img
                  src={bankAccount.data.barcodeUrl}
                  alt="باركود الحساب البنكي"
                  className="mx-auto max-h-48 max-w-full rounded-lg"
                />
              )}
            </div>
          )}

          <div>
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              className="hidden"
              onChange={(event) => {
                const selected = event.target.files?.[0] || null;
                setFile(selected);
                if (selected) onError(validReceipt(selected) || "");
              }}
              data-testid="input-commission-bank-receipt"
            />
            <Button
              type="button"
              variant="outline"
              onClick={() => inputRef.current?.click()}
              disabled={pending}
              className="w-full gap-2 bg-white"
            >
              <Upload className="h-4 w-4" />
              {file ? file.name : "اختر إيصال التحويل"}
            </Button>
            <p className="mt-2 text-[11px] text-muted-foreground">JPG أو PNG أو WebP أو PDF، بحد أقصى 5 MB.</p>
          </div>

          <Button
            type="button"
            onClick={() => void submit()}
            disabled={!file || pending || !bankAccountReady}
            className="w-full gap-2 bg-blue-700 hover:bg-blue-800"
            data-testid="button-submit-commission-bank-receipt"
          >
            {pending && <Loader2 className="h-4 w-4 animate-spin" />}
            رفع الإيصال للمراجعة
          </Button>
        </div>
      )}
    </div>
  );
}
