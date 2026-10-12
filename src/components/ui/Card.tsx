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
  trend?: { value: string; positive: boolean };
  color?: 'blue' | 'green' | 'red' | 'amber' | 'indigo' | 'purple' | 'slate';
  onClick?: () => void;
  hint?: string;
}

const colorClasses = {
  blue: { icon: 'bg-blue-600', ring: 'ring-blue-50' },
  green: { icon: 'bg-emerald-600', ring: 'ring-emerald-50' },
  red: { icon: 'bg-red-600', ring: 'ring-red-50' },
  amber: { icon: 'bg-amber-600', ring: 'ring-amber-50' },
  indigo: { icon: 'bg-indigo-600', ring: 'ring-indigo-50' },
  purple: { icon: 'bg-purple-600', ring: 'ring-purple-50' },
  slate: { icon: 'bg-slate-600', ring: 'ring-slate-50' },
};

export function StatCard({ label, value, icon, trend, color = 'blue', onClick, hint }: StatCardProps) {
  const c = colorClasses[color];
  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-lg border border-slate-200 shadow-[0_1px_2px_0_rgb(2_6_23_/_0.05)] p-3.5 ring-1 ring-inset ${c.ring} ${onClick ? 'cursor-pointer hover:shadow-md hover:border-slate-300 transition-all' : ''}`}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 space-y-0.5">
          <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide truncate">{label}</p>
          <p className="text-lg font-bold text-slate-900 tabular-nums leading-none">{value}</p>
          {trend && (
            <p className={`text-[11px] font-medium ${trend.positive ? 'text-emerald-600' : 'text-red-600'}`}>
              {trend.positive ? '↑' : '↓'} {trend.value}
            </p>
          )}
          {hint && <p className="text-[11px] text-slate-400 truncate">{hint}</p>}
        </div>
        <div className={`p-2 rounded-md ${c.icon} text-white shrink-0`}>
          {icon}
        </div>
      </div>
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
      <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-[13px] font-semibold text-slate-900">{title}</h3>
          {description && <p className="text-xs text-slate-500 mt-px truncate">{description}</p>}
        </div>
        {action}
      </div>
      <div className={`${noPadding ? '' : 'p-4'} ${bodyClassName}`}>
        {children}
      </div>
    </div>
  );
}