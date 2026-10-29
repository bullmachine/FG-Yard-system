'use client';

import { useState } from 'react';
import { ArrowLeft, Check, CheckCircle2, KeyRound, Lock, Mail, Send } from 'lucide-react';
import { asset } from '@/lib/basePath';
import { API_URL } from '@/lib/api';
import AuthShell, { AuthError, AuthField, AuthSubmit, PasswordStrength, useAuthOptions } from '@/components/AuthShell';

type Step = 'email' | 'code' | 'done';

async function post(path: string, body: unknown) {
  const res = await fetch(`${API_URL}/api/auth/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
}

/**
 * Forgot password: e-mail -> 6-digit code by e-mail -> new password. The first step
 * never says whether the account exists; if no e-mail arrives, the administrator has
 * been told and resets it.
 */
export default function ForgotPasswordPage() {
  const options = useAuthOptions();
  const minutes = options?.resetCodeMinutes ?? 15;
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [resent, setResent] = useState(false);
  const [shakeKey, setShakeKey] = useState(0);

  const fail = (message: string) => { setError(message); setShakeKey((k) => k + 1); };

  const sendCode = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setLoading(true);
    setError('');
    try {
      await post('forgot-password', { email: email.trim() });
      if (step === 'code') setResent(true);
      setStep('code');
    } catch (err) {
      fail(err instanceof Error ? err.message : 'Could not send the code');
    } finally {
      setLoading(false);
    }
  };

  const reset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) return fail('The new password needs at least 8 characters.');
    if (password !== confirm) return fail('The two passwords do not match.');
    setLoading(true);
    setError('');
    try {
      await post('reset-password', { email: email.trim(), code: code.trim(), password });
      setStep('done');
    } catch (err) {
      fail(err instanceof Error ? err.message : 'Could not reset the password');
    } finally {
      setLoading(false);
    }
  };

  const mismatch = confirm.length > 0 && !password.startsWith(confirm);
  const matches = confirm.length > 0 && confirm === password;
  const back = (
    <p className="mt-4 border-t border-slate-200 pt-4 text-center text-[13px]">
      <a href={asset('/login')} className="inline-flex items-center gap-1 font-semibold text-blue-700 underline-offset-2 hover:text-blue-900 hover:underline">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
      </a>
    </p>
  );

  if (step === 'done') {
    return (
      <AuthShell title="Password changed" subtitle="Sign in with your new password.">
        <div className="flex items-start gap-2.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 text-[13px] text-emerald-900">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
          <p>Your password is changed. Any device still signed in with the old password has been signed out.</p>
        </div>
        <a href={asset('/login')} className="mt-4 flex h-10 w-full items-center justify-center rounded-lg bg-blue-700 text-sm font-semibold text-white shadow-sm hover:bg-blue-800">Sign in</a>
      </AuthShell>
    );
  }

  if (step === 'email') {
    return (
      <AuthShell title="Forgot your password?" subtitle="We e-mail you a code to set a new one.">
        <form key={shakeKey} onSubmit={sendCode} className={`space-y-3 ${shakeKey ? 'animate-shake' : ''}`}>
          <AuthError message={error} />
          <AuthField
            id="email" label="Your work email" icon={<Mail />} type="email" inputMode="email" autoComplete="username"
            autoCapitalize="none" spellCheck={false} autoFocus required
            value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@bullmachine.com"
          />
          <AuthSubmit loading={loading} label="Send code" busyLabel="Sending…" icon={<Send className="h-4 w-4" />} />
        </form>
        {back}
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Enter the code" subtitle={`Check ${email.trim()} for a 6-digit code.`}>
      <form key={shakeKey} onSubmit={reset} className={`space-y-3 ${shakeKey ? 'animate-shake' : ''}`}>
        <p className="rounded-lg bg-blue-50 px-3 py-2 text-[11px] leading-snug text-blue-900">
          If an account exists for this e-mail, a code has been sent. It works for {minutes} minutes.
          No e-mail after a few minutes? Check spam, or ask your administrator: they have been told and can reset it for you.
        </p>
        <AuthError message={error} />
        <AuthField
          id="code" label="6-digit code" icon={<KeyRound />} inputMode="numeric" autoComplete="one-time-code" autoFocus required
          pattern="\d{6}" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          placeholder="123456" className="tracking-[0.3em]"
        />
        <AuthField
          id="password" label="New password" icon={<Lock />} type="password" reveal autoComplete="new-password" required minLength={8}
          value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters"
          aria-describedby="password-strength"
          hint={<PasswordStrength id="password-strength" password={password} />}
        />
        <AuthField
          id="confirm" label="Confirm new password" icon={<Lock />} type="password" reveal autoComplete="new-password" required
          value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Type it again"
          aria-invalid={mismatch || undefined}
          className={mismatch ? 'border-red-400 focus:border-red-500 focus:ring-red-500/15' : ''}
          hint={
            matches ? <p className="flex items-center gap-1 text-[11px] font-medium text-emerald-700"><Check className="h-3 w-3" /> Passwords match</p>
              : mismatch ? <p className="text-[11px] font-medium text-red-700">Passwords do not match</p> : null
          }
        />
        <AuthSubmit loading={loading} label="Set new password" busyLabel="Saving…" icon={<Check className="h-4 w-4" />} />
        <p className="text-center text-xs text-slate-500">
          {resent ? 'A new code has been sent. ' : ''}
          <button type="button" onClick={() => sendCode()} disabled={loading} className="font-medium text-blue-700 hover:underline disabled:opacity-60">Send a new code</button>
          {' · '}
          <button type="button" onClick={() => { setStep('email'); setCode(''); setError(''); setResent(false); }} className="font-medium text-blue-700 hover:underline">Change e-mail</button>
        </p>
      </form>
      {back}
    </AuthShell>
  );
}
