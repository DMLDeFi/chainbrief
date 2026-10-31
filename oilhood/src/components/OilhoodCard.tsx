"use client";

import { useTokens } from "@/hooks/useData";
import { compact, num, usd } from "@/lib/format";
import { Change } from "./Change";
import { DemoBadge } from "./DemoBadge";
import { LogoMark } from "./Logo";

export function OilhoodCard({ wti }: { wti?: number }) {
  const { data } = useTokens();
  const t = data?.oilhood;
  const price = t?.priceUsd ?? null;
  return (
    <div className="panel panel-hover relative flex flex-col gap-3 overflow-hidden p-5">
      <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-gold/10 blur-3xl" />
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <LogoMark className="h-6 w-6" />
          <div>
            <p className="label">$OILHOOD</p>
            <p className="mt-0.5 text-sm text-smoke">Robinhood Chain</p>
          </div>
        </div>
        {!data?.configured.oilhood ? <DemoBadge>Pre-launch</DemoBadge> : price === null ? <DemoBadge>Indexing</DemoBadge> : null}
      </div>
      <div className="flex items-end justify-between">
        <p className="font-mono text-2xl font-semibold text-gold">{price !== null ? usd(price) : "TBA"}</p>
        <Change value={t?.change24h} className="text-sm" />
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-xs">
        <dt className="text-smoke">Mkt cap</dt><dd className="text-right">{compact(t?.marketCap, "$")}</dd>
        <dt className="text-smoke">24h vol</dt><dd className="text-right">{compact(t?.volume24h, "$")}</dd>
        <dt className="text-smoke">Holders</dt><dd className="text-right">{num(t?.holders, 0)}</dd>
        <dt className="text-smoke">Per barrel</dt>
        <dd className="text-right">{price && wti ? `${compact(wti / price)}` : "—"}</dd>
      </dl>
      {t?.url && (
        <a href={t.url} target="_blank" rel="noreferrer" className="font-mono text-[10px] uppercase tracking-wider text-smoke hover:text-gold">
          Chart on DexScreener ↗
        </a>
      )}
    </div>
  );
}
