"use client";

interface PriceDisplayProps {
  amount: string | number;
  showSymbol?: boolean;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  textColor?: string;
  /** Applies line-through to the amount itself, never to the currency symbol. */
  strike?: boolean;
  /**
   * Size of the riyal symbol relative to the amount's font size. When omitted,
   * the page-level `--riyal-symbol-scale` variable is used (0.64em fallback).
   */
  symbolScale?: number;
  className?: string;
}

const sizeMap = {
  sm: { text: 'text-sm' },
  md: { text: 'text-base' },
  lg: { text: 'text-xl' },
  xl: { text: 'text-2xl md:text-4xl' },
};

/**
 * One shared price renderer for package cards, owner cards, payment summaries
 * and dialogs. The number is the visual focus; the riyal symbol scales with the
 * number's font size and stays vertically centred.
 */
export function PriceDisplay({
  amount,
  showSymbol = true,
  size = 'md',
  textColor = 'text-[#434040]',
  strike = false,
  symbolScale,
  className = '',
}: PriceDisplayProps) {
  const sizeClass = sizeMap[size];
  const amountClass = `${sizeClass.text} font-bold leading-none ${textColor} ${
    strike ? 'line-through decoration-[1.5px] [text-decoration-skip-ink:none]' : ''
  }`;
  const symbolHeight =
    symbolScale !== undefined
      ? `${symbolScale}em`
      : 'calc(var(--riyal-symbol-scale, 0.64) * 1em)';

  if (!showSymbol) {
    return (
      <span
        data-price-display="true"
        className={`inline-block whitespace-nowrap font-bold leading-none ${className}`}
      >
        <span data-price-amount="true" className={amountClass}>
          {amount}
        </span>
      </span>
    );
  }

  return (
    <span
      data-price-display="true"
      className={`inline-flex items-center gap-1 whitespace-nowrap font-bold leading-none ${textColor} ${className}`}
    >
      <span data-price-amount="true" className={amountClass}>
        {amount}
      </span>
      <span className={`${sizeClass.text} inline-flex items-center`} aria-hidden="true">
        <img
          data-price-symbol="true"
          src="/assets/riyal-symbol.png"
          alt=""
          className="inline-block object-contain"
          style={{ height: symbolHeight, width: 'auto', opacity: 0.85 }}
        />
      </span>
    </span>
  );
}
