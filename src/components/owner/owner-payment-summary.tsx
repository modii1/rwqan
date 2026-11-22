import { Badge } from "@/components/ui/badge";
import { PriceDisplay } from "@/components/price-display";
import { SummaryStrikePrice } from "@/components/summary-strike-price";

interface OwnerPaymentSummaryProps {
  packageName: string;
  durationLabel: string;
  originalPrice: number;
  discountPercent: number;
  discountAmount: number;
  additionalPropertiesCount: number;
  additionalPropertiesTotal: number;
  finalTotal: number;
  "data-testid"?: string;
}

/**
 * Owner payment summary.
 *
 * Labels stay in the right column. Every monetary value is pinned to the
 * physical left edge of the table, with a minimal 4px inset so glyphs are not
 * clipped by the rounded border.
 */
export function OwnerPaymentSummary({
  packageName,
  durationLabel,
  originalPrice,
  discountPercent,
  discountAmount,
  additionalPropertiesCount,
  additionalPropertiesTotal,
  finalTotal,
  "data-testid": dataTestId = "owner-payment-summary",
}: OwnerPaymentSummaryProps) {
  const hasDiscount = discountPercent > 0;
  const hasAdditionalProperties = additionalPropertiesTotal > 0;

  return (
    <div
      className="mb-6 overflow-hidden rounded-2xl border border-[#d8c9aa] bg-[#fffdfa]"
      data-testid={dataTestId}
    >
      <div className="border-b border-[#e4d9c1] bg-[#faf7ef] px-4 py-3">
        <h3 className="text-base font-bold text-[#29372F]">ملخص الاشتراك</h3>
      </div>
      <table className="w-full table-fixed border-collapse text-sm">
        <colgroup>
          <col />
          <col className="w-[8rem] sm:w-[10rem]" />
        </colgroup>
        <thead>
          <tr className="bg-[#faf7ef] text-[10px] text-[#8a8170] sm:text-[11px]">
            <th
              scope="col"
              className="py-2 pl-3 pr-3 text-right font-bold sm:pl-4 sm:pr-4"
            >
              اسم البند
            </th>
            <th scope="col" className="py-2 pl-2 pr-0 text-left font-bold">
              القيمة
            </th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-[#eee5d4]">
            <th
              scope="row"
              className="py-3 pl-3 pr-3 text-right align-middle text-xs font-semibold text-[#6f685b] sm:pl-4 sm:pr-4"
            >
              الباقة المختارة
            </th>
            <td className="break-words py-3 pl-2 pr-0 text-left align-middle text-sm font-bold text-[#29372F]">
              {packageName}
            </td>
          </tr>
          <tr className="border-b border-[#eee5d4]">
            <th
              scope="row"
              className="py-3 pl-3 pr-3 text-right align-middle text-xs font-semibold text-[#6f685b] sm:pl-4 sm:pr-4"
            >
              مدة الاشتراك
            </th>
            <td className="py-3 pl-2 pr-0 text-left align-middle text-sm font-bold text-[#29372F]">
              {durationLabel}
            </td>
          </tr>

          {hasDiscount && (
            <tr className="border-b border-[#eee5d4]">
              <th
                scope="row"
                className="py-3 pl-3 pr-3 text-right align-middle text-xs font-semibold text-[#6f685b] sm:pl-4 sm:pr-4"
              >
                السعر الأصلي
              </th>
              <td className="py-3 pl-2 pr-0 text-left align-middle">
                <SummaryStrikePrice amount={originalPrice} strike />
              </td>
            </tr>
          )}

          {hasDiscount && (
            <tr className="border-b border-[#eee5d4]">
              <th
                scope="row"
                className="py-3 pl-3 pr-3 text-right align-middle text-xs font-semibold text-[#6f685b] sm:pl-4 sm:pr-4"
              >
                الخصم
              </th>
              <td className="py-3 pl-2 pr-0 text-left align-middle">
                <span className="inline-flex flex-wrap items-center justify-end gap-2">
                  <Badge className="border-0 bg-[#f0b429] text-[#241d0c]">
                    خصم {discountPercent}%
                  </Badge>
                  <PriceDisplay
                    amount={discountAmount}
                    size="sm"
                    textColor="text-[#128c47]"
                  />
                </span>
              </td>
            </tr>
          )}

          {hasAdditionalProperties && (
            <tr className="border-b border-[#eee5d4]">
              <th
                scope="row"
                className="py-3 pl-3 pr-3 text-right align-middle text-xs font-semibold text-[#6f685b] sm:pl-4 sm:pr-4"
              >
                رسوم العقارات الإضافية ({additionalPropertiesCount})
              </th>
              <td className="py-3 pl-2 pr-0 text-left align-middle">
                <PriceDisplay
                  amount={additionalPropertiesTotal}
                  size="sm"
                  textColor="text-[#29372F]"
                />
              </td>
            </tr>
          )}
        </tbody>
        <tfoot>
          <tr className="bg-[#29372F]">
            <th
              scope="row"
              className="py-4 pl-3 pr-3 text-right align-middle text-sm font-bold text-white sm:pl-4 sm:pr-4"
            >
              السعر النهائي
            </th>
            <td className="py-5 pl-2 pr-0 text-left align-middle">
              <PriceDisplay
                amount={finalTotal}
                size="lg"
                textColor="text-white"
                className="[&_img]:invert [&_img]:brightness-0"
              />
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
