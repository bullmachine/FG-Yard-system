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
    <div className="min-h-screen flex bg-slate-50">
      {/* Left panel: the FG yard photo, darkened at the bottom so the text stays readable. */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden flex-col justify-between p-10 bg-slate-900">
        <img src={asset("/bull_fg_yard.jpeg")} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover" />
        <div className="absolute inset-0 bg-gradient-to-t from-slate-950/95 via-slate-950/25 to-slate-950/10" />

        <div className="relative z-10">
          <div className="inline-flex items-center gap-3 rounded-xl bg-slate-950/40 px-3 py-2 backdrop-blur-sm">
            <div className="bg-white rounded-md px-2 py-1">
              <img src={asset("/company-logo.png")} alt="Bull" className="h-5 w-auto" />
            </div>
            <div>
              <p className="text-sm font-bold text-white">FG Yard</p>
              <p className="text-xs text-slate-300">Machine Location System</p>
            </div>
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

      {/* Right panel — form */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          {/* Phones and tablets: a short photo banner with the name. */}
          <div className="lg:hidden relative mb-6 h-36 overflow-hidden rounded-xl">
            <img src={asset("/bull_fg_yard.jpeg")} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-t from-slate-950/85 to-slate-950/10" />
            <div className="absolute bottom-3 left-3 flex items-center gap-3">
              <div className="bg-white rounded-md px-2 py-1">
                <img src={asset("/company-logo.png")} alt="Bull" className="h-4 w-auto" />
              </div>
              <div>
                <p className="text-sm font-bold text-white">FG Yard</p>
                <p className="text-xs text-slate-300">Machine Location System</p>
              </div>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
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

              <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" required />
              <Input label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter your password" required />

              <Button type="submit" loading={loading} className="w-full" size="md">Sign In</Button>
            </form>

            <p className="mt-4 text-center text-sm text-slate-500">
              Don&apos;t have an account?{' '}
                <a href={asset("/register")} className="text-blue-700 hover:text-blue-900 font-semibold">Register</a>
            </p>
          </div>

        </div>
      </div>
    </div>
  );
}