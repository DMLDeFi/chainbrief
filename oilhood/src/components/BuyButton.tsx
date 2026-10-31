import { site } from "@/config/site";

export function BuyButton({ className = "", label = "Buy on Pons" }: { className?: string; label?: string }) {
  return (
    <a href={site.ponsUrl} target="_blank" rel="noreferrer" className={`btn-gold ${className}`}>
      <span aria-hidden>🛢</span> {label}
    </a>
  );
}
