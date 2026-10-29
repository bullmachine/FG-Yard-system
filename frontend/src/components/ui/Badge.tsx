'use client';

import { useEffect, useRef, useState } from 'react';

export interface BadgeProps {
  children: React.ReactNode;
  variant?: 'green' | 'red' | 'amber' | 'blue' | 'gray' | 'purple' | 'indigo' | 'orange';
  size?: 'sm' | 'md';
  dot?: boolean;
}

const variantClasses = {
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  red: 'bg-red-50 text-red-700 ring-red-600/20',
  amber: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  blue: 'bg-blue-50 text-blue-700 ring-blue-600/20',
  gray: 'bg-slate-50 text-slate-700 ring-slate-600/20',
  purple: 'bg-purple-50 text-purple-700 ring-purple-600/20',
  indigo: 'bg-indigo-50 text-indigo-700 ring-indigo-600/20',
  orange: 'bg-orange-50 text-orange-700 ring-orange-600/20',
};

const dotClasses = {
  green: 'bg-emerald-500',
  red: 'bg-red-500',
  amber: 'bg-amber-500',
  blue: 'bg-blue-500',
  gray: 'bg-slate-500',
  purple: 'bg-purple-500',
  indigo: 'bg-indigo-500',
  orange: 'bg-orange-500',
};

export default function Badge({ children, variant = 'gray', size = 'sm', dot }: BadgeProps) {
  // A short glow when a shown badge changes (e.g. PDI pending -> passed), not on first show.
  const label = typeof children === 'string' ? `${variant}:${children}` : variant;
  const previous = useRef(label);
  const [flashKey, setFlashKey] = useState(0);
  useEffect(() => {
    if (previous.current === label) return;
    previous.current = label;
    setFlashKey((k) => k + 1);
  }, [label]);

  return (
    <span key={flashKey} className={`inline-flex items-center gap-1 font-medium ring-1 ring-inset rounded-md whitespace-nowrap
      ${flashKey ? 'animate-flash' : ''}
      ${variantClasses[variant]}
      ${size === 'sm' ? 'px-1.5 py-0.5 text-[11px]' : 'px-2.5 py-0.5 text-xs'}`}
    >
      {dot && <span className={`h-1.5 w-1.5 rounded-full ${dotClasses[variant]}`} />}
      {children}
    </span>
  );
}