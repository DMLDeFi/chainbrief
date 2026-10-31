import Link from "next/link";
import { site } from "@/config/site";
import { robinhood } from "@/lib/wagmi";
import { Logo } from "./Logo";

export function Footer() {
  return (
    <footer className="mt-24 border-t border-pipe bg-well/60">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr]">
        <div className="space-y-4">
          <Logo />
          <p className="max-w-sm text-sm text-smoke">{site.tagline}</p>
        </div>
        <div className="space-y-2 text-sm">
          <p className="label mb-3">Product</p>
          <Link href="/terminal" className="block text-smoke hover:text-gold">OilHood Terminal</Link>
          <a href={site.ponsUrl} target="_blank" rel="noreferrer" className="block text-smoke hover:text-gold">Buy on Pons</a>
          <a href={robinhood.blockExplorers.default.url} target="_blank" rel="noreferrer" className="block text-smoke hover:text-gold">Robinhood Chain explorer</a>
        </div>
        <div className="space-y-2 text-sm">
          <p className="label mb-3">Community</p>
          {site.socials.x && <a href={site.socials.x} target="_blank" rel="noreferrer" className="block text-smoke hover:text-gold">X / Twitter</a>}
          {site.socials.telegram && <a href={site.socials.telegram} target="_blank" rel="noreferrer" className="block text-smoke hover:text-gold">Telegram</a>}
          {!site.socials.x && !site.socials.telegram && <p className="text-smoke">Socials go live at launch.</p>}
        </div>
      </div>
      <div className="border-t border-pipe">
        <p className="mx-auto max-w-7xl px-4 py-6 text-xs leading-relaxed text-smoke/80 sm:px-6">
          $OILHOOD is a community memecoin with no intrinsic value or expectation of financial return. It is not backed by oil or
          any commodity, is not a security, and is not affiliated with, endorsed by, or sponsored by Robinhood Markets, Inc.
          &quot;Virtual barrels&quot; are an illustration only. Market data is delayed, may be inaccurate, and is not investment
          advice. Crypto is highly volatile — only use what you can afford to lose.
        </p>
      </div>
    </footer>
  );
}
