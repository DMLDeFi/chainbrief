import { AURORA_FLOWS, CITIZEN_DEMAND, ECONOMY, MARKETS, RESOURCE_DEFS, RESOURCES, SEASONAL_DEMAND, TIME, type Resource } from './config';
import type { WorldState } from './types';
import { clamp, dayOf, money, pct, pushFeed, resourceMap, seasonOf, fmt } from './internal';
import { createMarket, unitPrice, updatePressure } from './market';
import { citizenBaseDemand, demandFactor, maybeStartEvent, productionFactor, updateSeason, updateWeather } from './environment';
import { merchantDaily, runMerchants } from './merchants';
import { businessDaily, runBusiness } from './businesses';
import { collectLoans } from './banking';
import { playerDaily } from './players';
import { evaluateProgression } from './progression';
import { createMerchant, MERCHANT_SEEDS } from './seed';

export function createWorld(seed = 20260101): WorldState {
  const markets = { nearhaven: createMarket('nearhaven'), aurora: createMarket('aurora') };
  const merchants: WorldState['merchants'] = {};
  for (const s of MERCHANT_SEEDS) merchants[s.id] = createMerchant(s);
  const world: WorldState = {
    version: 1,
    seed,
    rng: seed >>> 0,
    tick: 0,
    season: 'spring',
    weather: 'clear',
    weatherUntil: 12,
    population: ECONOMY.initialPopulation,
    markets,
    merchants,
    players: {},
    businesses: {},
    loans: {},
    listings: {},
    events: [],
    feed: [],
    nextId: 0,
    nextFeedId: 0,
    plotsUsed: [],
    ledger: [],
    guildTreasury: 500,
    reported: {
      nearhaven: { price: { ...markets.nearhaven.price }, stock: { ...markets.nearhaven.stock } },
      aurora: { price: { ...markets.aurora.price }, stock: { ...markets.aurora.stock } },
    },
    stats: { dayFoodSatisfaction: 0, lastDayFoodSatisfaction: 1 },
  };
  for (const m of Object.values(merchants)) for (const r of RESOURCES) m.beliefs[r] = markets.nearhaven.price[r];
  pushFeed(world, { kind: 'event', text: 'The gates of Nearhaven open. Ten merchants begin a new trading season.' });
  return world;
}

/**
 * Citizens of Nearhaven buy staples from the exchange. Demand falls as prices
 * rise (price elasticity) and is capped by the household purse, which is filled
 * by wages that merchants and businesses pay plus a small outside income. Food
 * is bought first, so when money is tight luxuries suffer before bread does.
 */
const CITIZEN_PRIORITY: Resource[] = ['bread', 'fish', 'wood', 'livestock', 'wheat', 'coal', 'cloth', 'tools', 'stone', 'weapons'];
function citizensConsume(world: WorldState): void {
  const m = world.markets.nearhaven;
  const seasonal = SEASONAL_DEMAND[world.season];
  // Nearhaven's exchange and its households share one town purse: wages and merchant
  // spending flow in, payments for goods sold to the exchange flow out.
  m.treasury = money(m.treasury + world.population * ECONOMY.citizenIncome);
  let wantedFood = 0;
  let gotFood = 0;
  for (const r of CITIZEN_PRIORITY) {
    if (!CITIZEN_DEMAND[r]) continue;
    const def = RESOURCE_DEFS[r];
    const base = citizenBaseDemand(world, r) * demandFactor(world, r, seasonal);
    let qty = base * Math.pow(def.basePrice / m.price[r], ECONOMY.citizenElasticity);
    qty = Math.min(qty, Math.max(0, m.treasury) / m.price[r]);
    const available = Math.max(0, m.stock[r] - 1);
    const take = Math.min(qty, available);
    const unmet = Math.max(0, base - take); // unmet vs. *baseline* need drives shortage pressure
    m.stock[r] = Math.round((m.stock[r] - take) * 100) / 100;
    m.tickConsumed[r] += take;
    m.tickShortage[r] += unmet > base * 0.25 ? unmet : 0;
    if (r === 'bread' || r === 'fish') {
      wantedFood += base;
      gotFood += take;
    }
  }
  world.stats.dayFoodSatisfaction += wantedFood > 0 ? Math.min(1, gotFood / wantedFood) : 1;
}

/** Port Aurora's hinterland produces and consumes on its own schedule. */
function regionFlows(world: WorldState): void {
  const m = world.markets.aurora;
  for (const r of RESOURCES) {
    const f = AURORA_FLOWS[r];
    const produced = f.produce * (r === 'fish' ? productionFactor(world, 'fish') : 1);
    m.stock[r] = Math.round((m.stock[r] + produced) * 100) / 100;
    m.tickProduced[r] += produced;
    const want = f.consume * Math.pow(RESOURCE_DEFS[r].basePrice / m.price[r], ECONOMY.citizenElasticity);
    const take = Math.min(want, Math.max(0, m.stock[r] - 1));
    m.stock[r] = Math.round((m.stock[r] - take) * 100) / 100;
    m.tickConsumed[r] += take;
    m.treasury = money(m.treasury + take * m.price[r]); // the hinterland pays for what it imports
    if (want - take > f.consume * 0.25) m.tickShortage[r] += want - take;
  }
}

/** Report significant price moves to the activity feed, explained by the underlying state change. */
function reportPriceMoves(world: WorldState): void {
  for (const id of MARKETS) {
    const m = world.markets[id];
    const rep = world.reported[id];
    for (const r of RESOURCES) {
      const change = (m.price[r] - rep.price[r]) / rep.price[r];
      if (Math.abs(change) < 0.07) continue;
      const stockChange = (m.stock[r] - rep.stock[r]) / Math.max(1, rep.stock[r]);
      const label = RESOURCE_DEFS[r].label;
      const cause =
        Math.abs(stockChange) >= 0.03
          ? `as ${label.toLowerCase()} supply ${stockChange < 0 ? 'fell' : 'rose'} ${pct(stockChange).replace(/^[+-]/, '')}`
          : m.pressure[r] > 1.05
            ? `on strong demand (pressure ${m.pressure[r].toFixed(2)}×)`
            : m.pressure[r] < 0.95
              ? `as demand cooled (pressure ${m.pressure[r].toFixed(2)}×)`
              : 'on shifting trade';
      pushFeed(world, {
        kind: 'price',
        resource: r,
        market: id,
        text: `${m.name}: ${label} prices ${change > 0 ? 'rose' : 'fell'} ${pct(Math.abs(change)).slice(1)} to ${fmt(m.price[r])}g ${cause}.`,
        data: { change: Math.round(change * 1000) / 10, price: money(m.price[r]), stockChange: Math.round(stockChange * 1000) / 10 },
        severity: change > 0 ? 'bad' : 'good',
      });
      rep.price[r] = m.price[r];
      rep.stock[r] = m.stock[r];
    }
  }
}

function daily(world: WorldState): void {
  for (const id of MARKETS) {
    const m = world.markets[id];
    for (const r of RESOURCES) {
      m.history[r].push(money(m.price[r]));
      if (m.history[r].length > ECONOMY.historyDays) m.history[r].shift();
      m.openPrice[r] = m.price[r];
    }
    m.volumeToday = 0;
  }
  for (const m of Object.values(world.merchants)) merchantDaily(world, m);
  recirculate(world);
  for (const b of Object.values(world.businesses)) businessDaily(world, b);
  collectLoans(world);
  for (const p of Object.values(world.players)) playerDaily(world, p);

  // Population responds to how well the town was fed.
  const sat = world.stats.dayFoodSatisfaction / TIME.ticksPerDay;
  world.stats.lastDayFoodSatisfaction = sat;
  world.stats.dayFoodSatisfaction = 0;
  const before = world.population;
  if (sat > 0.9) world.population = Math.round(world.population * (1 + ECONOMY.popGrowth));
  else if (sat < 0.6) world.population = Math.round(world.population * (1 - ECONOMY.popDecline));
  world.population = clamp(world.population, 200, 1200);
  if (world.population !== before) {
    pushFeed(world, {
      kind: 'population',
      text: world.population > before
        ? `Well fed, Nearhaven grew to ${world.population} citizens — demand for every good rises.`
        : `Food shortages drove families away: population fell to ${world.population}.`,
      data: { population: world.population, foodSatisfaction: Math.round(sat * 100) },
      severity: world.population > before ? 'good' : 'bad',
    });
  }
  maybeStartEvent(world);
}

/**
 * Money recirculation keeps the economy from stalling when gold pools in one
 * place: guild surpluses fund public works (paid into the town purse), and
 * merchant households spend part of their wealth in town.
 */
function recirculate(world: WorldState): void {
  if (world.guildTreasury > 1500) {
    const x = money((world.guildTreasury - 1500) * 0.1);
    world.guildTreasury = money(world.guildTreasury - x);
    world.markets.nearhaven.treasury = money(world.markets.nearhaven.treasury + x);
  }
  for (const m of Object.values(world.merchants)) {
    if (m.role === 'banker' || m.status === 'bankrupt' || m.gold <= 400) continue;
    // Merchant households live off their profits: spending flows back to the townsfolk,
    // with a small guild due. Wealth therefore plateaus instead of draining the town.
    const spend = money((m.gold - 400) * 0.04);
    const due = money(spend * 0.15);
    m.gold = money(m.gold - spend);
    m.today.costs += spend;
    world.markets.nearhaven.treasury = money(world.markets.nearhaven.treasury + spend - due);
    world.guildTreasury = money(world.guildTreasury + due);
  }
}

/** Advance the world by one tick (one in-game hour). */
export function stepWorld(world: WorldState): void {
  world.tick += 1;
  updateSeason(world);
  updateWeather(world);
  citizensConsume(world);
  regionFlows(world);
  runMerchants(world);
  for (const b of Object.values(world.businesses)) runBusiness(world, b);
  for (const id of MARKETS) updatePressure(world.markets[id], id === 'nearhaven' ? Object.fromEntries((Object.keys(CITIZEN_DEMAND) as Resource[]).map((r) => [r, citizenBaseDemand(world, r)])) : {});
  if (world.tick % 3 === 0) reportPriceMoves(world);
  if (world.tick % TIME.ticksPerDay === 0) daily(world);
  if (world.tick % 6 === 0) for (const p of Object.values(world.players)) evaluateProgression(world, p);
  if (world.ledger.length > 20000) world.ledger.splice(0, world.ledger.length - 20000);
}

export function advanceWorld(world: WorldState, ticks: number): void {
  for (let i = 0; i < ticks; i++) stepWorld(world);
}

export const worldDay = (w: WorldState) => dayOf(w.tick) + 1;
export const worldSeason = (w: WorldState) => seasonOf(w.tick);
export const midPrice = unitPrice;
export const zeroMap = () => resourceMap(() => 0);
