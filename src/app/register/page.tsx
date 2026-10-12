'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { AlertCircle } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';

export default function RegisterPage() {
  const [form, setForm] = useState({ name: '', email: '', password: '', confirmPassword: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();
  const { register } = useAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.password !== form.confirmPassword) {
      setError('Passwords do not match');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await register({
        name: form.name,
        email: form.email,
        password: form.password,
      });
      router.replace('/');
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-slate-50">
      {/* Left panel */}
      <div className="hidden lg:flex lg:w-1/2 bg-slate-900 relative overflow-hidden flex-col justify-center items-center p-10">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-900/20 to-slate-900" />
        <div className="absolute top-0 right-0 w-96 h-96 bg-blue-600/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
        <div className="relative z-10 text-center">
          <img src="/backhoe-loader.webp" alt="Backhoe Loader" className="w-64 mx-auto opacity-90 drop-shadow-2xl mb-8" />
          <h2 className="text-2xl font-bold text-white mb-2">Join the Team</h2>
          <p className="text-slate-400 text-sm max-w-sm">
            Create your account to start managing yard operations and tracking machines.
          </p>
        </div>
      </div>

      {/* Right panel — form */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6">
            <div className="space-y-1 mb-5">
              <h2 className="text-base font-semibold text-slate-900">Create account</h2>
              <p className="text-sm text-slate-500">Fill in the details to get started</p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3.5">
              {error && (
                <div className="flex items-center gap-2 p-2.5 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {error}
                </div>
              )}

              <Input label="Full Name" type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="John Doe" required />
              <Input label="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="you@company.com" required />
              <p className="text-xs text-slate-500 bg-slate-50 rounded-md px-3 py-2">New accounts are active immediately with View Only access. An administrator can assign a higher role later.</p>
              <Input label="Password" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="Min 8 characters" required minLength={8} />
              <Input label="Confirm Password" type="password" value={form.confirmPassword} onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })} placeholder="Repeat password" required />

              <Button type="submit" loading={loading} className="w-full" size="md">Create Account</Button>
            </form>

            <p className="mt-4 text-center text-sm text-slate-500">
              Already have an account?{' '}
              <a href="/login" className="text-blue-700 hover:text-blue-900 font-semibold">Sign in</a>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}