interface TableProps {
  children: React.ReactNode;
  className?: string;
  maxHeight?: string | number;
}

export function Table({ children, className = '', maxHeight }: TableProps) {
  return (
    <div className={`overflow-auto ${className}`} style={maxHeight ? { maxHeight } : undefined}>
      <table className="min-w-full divide-y divide-slate-200">
        {children}
      </table>
    </div>
  );
}

interface TableHeaderProps {
  children: React.ReactNode;
  className?: string;
  sticky?: boolean;
}

export function TableHeader({ children, className = '', sticky = false }: TableHeaderProps) {
  return (
    <thead className={`bg-slate-50 ${sticky ? 'sticky top-0 z-10' : ''} ${className}`}>
      <tr>{children}</tr>
    </thead>
  );
}

interface TableHeaderCellProps {
  children: React.ReactNode;
  className?: string;
  align?: 'left' | 'center' | 'right';
}

export function TableHeaderCell({ children, className = '', align = 'left' }: TableHeaderCellProps) {
  const alignClasses = {
    left: 'text-left',
    center: 'text-center',
    right: 'text-right',
  };
  return (
    <th className={`px-3 py-1.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider whitespace-nowrap ${alignClasses[align]} ${className}`}>
      {children}
    </th>
  );
}

interface TableBodyProps {
  children: React.ReactNode;
  className?: string;
}

export function TableBody({ children, className = '' }: TableBodyProps) {
  return (
    <tbody className={`bg-white divide-y divide-slate-100 ${className}`}>
      {children}
    </tbody>
  );
}

interface TableRowProps {
  children: React.ReactNode;
  className?: string;
  hover?: boolean;
  onClick?: () => void;
}

export function TableRow({ children, className = '', hover = true, onClick }: TableRowProps) {
  return (
    <tr
      className={`${hover ? 'hover:bg-slate-50/80' : ''} ${onClick ? 'cursor-pointer' : ''} transition-colors ${className}`}
      onClick={onClick}
    >
      {children}
    </tr>
  );
}

interface TableCellProps {
  children: React.ReactNode;
  className?: string;
  align?: 'left' | 'center' | 'right';
}

export function TableCell({ children, className = '', align = 'left' }: TableCellProps) {
  const alignClasses = {
    left: 'text-left',
    center: 'text-center',
    right: 'text-right',
  };
  return (
    <td className={`px-3 py-1.5 text-[13px] text-slate-700 whitespace-nowrap ${alignClasses[align]} ${className}`}>
      {children}
    </td>
  );
}