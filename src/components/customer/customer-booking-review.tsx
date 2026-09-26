"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Clock3, Loader2, Pencil, Star } from "lucide-react";

import type {
  CustomerPropertyReview,
  PropertyReviewInput,
} from "@shared/property-reviews";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { BookingApiError, bookingApiRequest } from "@/components/booking/booking-api";
import { customerSessionRequestHeaders } from "@/hooks/use-customer-account";

type CustomerReviewsPayload = { reviews: CustomerPropertyReview[] };
type CustomerReviewPayload = { review: CustomerPropertyReview };

export function customerReviewsQueryKey(customerSessionScope: string) {
  return ["customer-property-reviews", customerSessionScope] as const;
}

const ratingFields = [
  ["overallRating", "التقييم العام"],
  ["cleanlinessRating", "النظافة"],
  ["accuracyRating", "دقة بيانات العقار"],
  ["ownerResponsivenessRating", "تجاوب المعلن"],
] as const;

const initialRating = 5;

export function CustomerBookingReviewAction({
  bookingId,
  customerSessionScope,
}: {
  bookingId: string;
  customerSessionScope: string;
}) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState<PropertyReviewInput>({
    overallRating: initialRating,
    cleanlinessRating: initialRating,
    accuracyRating: initialRating,
    ownerResponsivenessRating: initialRating,
    text: null,
  });
  const reviewsQuery = useQuery<CustomerReviewsPayload>({
    queryKey: customerReviewsQueryKey(customerSessionScope),
    queryFn: () => bookingApiRequest<CustomerReviewsPayload>(
      "/api/customer/reviews",
      { headers: customerSessionRequestHeaders(customerSessionScope) },
    ),
    retry: false,
    staleTime: 30_000,
  });
  const item = reviewsQuery.data?.reviews.find(
    (review) => review.bookingId === bookingId,
  );

  useEffect(() => {
    if (!item?.review) return;
    setForm({
      overallRating: item.review.overallRating,
      cleanlinessRating: item.review.cleanlinessRating,
      accuracyRating: item.review.accuracyRating,
      ownerResponsivenessRating: item.review.ownerResponsivenessRating,
      text: item.review.text,
    });
  }, [item?.review]);

  const saveReview = useMutation({
    mutationFn: () => bookingApiRequest<CustomerReviewPayload>(
      `/api/customer/reviews/${encodeURIComponent(bookingId)}`,
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...customerSessionRequestHeaders(customerSessionScope),
        },
        body: JSON.stringify(form),
      },
    ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: customerReviewsQueryKey(customerSessionScope),
      });
      setOpen(false);
      setError("");
    },
  });

  if (reviewsQuery.isLoading || reviewsQuery.isError || !item) return null;

  if (!item.eligible && !item.review) {
    return (
      <p className="flex w-full items-center gap-2 text-xs text-muted-foreground">
        <Clock3 className="h-4 w-4" aria-hidden="true" />
        يتاح التقييم بعد انتهاء تاريخ الحجز
      </p>
    );
  }

  const status = item.review?.moderationStatus;
  const statusMeta = status === "approved"
    ? { label: "منشور", className: "border-emerald-200 bg-emerald-50 text-emerald-700" }
    : status === "rejected"
      ? { label: "يحتاج تعديل", className: "border-red-200 bg-red-50 text-red-700" }
      : status === "pending"
        ? { label: "قيد المراجعة", className: "border-amber-200 bg-amber-50 text-amber-700" }
        : null;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError("");
    try {
      await saveReview.mutateAsync();
    } catch (saveError) {
      setError(
        saveError instanceof BookingApiError
          ? saveError.message
          : "تعذر حفظ التقييم. حاول مرة أخرى.",
      );
    }
  };

  return (
    <div className="w-full rounded-xl border border-[#e3d4ae] bg-[#fffaf0] p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-[#9a7623] text-white">
            <Star className="h-4 w-4 fill-current" aria-hidden="true" />
          </span>
          <div>
            <p className="text-sm font-bold text-[#493a1d]">تقييم الإقامة</p>
            {statusMeta && (
              <span className={`mt-1 inline-flex rounded-full border px-2 py-0.5 text-[11px] font-bold ${statusMeta.className}`}>
                {statusMeta.label}
              </span>
            )}
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-2 border-[#cdb578] bg-white text-[#6f5520]"
          onClick={() => setOpen((current) => !current)}
          aria-expanded={open}
        >
          {item.review ? <Pencil className="h-4 w-4" /> : <Star className="h-4 w-4" />}
          {item.review ? "تعديل التقييم" : "اكتب تقييمك"}
        </Button>
      </div>

      {open && (
        <form className="mt-4 space-y-4 border-t border-[#eadfc8] pt-4" onSubmit={submit}>
          <div className="grid gap-4 sm:grid-cols-2">
            {ratingFields.map(([field, label]) => (
              <RatingInput
                key={field}
                label={label}
                value={form[field]}
                onChange={(value) => setForm((current) => ({ ...current, [field]: value }))}
              />
            ))}
          </div>
          <label className="block text-sm font-bold text-[#493a1d]">
            أضف ملاحظتك (اختياري)
            <Textarea
              value={form.text || ""}
              maxLength={1_000}
              rows={4}
              onChange={(event) => setForm((current) => ({
                ...current,
                text: event.target.value || null,
              }))}
              className="mt-2 resize-y bg-white font-normal"
              placeholder="اكتب تجربتك ليستفيد منها العملاء الآخرون"
            />
          </label>
          {error && <p className="text-sm font-medium text-red-700" role="alert">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" disabled={saveReview.isPending} className="gap-2">
              {saveReview.isPending
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <CheckCircle2 className="h-4 w-4" />}
              إرسال التقييم للمراجعة
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
              إلغاء
            </Button>
          </div>
          <p className="text-xs leading-5 text-muted-foreground">
            يظهر التقييم في صفحة العقار بعد اعتماده.
          </p>
        </form>
      )}
    </div>
  );
}

function RatingInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <fieldset>
      <legend className="mb-2 text-xs font-bold text-[#62532f]">{label}</legend>
      <div className="inline-flex gap-1" dir="ltr">
        {[1, 2, 3, 4, 5].map((rating) => (
          <button
            key={rating}
            type="button"
            onClick={() => onChange(rating)}
            aria-label={`${label}: ${rating} من 5`}
            aria-pressed={rating === value}
            className="rounded-md p-1 text-[#c89c2f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9a7623]"
          >
            <Star
              className={`h-6 w-6 ${rating <= value ? "fill-current" : "fill-transparent"}`}
              aria-hidden="true"
            />
          </button>
        ))}
      </div>
    </fieldset>
  );
}
