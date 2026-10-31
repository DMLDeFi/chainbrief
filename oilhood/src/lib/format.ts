export function usd(n: number | null | undefined, digits?: number) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const d = digits ?? (Math.abs(n) >= 1 ? 2 : n === 0 ? 2 : Math.min(10, Math.max(4, -Math.floor(Math.log10(Math.abs(n))) + 3)));
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: Math.min(d, 2), maximumFractionDigits: d }).format(n);
}

export function compact(n: number | null | undefined, prefix = "") {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return prefix + new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(n);
}

export function num(n: number | null | undefined, digits = 2) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: digits }).format(n);
}

export function pct(n: number | null | undefined) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${n > 0 ? "+" : ""}${n.toFixed(2)}%`;
}

export function shortAddr(a: string) {
  return `${a.slice(0, 6)}…${a.slice(-4)}`;
}

export function timeAgo(iso: string | null) {
  if (!iso) return "";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
