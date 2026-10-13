interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

const sizeClasses = {
  sm: 'h-4 w-4',
  md: 'h-5 w-5',
  lg: 'h-7 w-7',
};

export default function Spinner({ size = 'md', className = '' }: SpinnerProps) {
  return (
    <svg className={`animate-spin text-blue-600 ${sizeClasses[size]} ${className}`} viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

export function PageSpinner() {
  return (
    <div className="flex items-center justify-center py-12">
      <div className="text-center">
        <Spinner size="lg" />
        <p className="text-sm text-slate-500 mt-2">Loading...</p>
      </div>
    </div>
  );
}