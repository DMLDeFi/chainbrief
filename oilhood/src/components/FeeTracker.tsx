"use client";

import { creatorWallet, feeLog, tokens } from "@/config/site";
import { useSupply } from "@/hooks/useOnchain";
import { compact, num, shortAddr } from "@/lib/format";
import { robinhood } from "@/lib/wagmi";

const explorer = robinhood.blockExplorers.default.url;

export function FeeTracker() {
  const { supply, burned, burnedPct, creatorEth } = useSupply(tokens.oilhood);
  return (
    <div className="panel p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="label">Transparency · fees &amp; burns</p>
        <span className="font-mono text-[10px] uppercase text-smoke">read live from chain {robinhood.id}</span>
      </div>
      <div className="mt-5 grid grid-cols-2 gap-4 font-mono md:grid-cols-4">
        <Stat label="Total supply" value={compact(supply)} />
        <Stat label="Burned" value={compact(burned)} sub={burnedPct !== null ? `${num(burnedPct, 3)}% of supply` : undefined} />
        <Stat label="Circulating" value={supply !== null && burned !== null ? compact(supply - burned) : "—"} />
        <Stat
          label="Creator fee wallet"
          value={creatorEth !== null ? `${num(creatorEth, 4)} ETH` : "—"}
          sub={creatorWallet ? shortAddr(creatorWallet) : "not set"}
          href={creatorWallet ? `${explorer}/address/${creatorWallet}` : undefined}
        />
      </div>
      {burnedPct !== null && (
        <div className="mt-5 h-2 overflow-hidden rounded-full bg-rig">
          <div className="h-full rounded-full bg-gradient-to-r from-flame to-gold" style={{ width: `${Math.max(0.5, Math.min(100, burnedPct))}%` }} />
        </div>
      )}
      <div className="mt-6">
        <p className="label mb-2">Fee usage log</p>
        {feeLog.length === 0 ? (
          <p className="text-sm text-smoke">Every buyback, burn or spend of creator fees will be listed here with its transaction.</p>
        ) : (
          <ul className="divide-y divide-pipe font-mono text-sm">
            {feeLog.map((f, i) => (
              <li key={i} className="flex flex-wrap justify-between gap-2 py-2">
                <span className="text-smoke">{f.date}</span>
                <span>{f.action}</span>
                <span className="text-gold">{f.amount}</span>
                {f.tx && <a className="text-smoke hover:text-gold" href={`${explorer}/tx/${f.tx}`} target="_blank" rel="noreferrer">tx ↗</a>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Stat({ label, value, sub, href }: { label: string; value: string; sub?: string; href?: string }) {
  const body = (
    <>
      <p className="label">{label}</p>
      <p className="mt-1 text-lg text-sand">{value}</p>
      {sub && <p className="text-xs text-smoke">{sub}</p>}
    </>
  );
  return href ? <a href={href} target="_blank" rel="noreferrer" className="block hover:text-gold">{body}</a> : <div>{body}</div>;
}
