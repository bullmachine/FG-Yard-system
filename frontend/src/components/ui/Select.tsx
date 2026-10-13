import { SelectHTMLAttributes, forwardRef } from 'react';

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
        <select
          ref={ref}
          className={`w-full px-3 py-1.5 text-[13px] border rounded-md transition-colors
            ${error
              ? 'border-red-300 focus:ring-red-500 focus:border-red-500'
              : 'border-slate-300 focus:ring-blue-500/30 focus:border-blue-500'
            }
            focus:ring-2 focus:outline-none
            bg-white text-slate-900
            disabled:bg-slate-50 disabled:text-slate-500
            ${className}`}
          {...props}
        >
          {placeholder && <option value="">{placeholder}</option>}
          {options.map(opt => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    );
  }
);

Select.displayName = 'Select';
export default Select;