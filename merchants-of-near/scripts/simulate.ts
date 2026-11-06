/** Headless economy run: prints daily prices and merchant health. `npm run sim -- 28` */
import { createWorld, advanceWorld, RESOURCES, merchantNetWorth } from '../packages/engine/src/index';
const days = Number(process.argv[2] ?? 28);
const w = createWorld(Number(process.argv[3] ?? 42));
for (let d = 1; d <= days; d++) {
  advanceWorld(w, 24);
  const m = w.markets.nearhaven;
  console.log(`day ${String(d).padStart(2)} ${w.season.padEnd(6)} ${w.weather.padEnd(8)} pop ${w.population} tr ${Math.round(m.treasury)} guild ${Math.round(w.guildTreasury)} | ` + RESOURCES.map((r) => `${r.slice(0, 4)} ${m.price[r].toFixed(1)}/${Math.round(m.stock[r])}`).join(' '));
}
console.log('\nmerchants:');
for (const m of Object.values(w.merchants)) console.log(`${m.name.padEnd(18)} ${m.status.padEnd(10)} gold ${m.gold.toFixed(0).padStart(6)} nw ${merchantNetWorth(w, m).toFixed(0).padStart(6)} workers ${m.workers} trades ${m.stats.trades}`);
console.log('\nfeed tail:');
for (const f of w.feed.slice(-25)) console.log(`[${f.kind}] ${f.text}`);
console.log('guild', w.guildTreasury.toFixed(0), 'loans', Object.values(w.loans).map((l) => `${l.borrower.id}:${l.status}`).join(' '));
