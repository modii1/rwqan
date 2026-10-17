"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  BadgeCheck,
  CheckCircle2,
  Clock3,
  Loader2,
  MessageSquareText,
  Star,
  XCircle,
} from "lucide-react";

import type {
  AdminPropertyReview,
  PropertyReviewModerationStatus,
} from "@shared/property-reviews";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

type AdminReviewsPayload = { reviews: AdminPropertyReview[] };
type ReviewFilter = "all" | PropertyReviewModerationStatus;

const ADMIN_PROPERTY_REVIEWS_QUERY_KEY = ["admin-property-reviews"] as const;

const filters: Array<{ value: ReviewFilter; label: string }> = [
  { value: "pending", label: "بانتظار المراجعة" },
  { value: "approved", label: "منشورة" },
  { value: "rejected", label: "مرفوضة" },
  { value: "all", label: "الكل" },
];

function statusMeta(status: PropertyReviewModerationStatus) {
  if (status === "approved") {
    return {
      label: "منشور",
      icon: CheckCircle2,
      className: "border-emerald-200 bg-emerald-50 text-emerald-700",
    };
  }
  if (status === "rejected") {
    return {
      label: "مرفوض",
      icon: XCircle,
      className: "border-red-200 bg-red-50 text-red-700",
    };
  }
  return {
    label: "بانتظار المراجعة",
    icon: Clock3,
    className: "border-amber-200 bg-amber-50 text-amber-700",
  };
}

async function loadReviews(): Promise<AdminReviewsPayload> {
  const response = await fetch("/api/admin/property-reviews", {
    cache: "no-store",
    credentials: "include",
  });
  if (!response.ok) throw new Error("تعذر تحميل التقييمات");
  return response.json();
}

function formatAdminDate(value: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "-";
  return new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Asia/Riyadh",
  }).format(parsed);
}

export default function PropertyReviewsSection() {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<ReviewFilter>("pending");
  const [actionError, setActionError] = useState("");
  const reviewsQuery = useQuery<AdminReviewsPayload>({
    queryKey: ADMIN_PROPERTY_REVIEWS_QUERY_KEY,
    queryFn: loadReviews,
    staleTime: 15_000,
  });
  const reviews = reviewsQuery.data?.reviews || [];
  const visibleReviews = useMemo(
    () => reviews.filter((review) => filter === "all" || review.moderationStatus === filter),
    [filter, reviews],
  );
  const mutation = useMutation({
    mutationFn: async ({
      reviewId,
      status,
    }: {
      reviewId: string;
      status: "approved" | "rejected";
    }) => {
      const response = await fetch(
        `/api/admin/property-reviews/${encodeURIComponent(reviewId)}/moderation`,
        {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status }),
        },
      );
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "تعذر تحديث التقييم");
      return payload;
    },
    onSuccess: async () => {
      setActionError("");
      await queryClient.invalidateQueries({ queryKey: ADMIN_PROPERTY_REVIEWS_QUERY_KEY });
    },
    onError: (error) => {
      setActionError(error instanceof Error ? error.message : "تعذر تحديث التقييم");
    },
  });

  const moderate = (review: AdminPropertyReview, status: "approved" | "rejected") => {
    const confirmation = status === "approved"
      ? "هل تريد نشر هذا التقييم في صفحة العقار؟"
      : "هل تريد رفض هذا التقييم؟ يمكن للعميل تعديله وإرساله مرة أخرى.";
    if (!window.confirm(confirmation)) return;
    mutation.mutate({ reviewId: review.id, status });
  };

  return (
    <section className="min-w-0 space-y-5" dir="rtl" aria-labelledby="admin-reviews-heading">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <MessageSquareText className="h-6 w-6 text-[#8b6b25]" aria-hidden="true" />
            <h1 id="admin-reviews-heading" className="text-2xl font-bold text-foreground">
              تقييمات العملاء
            </h1>
          </div>
          <p className="mt-2 text-sm leading-6 text-muted-foreground">
            راجع تقييمات الحجوزات المكتملة قبل ظهورها في صفحات العقارات.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={() => reviewsQuery.refetch()} disabled={reviewsQuery.isFetching}>
          {reviewsQuery.isFetching && <Loader2 className="ml-2 h-4 w-4 animate-spin" />}
          تحديث
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:max-w-xl sm:gap-3">
        <ReviewStat label="بانتظار المراجعة" value={reviews.filter((review) => review.moderationStatus === "pending").length} tone="amber" />
        <ReviewStat label="منشورة" value={reviews.filter((review) => review.moderationStatus === "approved").length} tone="green" />
        <ReviewStat label="مرفوضة" value={reviews.filter((review) => review.moderationStatus === "rejected").length} tone="red" />
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1" aria-label="تصفية التقييمات">
        {filters.map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => setFilter(item.value)}
            aria-pressed={filter === item.value}
            className={`min-h-10 flex-shrink-0 rounded-lg border px-3 text-sm font-bold ${
              filter === item.value
                ? "border-[#8b6b25] bg-[#8b6b25] text-white"
                : "border-border bg-card text-muted-foreground hover:bg-muted/50"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {actionError && <p className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-700" role="alert">{actionError}</p>}

      {reviewsQuery.isLoading ? (
        <Card className="flex min-h-48 items-center justify-center">
          <Loader2 className="h-7 w-7 animate-spin text-[#8b6b25]" aria-label="جاري تحميل التقييمات" />
        </Card>
      ) : reviewsQuery.isError ? (
        <Card className="border-red-200 p-6 text-center text-sm text-red-700">
          تعذر تحميل التقييمات. حاول مرة أخرى.
        </Card>
      ) : visibleReviews.length === 0 ? (
        <Card className="border-dashed p-8 text-center">
          <MessageSquareText className="mx-auto h-9 w-9 text-muted-foreground/60" aria-hidden="true" />
          <p className="mt-3 font-bold">لا توجد تقييمات في هذه الحالة</p>
        </Card>
      ) : (
        <div className="grid min-w-0 gap-4 xl:grid-cols-2">
          {visibleReviews.map((review) => (
            <ReviewModerationCard
              key={review.id}
              review={review}
              busy={mutation.isPending && mutation.variables?.reviewId === review.id}
              onApprove={() => moderate(review, "approved")}
              onReject={() => moderate(review, "rejected")}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ReviewStat({ label, value, tone }: { label: string; value: number; tone: "amber" | "green" | "red" }) {
  const tones = {
    amber: "border-amber-200 bg-amber-50 text-amber-800",
    green: "border-emerald-200 bg-emerald-50 text-emerald-800",
    red: "border-red-200 bg-red-50 text-red-800",
  } as const;
  return (
    <Card className={`min-w-0 p-3 ${tones[tone]}`}>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
      <p className="mt-1 truncate text-[10px] font-bold sm:text-xs">{label}</p>
    </Card>
  );
}

function ReviewModerationCard({
  review,
  busy,
  onApprove,
  onReject,
}: {
  review: AdminPropertyReview;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const meta = statusMeta(review.moderationStatus);
  const StatusIcon = meta.icon;
  const ratingRows = [
    ["العام", review.overallRating],
    ["النظافة", review.cleanlinessRating],
    ["الدقة", review.accuracyRating],
    ["التجاوب", review.ownerResponsivenessRating],
  ] as const;
  return (
    <Card className="min-w-0 overflow-hidden border-[#ded3bc]">
      <div className="border-b bg-[#fffaf0] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="truncate font-bold text-[#34332f]">
              {review.propertyName || `عقار رقم ${review.propertyNumber}`}
            </h2>
            <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 break-all text-xs text-muted-foreground">
              <span>العقار: {review.propertyNumber}</span>
              <span>الطلب: {review.requestCode}</span>
            </p>
          </div>
          <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-xs font-bold ${meta.className}`}>
            <StatusIcon className="h-3.5 w-3.5" aria-hidden="true" />
            {meta.label}
          </span>
        </div>
      </div>
      <div className="space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1 font-semibold text-emerald-700">
            <BadgeCheck className="h-4 w-4" aria-hidden="true" />
            {review.customerDisplayName}
            <span className="sr-only">عميل موثّق</span>
          </span>
          <span>{formatAdminDate(review.updatedAt)}</span>
        </div>
        <dl className="grid grid-cols-4 gap-1 rounded-lg border bg-muted/20 p-2">
          {ratingRows.map(([label, value]) => (
            <div key={label} className="min-w-0 text-center">
              <dt className="truncate text-[10px] text-muted-foreground">{label}</dt>
              <dd className="mt-1 flex items-center justify-center gap-1 text-sm font-bold tabular-nums">
                <Star className="h-3.5 w-3.5 fill-[#c28f1c] text-[#c28f1c]" aria-hidden="true" />
                {value}
              </dd>
            </div>
          ))}
        </dl>
        <div className="min-h-16 rounded-lg border bg-background p-3">
          <p className="whitespace-pre-line break-words text-sm leading-7 text-foreground">
            {review.text || "لم يضف العميل تعليقًا نصيًا."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" onClick={onApprove} disabled={busy || review.moderationStatus === "approved"} className="gap-2 bg-emerald-700 hover:bg-emerald-800">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
            اعتماد ونشر
          </Button>
          <Button type="button" size="sm" variant="destructive" onClick={onReject} disabled={busy || review.moderationStatus === "rejected"} className="gap-2">
            <XCircle className="h-4 w-4" />
            رفض
          </Button>
        </div>
      </div>
    </Card>
  );
}
