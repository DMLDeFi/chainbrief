import { RESOURCES, type MarketId } from './config';
import type { Inventory, MerchantState, PlayerState, WorldState, ActorRef } from './types';
import { money } from './internal';

/** Liquidation value of goods at a city's mid prices (10% haircut); Nearhaven by default. */
export function inventoryValue(world: WorldState, inv: Inventory, city: MarketId = 'nearhaven'): number {
  const m = world.markets[city] ?? world.markets.nearhaven;
  let v = 0;
  for (const r of RESOURCES) v += (inv[r] ?? 0) * m.price[r] * 0.9;
  return money(v);
}

export function debtOf(world: WorldState, ref: ActorRef): number {
  let d = 0;
  for (const l of Object.values(world.loans)) {
    if (l.status === 'active' && l.borrower.kind === ref.kind && l.borrower.id === ref.id) d += l.outstanding;
  }
  return money(d);
}

export function merchantNetWorth(world: WorldState, m: MerchantState): number {
  const cargo = m.travel ? inventoryValue(world, m.travel.cargo) : 0;
  return money(m.gold + inventoryValue(world, m.inventory) + cargo - debtOf(world, { kind: 'merchant', id: m.id }));
}

/** Value per share of a merchant's equity (zero if bankrupt). */
export function shareValue(world: WorldState, m: MerchantState): number {
  if (m.status === 'bankrupt') return 0;
  return Math.max(0, merchantNetWorth(world, m)) / m.shares;
}

export function businessValue(world: WorldState, playerId: string): number {
  let v = 0;
  for (const b of Object.values(world.businesses)) {
    if (b.ownerId !== playerId) continue;
    v += b.purchasePrice * (0.6 + 0.2 * (b.level - 1)) + inventoryValue(world, b.inventory);
    if (b.caravan) v += inventoryValue(world, b.caravan.cargo);
  }
  return money(v);
}

export function investmentValue(world: WorldState, playerId: string): number {
  let v = 0;
  for (const m of Object.values(world.merchants)) {
    const s = m.investors[playerId];
    if (s) v += s * shareValue(world, m);
  }
  return money(v);
}

export function escrowValue(world: WorldState, playerId: string): number {
  let v = 0;
  for (const l of Object.values(world.listings)) {
    if (l.status === 'open' && l.sellerId === playerId) v += inventoryValue(world, { [l.resource]: l.qty });
  }
  return money(v);
}

export function playerNetWorth(world: WorldState, p: PlayerState): number {
  return money(
    p.gold +
      inventoryValue(world, p.inventory) +
      depotValue(world, p) +
      businessValue(world, p.id) +
      investmentValue(world, p.id) +
      escrowValue(world, p.id) -
      debtOf(world, { kind: 'player', id: p.id }),
  );
}

/** Goods in other cities' depots (valued where they sit) plus shipments on the road (valued at their destination). */
export function depotValue(world: WorldState, p: PlayerState): number {
  let v = 0;
  for (const [city, inv] of Object.entries(p.depots ?? {})) if (inv) v += inventoryValue(world, inv, city as MarketId);
  for (const s of Object.values(world.shipments ?? {})) if (s.ownerId === p.id) v += inventoryValue(world, { [s.resource]: s.qty }, s.to);
  return money(v);
}
