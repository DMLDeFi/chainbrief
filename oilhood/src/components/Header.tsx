"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Logo } from "./Logo";
import { ConnectButton } from "./ConnectButton";
import { BuyButton } from "./BuyButton";

const NAV = [
  { href: "/terminal", label: "Terminal" },
  { href: "/#tokenomics", label: "Tokenomics" },
  { href: "/#buy", label: "How to buy" },
  { href: "/#roadmap", label: "Roadmap" },
  { href: "/#faq", label: "FAQ" },
];

export function Header() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  return (
    <header className="sticky top-0 z-40 border-b border-pipe/70 bg-crude/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" aria-label="OilHood home"><Logo /></Link>
        <nav className="hidden items-center gap-1 md:flex">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className={`rounded-lg px-3 py-2 text-sm transition hover:text-gold ${path === n.href ? "text-gold" : "text-smoke"}`}
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <ConnectButton className="!px-3 !py-2 text-sm" />
          <BuyButton className="hidden !px-4 !py-2 text-sm sm:inline-flex" label="Buy" />
          <button className="rounded-lg p-2 text-smoke md:hidden" aria-label="Menu" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2"><path d={open ? "M6 6l12 12M18 6L6 18" : "M4 7h16M4 12h16M4 17h16"} /></svg>
          </button>
        </div>
      </div>
      {open && (
        <nav className="border-t border-pipe px-4 py-3 md:hidden">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} onClick={() => setOpen(false)} className="block rounded-lg px-3 py-3 text-sand hover:bg-rig">
              {n.label}
            </Link>
          ))}
          <BuyButton className="mt-2 w-full" />
        </nav>
      )}
    </header>
  );
}
