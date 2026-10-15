import { InputHTMLAttributes, forwardRef } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  icon?: React.ReactNode;
  suffix?: React.ReactNode;
  hint?: string;
}

const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, icon, suffix, hint, className = '', ...props }, ref) => {
    return (
      <div className="space-y-1">
        {label && (
          <label className="block text-xs font-medium text-slate-700">
            {label}
          </label>
        )}
        <div className="relative">
          {icon && (
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none">
              {icon}
            </span>
          )}
          <input
            ref={ref}
            className={`w-full px-3 py-1.5 text-[13px] border rounded-md transition-colors
              ${icon ? 'pl-9' : ''}
              ${suffix ? 'pr-10' : ''}
              ${error
                ? 'border-red-300 focus:ring-red-500 focus:border-red-500'
                : 'border-slate-300 focus:ring-blue-500/30 focus:border-blue-500'
              }
              focus:ring-2 focus:outline-none
              placeholder:text-slate-400 text-slate-900
              disabled:bg-slate-50 disabled:text-slate-500
              ${className}`}
            {...props}
          />
          {suffix && (
            <span className="absolute right-1.5 top-1/2 -translate-y-1/2">
              {suffix}
            </span>
          )}
        </div>
        {hint && !error && (
          <p className="text-[11px] text-slate-400">{hint}</p>
        )}
        {error && (
          <p className="text-xs text-red-600">{error}</p>
        )}
      </div>
    );
  }
);

Input.displayName = 'Input';
export default Input;