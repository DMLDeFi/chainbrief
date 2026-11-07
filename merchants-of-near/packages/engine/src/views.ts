import { MARKETS, RESOURCES, TIME, type MarketId } from './config';
import { CITY_DEFS } from './cities';
import { DEPOT_CAPACITY, depotCapacity, hasAccess } from './logistics';
import type { BusinessKind, WorldState } from './types';
import { dayOf, hourOf, invTotal, money } from './internal';
import { merchantNetWorth, playerNetWorth, shareValue, debtOf } from './valuation';
import { BUSINESS_DEFS, businessCapacity, businessMaxWorkers, businessQuote, businessSaleValue, MAX_BUSINESS_LEVEL, overheadFactor, playerCapacity, UPGRADE_LEVEL_REQ, upgradeCostOf } from './businesses';
import { affinity, LAND_TAX, landDef, landPrice, landValue, plotsTaken, prosperity } from './property';
import { LEVELS, levelTitle, nextLevelRequirements, ACHIEVEMENTS } from './progression';
import { warehouseExpansionCost } from './players';
import { activeLoansOf, evaluateCredit } from './banking';

/** Compact public snapshot broadcast to every client each tick. */
export function publicSnapshot(world: WorldState, feedSince = 0) {
  const markets = Object.fromEntries(
    MARKETS.map((id) => {
      const m = world.markets[id];
      return [
        id,
        {
          id,
          name: m.name,
          fee: m.fee,
          resources: Object.fromEntries(
            RESOURCES.map((r) => [
              r,
              {
                price: money(m.price[r]),
                open: money(m.openPrice[r]),
                stock: Math.round(m.stock[r] * 10) / 10,
                pressure: Math.round(m.pressure[r] * 100) / 100,
                demand: Math.round(m.demandRate[r] * 100) / 100,
                supply: Math.round(m.supplyRate[r] * 100) / 100,
                production: Math.round(m.productionRate[r] * 100) / 100,
                consumption: Math.round(m.consumptionRate[r] * 100) / 100,
                shortage: Math.round(m.shortageRate[r] * 100) / 100,
                // Full hourly curve for the home exchange; the last day for other cities keeps the stream small.
                intraday: id === 'nearhaven' ? m.intraday[r] : m.intraday[r].slice(-24),
              },
            ]),
          ),
          volumeToday: money(m.volumeToday),
          treasury: money(m.treasury),
        },
      ];
    }),
  );
  return {
    tick: world.tick,
    day: dayOf(world.tick) + 1,
    hour: hourOf(world.tick),
    ticksPerDay: TIME.ticksPerDay,
    season: world.season,
    weather: world.weather,
    population: world.population,
    foodSatisfaction: Math.round(world.stats.lastDayFoodSatisfaction * 100),
    guildTreasury: money(world.guildTreasury),
    events: world.events.map((e) => ({ id: e.id, kind: e.kind, title: e.title, description: e.description, endsInHours: e.endTick - world.tick })),
    markets,
    merchants: Object.values(world.merchants).map((m) => ({
      id: m.id,
      name: m.name,
      role: m.role,
      title: m.title,
      status: m.status,
      gold: money(m.gold),
      netWorth: merchantNetWorth(world, m),
      workers: m.workers,
      location: m.location,
      home: m.homeBuilding,
      travel: m.travel ? { to: m.travel.to, arriveTick: m.travel.arriveTick } : null,
      lastDecision: m.decisions[m.decisions.length - 1] ?? null,
      lastTradeTick: m.memory.length ? m.memory[m.memory.length - 1].tick : -1,
    })),
    businesses: Object.values(world.businesses).map((b) => ({ id: b.id, kind: b.kind, city: b.city ?? 'nearhaven', plot: b.plot, level: b.level, owner: world.players[b.ownerId]?.name ?? '?', ownerId: b.ownerId })),
    /** Vacant plots players hold as property (drawn as fenced, sold plots in town). */
    land: Object.values(world.players).flatMap((p) => (p.land ?? []).map((l) => ({ city: l.city, plot: l.plot, owner: p.name, ownerId: p.id }))),
    /** Land market in each city. */
    cityLand: Object.fromEntries(MARKETS.map((id) => [id, { plots: landDef(id).plots, taken: plotsTaken(world, id), price: landPrice(world, id), value: landValue(world, id), prosperity: Math.round(prosperity(world, id) * 100) / 100 }])) as Record<MarketId, { plots: number; taken: number; price: number; value: number; prosperity: number }>,
    feed: world.feed.filter((f) => f.id > feedSince).slice(-60),
    players: Object.keys(world.players).length,
    cities: Object.fromEntries(MARKETS.map((id) => [id, { population: id === 'nearhaven' ? world.population : (world.cities?.[id]?.population ?? CITY_DEFS[id].population) }])) as Record<MarketId, { population: number }>,
    /** Caravans on the road (AI traders and player shipments), for the world map. */
    traffic: [
      ...Object.values(world.merchants).filter((m) => m.travel).map((m) => ({ kind: 'merchant' as const, id: m.id, name: m.name, from: m.travel!.from ?? m.location, to: m.travel!.to, arriveTick: m.travel!.arriveTick })),
      ...Object.values(world.shipments ?? {}).map((s) => ({ kind: 'shipment' as const, id: s.id, name: world.players[s.ownerId]?.name ?? 'A merchant', from: s.from, to: s.to, arriveTick: s.arriveTick, departTick: s.departTick, resource: s.resource, qty: s.qty })),
    ],
  };
}
export type PublicSnapshot = ReturnType<typeof publicSnapshot>;

export function merchantDetail(world: WorldState, id: string, viewerId?: string) {
  const m = world.merchants[id];
  if (!m) return null;
  return {
    ...m,
    netWorth: merchantNetWorth(world, m),
    shareValue: money(shareValue(world, m)),
    debt: debtOf(world, { kind: 'merchant', id }),
    yourShares: viewerId ? m.investors[viewerId] ?? 0 : 0,
    yourRelationship: viewerId ? m.relationships[viewerId] ?? 0 : 0,
    investorCount: Object.keys(m.investors).length,
    investors: undefined,
    relationships: undefined,
  };
}

export function playerView(world: WorldState, playerId: string) {
  const p = world.players[playerId];
  if (!p) return null;
  const businesses = Object.values(world.businesses)
    .filter((b) => b.ownerId === playerId)
    .map((b) => ({
      ...b,
      city: b.city ?? 'nearhaven',
      def: BUSINESS_DEFS[b.kind],
      capacity: businessCapacity(b),
      maxWorkers: businessMaxWorkers(b),
      maxLevel: MAX_BUSINESS_LEVEL,
      upgradeCost: upgradeCostOf(b),
      upgradeNeedsLevel: b.level < MAX_BUSINESS_LEVEL ? UPGRADE_LEVEL_REQ[b.level + 1] ?? 0 : 0,
      affinity: affinity(b.city ?? 'nearhaven', b.kind),
      sale: businessSaleValue(world, b),
    }));
  const investments = Object.values(world.merchants)
    .filter((m) => m.investors[playerId])
    .map((m) => ({ merchantId: m.id, name: m.name, shares: m.investors[playerId], value: money(m.investors[playerId] * shareValue(world, m)), status: m.status }));
  return {
    ...p,
    netWorth: playerNetWorth(world, p),
    levelTitle: levelTitle(p.level),
    nextLevel: nextLevelRequirements(p),
    capacity: playerCapacity(world, playerId),
    used: Math.round(invTotal(p.inventory) * 10) / 10,
    warehouseExpansionCost: warehouseExpansionCost(p),
    businesses,
    investments,
    loans: activeLoansOf(world, { kind: 'player', id: playerId }),
    credit: { ...p.credit, offer: evaluateCredit(world, { kind: 'player', id: playerId }, 50) },
    listings: Object.values(world.listings).filter((l) => l.sellerId === playerId && l.status === 'open'),
    charters: p.charters ?? [],
    land: (p.land ?? []).map((l) => ({ ...l, value: landValue(world, l.city), tax: money(landValue(world, l.city) * LAND_TAX) })),
    taxArrears: money(p.taxArrears ?? 0),
    overhead: overheadFactor(world, playerId),
    /** Building quotes for every kind in every city the player can build in. */
    quotes: Object.fromEntries(MARKETS.filter((c) => hasAccess(p, c)).map((c) => [c, Object.fromEntries((Object.keys(BUSINESS_DEFS) as BusinessKind[]).map((k) => [k, businessQuote(world, playerId, k, c)]))])),
    depots: p.depots ?? {},
    depotCapacity: DEPOT_CAPACITY,
    depotCapacities: Object.fromEntries(MARKETS.filter((c) => c !== 'nearhaven').map((c) => [c, depotCapacity(p, c, world)])),
    shipments: Object.values(world.shipments ?? {}).filter((s) => s.ownerId === playerId),
  };
}
export type PlayerView = NonNullable<ReturnType<typeof playerView>>;

export function leaderboards(world: WorldState) {
  const players = Object.values(world.players).map((p) => ({
    id: p.id,
    name: p.name,
    level: p.level,
    title: levelTitle(p.level),
    netWorth: playerNetWorth(world, p),
    achievements: Object.keys(p.achievements).length,
    reputation: p.reputation,
    nearAccountId: p.nearAccountId ?? null,
    volume: money(p.lifetime.volume ?? 0),
  }));
  const businesses = Object.values(world.businesses).map((b) => ({
    id: b.id,
    name: b.name,
    kind: b.kind,
    owner: world.players[b.ownerId]?.name ?? '?',
    level: b.level,
    profit: money(b.totals.revenue - b.totals.expenses),
    revenue: money(b.totals.revenue),
    deed: b.deedTokenId ?? null,
  }));
  return {
    wealth: [...players].sort((a, b) => b.netWorth - a.netWorth).slice(0, 50),
    trading: [...players].sort((a, b) => b.volume - a.volume).slice(0, 50),
    achievements: [...players].sort((a, b) => b.achievements - a.achievements || b.netWorth - a.netWorth).slice(0, 50),
    businesses: businesses.sort((a, b) => b.profit - a.profit).slice(0, 50),
    /** AI merchants are ranked separately and always labelled as AI. */
    aiMerchants: Object.values(world.merchants)
      .map((m) => ({ id: m.id, name: m.name, role: m.role, status: m.status, netWorth: merchantNetWorth(world, m), ai: true }))
      .sort((a, b) => b.netWorth - a.netWorth),
  };
}

export const catalog = { LEVELS, ACHIEVEMENTS: ACHIEVEMENTS.map(({ check: _c, ...a }) => a), BUSINESS_DEFS };
