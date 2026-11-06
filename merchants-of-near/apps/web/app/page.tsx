'use client';
import Link from 'next/link';
import { useGame } from '@/lib/store';
import { RESOURCE_DEFS, RESOURCES } from '@/lib/catalog';
import { gold } from '@/lib/format';
import { TownCanvas } from '@/components/TownCanvas';
import { Delta } from '@/components/ui';
import { Logo, ResourceIcon } from '@/components/icons';

const AGENTS = [
  { name: 'Farmer John', role: 'Farmer', color: '#8fb35f', line: 'Holds grain when prices are low, floods the market at harvest, lays off hands in winter.' },
  { name: 'Baker Mara', role: 'Baker', color: '#e2a35a', line: 'Buys wheat only when bread margins clear her bar. Competes with the Golden Crust.' },
  { name: 'Smith Brunhild', role: 'Blacksmith', color: '#b8b0a6', line: 'Switches between tools and weapons by margin, borrows boldly to expand — and can go bust.' },
  { name: 'Trader Selene', role: 'Trader', color: '#6aa3c8', line: 'Runs caravans to Port Aurora when price gaps beat travel risk; remembers routes that burned her.' },
  { name: 'Banker Aldric', role: 'Banker', color: '#c6cfe0', line: 'Scores leverage, earnings and history. Lends to sound borrowers, refuses the rest, tightens after defaults.' },
];

export default function Landing() {
  const { world } = useGame();
  const m = world?.markets.nearhaven;
  return (
    <main className="relative">
      {/* Hero */}
      <section className="relative h-[92vh] min-h-[620px] overflow-hidden">
        <TownCanvas world={world} playerId={null} interactive={false} className="absolute inset-0 opacity-90" />
        <div className="absolute inset-0 bg-[radial-gradient(90%_70%_at_30%_45%,rgba(14,11,8,0.88),rgba(14,11,8,0.35)_60%,rgba(14,11,8,0.7))]" />
        <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-ink to-transparent" />
        <nav className="relative z-10 mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <div className="flex items-center gap-3"><Logo size={38} /><span className="display text-lg font-bold tracking-wider">Merchants of NEAR</span></div>
          <div className="flex items-center gap-2">
            <Link href="#how" className="hidden px-3 text-sm text-parchment-dim hover:text-parchment sm:block">How it works</Link>
            <Link href="#near" className="hidden px-3 text-sm text-parchment-dim hover:text-parchment sm:block">Why NEAR</Link>
            <Link href="/register" className="btn btn-ghost px-4 py-2 text-sm">Sign in</Link>
          </div>
        </nav>
        <div className="relative z-10 mx-auto flex h-[calc(100%-88px)] max-w-6xl flex-col justify-center px-6">
          <div className="max-w-2xl animate-rise">
            <span className="label text-brass">NEAR Hackathon 2026 · Economic strategy</span>
            <h1 className="display mt-4 text-5xl font-bold leading-[1.05] sm:text-6xl">A living economy<br /><span className="text-brass-bright">run by AI merchants.</span></h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-parchment-dim">Enter Nearhaven with 100 gold. Ten autonomous merchants farm, bake, forge, trade and lend — reacting to every harvest, shortage and trade you make. Build a trading empire and own it on NEAR.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/register" className="btn btn-gold px-6 py-3 text-base">Enter Nearhaven</Link>
              <Link href="/demo" className="btn btn-ghost px-6 py-3 text-base">Play the 3-minute demo</Link>
            </div>
            {world && <p className="mt-6 text-xs text-muted">Live now: day {world.day}, {world.season} · {world.population} citizens · {world.players} human merchant{world.players === 1 ? '' : 's'}</p>}
          </div>
        </div>
      </section>

      {/* Live ticker */}
      {m && (
        <div className="relative z-10 border-y border-line/60 bg-walnut/80 backdrop-blur">
          <div className="mx-auto flex max-w-6xl gap-6 overflow-x-auto px-6 py-3">
            {RESOURCES.map((r) => (
              <div key={r} className="flex shrink-0 items-center gap-2 text-sm">
                <ResourceIcon r={r} size={18} />
                <span className="text-parchment-dim">{RESOURCE_DEFS[r].label}</span>
                <span className="num font-bold">{gold(m.resources[r].price)}</span>
                <Delta value={(m.resources[r].price - m.resources[r].open) / m.resources[r].open} />
              </div>
            ))}
          </div>
        </div>
      )}

      <section className="mx-auto max-w-6xl px-6 py-24">
        <div className="grid gap-10 md:grid-cols-2">
          <div>
            <span className="label text-ember">The problem</span>
            <h2 className="display mt-3 text-3xl font-bold">Game economies are painted backdrops.</h2>
            <p className="mt-4 leading-relaxed text-parchment-dim">NPC shopkeepers sell fixed goods at fixed prices and never run out. Nothing you do ripples outward, so trading is arithmetic, not strategy. And whatever you build lives in one company&apos;s database, owned by nobody.</p>
          </div>
          <div>
            <span className="label text-moss">Our solution</span>
            <h2 className="display mt-3 text-3xl font-bold">Agents with balance sheets, assets with owners.</h2>
            <p className="mt-4 leading-relaxed text-parchment-dim">Every merchant in Nearhaven is an economic agent with its own gold, inventory, costs, personality and memory. Prices emerge from what they — and you — actually do. The businesses you build become deeds you hold in your own NEAR wallet.</p>
          </div>
        </div>
      </section>

      <section className="border-y border-line/50 bg-walnut/40">
        <div className="mx-auto max-w-6xl px-6 py-24">
          <span className="label text-brass">Why autonomous AI merchants matter</span>
          <h2 className="display mt-3 max-w-3xl text-3xl font-bold">They perceive, evaluate and act every in-game hour — and show their reasoning.</h2>
          <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            {AGENTS.map((a) => (
              <div key={a.name} className="panel p-5">
                <div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: a.color }} /><span className="label" style={{ color: a.color }}>{a.role}</span></div>
                <div className="display mt-2 text-lg font-bold">{a.name}</div>
                <p className="mt-2 text-sm leading-relaxed text-parchment-dim">{a.line}</p>
              </div>
            ))}
          </div>
          <p className="mt-6 max-w-3xl text-sm text-muted">Hybrid AI: a deterministic decision engine drives every economic choice, so the world keeps running with no API at all. When a Claude API key is configured, merchants also voice their reasoning in character — grounded strictly in their real state and decision log.</p>
        </div>
      </section>

      <section id="how" className="mx-auto max-w-6xl px-6 py-24">
        <span className="label text-river">How the economy works</span>
        <h2 className="display mt-3 text-3xl font-bold">One interconnected simulation.</h2>
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {[
            ['Price discovery', 'Each good is priced from the stock on the shelves and a demand-pressure term: price = base × (reference ÷ stock)^elasticity × pressure. Every unit you buy walks up the curve.'],
            ['Supply chains', 'Farmers grow wheat → bakers turn it into bread → citizens eat it. Miners feed the forge, livestock feeds the looms. A drought or a mine collapse ripples down every chain.'],
            ['A closed money loop', 'Gold circulates between citizens, merchants and the exchange. Wages flow back into households; the exchange can only pay out coin it holds; mission rewards come from market fees.'],
            ['Seasons, weather, events', 'Autumn harvests glut the granary, winter doubles firewood demand, storms ground the fleet. Festivals, bandits and royal commissions shift demand for days.'],
            ['Credit and failure', 'The banker lends against real risk. Merchants who miss payroll three days running go bankrupt, liquidate, and are replaced by a successor with guild capital.'],
            ['Two markets', 'Port Aurora runs its own regional economy six hours away. Price gaps open, and caravans — Selene’s and yours — close them.'],
          ].map(([t, d]) => (
            <div key={t} className="rounded-2xl border border-line/60 bg-black/20 p-6">
              <h3 className="display text-lg font-bold">{t}</h3>
              <p className="mt-2 text-sm leading-relaxed text-parchment-dim">{d}</p>
            </div>
          ))}
        </div>
      </section>

      <section id="near" className="border-y border-near/20 bg-[linear-gradient(180deg,rgba(0,236,151,0.05),transparent)]">
        <div className="mx-auto grid max-w-6xl gap-10 px-6 py-24 md:grid-cols-[1.1fr_1fr]">
          <div>
            <span className="label text-near">Why NEAR is necessary</span>
            <h2 className="display mt-3 text-3xl font-bold">Ownership that outlives the server.</h2>
            <p className="mt-4 leading-relaxed text-parchment-dim">Routine simulation stays off-chain so play is instant and free. The moments that matter — owning a business, selling it to another player, proving an achievement — settle on NEAR, where neither we nor anyone else can quietly revoke them.</p>
            <ul className="mt-6 space-y-3 text-sm text-parchment-dim">
              <li><b className="text-parchment">Wallet sign-in</b> with NEP-413 signed messages, checked against your on-chain access keys.</li>
              <li><b className="text-parchment">Business deeds</b> minted with a game-signed certificate the contract verifies with ed25519 — you can only deed what you really own.</li>
              <li><b className="text-parchment">Deed marketplace</b> settled atomically in NEAR; the game follows on-chain ownership and hands the business to the buyer.</li>
              <li><b className="text-parchment">Soulbound badges</b> for verifiable achievements. Every transaction is shown with its real status and a NearBlocks link — never faked.</li>
            </ul>
          </div>
          <div className="panel self-start p-6">
            <div className="label">What makes it different</div>
            <ol className="mt-4 space-y-4">
              {['NPCs are agents with money, not vending machines.', 'Your trades move real prices for everyone.', 'Merchants can win, borrow, fail and be replaced.', 'Every activity-feed line comes from a real state change.', 'Your empire is yours, on-chain, tradeable for NEAR.'].map((t, i) => (
                <li key={t} className="flex gap-3"><span className="display grid h-7 w-7 shrink-0 place-items-center rounded-full border border-brass/60 text-sm text-brass">{i + 1}</span><span className="pt-0.5 text-sm">{t}</span></li>
              ))}
            </ol>
            <Link href="/demo" className="btn btn-gold mt-6 w-full py-3">Try it now — no wallet needed</Link>
          </div>
        </div>
      </section>

      <footer className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-10 text-xs text-muted">
        <div className="flex items-center gap-2"><Logo size={22} /> Merchants of NEAR · original procedural art · NEAR testnet</div>
        <div>Built for the NEAR Hackathon 2026</div>
      </footer>
    </main>
  );
}
