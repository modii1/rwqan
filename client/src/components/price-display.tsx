import riyal from '@assets/riyal-symbol.png';

interface PriceDisplayProps {
  amount: string | number;
  showSymbol?: boolean;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  textColor?: string;
}

const sizeMap = {
  sm: { text: 'text-sm', img: 'w-3 h-3' },
  md: { text: 'text-base', img: 'w-4 h-4' },
  lg: { text: 'text-xl', img: 'w-5 h-5' },
  xl: { text: 'text-2xl md:text-4xl', img: 'w-6 h-6 md:w-8 md:h-8' },
};

export function PriceDisplay({
  amount,
  showSymbol = true,
  size = 'md',
  textColor = 'text-[#b88d2b]',
}: PriceDisplayProps) {
  const sizeClass = sizeMap[size];

  if (!showSymbol) {
    return <span className={`${sizeClass.text} font-bold ${textColor}`}>{amount}</span>;
  }

  return (
    <div className={`flex items-center gap-1 ${sizeClass.text} font-bold ${textColor}`}>
      <span>{amount}</span>
      <img
        src={riyal}
        alt="ريال سعودي"
        className={`${sizeClass.img} inline-block brightness-0 invert-0`}
        style={{
          filter: 'brightness(0) saturate(100%)',
          opacity: 0.8,
        }}
      />
    </div>
  );
}
