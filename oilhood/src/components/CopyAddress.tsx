"use client";

import { useState } from "react";
import { tokens } from "@/config/site";
import { robinhood } from "@/lib/wagmi";

export function CopyAddress({ compact = false }: { compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  const address = tokens.oilhood;

  if (!address) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-dashed border-pipe bg-crude/60 px-4 py-3 font-mono text-sm text-smoke">
        <span className="label">CA</span> Contract address drops at launch
      </div>
    );
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(address!);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked: the address stays selectable */
    }
  }

  return (
    <div className="flex items-stretch overflow-hidden rounded-xl border border-pipe bg-crude/60">
      <span className="flex items-center px-3 label">CA</span>
      <code className="flex-1 select-all truncate py-3 font-mono text-sm text-sand">
        {compact ? `${address.slice(0, 10)}…${address.slice(-8)}` : address}
      </code>
      <a
        href={`${robinhood.blockExplorers.default.url}/token/${address}`}
        target="_blank"
        rel="noreferrer"
        className="flex items-center border-l border-pipe px-3 text-smoke transition hover:text-gold"
        aria-label="View on explorer"
      >
        ↗
      </a>
      <button onClick={copy} className="border-l border-pipe px-4 font-mono text-xs font-semibold uppercase text-gold transition hover:bg-gold/10">
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}
