"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { useMarket, useTokens } from "@/hooks/useData";
import { alertsStore } from "@/lib/alertsStore";
import { usd } from "@/lib/format";

const ASSETS: Record<string, string> = { wti: "WTI", brent: "Brent", natgas: "Nat Gas", uso: "USO", xom: "XOM", oilhood: "$OILHOOD" };

/** Browser-side price alerts. Stored locally; fire while the Terminal is open. */
export function AlertsPanel() {
  const { data: market } = useMarket();
  const { data: tok } = useTokens();
  const { alerts, toast } = useSyncExternalStore(alertsStore.subscribe, alertsStore.get, alertsStore.getServer);
  const [asset, setAsset] = useState("wti");
  const [dir, setDir] = useState<"above" | "below">("above");
  const [target, setTarget] = useState("");

  const priceOf = (id: string) => (id === "oilhood" ? tok?.oilhood?.priceUsd ?? null : market?.quotes[id]?.price ?? null);

  useEffect(() => {
    if (!market || market.demo) return;
    let toastMsg: string | null = null;
    const next = alerts.map((a) => {
      const p = priceOf(a.asset);
      if (a.fired || p === null) return a;
      if ((a.dir === "above" && p >= a.target) || (a.dir === "below" && p <= a.target)) {
        const msg = `${ASSETS[a.asset]} is ${a.dir} ${usd(a.target)} — now ${usd(p)}`;
        toastMsg = msg;
        if (typeof Notification !== "undefined" && Notification.permission === "granted") new Notification("OilHood alert", { body: msg });
        return { ...a, fired: true };
      }
      return a;
    });
    if (toastMsg) alertsStore.set(() => ({ alerts: next, toast: toastMsg }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market, tok]);

  function add(e: React.FormEvent) {
    e.preventDefault();
    const t = Number(target);
    if (!t) return;
    alertsStore.set((s) => ({ ...s, alerts: [...s.alerts, { id: crypto.randomUUID(), asset, dir, target: t }] }));
    setTarget("");
    if (typeof Notification !== "undefined" && Notification.permission === "default") Notification.requestPermission().catch(() => {});
  }

  const current = priceOf(asset);

  return (
    <div className="panel flex h-full flex-col p-6">
      <p className="label">Price alerts</p>
      <form onSubmit={add} className="mt-4 grid grid-cols-2 gap-2">
        <select className="input !py-2.5" value={asset} onChange={(e) => setAsset(e.target.value)} aria-label="Asset">
          {Object.entries(ASSETS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className="input !py-2.5" value={dir} onChange={(e) => setDir(e.target.value as "above" | "below")} aria-label="Direction">
          <option value="above">rises above</option>
          <option value="below">falls below</option>
        </select>
        <input className="input !py-2.5" inputMode="decimal" placeholder={current ? usd(current) : "Target $"} value={target} onChange={(e) => setTarget(e.target.value.replace(/[^\d.]/g, ""))} aria-label="Target price" />
        <button className="btn-gold !py-2.5" type="submit">Add alert</button>
      </form>
      {toast && (
        <button onClick={() => alertsStore.set((s) => ({ ...s, toast: null }))} className="mt-3 rounded-lg border border-gold/50 bg-gold/10 px-3 py-2 text-left text-sm text-gold">
          🔔 {toast}
        </button>
      )}
      <ul className="mt-4 flex-1 space-y-2 font-mono text-sm">
        {alerts.length === 0 && <li className="text-xs text-smoke">No alerts yet. Alerts are saved in this browser.</li>}
        {alerts.map((a) => (
          <li key={a.id} className={`flex items-center justify-between rounded-lg border border-pipe px-3 py-2 ${a.fired ? "opacity-50" : ""}`}>
            <span>{ASSETS[a.asset]} {a.dir === "above" ? "≥" : "≤"} {usd(a.target)} {a.fired && <span className="text-up">✓</span>}</span>
            <button className="text-smoke hover:text-down" aria-label="Remove alert" onClick={() => alertsStore.set((s) => ({ ...s, alerts: s.alerts.filter((x) => x.id !== a.id) }))}>✕</button>
          </li>
        ))}
      </ul>
      {market?.demo && <p className="mt-3 text-[11px] text-amber">Alerts pause while the feed is in demo mode.</p>}
    </div>
  );
}
