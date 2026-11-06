import { BUSINESS_DEFS, LEVELS, ACHIEVEMENTS, RESOURCE_DEFS, RESOURCES, unitPrice, type MarketState, type Resource } from '@mon/engine';
import type { PublicSnapshot } from '@mon/engine';

export { BUSINESS_DEFS, LEVELS, RESOURCE_DEFS, RESOURCES };
export const ACHIEVEMENT_LIST = ACHIEVEMENTS.map(({ check: _c, ...a }) => a);
export type MarketSnap = PublicSnapshot['markets']['nearhaven'];

/**
 * Client-side *estimate* of a trade, using the same price curve as the server
 * and the latest public snapshot. The server recomputes the real price; the
 * estimate only sets a slippage limit.
 */
export function estimate(m: MarketSnap, r: Resource, side: 'buy' | 'sell', qty: number) {
  const stock = m.resources[r].stock;
  const pseudo = { pressure: { [r]: m.resources[r].pressure } } as unknown as MarketState;
  let gross = 0;
  for (let i = 0; i < qty; i++) gross += unitPrice(pseudo, r, side === 'buy' ? stock - i : stock + i + 1);
  const fee = gross * m.fee;
  const total = side === 'buy' ? gross + fee : gross - fee;
  return { total, avg: total / Math.max(1, qty), fee, after: unitPrice(pseudo, r, side === 'buy' ? stock - qty : stock + qty), feasible: side === 'sell' || stock - qty >= 1 };
}

export const ROLE_TITLE: Record<string, string> = {
  farmer: 'Farmer', baker: 'Baker', blacksmith: 'Blacksmith', trader: 'Trader', banker: 'Banker', miner: 'Miner', fisher: 'Fisher', weaver: 'Weaver', woodcutter: 'Woodcutter',
};
export const ROLE_COLOR: Record<string, string> = {
  farmer: '#8fb35f', baker: '#e2a35a', blacksmith: '#b8b0a6', trader: '#6aa3c8', banker: '#c6cfe0', miner: '#a8957c', fisher: '#5fb3c0', weaver: '#b98ab0', woodcutter: '#7fa060',
};
