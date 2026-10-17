"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CheckCircle2, Clock3, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

const RETURN_STORAGE_KEY = "rwqan-booking-commission-return";
const RETURN_PATH_PATTERN = /^\/booking-commission\/[A-Za-z0-9._~-]+$/;

export default function BookingCommissionResultClient({ failed }: { failed: boolean }) {
  const [commissionHref, setCommissionHref] = useState<string | null>(null);

  useEffect(() => {
    try {
      const stored = window.sessionStorage.getItem(RETURN_STORAGE_KEY);
      if (stored && RETURN_PATH_PATTERN.test(stored)) setCommissionHref(stored);
    } catch {
      // The generic result page remains usable when storage is disabled.
    }
  }, []);

  return (
    <div className="mx-auto flex min-h-[65vh] max-w-2xl items-center px-4 py-12" dir="rtl">
      <Card className="w-full p-7 text-center sm:p-10">
        {failed ? (
          <XCircle className="mx-auto h-12 w-12 text-red-600" aria-hidden="true" />
        ) : (
          <Clock3 className="mx-auto h-12 w-12 text-amber-600" aria-hidden="true" />
        )}
        <h1 className="mt-4 text-2xl font-bold">
          {failed ? "لم تكتمل عملية الدفع" : "جاري التحقق من عملية الدفع"}
        </h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          {failed
            ? "يمكنك العودة إلى رابط العمولة في واتساب والمحاولة مرة أخرى."
            : "سيتم تحديث حالة العمولة تلقائياً بعد وصول التأكيد الموقّع من مزود الدفع."}
        </p>
        {!failed && (
          <div className="mx-auto mt-5 flex w-fit items-center gap-2 rounded-full bg-emerald-50 px-4 py-2 text-xs font-semibold text-emerald-700">
            <CheckCircle2 className="h-4 w-4" />
            لا تغلق رابط واتساب الأصلي
          </div>
        )}
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          {commissionHref && (
            <Button asChild>
              <Link href={commissionHref}>العودة إلى تفاصيل العمولة</Link>
            </Button>
          )}
          <Button asChild variant="outline">
            <Link href="/">العودة إلى الرئيسية</Link>
          </Button>
        </div>
      </Card>
    </div>
  );
}
