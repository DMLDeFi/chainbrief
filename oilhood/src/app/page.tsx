import Link from "next/link";
import { faq, roadmap, site, tokenomics } from "@/config/site";
import { HeroLive } from "@/components/HeroLive";
import { BuyButton } from "@/components/BuyButton";
import { CopyAddress } from "@/components/CopyAddress";
import { LaunchCountdown } from "@/components/LaunchCountdown";
import { robinhood } from "@/lib/wagmi";

const FEATURES = [
  { icon: "📈", title: "Live oil terminal", body: "WTI, Brent, nat gas and gasoline next to tokenized USO and XOM — the oil complex on one screen." },
  { icon: "🛢", title: "Virtual Barrels", body: "Connect a wallet and see your $OILHOOD bag converted into barrels of crude at today's price." },
  { icon: "👛", title: "One portfolio", body: "$OILHOOD plus your tokenized energy stocks on Robinhood Chain, valued live. Read-only, nothing to sign." },
  { icon: "🔔", title: "Alerts & energy wire", body: "Set price alerts on crude or $OILHOOD and follow the latest energy headlines without leaving the page." },
  { icon: "🔥", title: "Fee & burn tracker", body: "Supply, burns and the creator fee wallet read straight from the chain, plus a public log of every fee spent." },
  { icon: "⚙️", title: "Virtual Rigs (soon)", body: "Hold $OILHOOD to activate a rig that earns points as oil moves. Phase 3 of the roadmap." },
];

const STEPS = [
  { t: "Get a wallet", b: "Any EVM wallet works — MetaMask, Rabby, Coinbase Wallet. Add Robinhood Chain (chain ID 4663) with one click from the Connect button." },
  { t: "Bridge ETH", b: "Gas on Robinhood Chain is paid in ETH. Bridge a small amount from Ethereum or another L2 using the official bridge." },
  { t: "Swap on Pons", b: "Open Pons, connect, paste the $OILHOOD contract address below, and swap ETH for $OILHOOD." },
  { t: "Check the Terminal", b: "Come back daily: oil price, your virtual barrels, and every move in one place." },
];

export default function Home() {
  return (
    <>
      {/* HERO */}
      <section className="relative overflow-hidden">
        <div className="oil-sheen pointer-events-none absolute inset-0" />
        <div className="grid-lines pointer-events-none absolute inset-0" />
        <div className="relative mx-auto grid max-w-7xl items-center gap-12 px-4 pb-20 pt-14 sm:px-6 lg:grid-cols-[1.15fr_1fr] lg:pt-24">
          <div className="animate-rise space-y-7">
            <span className="inline-flex items-center gap-2 rounded-full border border-gold/30 bg-gold/5 px-3 py-1 font-mono text-xs text-gold">
              Live on Robinhood Chain · ID {robinhood.id}
            </span>
            <h1 className="text-5xl font-bold leading-[1.02] tracking-tight sm:text-6xl lg:text-7xl">
              The oil of <span className="gold-text">the people.</span>
            </h1>
            <p className="max-w-xl text-lg text-smoke">
              {site.ticker} is the community energy token on Robinhood Chain — with a real Terminal you&apos;ll actually open:
              live crude, tokenized USO &amp; XOM, and your bag measured in barrels.
            </p>
            <div className="flex flex-wrap gap-3">
              <BuyButton />
              <Link href="/terminal" className="btn-ghost">Open Terminal</Link>
            </div>
            <LaunchCountdown />
            <div className="max-w-xl"><CopyAddress /></div>
          </div>
          <HeroLive />
        </div>
      </section>

      {/* NARRATIVE */}
      <section className="border-y border-pipe bg-well/50">
        <div className="mx-auto max-w-4xl px-4 py-20 text-center sm:px-6">
          <p className="label">The story</p>
          <p className="mt-6 text-2xl font-semibold leading-snug sm:text-3xl">
            Oil moved empires. Robinhood moved markets to the people. <span className="gold-text">OilHood</span> puts the world&apos;s most
            watched commodity in the same place as your on-chain bag — so every pump at the pump has a ticker.
          </p>
        </div>
      </section>

      {/* FEATURES */}
      <section className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
        <div className="max-w-2xl">
          <p className="label">Utility, not just a meme</p>
          <h2 className="mt-3 text-3xl font-bold sm:text-4xl">Built to be checked every day.</h2>
        </div>
        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="panel panel-hover p-6">
              <span className="text-2xl" aria-hidden>{f.icon}</span>
              <h3 className="mt-4 text-lg font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-smoke">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* TOKENOMICS */}
      <section id="tokenomics" className="mx-auto max-w-7xl scroll-mt-24 px-4 py-20 sm:px-6">
        <div className="panel oil-sheen grid gap-10 p-8 md:grid-cols-[1fr_1.4fr] md:p-12">
          <div>
            <p className="label">Tokenomics</p>
            <h2 className="mt-3 text-3xl font-bold sm:text-4xl">Simple. Fair. Fixed.</h2>
            <p className="mt-6 font-mono text-sm text-smoke">Total supply</p>
            <p className="font-mono text-4xl font-bold gold-text sm:text-5xl">{tokenomics.totalSupply}</p>
            <p className="mt-1 font-mono text-sm text-smoke">{site.ticker}</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {tokenomics.items.map((t) => (
              <div key={t.label} className="rounded-xl border border-pipe bg-crude/60 p-5">
                <p className="label">{t.label}</p>
                <p className="mt-2 font-mono text-2xl font-semibold text-sand">{t.value}</p>
                <p className="mt-1 text-sm text-smoke">{t.note}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* HOW TO BUY */}
      <section id="buy" className="mx-auto max-w-7xl scroll-mt-24 px-4 py-20 sm:px-6">
        <p className="label">How to buy</p>
        <h2 className="mt-3 text-3xl font-bold sm:text-4xl">Four steps to your first barrel.</h2>
        <ol className="mt-10 grid gap-4 md:grid-cols-4">
          {STEPS.map((s, i) => (
            <li key={s.t} className="panel relative p-6">
              <span className="font-mono text-5xl font-bold text-pipe">0{i + 1}</span>
              <h3 className="mt-3 text-lg font-semibold">{s.t}</h3>
              <p className="mt-2 text-sm leading-relaxed text-smoke">{s.b}</p>
            </li>
          ))}
        </ol>
        <div className="mt-8 flex flex-col gap-3 md:flex-row md:items-center">
          <div className="flex-1"><CopyAddress /></div>
          <BuyButton />
        </div>
      </section>

      {/* ROADMAP */}
      <section id="roadmap" className="mx-auto max-w-7xl scroll-mt-24 px-4 py-20 sm:px-6">
        <p className="label">Roadmap</p>
        <h2 className="mt-3 text-3xl font-bold sm:text-4xl">From wellhead to refinery.</h2>
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {roadmap.map((r) => (
            <div key={r.phase} className={`panel p-6 ${r.status === "live" ? "border-gold/40" : ""}`}>
              <div className="flex items-center justify-between">
                <span className="label">{r.phase}</span>
                <span className={`rounded-full px-2 py-0.5 font-mono text-[10px] uppercase ${r.status === "live" ? "bg-up/15 text-up" : r.status === "next" ? "bg-gold/15 text-gold" : "bg-pipe text-smoke"}`}>
                  {r.status}
                </span>
              </div>
              <h3 className="mt-3 text-xl font-semibold">{r.title}</h3>
              <ul className="mt-4 space-y-2 text-sm text-smoke">
                {r.items.map((it) => <li key={it} className="flex gap-2"><span className="text-gold">▸</span>{it}</li>)}
              </ul>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="mx-auto max-w-3xl scroll-mt-24 px-4 py-20 sm:px-6">
        <p className="label text-center">FAQ</p>
        <h2 className="mt-3 text-center text-3xl font-bold sm:text-4xl">Questions from the pump.</h2>
        <div className="mt-10 space-y-3">
          {faq.map((f) => (
            <details key={f.q} className="panel group p-5 [&_summary::-webkit-details-marker]:hidden">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold">
                {f.q}<span className="text-gold transition group-open:rotate-45">+</span>
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-smoke">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-7xl px-4 sm:px-6">
        <div className="panel oil-sheen flex flex-col items-center gap-6 px-6 py-16 text-center">
          <h2 className="max-w-2xl text-3xl font-bold sm:text-5xl">Fill your barrel.</h2>
          <p className="max-w-lg text-smoke">Join the drillers. Check oil, check your bag, every day.</p>
          <div className="flex flex-wrap justify-center gap-3">
            <BuyButton />
            {site.socials.x && <a href={site.socials.x} target="_blank" rel="noreferrer" className="btn-ghost">Follow on X</a>}
            {site.socials.telegram && <a href={site.socials.telegram} target="_blank" rel="noreferrer" className="btn-ghost">Telegram</a>}
          </div>
        </div>
      </section>
    </>
  );
}
