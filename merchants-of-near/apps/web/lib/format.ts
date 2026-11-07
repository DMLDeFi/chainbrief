export const gold = (x: number | undefined | null) => (x == null ? '—' : Math.abs(x) >= 10000 ? `${(x / 1000).toFixed(1)}k` : Math.abs(x) >= 100 ? x.toFixed(0) : x.toFixed(2));
export const pct = (x: number) => `${x >= 0 ? '+' : ''}${(x * 100).toFixed(1)}%`;
export const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`;
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export function timeOfDay(h: number) {
  if (h < 5) return 'Night';
  if (h < 8) return 'Dawn';
  if (h < 12) return 'Morning';
  if (h < 17) return 'Afternoon';
  if (h < 20) return 'Dusk';
  return 'Night';
}
export const yoctoToNear = (y: string | null | undefined) => (y ? (Number(BigInt(y) / 10n ** 18n) / 1e6).toFixed(3) : '—');
export const nearToYocto = (n: number) => (BigInt(Math.round(n * 1e6)) * 10n ** 18n).toString();
