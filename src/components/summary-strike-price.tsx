"use client";

interface SummaryStrikePriceProps {
  amount: string | number;
  /** When omitted, uses `--riyal-symbol-scale` (0.64em fallback). */
  symbolScale?: number;
  strike?: boolean;
  className?: string;
}

/**
 * Original-price renderer used only inside the step-3 subscription summary.
 *
 * The strike line is an independent absolutely-positioned element, so it is
 * centred on the digits regardless of RTL direction, font metrics, or the riyal
 * symbol. Package cards keep using the shared PriceDisplay unchanged.
 */
export function SummaryStrikePrice({
  amount,
  symbolScale,
  strike = true,
  className = "",
}: SummaryStrikePriceProps) {
  const symbolHeight =
    symbolScale !== undefined
      ? `${symbolScale}em`
      : "calc(var(--riyal-symbol-scale, 0.64) * 1em)";
  return (
    <span
      data-summary-strike-price="true"
      className={`inline-flex items-center gap-1 whitespace-nowrap font-bold leading-none text-[#6f685b] ${className}`}
    >
      <span
        data-summary-strike-amount="true"
        className="relative inline-block text-sm font-bold leading-none"
      >
        {amount}
        {strike && (
          <span
            data-summary-strike-line="true"
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2 rounded-full bg-current"
            style={{ height: "max(1.5px, 0.06em)" }}
          />
        )}
      </span>
      <span className="inline-flex items-center text-sm" aria-hidden="true">
        <img
          data-price-symbol="true"
          src="/assets/riyal-symbol.png"
          alt=""
          className="inline-block object-contain"
          style={{ height: symbolHeight, width: "auto", opacity: 0.85 }}
        />
      </span>
    </span>
  );
}
