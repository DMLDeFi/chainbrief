import { pct } from "@/lib/format";

export function Change({ value, className = "" }: { value: number | null | undefined; className?: string }) {
  if (value === null || value === undefined) return <span className={`font-mono text-smoke ${className}`}>—</span>;
  const up = value >= 0;
  return (
    <span className={`font-mono ${up ? "text-up" : "text-down"} ${className}`}>
      {up ? "▲" : "▼"} {pct(value)}
    </span>
  );
}
