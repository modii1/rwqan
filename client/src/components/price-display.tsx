import riyal from './riyal-symbol.png';

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
  textColor = 'text-[#434040]',
}: PriceDisplayProps) {
  const sizeClass = sizeMap[size];

  if (!showSymbol) {
    return <span className={`${sizeClass.text} font-bold ${textColor}`}>{amount}</span>;
  }

  return (
    <div className="flex items-center gap-1 text-xl font-bold text-[#434040] ml-[30px] mr-[30px]">
      <span className="text-[#434040]">{amount}</span>
      <img
        src={riyal}
        alt="ريال سعودي"
        className={`${sizeClass.img} inline-block`}
        style={{
          opacity: 0.85,
        }}
      />
    </div>
  );
}
