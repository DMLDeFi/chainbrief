"use client";

import { useAccount, useBalance } from "wagmi";
import { tokens } from "@/config/site";
import { useTokenBalances } from "@/hooks/useOnchain";
import { useMarket, useTokens } from "@/hooks/useData";
import { num, usd } from "@/lib/format";
import { robinhood } from "@/lib/wagmi";
import { ConnectButton } from "./ConnectButton";

export function Portfolio() {
  const { address, isConnected } = useAccount();
  const { data: market } = useMarket();
  const { data: tok } = useTokens();
  const eth = useBalance({ address, chainId: robinhood.id, query: { enabled: !!address } });
  const { balances } = useTokenBalances(address, [tokens.oilhood, tokens.uso, tokens.xom]);

  const rows = [
    { sym: "$OILHOOD", addr: tokens.oilhood, price: tok?.oilhood?.priceUsd ?? null },
    { sym: "USO", addr: tokens.uso, price: tok?.uso?.priceUsd ?? market?.quotes.uso?.price ?? null },
    { sym: "XOM", addr: tokens.xom, price: tok?.xom?.priceUsd ?? market?.quotes.xom?.price ?? null },
  ].map((r) => {
    const bal = r.addr ? balances[r.addr.toLowerCase()] ?? null : null;
    return { ...r, bal, value: bal !== null && r.price !== null ? bal * r.price : null };
  });
  const total = rows.reduce((s, r) => s + (r.value ?? 0), 0);
  const energy = rows.slice(1).reduce((s, r) => s + (r.value ?? 0), 0);

  return (
    <div className="panel flex h-full flex-col p-6">
      <div className="flex items-center justify-between">
        <p className="label">Portfolio</p>
        {isConnected && <span className="font-mono text-xs text-smoke">{num(eth.data ? Number(eth.data.value) / 1e18 : null, 4)} ETH</span>}
      </div>
      {!isConnected ? (
        <div className="flex flex-1 flex-col items-start justify-center gap-4 py-8">
          <p className="text-lg font-semibold">See $OILHOOD, USO and XOM in one place.</p>
          <p className="text-sm text-smoke">Connect a wallet on Robinhood Chain. Read-only: nothing is signed.</p>
          <ConnectButton />
        </div>
      ) : (
        <>
          <p className="mt-3 font-mono text-3xl font-semibold">{usd(total, 2)}</p>
          <p className="text-xs text-smoke">{total > 0 ? `${((energy / total) * 100).toFixed(0)}% in tokenized energy stocks` : "No tracked holdings yet"}</p>
          <div className="mt-5 divide-y divide-pipe font-mono text-sm">
            {rows.map((r) => (
              <div key={r.sym} className="flex items-center justify-between py-3">
                <span className={r.sym === "$OILHOOD" ? "text-gold" : ""}>{r.sym}</span>
                {r.addr ? (
                  <span className="text-right">
                    <span className="block">{num(r.bal, 4)}</span>
                    <span className="block text-xs text-smoke">{usd(r.value, 2)}</span>
                  </span>
                ) : (
                  <span className="text-xs text-smoke">contract not set</span>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
