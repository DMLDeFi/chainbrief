export type QuoteSource = "yahoo" | "stooq" | "demo";

export interface Quote {
  id: string;
  symbol: string;
  name: string;
  unit: string;
  price: number;
  previousClose: number | null;
  change: number | null;
  changePct: number | null;
  history: number[];
  source: QuoteSource;
  updatedAt: string;
}

export interface MarketResponse {
  quotes: Record<string, Quote>;
  demo: boolean;
  updatedAt: string;
}

export interface NewsItem {
  title: string;
  link: string;
  source: string;
  publishedAt: string | null;
}

export interface DexPair {
  priceUsd: number | null;
  change24h: number | null;
  volume24h: number | null;
  liquidityUsd: number | null;
  marketCap: number | null;
  url: string | null;
}

export interface TokenResponse {
  oilhood: (DexPair & { holders: number | null }) | null;
  uso: DexPair | null;
  xom: DexPair | null;
  configured: { oilhood: boolean; uso: boolean; xom: boolean };
  updatedAt: string;
}
