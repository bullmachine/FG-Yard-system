'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { AlertCircle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();
  const { login } = useAuth();

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
      {/* Left panel — branding */}
      <div className="hidden lg:flex lg:w-1/2 bg-slate-900 relative overflow-hidden flex-col justify-between p-10">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-900/20 to-slate-900" />
        <div className="absolute top-0 right-0 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
        <div className="absolute bottom-0 left-0 w-96 h-96 bg-blue-600/5 rounded-full blur-3xl translate-y-1/2 -translate-x-1/2" />

        <div className="relative z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center">
              <img src="/company-logo.png" alt="Logo" className="h-7 w-7 object-contain brightness-0 invert" />
            </div>
            <div>
              <p className="text-sm font-bold text-white">Yard Management System</p>
              <p className="text-xs text-slate-400">Machine Location System</p>
            </div>
          </div>
        </div>

        <div className="relative z-10">
          <img src="/backhoe-loader.webp" alt="Backhoe Loader" className="w-full max-w-md mx-auto opacity-90 drop-shadow-2xl" />
        </div>

        <div className="relative z-10 space-y-3">
          <h2 className="text-2xl font-bold text-white leading-tight">
            Track. Manage.<br />
            <span className="text-blue-400">Deliver.</span>
          </h2>
          <p className="text-slate-400 text-sm max-w-md leading-relaxed">
            Real-time visibility into your yard operations. Monitor machine locations,
            assembly progress, and dispatch readiness from a single dashboard.
          </p>
          <div className="flex gap-6 pt-1">
            <div>
              <p className="text-xl font-bold text-white">98%</p>
              <p className="text-xs text-slate-500">Yard Utilization</p>
            </div>
            <div>
              <p className="text-xl font-bold text-white">24/7</p>
              <p className="text-xs text-slate-500">Real-time Tracking</p>
            </div>
            <div>
              <p className="text-xl font-bold text-white">3x</p>
              <p className="text-xs text-slate-500">Faster Dispatch</p>
            </div>
          </div>
        </div>
      </div>

      {/* Right panel — form */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="lg:hidden flex items-center gap-3 mb-8">
            <div className="w-9 h-9 bg-blue-600 rounded-lg flex items-center justify-center">
              <img src="/company-logo.png" alt="Logo" className="h-6 w-6 object-contain brightness-0 invert" />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-900">Yard Management System</p>
              <p className="text-xs text-slate-500">Machine Location System</p>
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
              <a href="/register" className="text-blue-700 hover:text-blue-900 font-semibold">Register</a>
            </p>
          </div>

        </div>
      </div>
    </div>
  );
}