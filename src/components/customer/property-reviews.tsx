"use client";

import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, Loader2, MessageSquareText, Star } from "lucide-react";

import type {
  PropertyReviewAggregate,
  PublicPropertyReview,
} from "@shared/property-reviews";

type PublicPropertyReviewsPayload = {
  aggregate: PropertyReviewAggregate;
  reviews: PublicPropertyReview[];
};

function RatingStars({ value, label }: { value: number; label: string }) {
  const rounded = Math.round(value);
  return (
    <span
      className="inline-flex gap-0.5 text-[#bd8a14]"
      dir="ltr"
      aria-label={`${label}: ${value} من 5`}
    >
      {[1, 2, 3, 4, 5].map((rating) => (
        <Star
          key={rating}
          className={`h-4 w-4 ${rating <= rounded ? "fill-current" : "fill-transparent"}`}
          aria-hidden="true"
        />
      ))}
    </span>
  );
}

function formatReviewDate(value: string): string {
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return "";
  return new Intl.DateTimeFormat("en-US-u-ca-gregory-nu-latn", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "Asia/Riyadh",
  }).format(parsed);
}

export function PropertyReviews({ propertyNumber }: { propertyNumber: string }) {
  const reviewsQuery = useQuery<PublicPropertyReviewsPayload>({
    queryKey: ["public-property-reviews", propertyNumber],
    queryFn: async () => {
      const response = await fetch(
        `/api/properties/${encodeURIComponent(propertyNumber)}/reviews`,
      );
      if (!response.ok) throw new Error("Failed to load property reviews");
      return response.json();
    },
    staleTime: 60_000,
    retry: 1,
  });

  if (reviewsQuery.isLoading) {
    return (
      <section className="rounded-lg border border-[#e2d6bd] bg-white p-5" aria-label="تقييمات العملاء">
        <div className="flex items-center justify-center gap-2 py-5 text-sm text-muted-foreground" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          جاري تحميل التقييمات...
        </div>
      </section>
    );
  }

  if (reviewsQuery.isError || !reviewsQuery.data) return null;
  const { aggregate, reviews } = reviewsQuery.data;

  return (
    <section className="overflow-hidden rounded-lg border border-[#dfd1b2] bg-white" aria-labelledby="property-reviews-heading">
      <div className="border-b border-[#eee4cf] bg-[#fffaf0] p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <MessageSquareText className="h-5 w-5 text-[#8a671e]" aria-hidden="true" />
              <h3 id="property-reviews-heading" className="text-lg font-bold text-[#2f2a1f]">
                تقييمات العملاء
              </h3>
            </div>
            <p className="mt-1 text-xs leading-5 text-[#6f6249]">
              تقييمات من حجوزات مؤكدة ومكتملة
            </p>
          </div>
          {aggregate.count > 0 && aggregate.averageOverall !== null && (
            <div className="flex items-center gap-3" aria-label={`متوسط التقييم ${aggregate.averageOverall} من 5`}>
              <span className="text-3xl font-bold tabular-nums text-[#3d321e]">{aggregate.averageOverall}</span>
              <div>
                <RatingStars value={aggregate.averageOverall} label="متوسط التقييم" />
                <p className="mt-1 text-xs text-[#6f6249]">{aggregate.count} تقييم</p>
              </div>
            </div>
          )}
        </div>

        {aggregate.count > 0 && (
          <dl className="mt-4 grid grid-cols-3 overflow-hidden rounded-lg border border-[#e5d8bc] bg-[#e5d8bc]">
            {([
              ["النظافة", aggregate.averageCleanliness],
              ["دقة البيانات", aggregate.averageAccuracy],
              ["تجاوب المعلن", aggregate.averageOwnerResponsiveness],
            ] as const).map(([label, value]) => (
              <div key={label} className="min-w-0 bg-white px-2 py-3 text-center sm:px-3">
                <dt className="truncate text-[10px] font-semibold text-[#796b50] sm:text-xs">{label}</dt>
                <dd className="mt-1 text-base font-bold tabular-nums text-[#493a1d]">{value ?? "-"}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>

      {reviews.length === 0 ? (
        <div className="p-6 text-center sm:p-8">
          <Star className="mx-auto h-8 w-8 text-[#c6b58e]" aria-hidden="true" />
          <p className="mt-3 text-sm font-semibold text-[#62532f]">لا توجد تقييمات منشورة بعد</p>
        </div>
      ) : (
        <div className="divide-y divide-[#eee4cf]">
          {reviews.map((review) => (
            <article key={review.id} className="p-4 sm:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="flex items-center gap-1.5 text-sm font-bold text-[#34332f]">
                    {review.customerDisplayName}
                    <BadgeCheck className="h-4 w-4 text-emerald-600" aria-label="عميل موثّق" />
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">{formatReviewDate(review.updatedAt)}</p>
                </div>
                <div className="flex items-center gap-2">
                  <RatingStars value={review.overallRating} label="التقييم" />
                  <span className="text-sm font-bold tabular-nums text-[#493a1d]">{review.overallRating}</span>
                </div>
              </div>
              {review.text && (
                <p className="mt-4 whitespace-pre-line break-words text-sm leading-7 text-[#544a37]">
                  {review.text}
                </p>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
