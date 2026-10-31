"use client";

import Link from "next/link";
import { useMarket, useTokens } from "@/hooks/useData";
import { usd } from "@/lib/format";
import { Change } from "./Change";
import { Sparkline } from "./Sparkline";
import { DemoBadge, LiveDot } from "./DemoBadge";

export function HeroLive() {
  const { data } = useMarket();
  const { data: tok } = useTokens();
  const rows = [
    { k: "BRENT", q: data?.quotes.brent },
    { k: "USO", q: data?.quotes.uso },
    { k: "XOM", q: data?.quotes.xom },
  ];
  const wti = data?.quotes.wti;
  return (
    <div className="panel relative animate-rise overflow-hidden p-5 [animation-delay:150ms] sm:p-6">
      <div className="flex items-center justify-between">
        <p className="label flex items-center gap-2">{data && !data.demo && <LiveDot />} Terminal preview</p>
        {data?.demo && <DemoBadge />}
      </div>
      <div className="mt-4 flex items-end justify-between">
        <div>
          <p className="font-mono text-xs text-smoke">WTI / bbl</p>
          <p className="font-mono text-4xl font-bold">{wti ? <span className="gold-text">{usd(wti.price)}</span> : "—"}</p>
        </div>
        <Change value={wti?.changePct} />
      </div>
      <Sparkline data={wti?.history ?? []} up={(wti?.changePct ?? 0) >= 0} className="mt-3 h-20 w-full" />
      <div className="mt-4 divide-y divide-pipe border-t border-pipe font-mono text-sm">
        {rows.map(({ k, q }) => (
          <div key={k} className="flex items-center justify-between py-2.5">
            <span className="text-smoke">{k}</span>
            <span className="flex items-center gap-4"><span>{usd(q?.price)}</span><Change value={q?.changePct} className="w-20 text-right text-xs" /></span>
          </div>
        ))}
        <div className="flex items-center justify-between py-2.5">
          <span className="text-gold">$OILHOOD</span>
          <span>{tok?.oilhood?.priceUsd ? usd(tok.oilhood.priceUsd) : "Launching on Pons"}</span>
        </div>
      </div>
      <Link href="/terminal" className="btn-ghost mt-4 w-full">Open the full Terminal →</Link>
    </div>
  );
}
