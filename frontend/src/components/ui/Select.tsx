import { SelectHTMLAttributes, forwardRef } from 'react';
import { ChevronDown } from 'lucide-react';

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  error?: string;
  placeholder?: string;
  options: Array<{ value: string; label: string }>;
}

const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ label, error, placeholder, options, className = '', ...props }, ref) => {
    return (
      <div className="space-y-1">
        {label && (
          <label className="block text-xs font-medium text-slate-700">
            {label}
          </label>
        )}
        <div className={`relative ${className}`}>
          <select
            ref={ref}
            className={`h-9 w-full appearance-none pl-3 pr-8 text-[13px] border rounded-lg shadow-[0_1px_2px_0_rgb(2_6_23_/_0.04)] transition-[border-color,box-shadow] cursor-pointer
              ${error
                ? 'border-red-300 focus:ring-red-500/15 focus:border-red-500'
                : 'border-slate-300 hover:border-slate-400 focus:ring-blue-600/15 focus:border-blue-600'
              }
              focus:ring-4 focus:outline-none
              bg-white text-slate-900
              disabled:bg-slate-50 disabled:text-slate-500 disabled:cursor-not-allowed`}
            {...props}
          >
            {placeholder && <option value="">{placeholder}</option>}
            {options.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    );
  }
);

Select.displayName = 'Select';
export default Select;