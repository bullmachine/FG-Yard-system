'use client';

import { forwardRef, useEffect, useState } from 'react';
import { AlertCircle, Boxes, Eye, EyeOff, Loader2, ScanLine, Truck } from 'lucide-react';
import { asset } from '@/lib/basePath';
import { API_URL } from '@/lib/api';

/**
 * Shared frame of the sign-in and register pages: the FG yard photo panel (desktop) or
 * photo header (phones), and a compact form column with the footer notice.
 */

const FEATURES = [
  { icon: <ScanLine className="h-3.5 w-3.5" />, title: 'Gate check', text: 'Barcode scan and dress code at the FG gate' },
  { icon: <Boxes className="h-3.5 w-3.5" />, title: 'FIFO stock', text: 'Oldest machine first, slot by slot' },
  { icon: <Truck className="h-3.5 w-3.5" />, title: 'PDI to main gate', text: 'Every dispatch tracked to the plant exit' },
];

/** Logo in its real colours on a small white tag, beside the product name. */
function Brand({ small = false }: { small?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className={`rounded-md bg-white shadow-sm ${small ? 'px-1.5 py-1' : 'px-2 py-1.5'}`}>
        <img src={asset('/company-logo.png')} alt="BULL" className={`block w-auto object-contain select-none ${small ? 'h-3 max-w-[65px]' : 'h-3.5 max-w-[75px]'}`} />
      </span>
      <span className={`w-px bg-white/40 ${small ? 'h-6' : 'h-7'}`} aria-hidden="true" />
      <div>
        <p className={`font-bold leading-tight text-white drop-shadow ${small ? 'text-sm' : 'text-base'}`}>FG Yard</p>
        <p className="text-[11px] text-slate-200 drop-shadow">Machine Location System</p>
      </div>
    </div>
  );
}

export default function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: React.ReactNode }) {
  return (
    <div className="min-h-dvh bg-slate-50 lg:grid lg:grid-cols-[1.1fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-slate-900 lg:flex lg:flex-col lg:justify-between lg:p-9">
        <img src={asset('/bull_fg_yard.jpeg')} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover animate-slow-zoom" />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/40 to-slate-950/10" />

        <div className="relative z-10"><Brand /></div>

        <div className="relative z-10 max-w-lg space-y-4">
          <div className="space-y-2">
            <h1 className="text-4xl font-bold leading-[1.1] tracking-tight text-white">
              Track. Manage.<br /><span className="text-amber-400">Deliver.</span>
            </h1>
            <p className="text-sm leading-relaxed text-slate-200">
              Every machine from Stage 18 through the FG yard gate, its slot, FIFO stock,
              dispatch planning, the PDI check and main gate-out, in one place.
            </p>
          </div>
          <ul className="grid grid-cols-3 gap-2">
            {FEATURES.map((f) => (
              <li key={f.title} className="rounded-lg border border-white/15 bg-white/10 px-2.5 py-2 backdrop-blur-md">
                <span className="flex items-center gap-1.5 text-xs font-semibold text-white">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-amber-400/90 text-slate-900">{f.icon}</span>
                  {f.title}
                </span>
                <span className="mt-1 block text-[11px] leading-snug text-slate-300">{f.text}</span>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      <main className="flex min-h-dvh flex-col">
        <div className="relative h-40 w-full shrink-0 overflow-hidden sm:h-48 lg:hidden">
          <img src={asset('/bull_fg_yard.jpeg')} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover animate-slow-zoom" />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-950/30 to-slate-950/50" />
          <div className="absolute inset-x-0 top-0 px-4 pt-[max(0.875rem,env(safe-area-inset-top))]"><Brand small /></div>
          <p className="absolute inset-x-0 bottom-8 px-4 text-xl font-bold leading-tight tracking-tight text-white drop-shadow">
            Track. Manage. <span className="text-amber-400">Deliver.</span>
          </p>
        </div>

        <div className="animate-page relative z-10 -mt-5 flex flex-1 flex-col rounded-t-2xl bg-slate-50 px-5 pt-5 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-10 lg:mt-0 lg:rounded-none lg:px-10 lg:py-8">
          <div className="flex flex-1 items-start justify-center lg:items-center">
            <div className="w-full max-w-[360px]">
              <div className="mb-5 space-y-1">
                <h2 className="text-xl font-bold tracking-tight text-slate-900">{title}</h2>
                <p className="text-sm text-slate-500">{subtitle}</p>
              </div>
              {children}
            </div>
          </div>

          <footer className="mt-6 space-y-0.5 text-center text-[11px] leading-snug text-slate-400">
            <p>Sign-ins are recorded (time, IP address and device) for security.</p>
            <p>© {new Date().getFullYear()} Bull Machines Pvt Ltd · FG Yard</p>
          </footer>
        </div>
      </main>
    </div>
  );
}

interface AuthFieldProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label: string;
  icon: React.ReactNode;
  /** Adds a show / hide button for a password field. */
  reveal?: boolean;
  hint?: React.ReactNode;
}

/** A 40 px field with a leading icon; the icon turns blue while the field has focus. */
export const AuthField = forwardRef<HTMLInputElement, AuthFieldProps>(
  ({ label, icon, reveal = false, hint, id, type = 'text', className = '', ...props }, ref) => {
    const [shown, setShown] = useState(false);
    return (
      <div className="space-y-1">
        <label htmlFor={id} className="block text-[13px] font-medium text-slate-700">{label}</label>
        <div className="relative">
          <input
            ref={ref}
            id={id}
            type={reveal && shown ? 'text' : type}
            className={`peer h-10 w-full rounded-lg border border-slate-300 bg-white pl-9 text-base text-slate-900 shadow-sm outline-none transition-[border-color,box-shadow] placeholder:text-slate-400 focus:border-blue-600 focus:ring-4 focus:ring-blue-600/15 sm:text-sm ${reveal ? 'pr-10' : 'pr-3'} ${className}`}
            {...props}
          />
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 transition-colors peer-focus:text-blue-600 [&>svg]:h-4 [&>svg]:w-4">{icon}</span>
          {reveal && (
            <button
              type="button"
              onClick={() => setShown((v) => !v)}
              aria-label={shown ? 'Hide password' : 'Show password'}
              aria-pressed={shown}
              className="absolute right-1 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600/40"
            >
              {shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          )}
        </div>
        {hint}
      </div>
    );
  }
);
AuthField.displayName = 'AuthField';

export function AuthError({ message }: { message: string }) {
  return (
    <div aria-live="polite">
      {message && (
        <div role="alert" className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
          <span>{message}</span>
        </div>
      )}
    </div>
  );
}

export function AuthSubmit({ loading, label, busyLabel, icon }: { loading: boolean; label: string; busyLabel: string; icon: React.ReactNode }) {
  return (
    <button
      type="submit"
      disabled={loading}
      className="group flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-blue-700 text-sm font-semibold text-white shadow-sm shadow-blue-700/30 transition-[background-color,transform,box-shadow] hover:bg-blue-800 hover:shadow-md hover:shadow-blue-700/30 active:scale-[0.98] focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-600/30 disabled:cursor-wait disabled:opacity-80"
    >
      {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> {busyLabel}</> : <>{label} <span className="transition-transform group-hover:translate-x-0.5">{icon}</span></>}
    </button>
  );
}

/** What the sign-in pages offer; Create account shows only when an Admin allows it. null while loading. */
export function useAuthOptions() {
  const [options, setOptions] = useState<{ allowRegistration: boolean; resetCodeMinutes: number } | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`${API_URL}/api/auth/options`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (live) setOptions(d ?? { allowRegistration: false, resetCodeMinutes: 15 }); })
      .catch(() => { if (live) setOptions({ allowRegistration: false, resetCodeMinutes: 15 }); });
    return () => { live = false; };
  }, []);
  return options;
}

/** 0-3: length 8+, letters and digits, 12+ or a symbol. Only a guide; the server requires 8+. */
export function passwordStrength(p: string) {
  if (p.length < 8) return 0;
  let s = 1;
  if (/[a-zA-Z]/.test(p) && /\d/.test(p)) s++;
  if (p.length >= 12 || /[^a-zA-Z0-9]/.test(p)) s++;
  return s;
}

const STRENGTH = [
  { label: 'At least 8 characters', bar: 'bg-slate-200', text: 'text-slate-500' },
  { label: 'Weak', bar: 'bg-red-500', text: 'text-red-700' },
  { label: 'Good', bar: 'bg-amber-500', text: 'text-amber-700' },
  { label: 'Strong', bar: 'bg-emerald-500', text: 'text-emerald-700' },
];

export function PasswordStrength({ id, password }: { id: string; password: string }) {
  const level = passwordStrength(password);
  return (
    <div id={id} className="flex items-center gap-2 pt-0.5">
      <div className="flex flex-1 gap-1" aria-hidden="true">
        {[1, 2, 3].map((i) => (
          <span key={i} className={`h-1 flex-1 rounded-full transition-colors ${level >= i ? STRENGTH[level].bar : 'bg-slate-200'}`} />
        ))}
      </div>
      <span className={`w-36 text-right text-[11px] font-medium ${STRENGTH[level].text}`}>{STRENGTH[level].label}</span>
    </div>
  );
}
