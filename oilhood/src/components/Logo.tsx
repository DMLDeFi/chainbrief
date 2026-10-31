export function LogoMark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <defs>
        <linearGradient id="oh-g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffe3a3" />
          <stop offset="0.5" stopColor="#f5b83d" />
          <stop offset="1" stopColor="#ff8a1f" />
        </linearGradient>
      </defs>
      <path d="M16 2.5c5.6 7 9.5 12.4 9.5 17a9.5 9.5 0 0 1-19 0c0-4.6 3.9-10 9.5-17Z" fill="url(#oh-g)" />
      <path d="M11 20.5c.4 2.6 2.5 4.5 5 4.8" stroke="#07070a" strokeWidth="2" strokeLinecap="round" fill="none" opacity=".55" />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="flex items-center gap-2">
      <LogoMark />
      <span className="text-lg font-bold tracking-tight">
        Oil<span className="gold-text">Hood</span>
      </span>
    </span>
  );
}
