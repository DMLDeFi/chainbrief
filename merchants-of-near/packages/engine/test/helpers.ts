import { createWorld, registerPlayer, type WorldState } from '../src/index';

export function freshWorld(seed = 123): WorldState {
  return createWorld(seed);
}

export function withPlayer(seed = 123, name = 'Tester') {
  const world = createWorld(seed);
  const r = registerPlayer(world, 'p1', name);
  if (!r.ok) throw new Error(r.error);
  return { world, player: r.data };
}

/** Total gold held anywhere in the closed economy. */
export function totalGold(w: WorldState): number {
  let g = w.guildTreasury;
  for (const m of Object.values(w.markets)) g += m.treasury;
  for (const m of Object.values(w.merchants)) g += m.gold;
  for (const p of Object.values(w.players)) g += p.gold;
  return Math.round(g * 100) / 100;
}
