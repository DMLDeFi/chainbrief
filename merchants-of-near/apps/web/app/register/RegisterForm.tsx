'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { signInWithNear } from '@/lib/near';
import { refreshMe } from '@/lib/store';
import { Logo } from '@/components/icons';

export function RegisterForm() {
  const router = useRouter();
  const next = useSearchParams().get('next');
  const [mode, setMode] = useState<'create' | 'login'>('create');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [merchantName, setMerchantName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const done = async (fresh: boolean) => {
    await refreshMe();
    router.push(fresh ? `/intro${next ? `?next=${encodeURIComponent(next)}` : ''}` : next ?? '/play');
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'create') await api('/auth/register', { body: { username, password, merchantName: merchantName || undefined } });
      else await api('/auth/login', { body: { username, password } });
      await done(mode === 'create');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const near = async () => {
    setBusy(true);
    setError(null);
    try {
      await signInWithNear();
      await done(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const guest = async () => {
    setBusy(true);
    try {
      await api('/auth/guest', { body: {} });
      await done(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden px-4 py-10">
      <div className="absolute inset-0 bg-[radial-gradient(60%_50%_at_50%_0%,rgba(217,168,74,0.14),transparent),radial-gradient(50%_40%_at_80%_100%,rgba(0,236,151,0.06),transparent)]" />
      <div className="relative w-full max-w-md animate-rise">
        <Link href="/" className="mb-6 flex items-center justify-center gap-3"><Logo size={42} /><span className="display text-xl font-bold">Merchants of NEAR</span></Link>
        <div className="panel p-6">
          <h1 className="display text-2xl font-bold">{mode === 'create' ? 'Register your merchant' : 'Welcome back'}</h1>
          <p className="mt-1 text-sm text-muted">{mode === 'create' ? 'You arrive with 100 gold, an empty stall and a 60-unit warehouse.' : 'Your ledger is where you left it.'}</p>
          <form onSubmit={submit} className="mt-5 space-y-3">
            <label className="block text-xs text-muted">Username<input className="input mt-1" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} pattern="[A-Za-z0-9_]{3,20}" required /></label>
            <label className="block text-xs text-muted">Password<input className="input mt-1" type="password" autoComplete={mode === 'create' ? 'new-password' : 'current-password'} minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
            {mode === 'create' && <label className="block text-xs text-muted">Merchant name <span className="text-muted/70">(shown in town)</span><input className="input mt-1" maxLength={20} placeholder="e.g. Elena Varro" value={merchantName} onChange={(e) => setMerchantName(e.target.value)} /></label>}
            {error && <p className="rounded-lg border border-ember/40 bg-ember/10 px-3 py-2 text-sm text-[#f0b8a0]" role="alert">{error}</p>}
            <button disabled={busy} className="btn btn-gold w-full py-2.5">{busy ? 'One moment…' : mode === 'create' ? 'Create merchant' : 'Sign in'}</button>
          </form>
          <div className="my-5 flex items-center gap-3 text-xs text-muted"><div className="brass-rule flex-1" />or<div className="brass-rule flex-1" /></div>
          <button disabled={busy} onClick={near} className="btn btn-near w-full py-2.5">Continue with NEAR wallet</button>
          <button disabled={busy} onClick={guest} className="btn btn-ghost mt-2 w-full py-2.5">Play as guest</button>
          <p className="mt-5 text-center text-sm text-muted">
            {mode === 'create' ? 'Already trading here? ' : 'New to Nearhaven? '}
            <button className="text-brass hover:underline" onClick={() => setMode(mode === 'create' ? 'login' : 'create')}>{mode === 'create' ? 'Sign in' : 'Create a merchant'}</button>
          </p>
        </div>
        <p className="mt-4 text-center text-[11px] text-muted">Passwords are hashed with scrypt. Wallet sign-in never shares your keys — you only sign a one-time message.</p>
      </div>
    </main>
  );
}
