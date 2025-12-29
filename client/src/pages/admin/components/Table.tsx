export function Th({ children }: any) {
  return (
    <th className="px-3 py-2 text-[11px] md:text-xs font-bold whitespace-nowrap text-right">
      {children}
    </th>
  );
}

export function Td({
  children,
  colSpan,
  className,
}: {
  children: React.ReactNode;
  colSpan?: number;
  className?: string;
}) {
  return (
    <td className={`px-3 py-2 whitespace-nowrap align-middle text-right ${className || ''}`} colSpan={colSpan}>
      {children}
    </td>
  );
}
