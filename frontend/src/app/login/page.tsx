'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Lock, Mail } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { asset } from '@/lib/basePath';
import AuthShell, { AuthError, AuthField, AuthSubmit } from '@/components/AuthShell';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
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

  return (
    <AuthShell title="Welcome back" subtitle="Sign in with your work email to continue.">
      <form key={shakeKey} onSubmit={handleSubmit} className={`space-y-3 ${shakeKey ? 'animate-shake' : ''}`}>
        <AuthError message={error} />
        <AuthField
          id="email" label="Email" icon={<Mail />} type="email" inputMode="email" autoComplete="username"
          autoCapitalize="none" spellCheck={false} autoFocus required
          value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@bullmachine.com"
        />
        <AuthField
          id="password" label="Password" icon={<Lock />} type="password" reveal autoComplete="current-password" required
          value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Enter your password"
          onKeyUp={trackCaps} onKeyDown={trackCaps} onBlur={() => setCapsLock(false)}
          aria-describedby={capsLock ? 'caps-warning' : undefined}
          hint={capsLock ? <p id="caps-warning" className="text-xs font-medium text-amber-700">Caps Lock is on.</p> : null}
        />
        <div className="pt-1">
          <AuthSubmit loading={loading} label="Sign in" busyLabel="Signing in…" icon={<ArrowRight className="h-4 w-4" />} />
        </div>
        <p className="text-center text-xs text-slate-500">Forgot your password? Ask your administrator to reset it.</p>
      </form>

      <p className="mt-4 border-t border-slate-200 pt-4 text-center text-[13px] text-slate-600">
        New to FG Yard?{' '}
        <a href={asset('/register')} className="font-semibold text-blue-700 underline-offset-2 hover:text-blue-900 hover:underline">Create an account</a>
      </p>
    </AuthShell>
  );
}
