'use client';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { disconnectWallet } from '@/lib/near';
import type { Settings } from '@/lib/hooks';
import { Drawer } from '../../ui';
import { IconGear } from '../../icons';

export function SettingsPanel({ settings, onChange, onClose, onDemo }: { settings: Settings; onChange: (p: Partial<Settings>) => void; onClose: () => void; onDemo: () => void }) {
  const router = useRouter();
  const Toggle = ({ k, label, hint }: { k: keyof Settings; label: string; hint: string }) => (
    <label className="flex cursor-pointer items-center justify-between gap-4 rounded-xl border border-line/60 bg-black/20 px-4 py-3">
      <span><span className="block font-semibold">{label}</span><span className="block text-xs text-muted">{hint}</span></span>
      <input type="checkbox" className="h-5 w-5 accent-[#d9a84a]" checked={settings[k]} onChange={(e) => onChange({ [k]: e.target.checked })} />
    </label>
  );
  return (
    <Drawer title="Settings" icon={<IconGear />} onClose={onClose}>
      <div className="space-y-2">
        <Toggle k="weather" label="Weather effects" hint="Rain, snow and lightning particles" />
        <Toggle k="reducedMotion" label="Reduced motion" hint="Disable flashes and particle weather" />
        <Toggle k="feed" label="Market chronicle" hint="Show the live activity feed" />
        <Toggle k="compactFeed" label="Compact feed" hint="Smaller text in the chronicle" />
      </div>
      <div className="mt-6 space-y-2">
        <div className="label">Controls</div>
        <p className="text-sm text-parchment-dim">Drag or WASD/arrow keys to pan · mouse wheel or Q/E to zoom · keys 1–0 open panels · Esc closes · click buildings and merchants to inspect them.</p>
      </div>
      <div className="mt-6 flex flex-wrap gap-2">
        <button onClick={onDemo} className="btn btn-gold px-4 py-2">Start guided demo</button>
        <button onClick={async () => { await api('/auth/logout', { body: {} }); await disconnectWallet(); router.push('/'); }} className="btn btn-ghost px-4 py-2">Sign out</button>
      </div>
    </Drawer>
  );
}
