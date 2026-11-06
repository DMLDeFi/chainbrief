import { CITIZEN_DEMAND, RESOURCE_DEFS, type Resource, type Season, type Weather } from './config';
import type { ActiveEvent, EventKind, WorldState } from './types';
import { dayOf, newId, nextRandom, pick, pushFeed, randRange, seasonOf } from './internal';

/** Seasonal yield of each raw resource. */
const SEASON_YIELD: Record<Season, Partial<Record<Resource, number>>> = {
  spring: { wheat: 0.9, livestock: 1.2, fish: 1.0, wood: 1.0 },
  summer: { wheat: 1.25, livestock: 1.0, fish: 1.2, wood: 1.1 },
  autumn: { wheat: 1.5, livestock: 0.9, fish: 1.0, wood: 1.0 },
  winter: { wheat: 0.3, livestock: 0.7, fish: 0.7, wood: 0.8, iron: 0.9, stone: 0.7 },
};

const WEATHER_YIELD: Record<Weather, Partial<Record<Resource, number>>> = {
  clear: {},
  cloudy: { wheat: 0.95 },
  rain: { wheat: 1.15, fish: 0.9, wood: 0.85, stone: 0.85 },
  storm: { wheat: 0.6, fish: 0.3, wood: 0.6, stone: 0.7, livestock: 0.9 },
  snow: { wheat: 0.4, fish: 0.6, wood: 0.7, stone: 0.6, iron: 0.85 },
  heatwave: { wheat: 0.6, livestock: 0.8, fish: 0.9 },
};

const WEATHER_BY_SEASON: Record<Season, Array<[Weather, number]>> = {
  spring: [['clear', 4], ['cloudy', 3], ['rain', 4], ['storm', 1]],
  summer: [['clear', 6], ['cloudy', 2], ['rain', 2], ['storm', 1], ['heatwave', 2]],
  autumn: [['clear', 3], ['cloudy', 4], ['rain', 4], ['storm', 2]],
  winter: [['clear', 2], ['cloudy', 3], ['snow', 6], ['storm', 1]],
};

export function productionFactor(world: WorldState, r: Resource): number {
  let f = (SEASON_YIELD[world.season][r] ?? 1) * (WEATHER_YIELD[world.weather][r] ?? 1);
  for (const e of world.events) f *= e.effects.production?.[r] ?? 1;
  return f;
}

export function demandFactor(world: WorldState, r: Resource, seasonal: Partial<Record<Resource, number>>): number {
  let f = seasonal[r] ?? 1;
  for (const e of world.events) f *= e.effects.demand?.[r] ?? 1;
  return f;
}

export function updateWeather(world: WorldState): void {
  if (world.tick < world.weatherUntil) return;
  const options = WEATHER_BY_SEASON[world.season];
  const total = options.reduce((s, [, w]) => s + w, 0);
  let roll = nextRandom(world) * total;
  let next: Weather = options[0][0];
  for (const [w, weight] of options) {
    roll -= weight;
    if (roll <= 0) {
      next = w;
      break;
    }
  }
  const changed = next !== world.weather;
  world.weather = next;
  world.weatherUntil = world.tick + Math.floor(randRange(world, 8, 30));
  if (changed && next !== 'clear' && next !== 'cloudy') {
    const effects: Record<string, string> = {
      rain: 'Rain waters the fields; wheat yields improve.',
      storm: 'A storm keeps the fishing boats in harbour and batters the fields.',
      snow: 'Snow blankets Nearhaven. Farm output collapses and firewood demand climbs.',
      heatwave: 'A heatwave scorches the crops.',
    };
    pushFeed(world, { kind: 'weather', text: effects[next] ?? `The weather turns ${next}.`, data: { weather: next } });
  }
}

export function updateSeason(world: WorldState): void {
  const s = seasonOf(world.tick);
  if (s !== world.season) {
    world.season = s;
    pushFeed(world, { kind: 'weather', text: `${s[0].toUpperCase()}${s.slice(1)} arrives in Nearhaven (day ${dayOf(world.tick) + 1}).`, data: { season: s } });
  }
}

interface EventTemplate {
  kind: EventKind;
  title: string;
  description: string;
  days: [number, number];
  seasons?: Season[];
  effects: ActiveEvent['effects'];
}

export const EVENT_TEMPLATES: EventTemplate[] = [
  { kind: 'drought', title: 'Drought', description: 'Dry winds wither the valley. Wheat yields fall sharply.', days: [3, 5], seasons: ['summer', 'spring'], effects: { production: { wheat: 0.4, livestock: 0.8 } } },
  { kind: 'bumper_harvest', title: 'Bumper Harvest', description: 'The best harvest in a generation floods the granaries.', days: [2, 4], seasons: ['autumn', 'summer'], effects: { production: { wheat: 1.7 } } },
  { kind: 'mine_collapse', title: 'Mine Collapse', description: 'A shaft collapses in the Greyrock mine. Iron and coal output plummets.', days: [3, 6], effects: { production: { iron: 0.3, coal: 0.4 } } },
  { kind: 'festival', title: 'Harvest Festival', description: 'Nearhaven celebrates! Citizens buy bread, livestock and cloth.', days: [2, 3], seasons: ['autumn', 'summer'], effects: { demand: { bread: 1.6, livestock: 1.8, cloth: 1.4, fish: 1.3 } } },
  { kind: 'bandits', title: 'Bandits on the Roads', description: 'Bandits raid the roads; the guard and caravans arm themselves.', days: [3, 5], effects: { demand: { weapons: 3.5, tools: 1.2 } } },
  { kind: 'fishing_boom', title: 'Herring Run', description: 'Shoals of herring fill the river mouth.', days: [2, 4], seasons: ['spring', 'summer', 'autumn'], effects: { production: { fish: 1.9 } } },
  { kind: 'cattle_plague', title: 'Cattle Murrain', description: 'Sickness spreads through the herds.', days: [3, 5], effects: { production: { livestock: 0.3 } } },
  { kind: 'royal_order', title: 'Royal Commission', description: 'The crown orders tools and stone for a new keep.', days: [3, 5], effects: { demand: { tools: 2.2, stone: 2.5, iron: 1.5 } } },
];

/** Roll for a new economic event once per day (~22% chance, at most two at a time). */
export function maybeStartEvent(world: WorldState): ActiveEvent | null {
  world.events = world.events.filter((e) => {
    if (e.endTick <= world.tick) {
      pushFeed(world, { kind: 'event', text: `${e.title} has ended.`, data: { event: e.kind } });
      return false;
    }
    return true;
  });
  if (world.events.length >= 2 || nextRandom(world) > 0.22) return null;
  const candidates = EVENT_TEMPLATES.filter((t) => (!t.seasons || t.seasons.includes(world.season)) && !world.events.some((e) => e.kind === t.kind));
  if (!candidates.length) return null;
  const t = pick(world, candidates);
  return startEvent(world, t.kind);
}

export function startEvent(world: WorldState, kind: EventKind): ActiveEvent | null {
  const t = EVENT_TEMPLATES.find((e) => e.kind === kind);
  if (!t) return null;
  const days = Math.round(randRange(world, t.days[0], t.days[1]));
  const ev: ActiveEvent = { id: newId(world, 'evt'), kind: t.kind, title: t.title, description: t.description, startTick: world.tick, endTick: world.tick + days * 24, effects: t.effects };
  world.events.push(ev);
  const affected = Object.keys({ ...(t.effects.production ?? {}), ...(t.effects.demand ?? {}) }).join(', ');
  pushFeed(world, { kind: 'event', text: `EVENT — ${t.title}: ${t.description} (${days} days; affects ${affected})`, data: { event: t.kind, days }, severity: 'bad' });
  return ev;
}

export const citizenBaseDemand = (world: WorldState, r: Resource): number => ((CITIZEN_DEMAND[r] ?? 0) * world.population) / 100;
export const isKnownResource = (r: string): r is Resource => r in RESOURCE_DEFS;
