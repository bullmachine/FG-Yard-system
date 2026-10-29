'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Info, Lock, Mail, ShieldOff, User, UserPlus } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { asset } from '@/lib/basePath';
import AuthShell, { AuthError, AuthField, AuthSubmit, PasswordStrength, useAuthOptions } from '@/components/AuthShell';

export default function RegisterPage() {
  const [form, setForm] = useState({ name: '', email: '', password: '', confirmPassword: '' });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [shakeKey, setShakeKey] = useState(0);
  const router = useRouter();
  const { register, isAuthenticated } = useAuth();
  const options = useAuthOptions();

  useEffect(() => {
    if (isAuthenticated) router.replace('/');
  }, [isAuthenticated, router]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const matches = form.confirmPassword.length > 0 && form.confirmPassword === form.password;
  const mismatch = form.confirmPassword.length > 0 && !form.password.startsWith(form.confirmPassword);

  const fail = (message: string) => { setError(message); setShakeKey((k) => k + 1); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.password.length < 8) return fail('The password needs at least 8 characters.');
    if (form.password !== form.confirmPassword) return fail('The two passwords do not match.');
    setLoading(true);
    setError('');
    try {
      await register({ name: form.name.trim(), email: form.email.trim(), password: form.password });
      router.replace('/');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Registration failed';
      fail(message === 'User already exists' ? 'An account with this email already exists. Sign in instead.' : message);
      setLoading(false);
    }
  };

  if (options && !options.allowRegistration) {
    return (
      <AuthShell title="Create account is off" subtitle="Accounts are created by your administrator.">
        <div className="flex items-start gap-2.5 rounded-lg border border-slate-200 bg-white px-3 py-3 text-[13px] text-slate-700">
          <ShieldOff className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
          <p>Ask your administrator to create an account for you with the role for your work. They give you the e-mail and first password to sign in.</p>
        </div>
        <p className="mt-4 border-t border-slate-200 pt-4 text-center text-[13px] text-slate-600">
          Already have an account?{' '}
          <a href={asset('/login')} className="font-semibold text-blue-700 underline-offset-2 hover:text-blue-900 hover:underline">Sign in</a>
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Create your account" subtitle="Takes a minute. Use your work email.">
      <form key={shakeKey} onSubmit={handleSubmit} className={`space-y-3 ${shakeKey ? 'animate-shake' : ''}`}>
        <AuthError message={error} />
        <AuthField
          id="name" label="Full name" icon={<User />} autoComplete="name" autoFocus required
          value={form.name} onChange={set('name')} placeholder="e.g. Ravi Kumar"
        />
        <AuthField
          id="email" label="Work email" icon={<Mail />} type="email" inputMode="email" autoComplete="email"
          autoCapitalize="none" spellCheck={false} required
          value={form.email} onChange={set('email')} placeholder="you@bullmachine.com"
        />
        <AuthField
          id="password" label="Password" icon={<Lock />} type="password" reveal autoComplete="new-password" required minLength={8}
          value={form.password} onChange={set('password')} placeholder="At least 8 characters"
          aria-describedby="password-strength"
          hint={<PasswordStrength id="password-strength" password={form.password} />}
        />
        <AuthField
          id="confirm" label="Confirm password" icon={<Lock />} type="password" reveal autoComplete="new-password" required
          value={form.confirmPassword} onChange={set('confirmPassword')} placeholder="Type it again"
          aria-invalid={mismatch || undefined}
          className={mismatch ? 'border-red-400 focus:border-red-500 focus:ring-red-500/15' : ''}
          hint={
            matches ? <p className="flex items-center gap-1 text-[11px] font-medium text-emerald-700"><Check className="h-3 w-3" /> Passwords match</p>
              : mismatch ? <p className="text-[11px] font-medium text-red-700">Passwords do not match</p> : null
          }
        />

        <p className="flex items-start gap-2 rounded-lg bg-blue-50 px-3 py-2 text-[11px] leading-snug text-blue-900">
          <Info className="mt-px h-3.5 w-3.5 shrink-0 text-blue-600" />
          New accounts start with View Only access. An administrator gives you the role for your work.
        </p>

        <AuthSubmit loading={loading} label="Create account" busyLabel="Creating account…" icon={<UserPlus className="h-4 w-4" />} />
      </form>

      <p className="mt-4 border-t border-slate-200 pt-4 text-center text-[13px] text-slate-600">
        Already have an account?{' '}
        <a href={asset('/login')} className="font-semibold text-blue-700 underline-offset-2 hover:text-blue-900 hover:underline">Sign in</a>
      </p>
    </AuthShell>
  );
}
