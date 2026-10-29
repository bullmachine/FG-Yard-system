'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AlertCircle, ArrowRight, Boxes, Eye, EyeOff, Loader2, Lock, Mail, ScanLine, Truck } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { asset } from '@/lib/basePath';

const FEATURES = [
  { icon: <ScanLine className="h-4 w-4" />, title: 'Gate check', text: 'Barcode scan and dress code at the FG gate' },
  { icon: <Boxes className="h-4 w-4" />, title: 'FIFO stock', text: 'Oldest machine first, slot by slot' },
  { icon: <Truck className="h-4 w-4" />, title: 'PDI to main gate', text: 'Every dispatch tracked to the plant exit' },
];

/** Logo in its real colours on a small white tag, beside the product name. */
function Brand({ small = false }: { small?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <span className={`rounded-md bg-white shadow-sm ${small ? 'px-1.5 py-1' : 'px-2 py-1.5'}`}>
        <img src={asset('/company-logo.png')} alt="BULL" className={`block w-auto object-contain select-none ${small ? 'h-3 max-w-[65px]' : 'h-3.5 max-w-[75px]'}`} />
      </span>
      <span className={`w-px bg-white/40 ${small ? 'h-7' : 'h-8'}`} aria-hidden="true" />
      <div>
        <p className={`font-bold leading-tight text-white drop-shadow ${small ? 'text-sm' : 'text-lg'}`}>FG Yard</p>
        <p className={`text-slate-200 drop-shadow ${small ? 'text-[11px]' : 'text-xs'}`}>Machine Location System</p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [shakeKey, setShakeKey] = useState(0);
  const router = useRouter();
  const { login, isAuthenticated } = useAuth();

  // Already signed in: go straight to the app.
  useEffect(() => {
    if (isAuthenticated) router.replace('/');
  }, [isAuthenticated, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await login(email.trim(), password);
      router.replace('/');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login failed';
      setError(message === 'Invalid credentials' ? 'The email or password is not correct.' : message);
      setShakeKey((k) => k + 1);
      setLoading(false);
    }
  };

  const trackCaps = (e: React.KeyboardEvent<HTMLInputElement>) => setCapsLock(e.getModifierState('CapsLock'));

  const field = 'peer h-11 w-full rounded-lg border border-slate-300 bg-white pl-10 text-base text-slate-900 shadow-sm outline-none transition-[border-color,box-shadow] placeholder:text-slate-400 focus:border-blue-600 focus:ring-4 focus:ring-blue-600/15 sm:text-sm';

  return (
    <div className="min-h-dvh bg-slate-50 lg:grid lg:grid-cols-[1.15fr_1fr]">
      {/* Photo panel (desktop): the FG yard, darkened towards the bottom for the text. */}
      <aside className="relative hidden overflow-hidden bg-slate-900 lg:flex lg:flex-col lg:justify-between lg:p-10 xl:p-12">
        <img src={asset('/bull_fg_yard.jpeg')} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover animate-slow-zoom" />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950 via-slate-950/40 to-slate-950/10" />

        <div className="relative z-10"><Brand /></div>

        <div className="relative z-10 max-w-lg space-y-5">
          <div className="space-y-3">
            <h1 className="text-4xl font-bold leading-[1.1] tracking-tight text-white xl:text-5xl">
              Track. Manage.<br /><span className="text-amber-400">Deliver.</span>
            </h1>
            <p className="text-[15px] leading-relaxed text-slate-200">
              Every machine from Stage 18 through the FG yard gate, its slot, FIFO stock,
              dispatch planning, the PDI check and main gate-out, in one place.
            </p>
          </div>
          <ul className="grid gap-2 xl:grid-cols-3">
            {FEATURES.map((f) => (
              <li key={f.title} className="rounded-xl border border-white/15 bg-white/10 p-3 backdrop-blur-md">
                <span className="flex items-center gap-2 text-sm font-semibold text-white">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-400/90 text-slate-900">{f.icon}</span>
                  {f.title}
                </span>
                <span className="mt-1.5 block text-xs leading-snug text-slate-300">{f.text}</span>
              </li>
            ))}
          </ul>
        </div>
      </aside>

      {/* Form side. On phones the photo sits edge to edge at the top and the form sheet overlaps it. */}
      <main className="flex min-h-dvh flex-col">
        <div className="relative h-56 w-full shrink-0 overflow-hidden sm:h-64 lg:hidden">
          <img src={asset('/bull_fg_yard.jpeg')} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover animate-slow-zoom" />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-950/30 to-slate-950/50" />
          <div className="absolute inset-x-0 top-0 px-5 pt-[max(1rem,env(safe-area-inset-top))]"><Brand small /></div>
          <p className="absolute inset-x-0 bottom-10 px-5 text-2xl font-bold leading-tight tracking-tight text-white drop-shadow">
            Track. Manage. <span className="text-amber-400">Deliver.</span>
          </p>
        </div>

        <div className="animate-page relative z-10 -mt-6 flex flex-1 flex-col rounded-t-3xl bg-slate-50 px-5 pt-7 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-10 lg:mt-0 lg:rounded-none lg:px-12 lg:py-10">
          <div className="flex flex-1 items-start justify-center lg:items-center">
            <div className="w-full max-w-[380px]">
              <div className="mb-7 space-y-1.5">
                <h2 className="text-2xl font-bold tracking-tight text-slate-900">Welcome back</h2>
                <p className="text-sm text-slate-500">Sign in with your work email to continue.</p>
              </div>

              <form key={shakeKey} onSubmit={handleSubmit} className={`space-y-4 ${shakeKey ? 'animate-shake' : ''}`}>
                <div aria-live="polite">
                  {error && (
                    <div role="alert" className="flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                      <span>{error}</span>
                    </div>
                  )}
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="email" className="block text-sm font-medium text-slate-700">Email</label>
                  <div className="relative">
                    <input
                      id="email"
                      type="email"
                      inputMode="email"
                      autoComplete="username"
                      autoCapitalize="none"
                      spellCheck={false}
                      autoFocus
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@bullmachine.com"
                      className={`${field} pr-3`}
                    />
                    <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 transition-colors peer-focus:text-blue-600" />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="password" className="block text-sm font-medium text-slate-700">Password</label>
                  <div className="relative">
                    <input
                      id="password"
                      type={showPassword ? 'text' : 'password'}
                      autoComplete="current-password"
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      onKeyUp={trackCaps}
                      onKeyDown={trackCaps}
                      onBlur={() => setCapsLock(false)}
                      placeholder="Enter your password"
                      aria-describedby={capsLock ? 'caps-warning' : undefined}
                      className={`${field} pr-11`}
                    />
                    <Lock className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400 transition-colors peer-focus:text-blue-600" />
                    <button
                      type="button"
                      onClick={() => setShowPassword((v) => !v)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      aria-pressed={showPassword}
                      className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600/40"
                    >
                      {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                  {capsLock && (
                    <p id="caps-warning" className="text-xs font-medium text-amber-700">Caps Lock is on.</p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="group flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-blue-700 text-sm font-semibold text-white shadow-sm shadow-blue-700/30 transition-[background-color,transform,box-shadow] hover:bg-blue-800 hover:shadow-md hover:shadow-blue-700/30 active:scale-[0.98] focus:outline-none focus-visible:ring-4 focus-visible:ring-blue-600/30 disabled:cursor-wait disabled:opacity-80"
                >
                  {loading ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> Signing in…</>
                  ) : (
                    <>Sign in <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" /></>
                  )}
                </button>

                <p className="text-center text-xs text-slate-500">
                  Forgot your password? Ask your FG Yard administrator to reset it.
                </p>
              </form>

              <div className="mt-6 border-t border-slate-200 pt-5 text-center text-sm text-slate-600">
                New to FG Yard?{' '}
                <a href={asset('/register')} className="font-semibold text-blue-700 underline-offset-2 hover:text-blue-900 hover:underline">Create an account</a>
              </div>
            </div>
          </div>

          <footer className="mt-8 space-y-1 text-center text-[11px] leading-snug text-slate-400">
            <p>Sign-ins are recorded (time, IP address and device) for security.</p>
            <p>© {new Date().getFullYear()} Bull Machines Pvt Ltd · FG Yard</p>
          </footer>
        </div>
      </main>
    </div>
  );
}
