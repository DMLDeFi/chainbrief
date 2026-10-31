export function DemoBadge({ children = "Demo data" }: { children?: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-amber/40 bg-amber/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-amber">
      {children}
    </span>
  );
}

export function LiveDot() {
  return (
    <span className="relative inline-flex h-2 w-2">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-up opacity-60" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-up" />
    </span>
  );
}
