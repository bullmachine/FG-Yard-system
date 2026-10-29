'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, CircleHelp, Lock, Mail, X } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { asset } from '@/lib/basePath';
import AuthShell, { AuthError, AuthField, AuthSubmit, useAuthOptions } from '@/components/AuthShell';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [capsLock, setCapsLock] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [shakeKey, setShakeKey] = useState(0);
  const [showHelp, setShowHelp] = useState(false);
  const router = useRouter();
  const { login, isAuthenticated } = useAuth();
  const options = useAuthOptions();

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
        <p className="text-center text-xs">
          <a href={asset('/forgot-password')} className="font-medium text-blue-700 underline-offset-2 hover:text-blue-900 hover:underline">Forgot your password?</a>
        </p>
      </form>

      {options?.allowRegistration ? (
        <p className="mt-4 border-t border-slate-200 pt-4 text-center text-[13px] text-slate-600">
          New to FG Yard?{' '}
          <a href={asset('/register')} className="font-semibold text-blue-700 underline-offset-2 hover:text-blue-900 hover:underline">Create an account</a>
        </p>
      ) : (
        <p className="mt-4 border-t border-slate-200 pt-4 text-center text-[13px] text-slate-600">New to FG Yard? Ask your administrator for an account.</p>
      )}
      <p className="mt-2 text-center">
        <button type="button" onClick={() => setShowHelp((v) => !v)} aria-expanded={showHelp}
          className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-blue-700">
          <CircleHelp className="h-3.5 w-3.5" /> How to use FG Yard
        </button>
      </p>
      {showHelp && (
        <div className="animate-pop mt-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs leading-relaxed text-slate-700">
          <div className="mb-1.5 flex items-center justify-between">
            <p className="font-semibold text-slate-900">Getting started</p>
            <button type="button" onClick={() => setShowHelp(false)} aria-label="Close" className="text-slate-400 hover:text-slate-700"><X className="h-3.5 w-3.5" /></button>
          </div>
          <ol className="list-decimal space-y-1 pl-4">
            {options?.allowRegistration ? (
              <>
                <li><b>Create an account</b> with your work e-mail. New accounts start with View Only access.</li>
                <li>Ask your <b>administrator</b> to give you the role for your work (Security, Yard Manager, PDI, Planner and so on).</li>
              </>
            ) : (
              <li>Your <b>administrator</b> creates your account with the role for your work and gives you the e-mail and first password.</li>
            )}
            <li><b>Sign in</b>. The menu shows only the pages your role uses.</li>
            <li>Open <b>Help &amp; User Guide</b> in the menu for step-by-step help, and <b>SOP</b> for your checklist.</li>
            <li>Something not right? Use the <b>Feedback</b> button at the top of every page.</li>
          </ol>
          <p className="mt-2 text-slate-500">Forgot your password? Use Forgot your password to get a code by e-mail, or ask the administrator. Drivers sign in with the login the yard office gives them.</p>
        </div>
      )}
    </AuthShell>
  );
}
