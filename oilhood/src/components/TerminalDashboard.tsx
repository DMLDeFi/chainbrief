"use client";

import { useMarket, useTokens } from "@/hooks/useData";
import { usd } from "@/lib/format";
import { tokens } from "@/config/site";
import { QuoteCard } from "./QuoteCard";
import { OilhoodCard } from "./OilhoodCard";
import { Sparkline } from "./Sparkline";
import { Change } from "./Change";
import { DemoBadge, LiveDot } from "./DemoBadge";
import { BarrelsCalculator } from "./BarrelsCalculator";
import { Portfolio } from "./Portfolio";
import { AlertsPanel } from "./AlertsPanel";
import { NewsFeed } from "./NewsFeed";
import { FeeTracker } from "./FeeTracker";
import { CopyAddress } from "./CopyAddress";
import { BuyButton } from "./BuyButton";

export function TerminalDashboard() {
  const { data: market, dataUpdatedAt } = useMarket();
  const { data: tok } = useTokens();
  const q = market?.quotes;
  const wti = q?.wti;
  const spread = q?.brent && wti ? q.brent.price - wti.price : null;

  return (
    <div className="mx-auto max-w-7xl space-y-6 px-4 py-8 sm:px-6 lg:py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label flex items-center gap-2">
            {market && !market.demo ? <LiveDot /> : null} OilHood Terminal · Robinhood Chain
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">The daily oil check.</h1>
        </div>
        <div className="flex items-center gap-3 font-mono text-xs text-smoke">
          {market?.demo && <DemoBadge>Live feed unavailable — showing demo data</DemoBadge>}
          {dataUpdatedAt > 0 && <span>Updated {new Date(dataUpdatedAt).toLocaleTimeString()}</span>}
        </div>
      </div>

      {/* WTI hero */}
      <section className="panel oil-sheen relative overflow-hidden p-6 md:p-8">
        <div className="grid gap-6 md:grid-cols-[auto_1fr] md:items-end">
          <div className="space-y-2">
            <p className="label">WTI crude · front month</p>
            <p className="font-mono text-5xl font-bold tracking-tight sm:text-6xl">
              {wti ? <span className="gold-text">{usd(wti.price)}</span> : <span className="inline-block h-14 w-56 animate-pulse rounded bg-rig" />}
            </p>
            <div className="flex flex-wrap items-center gap-4 font-mono text-sm">
              <Change value={wti?.changePct} />
              <span className="text-smoke">Prev {usd(wti?.previousClose)}</span>
              <span className="text-smoke">Brent–WTI {spread !== null ? usd(spread) : "—"}</span>
            </div>
          </div>
          <Sparkline data={wti?.history ?? []} className="h-28 w-full md:h-32" up={(wti?.changePct ?? 0) >= 0} />
        </div>
      </section>

      {/* Price grid */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <QuoteCard quote={q?.brent} label="BRENT" />
        <QuoteCard quote={q?.uso} label="USO" note={tokens.uso ? `Tokenized on Robinhood Chain · underlying ${tok?.uso?.priceUsd ? `· on-chain ${usd(tok.uso.priceUsd)}` : "NYSE Arca"}` : "Underlying (NYSE Arca) · tokenized on Robinhood Chain"} />
        <QuoteCard quote={q?.xom} label="XOM" note={tokens.xom ? `Tokenized on Robinhood Chain ${tok?.xom?.priceUsd ? `· on-chain ${usd(tok.xom.priceUsd)}` : ""}` : "Underlying (NYSE) · tokenized on Robinhood Chain"} />
        <OilhoodCard wti={wti?.price} />
        <QuoteCard quote={q?.natgas} label="NAT GAS" />
        <QuoteCard quote={q?.gasoline} label="RBOB" />
        <div className="panel flex flex-col justify-between gap-4 p-5 sm:col-span-2">
          <div>
            <p className="label">Get $OILHOOD</p>
            <p className="mt-2 text-sm text-smoke">Always verify the contract address before you swap.</p>
          </div>
          <CopyAddress compact />
          <BuyButton className="w-full" />
        </div>
      </section>

      <BarrelsCalculator wti={wti?.price} oilhoodPrice={tok?.oilhood?.priceUsd ?? null} />

      <section className="grid gap-4 lg:grid-cols-3">
        <Portfolio />
        <AlertsPanel />
        <NewsFeed />
      </section>

      <FeeTracker />
    </div>
  );
}
