import { isAddress, type Address } from "viem";

function addr(value: string | undefined): Address | undefined {
  return value && isAddress(value) ? (value as Address) : undefined;
}

export const site = {
  name: "OilHood",
  ticker: "$OILHOOD",
  tagline: "The oil of the people on Robinhood Chain.",
  url: process.env.NEXT_PUBLIC_SITE_URL || "https://oilhood.xyz",
  ponsUrl: process.env.NEXT_PUBLIC_PONS_URL || "https://pons.family",
  socials: {
    x: process.env.NEXT_PUBLIC_X_URL || "",
    telegram: process.env.NEXT_PUBLIC_TELEGRAM_URL || "",
  },
  walletConnectProjectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "",
};

export const tokens = {
  oilhood: addr(process.env.NEXT_PUBLIC_OILHOOD_ADDRESS),
  uso: addr(process.env.NEXT_PUBLIC_USO_TOKEN_ADDRESS),
  xom: addr(process.env.NEXT_PUBLIC_XOM_TOKEN_ADDRESS),
};

const launch = process.env.NEXT_PUBLIC_LAUNCH_DATE ? new Date(process.env.NEXT_PUBLIC_LAUNCH_DATE) : null;
/** Pre-launch countdown target (ISO date with timezone, e.g. 2026-11-05T18:00:00Z). */
export const launchDate = launch && !isNaN(launch.getTime()) ? launch : null;

export const creatorWallet = addr(process.env.NEXT_PUBLIC_CREATOR_WALLET);

export const BURN_ADDRESSES: Address[] = [
  "0x000000000000000000000000000000000000dEaD",
  "0x0000000000000000000000000000000000000000",
];

/** Edit to match the launch. Pons launches are fair launches with fixed supply. */
export const tokenomics = {
  totalSupply: "1,000,000,000",
  items: [
    { label: "Fair launch on Pons", value: "100%", note: "No presale, no team allocation" },
    { label: "Buy / sell tax", value: "0%", note: "Only the standard Pons pool fee" },
    { label: "Creator fees", value: "Public", note: "Every use is logged in the fee tracker" },
    { label: "Contract", value: "Pons standard", note: "No mint function after launch" },
  ],
};

/**
 * Public log of what was done with creator fees. Add an entry each time you
 * buy back, burn, or fund development so holders can verify it on-chain.
 */
export const feeLog: { date: string; action: string; amount: string; tx?: string }[] = [];

export const roadmap = [
  {
    phase: "Phase 1",
    title: "Strike oil",
    status: "live" as const,
    items: ["Launch $OILHOOD on Pons", "OilHood Terminal: live WTI, Brent, USO, XOM", "Virtual Barrels calculator"],
  },
  {
    phase: "Phase 2",
    title: "Build the refinery",
    status: "next" as const,
    items: ["Wallet portfolio (OILHOOD + tokenized USO/XOM)", "Price alerts and energy news", "Creator fee and burn tracker"],
  },
  {
    phase: "Phase 3",
    title: "Virtual Rigs",
    status: "later" as const,
    items: ["Hold or stake $OILHOOD to activate a rig", "Rigs produce points based on real oil moves", "Leaderboard of top drillers"],
  },
];

export const faq = [
  {
    q: "What is a virtual barrel?",
    a: "The dollar value of your $OILHOOD divided by the current WTI crude price. It is a fun way to see your bag in oil terms, not a claim on real oil.",
  },
  {
    q: "Is OilHood backed by oil or affiliated with Robinhood?",
    a: "No. $OILHOOD is a community memecoin on Robinhood Chain. It is not backed by oil, not a security, and not affiliated with or endorsed by Robinhood Markets, Inc.",
  },
  {
    q: "Where does the oil data come from?",
    a: "Futures and ETF prices come from public market data feeds and are delayed. If a feed is unavailable the Terminal clearly labels prices as demo data.",
  },
  {
    q: "How do I buy?",
    a: "Get ETH on Robinhood Chain, connect your wallet on Pons, search $OILHOOD, and swap. Always check the contract address shown on this site.",
  },
];
