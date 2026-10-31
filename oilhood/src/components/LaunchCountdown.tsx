"use client";

import { useEffect, useState } from "react";
import { launchDate, tokens } from "@/config/site";
import { useMounted } from "@/hooks/useMounted";

const UNITS = [
  ["days", 86_400_000],
  ["hrs", 3_600_000],
  ["min", 60_000],
  ["sec", 1000],
] as const;

/** Pre-launch countdown; hides itself once the contract address is set or the date passes. */
export function LaunchCountdown() {
  const mounted = useMounted();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!mounted || !launchDate || tokens.oilhood) return null;
  const left = launchDate.getTime() - now;
  if (left <= 0) return null;
  const parts = UNITS.map(([label, ms], i) => {
    const bigger = i ? UNITS[i - 1][1] : Infinity;
    return [label, Math.floor((left % bigger) / ms)] as const;
  });

  return (
    <div className="max-w-xl">
      <p className="label mb-2">Launching on Pons in</p>
      <div className="grid grid-cols-4 gap-2">
        {parts.map(([label, v]) => {
          return (
            <div key={label} className="rounded-xl border border-gold/30 bg-gold/5 px-2 py-3 text-center">
              <p className="font-mono text-2xl font-bold text-gold sm:text-3xl">{String(v).padStart(2, "0")}</p>
              <p className="label !text-[10px]">{label}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
