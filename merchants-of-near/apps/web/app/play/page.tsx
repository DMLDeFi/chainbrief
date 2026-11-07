import { Suspense } from 'react';
import { GameShell } from '@/components/game/GameShell';
export const metadata = { title: 'Nearhaven — Merchants of NEAR' };
export default function Play() {
  return (
    <Suspense>
      <GameShell />
    </Suspense>
  );
}
