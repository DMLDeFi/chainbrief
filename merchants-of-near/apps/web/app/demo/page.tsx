'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { refreshMe } from '@/lib/store';

/** One-click demo: reuse the current session or create a guest merchant, then open the guided tour. */
export default function Demo() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      try {
        let me = await refreshMe();
        if (!me) {
          await api('/auth/guest', { body: {} });
          me = await refreshMe();
        }
        router.replace('/play?demo=1');
      } catch (e) {
        setError((e as Error).message);
      }
    })();
  }, [router]);
  return (
    <main className="grid min-h-screen place-items-center">
      <div className="text-center">
        <div className="display text-2xl text-brass animate-pulse-soft">{error ? 'Could not start the demo' : 'Preparing your merchant…'}</div>
        {error && <p className="mt-2 text-sm text-muted">{error}</p>}
      </div>
    </main>
  );
}
