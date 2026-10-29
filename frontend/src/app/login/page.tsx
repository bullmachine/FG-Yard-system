'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { AlertCircle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { asset } from '@/lib/basePath';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
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
      await login(email, password);
      router.replace('/');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-dvh flex bg-slate-50">
      {/* Left panel: the FG yard photo, darkened at the bottom so the text stays readable. */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden flex-col justify-between p-10 bg-slate-900">
        <img src={asset("/bull_fg_yard.jpeg")} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/95 via-slate-950/25 to-slate-950/10" />

        {/* Logo left of the name, in its real colours on a small white tag so the black
            bull and red letters stay readable on the dark photo. */}
        <div className="relative z-10 flex items-center gap-3">
          <span className="rounded-md bg-white px-2 py-1.5 shadow-sm">
            <img src={asset("/company-logo.png")} alt="BULL" className="block h-3.5 w-auto max-w-[75px] object-contain select-none" />
          </span>
          <span className="h-8 w-px bg-white/40" aria-hidden="true" />
          <div>
            <p className="text-lg font-bold leading-tight text-white drop-shadow">FG Yard</p>
            <p className="text-xs text-slate-200 drop-shadow">Machine Location System</p>
          </div>
        </div>

        <div className="relative z-10 space-y-3">
          <h2 className="text-3xl font-bold text-white leading-tight">
            Track. Manage.<br />
            <span className="text-amber-400">Deliver.</span>
          </h2>
          <p className="text-slate-200 text-sm max-w-md leading-relaxed">
            Every machine from Stage 18 through the FG yard gate, its slot, FIFO stock,
            dispatch planning, the PDI check and main gate-out, in one place.
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            {['Gate check', 'FIFO stock', 'PDI to main gate'].map((t) => (
              <span key={t} className="rounded-full border border-white/20 bg-white/10 px-3 py-1 text-xs font-medium text-white backdrop-blur-sm">{t}</span>
            ))}
          </div>
        </div>
      </div>

      {/* Right panel: the form. On phones and tablets the yard photo sits edge to edge at the
          top and the form sheet overlaps it, so there is no empty space above the photo. */}
      <div className="flex-1 flex flex-col lg:items-center lg:justify-center lg:p-6">
        <div className="lg:hidden relative h-60 sm:h-72 w-full shrink-0 overflow-hidden">
          <img src={asset("/bull_fg_yard.jpeg")} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-950/30 to-slate-950/40" />
          <div className="absolute top-0 inset-x-0 flex items-center gap-2.5 px-4 pt-[max(1rem,env(safe-area-inset-top))]">
            <span className="rounded bg-white px-1.5 py-1 shadow-sm">
              <img src={asset("/company-logo.png")} alt="BULL" className="block h-3 w-auto max-w-[65px] object-contain select-none" />
            </span>
            <span className="h-7 w-px bg-white/50" aria-hidden="true" />
            <div>
              <p className="text-sm font-bold leading-tight text-white drop-shadow">FG Yard</p>
              <p className="text-[11px] text-slate-200 drop-shadow">Machine Location System</p>
            </div>
          </div>
          <div className="absolute inset-x-0 bottom-10 px-4">
            <p className="text-2xl font-bold leading-tight text-white drop-shadow">
              Track. Manage. <span className="text-amber-400">Deliver.</span>
            </p>
          </div>
        </div>

        <div className="relative z-10 -mt-6 flex-1 rounded-t-3xl bg-slate-50 px-4 pt-5 pb-[max(2rem,env(safe-area-inset-bottom))] sm:px-8 lg:mt-0 lg:flex-none lg:w-full lg:max-w-sm lg:rounded-none lg:bg-transparent lg:p-0">
        <div className="mx-auto w-full max-w-sm">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 max-lg:bg-transparent max-lg:border-0 max-lg:shadow-none max-lg:px-1 max-lg:pt-2">
            <div className="space-y-1 mb-5">
              <h2 className="text-base font-semibold text-slate-900">Welcome back</h2>
              <p className="text-sm text-slate-500">Sign in to your account</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3.5">
              {error && (
                <div className="flex items-center gap-2 p-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {error}
                </div>
              )}

              <Input label="Email" className="bg-white max-lg:text-base! max-lg:py-2.5!" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" required />
              <Input label="Password" className="bg-white max-lg:text-base! max-lg:py-2.5!" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter your password" required />

              <Button type="submit" loading={loading} className="w-full max-lg:py-2.5 max-lg:text-sm" size="md">Sign In</Button>
            </form>

            <p className="mt-4 text-center text-sm text-slate-500">
              Don&apos;t have an account?{' '}
                <a href={asset("/register")} className="text-blue-700 hover:text-blue-900 font-semibold">Register</a>
            </p>
            <p className="mt-3 text-center text-[11px] leading-snug text-slate-400">
              Sign-ins are recorded (time, IP address and device) for security.
            </p>
          </div>
        </div>

        </div>
      </div>
    </div>
  );
}