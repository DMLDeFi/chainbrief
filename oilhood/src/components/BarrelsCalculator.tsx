"use client";

import { useState } from "react";
import { useAccount } from "wagmi";
import { tokens } from "@/config/site";
import { useTokenBalances } from "@/hooks/useOnchain";
import { compact, num, usd } from "@/lib/format";

const BARREL_LITERS = 158.987;

/** Converts an $OILHOOD position into "virtual barrels" at the live WTI price. */
export function BarrelsCalculator({ wti, oilhoodPrice }: { wti?: number; oilhoodPrice: number | null }) {
  const { address } = useAccount();
  const { balances } = useTokenBalances(address, [tokens.oilhood]);
  const walletBal = tokens.oilhood ? balances[tokens.oilhood.toLowerCase()] : null;

  const [amount, setAmount] = useState("1000000");
  const [manualPrice, setManualPrice] = useState("0.00001");
  const [mode, setMode] = useState<"wallet" | "manual">("wallet");
  const useWallet = mode === "wallet" && walletBal != null;

  const qty = useWallet && walletBal != null ? walletBal : Number(amount) || 0;
  const price = oilhoodPrice ?? (Number(manualPrice) || 0);
  const value = qty * price;
  const barrels = wti ? value / wti : 0;
  // Log scale so 0.1 barrels and 1,000 barrels both read visually.
  const fill = barrels > 0 ? Math.max(0.06, Math.min(1, Math.log10(1 + barrels * 10) / 4)) : 0;

  return (
    <div className="panel grid gap-6 p-6 md:grid-cols-[1fr_auto] md:p-8">
      <div className="space-y-5">
        <div>
          <p className="label">Virtual Barrels</p>
          <h2 className="mt-2 text-2xl font-bold sm:text-3xl">Your bag, measured in crude.</h2>
          <p className="mt-2 text-sm text-smoke">Value of your $OILHOOD ÷ live WTI price per barrel.</p>
        </div>

        {walletBal != null && (
          <div className="flex gap-2 font-mono text-xs">
            <button onClick={() => setMode("wallet")} className={`rounded-lg border px-3 py-1.5 ${useWallet ? "border-gold text-gold" : "border-pipe text-smoke"}`}>Wallet balance</button>
            <button onClick={() => setMode("manual")} className={`rounded-lg border px-3 py-1.5 ${!useWallet ? "border-gold text-gold" : "border-pipe text-smoke"}`}>What if…</button>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1.5">
            <span className="label">$OILHOOD amount</span>
            {useWallet && walletBal != null ? (
              <div className="input">{num(walletBal, 2)}</div>
            ) : (
              <input className="input" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ""))} />
            )}
          </label>
          <label className="space-y-1.5">
            <span className="label">$OILHOOD price (USD)</span>
            {oilhoodPrice !== null ? (
              <div className="input text-gold">{usd(oilhoodPrice)}</div>
            ) : (
              <input className="input" inputMode="decimal" value={manualPrice} onChange={(e) => setManualPrice(e.target.value.replace(/[^\d.]/g, ""))} />
            )}
          </label>
        </div>

        <div className="grid grid-cols-3 gap-3 border-t border-pipe pt-5 font-mono">
          <div><p className="label">Bag value</p><p className="mt-1 text-lg">{usd(value, 2)}</p></div>
          <div><p className="label">WTI / bbl</p><p className="mt-1 text-lg">{usd(wti)}</p></div>
          <div><p className="label">Liters</p><p className="mt-1 text-lg">{compact(barrels * BARREL_LITERS)}</p></div>
        </div>
      </div>

      <div className="flex flex-col items-center justify-center gap-3">
        <div className="relative h-52 w-36" aria-label={`${barrels.toFixed(2)} virtual barrels`}>
          <svg viewBox="0 0 120 170" className="absolute inset-0 h-full w-full">
            <defs>
              <clipPath id="barrel"><path d="M14 8h92c8 26 8 128 0 154H14C6 136 6 34 14 8Z" /></clipPath>
              <linearGradient id="crude" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopColor="#1b130a" /><stop offset=".5" stopColor="#3a2610" /><stop offset="1" stopColor="#1b130a" />
              </linearGradient>
            </defs>
            <g clipPath="url(#barrel)">
              <rect width="120" height="170" fill="#0e0e13" />
              <rect y={170 - 170 * fill} width="120" height={170 * fill} fill="url(#crude)" style={{ transition: "all .8s cubic-bezier(.2,.7,.2,1)" }} />
              <rect y={170 - 170 * fill} width="120" height="3" fill="#f5b83d" opacity=".8" style={{ transition: "all .8s cubic-bezier(.2,.7,.2,1)" }} />
            </g>
            <path d="M14 8h92c8 26 8 128 0 154H14C6 136 6 34 14 8Z" fill="none" stroke="#f5b83d" strokeWidth="2.5" />
            {[48, 122].map((y) => <path key={y} d={`M9 ${y}h102`} stroke="#f5b83d" strokeOpacity=".5" strokeWidth="2" />)}
          </svg>
          <span className="absolute left-1/2 top-0 h-3 w-3 -translate-x-1/2 animate-drip rounded-full bg-gold" />
        </div>
        <p className="font-mono text-4xl font-bold gold-text">{barrels >= 1000 ? compact(barrels) : num(barrels, 2)}</p>
        <p className="label">virtual barrels</p>
      </div>
    </div>
  );
}
