interface CardProps {
  children: React.ReactNode;
  className?: string;
  padding?: 'sm' | 'md' | 'lg';
}

const paddingClasses = {
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-5',
};

export default function Card({ children, className = '', padding = 'md' }: CardProps) {
  return (
    <div className={`bg-white rounded-lg border border-slate-200 shadow-[0_1px_2px_0_rgb(2_6_23_/_0.05)] ${paddingClasses[padding]} ${className}`}>
      {children}
    </div>
  );
}

interface StatCardProps {
  label: string;
  value: string | number;
  icon: React.ReactNode;
  color?: 'blue' | 'green' | 'red' | 'amber' | 'indigo' | 'purple' | 'slate';
  onClick?: () => void;
  hint?: string;
}

const colorClasses = {
  blue: 'bg-blue-600',
  green: 'bg-emerald-600',
  red: 'bg-red-600',
  amber: 'bg-amber-600',
  indigo: 'bg-indigo-600',
  purple: 'bg-purple-600',
  slate: 'bg-slate-600',
};

/**
 * Summary tile in two lines: icon, title and count on the first, description under the
 * title on the second. Every tile has the same shape, so a row of tiles lines up. A long
 * text value (a date, "Admin only") takes the second line instead, so the title keeps its width.
 */
export function StatCard({ label, value, icon, color = 'blue', onClick, hint }: StatCardProps) {
  const longValue = typeof value === 'string' && value.length > 8;
  return (
    <div
      onClick={onClick}
      title={hint ? `${label}: ${hint}` : label}
      className={`flex items-center gap-2 bg-white rounded-lg border border-slate-200 shadow-[0_1px_2px_0_rgb(2_6_23_/_0.05)] px-3 py-2.5 ${onClick ? 'cursor-pointer hover:shadow-md hover:border-slate-300 transition-all' : ''}`}
    >
      <div className={`p-1 rounded ${colorClasses[color]} text-white shrink-0 [&>svg]:w-3 [&>svg]:h-3`}>{icon}</div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold leading-4 text-slate-600">{label}</p>
        {longValue
          ? <p className="truncate text-xs font-bold leading-4 text-slate-900 tabular-nums">{value}</p>
          : <p className="h-3.5 truncate text-[10px] leading-3.5 text-slate-400">{hint}</p>}
      </div>
      {!longValue && <p className="shrink-0 text-right text-base font-bold leading-tight text-slate-900 tabular-nums">{value}</p>}
    </div>
  );
}

interface SectionCardProps {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  bodyClassName?: string;
  noPadding?: boolean;
}

export function SectionCard({ title, description, action, children, className = '', bodyClassName = '', noPadding = false }: SectionCardProps) {
  return (
    <div className={`bg-white rounded-lg border border-slate-200 shadow-[0_1px_2px_0_rgb(2_6_23_/_0.05)] ${className}`}>
      <div className="px-4 py-3 border-b border-slate-100 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-[13px] font-semibold text-slate-900">{title}</h3>
          {description && <p className="text-xs text-slate-500 mt-px sm:truncate">{description}</p>}
        </div>
        {action}
      </div>
      {/* A page that passes p-0 gets no default padding; both classes together would leave it to CSS order. */}
      <div className={`${noPadding || /(^|\s)p-0(\s|$)/.test(bodyClassName) ? '' : 'p-4'} ${bodyClassName}`}>
        {children}
      </div>
    </div>
  );
}