import { CITY_DEFS, MARKET_DEFS, RESOURCE_DEFS, type MarketId, type PublicSnapshot, type Resource } from '@mon/engine';

/**
 * The townsfolk walking a city's streets. Each has a stable identity from their
 * number and city, a mood that follows the live world (food, weather, events),
 * and things to say about it: prices, jobs, the races, the guilds and the news.
 * All of it is read from the public snapshot, so it costs the server nothing and
 * a citizen never knows anything a player could not find out.
 */
export interface Citizen {
  index: number;
  city: MarketId;
  name: string;
  trade: string;
  temper: 'cheerful' | 'grumpy' | 'gossip' | 'shrewd' | 'shy';
  age: number;
  /** Something about them, for when you ask. */
  about: string;
}

const FIRST = ['Edda', 'Tobin', 'Mirela', 'Oswin', 'Hilde', 'Corwin', 'Ysolde', 'Bram', 'Petra', 'Aldo', 'Wynn', 'Greta', 'Lorcan', 'Nell', 'Fenwick', 'Marta', 'Silas', 'Ilse', 'Rowan', 'Bettany', 'Hamon', 'Clova', 'Desmond', 'Agna'];
const FAMILY = ['Ashdown', 'Millward', 'Thatcher', 'Coppersmith', 'Reed', 'Hollow', 'Brightwater', 'Fenn', 'Oakes', 'Marlow', 'Tanner', 'Cobb', 'Wick', 'Stonebridge', 'Harrow', 'Pell'];
const TRADES = ['carter', 'dockhand', 'washerwoman', "baker's apprentice", 'stable hand', 'tanner', 'chandler', 'net mender', 'lamplighter', 'cooper', 'seamstress', 'stonemason', 'herbalist', 'porter', 'tavern cook', 'goat herd', 'scribe', 'thatcher', 'brewer', 'night watchman'];
const TEMPERS: Citizen['temper'][] = ['cheerful', 'grumpy', 'gossip', 'shrewd', 'shy'];
const ABOUT = [
  'My grandmother swept this very street.',
  'I save a copper a day for a cart of my own.',
  'I came here with nothing but a sack of turnips.',
  'My brother sails for Port Aurora. Never writes.',
  'I have lived on this street for {age} years.',
  'One day I will open a shop by the exchange.',
  'They say I make the best stew this side of the river.',
  'I lost a bet at the Hippodrome once. Once!',
];

function rng(seed: number) {
  let h = (Math.imul(seed + 0x9e37, 2654435761) ^ 0x5bd1e995) >>> 0;
  return () => {
    h = (Math.imul(h ^ (h >>> 15), 2246822507) + 0x6d2b79f5) >>> 0;
    return ((h ^ (h >>> 13)) >>> 0) / 4294967296;
  };
}
const cityHash = (c: string) => [...c].reduce((a, ch) => a * 31 + ch.charCodeAt(0), 7) % 9973;

export function citizenProfile(index: number, city: MarketId): Citizen {
  const r = rng(index * 131 + cityHash(city));
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const age = 16 + Math.floor(r() * 58);
  return { index, city, name: `${pick(FIRST)} ${pick(FAMILY)}`, trade: pick(TRADES), temper: pick(TEMPERS), age, about: pick(ABOUT).replace('{age}', String(Math.max(3, age - 12))) };
}

export interface Mood { score: number; label: string; emoji: string; why: string }

/** How a citizen feels right now, and the main reason. */
export function citizenMood(c: Citizen, w: PublicSnapshot): Mood {
  const reasons: Array<[number, string]> = [];
  const food = w.foodSatisfaction;
  if (food < 60) reasons.push([-0.35, 'Bread is short and bellies are empty.']);
  else if (food < 85) reasons.push([-0.15, 'Food is dear this week.']);
  else reasons.push([0.1, 'At least nobody goes hungry.']);
  const kinds = w.events.map((e) => e.title.toLowerCase());
  for (const e of w.events) {
    const t = e.title.toLowerCase();
    if (/festival|harvest|boom/.test(t)) reasons.push([0.25, `${e.title}! The whole town is out.`]);
    else if (/order/.test(t)) reasons.push([0.05, `${e.title}: the merchants are scrambling.`]);
    else reasons.push([-0.2, `${e.title}. Everyone is on edge.`]);
  }
  if (!kinds.length) reasons.push([0.05, 'A quiet week, thank the stars.']);
  if (w.weather === 'storm') reasons.push([-0.15, 'This storm has soaked me to the bone.']);
  else if (w.weather === 'rain') reasons.push([-0.05, 'Rain again.']);
  else if (w.weather === 'heatwave') reasons.push([-0.1, 'This heat! I can barely work.']);
  else if (w.weather === 'snow') reasons.push([0, 'Snow on the rooftops. Pretty, but cold.']);
  else if (w.weather === 'clear') reasons.push([0.08, 'Fine weather for it.']);
  const temper = { cheerful: 0.15, grumpy: -0.2, gossip: 0, shrewd: -0.05, shy: 0 }[c.temper];
  const score = Math.max(-1, Math.min(1, 0.35 + temper + reasons.reduce((s, [d]) => s + d, 0)));
  const why = reasons.slice().sort((a, b) => Math.abs(b[0]) - Math.abs(a[0]))[0][1];
  const [label, emoji] = score > 0.6 ? ['Joyful', '😄'] : score > 0.3 ? ['Content', '🙂'] : score > 0 ? ['Uneasy', '😐'] : score > -0.35 ? ['Grumbling', '😠'] : ['Miserable', '😞'];
  return { score, label, emoji, why };
}

export type Topic = 'hello' | 'prices' | 'work' | 'news' | 'races' | 'guilds' | 'self';
export const TOPICS: Array<{ id: Exclude<Topic, 'hello'>; label: string }> = [
  { id: 'prices', label: 'Any good deals?' },
  { id: 'work', label: 'Who is hiring?' },
  { id: 'news', label: 'What’s the news?' },
  { id: 'races', label: 'Tips for the races?' },
  { id: 'guilds', label: 'Which guild leads?' },
  { id: 'self', label: 'Tell me about yourself' },
];

const label = (r: string) => RESOURCE_DEFS[r as Resource]?.label.toLowerCase() ?? r;
const g = (n: number) => `${n < 10 ? n.toFixed(2) : Math.round(n)}g`;

/** The biggest gap between this city and another for one good: a real trading tip. */
export function bestSpread(w: PublicSnapshot, city: MarketId) {
  const here = w.markets[city]?.resources;
  if (!here) return null;
  let best: { resource: string; buyAt: string; buy: number; sellAt: string; sell: number; gain: number } | null = null;
  for (const [id, m] of Object.entries(w.markets)) {
    if (id === city) continue;
    for (const [r, v] of Object.entries(m.resources)) {
      const h = here[r as Resource];
      if (!h || !v.price || !h.price) continue;
      for (const [buyAt, buy, sellAt, sell] of [[id, v.price, city, h.price], [city, h.price, id, v.price]] as Array<[string, number, string, number]>) {
        const gain = sell / buy;
        if (gain > 1.25 && (!best || gain > best.gain)) best = { resource: r, buyAt, buy, sellAt, sell, gain };
      }
    }
  }
  return best;
}

/** What a citizen says on a topic. `n` varies the wording when asked again. */
export function citizenSays(c: Citizen, w: PublicSnapshot, topic: Topic, n = 0, playerName = 'friend'): string {
  const r = rng(c.index * 7 + n * 13 + w.day * 3 + [...topic].reduce((x, ch) => x + ch.charCodeAt(0), 0) * 101);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const city = MARKET_DEFS[c.city]?.name ?? c.city;
  const town = CITY_DEFS[c.city]?.name ?? c.city;
  const voice = (line: string) => {
    if (c.temper === 'grumpy') return pick(['Hmph. ', 'If you must know: ', 'Ask someone else next time. ']) + line;
    if (c.temper === 'gossip') return pick(['Oh, you haven’t heard? ', 'Between you and me, ', 'Everyone’s saying it: ']) + line;
    if (c.temper === 'shrewd') return pick(['Listen closely. ', 'A word to the wise: ', 'Mark my words: ']) + line;
    if (c.temper === 'shy') return pick(['Um… ', 'I think… ', 'Well, if it helps… ']) + line;
    return pick(['Ha! ', 'Good question! ', 'Glad you asked! ']) + line;
  };
  const mood = citizenMood(c, w);
  switch (topic) {
    case 'hello': {
      const hour = w.hour;
      const time = hour < 5 || hour >= 22 ? 'You’re up late' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
      return `${time}, ${playerName}. ${c.name}, ${c.trade}, at your service. ${mood.why}`;
    }
    case 'prices': {
      const s = bestSpread(w, c.city);
      if (s) {
        const buyAt = s.buyAt === c.city ? `here at ${city}` : `in ${MARKET_DEFS[s.buyAt as MarketId]?.name ?? s.buyAt}`;
        const sellAt = s.sellAt === c.city ? `back here` : `in ${CITY_DEFS[s.sellAt as MarketId]?.name ?? s.sellAt}`;
        return voice(`${cap(label(s.resource))} goes for ${g(s.buy)} ${buyAt}, but fetches ${g(s.sell)} ${sellAt}. That’s ${Math.round((s.gain - 1) * 100)}% before the road costs.`);
      }
      const here = Object.entries(w.markets[c.city]?.resources ?? {}).map(([k, v]) => ({ k, ch: v.open ? v.price / v.open - 1 : 0, price: v.price })).sort((a, b) => Math.abs(b.ch) - Math.abs(a.ch))[0];
      if (here && Math.abs(here.ch) > 0.04) return voice(`${cap(label(here.k))} is ${here.ch > 0 ? 'up' : 'down'} ${Math.abs(Math.round(here.ch * 100))}% today at ${g(here.price)}. ${here.ch > 0 ? 'Sellers are smiling.' : 'Cheap, if you ask me.'}`);
      return voice('Prices are steady. A dull week for traders.');
    }
    case 'work': {
      const jobs = (w.contracts ?? []).filter((j) => j.status === 'open').sort((a, b) => (a.city === c.city ? -1 : 0) - (b.city === c.city ? -1 : 0) || b.reward - a.reward);
      const j = jobs[n % Math.max(1, jobs.length)];
      if (!j) return voice('Nobody is posting jobs right now. Try the contracts board tomorrow.');
      const where = j.city === c.city ? 'here in town' : `over in ${CITY_DEFS[j.city]?.name ?? j.city}`;
      return voice(`${j.issuer} ${where} wants ${j.qty} ${label(j.resource)} and pays ${g(j.reward)} for it. It’s on the contracts board (J).`);
    }
    case 'news': {
      const ev = w.events[n % Math.max(1, w.events.length)];
      if (ev) return voice(`${ev.title}. ${ev.description} It should be over in about ${Math.max(1, Math.round(ev.endsInHours / 24))} day${ev.endsInHours >= 48 ? 's' : ''}.`);
      const pop = w.cities?.[c.city]?.population;
      const struggling = w.merchants.filter((m) => m.status === 'struggling').map((m) => m.name);
      if (struggling.length && r() < 0.6) return voice(`${struggling[0]} is struggling. Debts, they say. Watch for bargains.`);
      return voice(`${town} has ${pop ?? w.population} souls now, and it’s still growing. ${pick(['New houses go up every week.', 'Land by the exchange will be dear soon.', 'More mouths need more bread.'])}`);
    }
    case 'races': {
      const race = w.races?.race;
      if (!race) return voice('The Hippodrome is quiet today.');
      const fav = race.horses.slice().sort((a, b) => a.odds - b.odds)[0];
      const long = race.horses.slice().sort((a, b) => b.odds - a.odds)[0];
      const last = w.races.last ? ` Last race went to ${w.races.last.horses[w.races.last.winner].name}.` : '';
      return voice(`${fav.name} is the favourite at ${fav.odds}×. ${long.name} at ${long.odds}× is the long shot. ${c.temper === 'shrewd' ? 'Never bet more than you can lose.' : 'My cousin swears by long shots.'}${last} Press H for the Hippodrome.`);
    }
    case 'guilds': {
      const gs = w.guilds?.guilds?.slice().sort((a, b) => b.points - a.points) ?? [];
      if (!gs.length) return voice('The guilds keep to themselves.');
      const [lead, second] = gs;
      const close = second && lead.points - second.points < Math.max(50, lead.points * 0.1);
      return voice(`${lead.name} leads season ${w.guilds.season} with ${lead.points.toLocaleString('en-US')} points${close ? `, but ${second.name} is close behind` : ''}. ${w.guilds.endsInDays} days left. Join one with G.`);
    }
    case 'self':
      return `${c.about} ${pick(['Not much else to tell.', 'And you? You look like a merchant on the rise.', 'Mind how you go.'])} (${c.temper}, ${c.age} years old)`;
  }
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
