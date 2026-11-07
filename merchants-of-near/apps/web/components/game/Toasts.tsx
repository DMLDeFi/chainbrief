'use client';
import { useGame } from '@/lib/store';

export function Toasts() {
  const { toasts } = useGame();
  return (
    <div className="pointer-events-none fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`panel-glass animate-rise px-4 py-2.5 text-sm font-semibold ${t.tone === 'good' ? 'border-moss/60 text-moss' : t.tone === 'bad' ? 'border-ember/60 text-[#ffb59a]' : ''}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}
