"use client";

import { useMarket, useTokens } from "@/hooks/useData";
import { usd } from "@/lib/format";
import { Change } from "./Change";

export function Ticker() {
  const { data } = useMarket();
  const { data: tok } = useTokens();
  const items = [
    ...(data ? Object.values(data.quotes).map((q) => ({ k: q.symbol.replace("=F", ""), label: q.name, price: q.price, ch: q.changePct })) : []),
    ...(tok?.oilhood?.priceUsd ? [{ k: "OILHOOD", label: "$OILHOOD", price: tok.oilhood.priceUsd, ch: tok.oilhood.change24h }] : []),
  ];
  return (
    <div className="relative overflow-hidden border-b border-pipe bg-well text-xs" aria-label="Live energy prices">
      <div className="flex w-max animate-ticker gap-8 whitespace-nowrap px-4 py-2 hover:[animation-play-state:paused]">
        {(items.length ? [...items, ...items] : Array.from({ length: 12 }, () => null)).map((it, i) =>
          it ? (
            <span key={i} className="flex items-center gap-2 font-mono">
              <span className="text-gold">{it.k}</span>
              <span className="text-sand">{usd(it.price)}</span>
              <Change value={it.ch} />
            </span>
          ) : (
            <span key={i} className="h-3 w-32 animate-pulse rounded bg-rig" />
          ),
        )}
      </div>
      {data?.demo && (
        <span className="absolute right-0 top-0 bottom-0 flex items-center bg-well px-3 font-mono text-[10px] uppercase text-amber">demo feed</span>
      )}
    </div>
  );
}
