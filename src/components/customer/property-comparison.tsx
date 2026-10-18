"use client";

import Link from "next/link";
import type { Property } from "@shared/schema";
import { ExternalLink, MapPin, Scale, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PriceDisplay } from "@/components/price-display";
import { PROPERTY_IMAGE_PLACEHOLDER } from "@/lib/property-images";
import { getPublicPropertyLabel } from "@/lib/public-subscription";
import {
  comparisonPriceRowsForProperties,
  uniquePropertyFacilities,
} from "./property-comparison-model";

interface PropertyComparisonProps {
  properties: Property[];
  onRemove: (propertyNumber: string) => void;
  onClear: () => void;
}

function externalLocationHref(value: string | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^www\./i.test(trimmed)) return `https://${trimmed}`;
  return "";
}

function ComparisonRow({
  label,
  properties,
  children,
}: {
  label: string;
  properties: Property[];
  children: (property: Property) => React.ReactNode;
}) {
  return (
    <div
      className="grid border-t border-[#eadfc8]"
      style={{ gridTemplateColumns: `8rem repeat(${properties.length}, minmax(11rem, 1fr))` }}
    >
      <div className="sticky right-0 z-10 flex min-h-16 items-center border-l border-[#eadfc8] bg-[#f8f1df] px-3 py-4 text-xs font-bold text-[#6e5520]">
        {label}
      </div>
      {properties.map((property) => (
        <div
          key={`${label}-${property.propertyNumber}`}
          className="min-w-0 border-l border-[#eadfc8] bg-white px-3 py-4 text-sm text-[#34332f] last:border-l-0"
        >
          {children(property)}
        </div>
      ))}
    </div>
  );
}

export function PropertyComparison({
  properties,
  onRemove,
  onClear,
}: PropertyComparisonProps) {
  if (properties.length < 2) return null;

  const priceRows = comparisonPriceRowsForProperties(properties);
  const minimumWidth = 128 + properties.length * 176;

  return (
    <section id="property-comparison" aria-labelledby="property-comparison-heading" className="scroll-mt-24">
      <Card className="overflow-hidden border-[#cdb77e] bg-[#fffdf8]">
        <div className="flex flex-col gap-3 border-b border-[#eadfc8] bg-[#f8f1df] p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
          <div>
            <div className="flex items-center gap-2 text-[#75591d]">
              <Scale className="h-5 w-5" aria-hidden="true" />
              <h2 id="property-comparison-heading" className="text-lg font-bold sm:text-xl">مقارنة العقارات</h2>
            </div>
            <p className="mt-1 text-xs leading-5 text-[#6f6249]">مرّر الجدول أفقيًا على الجوال لمراجعة كل التفاصيل.</p>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={onClear} className="self-start">
            مسح المقارنة
          </Button>
        </div>

        <div className="overflow-x-auto" tabIndex={0} aria-label="جدول مقارنة العقارات">
          <div style={{ minWidth: minimumWidth }}>
            <div
              className="grid"
              style={{ gridTemplateColumns: `8rem repeat(${properties.length}, minmax(11rem, 1fr))` }}
            >
              <div className="sticky right-0 z-10 flex items-center border-l border-[#eadfc8] bg-[#f8f1df] px-3 py-4 text-xs font-bold text-[#6e5520]">
                العقار
              </div>
              {properties.map((property) => {
                const image = property.imageUrls?.[0] || PROPERTY_IMAGE_PLACEHOLDER;
                return (
                  <div key={property.propertyNumber} className="relative min-w-0 border-l border-[#eadfc8] bg-white p-3 last:border-l-0">
                    <button
                      type="button"
                      onClick={() => onRemove(property.propertyNumber)}
                      aria-label={`إزالة العقار ${property.propertyNumber} من المقارنة`}
                      className="absolute left-2 top-2 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-white/80 bg-white/95 text-[#6f6249] shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9a7623]"
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                    <Link href={`/property/${encodeURIComponent(property.propertyNumber)}`} className="block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#9a7623]">
                      <img
                        src={image}
                        alt={getPublicPropertyLabel(property)}
                        loading="lazy"
                        decoding="async"
                        className="aspect-[4/3] w-full rounded-lg bg-[#eee7d8] object-cover"
                        onError={(event) => { event.currentTarget.src = PROPERTY_IMAGE_PLACEHOLDER; }}
                      />
                      <p className="mt-3 truncate text-sm font-bold text-[#2f2a1f]">{getPublicPropertyLabel(property)}</p>
                      <p className="mt-1 text-xs text-[#6f6249]">رقم العقار: {property.propertyNumber}</p>
                    </Link>
                  </div>
                );
              })}
            </div>

            <ComparisonRow label="الموقع" properties={properties}>
              {(property) => {
                const href = externalLocationHref(property.location);
                if (href) {
                  return (
                    <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-[#76591c] underline-offset-4 hover:underline">
                      <MapPin className="h-4 w-4" aria-hidden="true" />
                      فتح الموقع
                      <ExternalLink className="h-3 w-3" aria-hidden="true" />
                    </a>
                  );
                }
                return property.location?.trim() || property.city;
              }}
            </ComparisonRow>
            <ComparisonRow label="المدينة" properties={properties}>{(property) => property.city}</ComparisonRow>
            <ComparisonRow label="الاتجاه" properties={properties}>{(property) => property.direction}</ComparisonRow>
            <ComparisonRow label="النوع" properties={properties}>{(property) => property.type}</ComparisonRow>
            <ComparisonRow label="السعة القصوى" properties={properties}>
              {(property) => property.capacity
                ? `${property.capacity} شخص`
                : <span className="text-muted-foreground">غير محدد</span>}
            </ComparisonRow>
            <ComparisonRow label="التوفر" properties={properties}>
              {(property) => typeof property.availabilityNote === "string" && property.availabilityNote.trim()
                ? property.availabilityNote.trim()
                : <span className="text-muted-foreground">متاح للاستعلام</span>}
            </ComparisonRow>

            {priceRows.map((row) => (
              <ComparisonRow key={row.key} label={row.label} properties={properties}>
                {(property) => {
                  const amount = String(property.prices?.[row.key] || "").trim();
                  return amount
                    ? <PriceDisplay amount={amount} size="sm" />
                    : <span className="text-muted-foreground">غير محدد</span>;
                }}
              </ComparisonRow>
            ))}

            <ComparisonRow label="المرافق" properties={properties}>
              {(property) => {
                const facilities = uniquePropertyFacilities(property);
                return facilities.length > 0 ? (
                  <ul className="space-y-1.5">
                    {facilities.map((facility) => (
                      <li key={facility} className="rounded-md bg-[#fbf7ee] px-2 py-1.5 text-xs leading-5 text-[#5f543f]">{facility}</li>
                    ))}
                  </ul>
                ) : <span className="text-muted-foreground">غير محدد</span>;
              }}
            </ComparisonRow>

            {properties.some((property) => String(property.lastUpdate || "").trim()) && (
              <ComparisonRow label="آخر تحديث" properties={properties}>
                {(property) => property.lastUpdate?.trim() || <span className="text-muted-foreground">غير محدد</span>}
              </ComparisonRow>
            )}
          </div>
        </div>
      </Card>
    </section>
  );
}
