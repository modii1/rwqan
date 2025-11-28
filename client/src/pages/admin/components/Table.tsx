export function Th({ children }: any) {
  return (
    <th className="px-3 py-2 text-[11px] md:text-xs font-bold whitespace-nowrap">
      {children}
    </th>
  );
}

export function Td({
  children,
  colSpan,
}: {
  children: React.ReactNode;
  colSpan?: number;
}) {
  return (
    <td className="px-3 py-2 whitespace-nowrap align-middle" colSpan={colSpan}>
      {children}
    </td>
  );
}
