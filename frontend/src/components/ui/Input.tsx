import { InputHTMLAttributes, forwardRef } from 'react';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: React.ReactNode;
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
          <input
            ref={ref}
            className={`peer h-9 w-full px-3 text-[13px] bg-white border rounded-lg shadow-[0_1px_2px_0_rgb(2_6_23_/_0.04)] transition-[border-color,box-shadow]
              ${icon ? 'pl-9' : ''}
              ${suffix ? 'pr-10' : ''}
              ${error
                ? 'border-red-300 focus:ring-red-500/15 focus:border-red-500'
                : 'border-slate-300 hover:border-slate-400 focus:ring-blue-600/15 focus:border-blue-600'
              }
              focus:ring-4 focus:outline-none
              placeholder:text-slate-400 text-slate-900
              disabled:bg-slate-50 disabled:text-slate-500 disabled:hover:border-slate-300
              ${className}`}
            {...props}
          />
          {icon && (
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none transition-colors peer-focus:text-blue-600">
              {icon}
            </span>
          )}
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