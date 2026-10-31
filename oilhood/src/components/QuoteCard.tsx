import type { Quote } from "@/lib/types";
import { usd } from "@/lib/format";
import { Sparkline } from "./Sparkline";
import { Change } from "./Change";
import { DemoBadge } from "./DemoBadge";

export function QuoteCard({ quote, label, note }: { quote?: Quote; label?: string; note?: string }) {
  if (!quote) return <div className="panel h-[168px] animate-pulse" />;
  const up = (quote.changePct ?? 0) >= 0;
  return (
    <div className="panel panel-hover flex flex-col gap-3 p-5">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="label">{label ?? quote.symbol}</p>
          <p className="mt-1 text-sm text-smoke">{quote.name}</p>
        </div>
        {quote.source === "demo" && <DemoBadge />}
      </div>
      <div className="flex items-end justify-between gap-2">
        <p className="font-mono text-2xl font-semibold tracking-tight text-sand">{usd(quote.price)}</p>
        <Change value={quote.changePct} className="text-sm" />
      </div>
      <Sparkline data={quote.history} up={up} className="h-10 w-full" />
      <p className="font-mono text-[10px] uppercase tracking-wider text-smoke/70">{note ?? quote.unit}</p>
    </div>
  );
}
