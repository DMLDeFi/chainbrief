"use client";

import { useEffect, useRef, useState } from "react";
import { useMounted } from "@/hooks/useMounted";
import { useAccount, useConnect, useDisconnect, useSwitchChain } from "wagmi";
import { robinhood } from "@/lib/wagmi";
import { shortAddr } from "@/lib/format";

export function ConnectButton({ className = "" }: { className?: string }) {
  const { address, isConnected, chainId } = useAccount();
  const { connectors, connect, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain, isPending: switching } = useSwitchChain();
  const [open, setOpen] = useState(false);
  const mounted = useMounted();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  if (!mounted) return <button className={`btn-ghost ${className}`} disabled>Connect</button>;

  const wrongChain = isConnected && chainId !== robinhood.id;
  // EIP-6963 discovered wallets show by name; hide the generic "Injected" entry when a named one exists.
  const list = connectors.filter((c, _, all) => !(c.id === "injected" && all.some((o) => o.type === "injected" && o.id !== "injected")));

  return (
    <div className="relative" ref={ref}>
      {isConnected && address ? (
        wrongChain ? (
          <button className={`btn-gold ${className}`} disabled={switching} onClick={() => switchChain({ chainId: robinhood.id })}>
            {switching ? "Switching…" : "Switch to Robinhood Chain"}
          </button>
        ) : (
          <button className={`btn-ghost font-mono ${className}`} onClick={() => setOpen((o) => !o)}>
            <span className="h-2 w-2 rounded-full bg-up" /> {shortAddr(address)}
          </button>
        )
      ) : (
        <button className={`btn-ghost ${className}`} onClick={() => setOpen((o) => !o)} disabled={isPending}>
          {isPending ? "Connecting…" : "Connect wallet"}
        </button>
      )}

      {open && (
        <div className="panel absolute right-0 z-50 mt-2 w-64 animate-rise p-2">
          {isConnected ? (
            <>
              <p className="px-3 py-2 label">Connected · Robinhood Chain</p>
              <button
                className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-rig"
                onClick={() => navigator.clipboard?.writeText(address!).catch(() => {})}
              >
                Copy address
              </button>
              <button className="w-full rounded-lg px-3 py-2 text-left text-sm text-down hover:bg-rig" onClick={() => { disconnect(); setOpen(false); }}>
                Disconnect
              </button>
            </>
          ) : (
            <>
              <p className="px-3 py-2 label">Choose wallet</p>
              {list.map((c) => (
                <button
                  key={c.uid}
                  className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-rig"
                  onClick={() => connect({ connector: c, chainId: robinhood.id }, { onSuccess: () => setOpen(false) })}
                >
                  {c.icon ? (
                    // eslint-disable-next-line @next/next/no-img-element -- wallet icons are data URIs
                    <img src={c.icon} alt="" className="h-5 w-5 rounded" />
                  ) : <span className="h-5 w-5 rounded bg-pipe" />}
                  {c.id === "injected" ? "Browser wallet" : c.name}
                </button>
              ))}
              {error && <p className="px-3 py-2 text-xs text-down">{error.message.split("\n")[0]}</p>}
              <p className="px-3 pt-2 pb-1 text-[11px] text-smoke">Chain ID {robinhood.id} is added to your wallet automatically.</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
