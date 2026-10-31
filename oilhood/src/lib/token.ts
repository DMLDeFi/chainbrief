import type { Address } from "viem";
import { robinhood } from "viem/chains";
import { tokens } from "@/config/site";
import { cached, fetchWithTimeout } from "./cache";
import type { DexPair, TokenResponse } from "./types";

interface DexScreenerPair {
  chainId?: string;
  priceUsd?: string;
  priceChange?: { h24?: number };
  volume?: { h24?: number };
  liquidity?: { usd?: number };
  marketCap?: number;
  fdv?: number;
  url?: string;
  baseToken?: { address?: string };
}

/** Best (most liquid) DexScreener pair where the token is the base asset. */
async function dexPair(address: Address): Promise<DexPair | null> {
  try {
    const res = await fetchWithTimeout(`https://api.dexscreener.com/latest/dex/tokens/${address}`);
    const json = (await res.json()) as { pairs?: DexScreenerPair[] | null };
    const pairs = (json.pairs ?? []).filter(
      (p) => p.baseToken?.address?.toLowerCase() === address.toLowerCase() && p.priceUsd,
    );
    if (!pairs.length) return null;
    pairs.sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
    const p = pairs[0];
    return {
      priceUsd: Number(p.priceUsd),
      change24h: p.priceChange?.h24 ?? null,
      volume24h: p.volume?.h24 ?? null,
      liquidityUsd: p.liquidity?.usd ?? null,
      marketCap: p.marketCap ?? p.fdv ?? null,
      url: p.url ?? null,
    };
  } catch {
    return null;
  }
}

async function holders(address: Address): Promise<number | null> {
  try {
    const api = robinhood.blockExplorers.default.url;
    const res = await fetchWithTimeout(`${api}/api/v2/tokens/${address}/counters`);
    const json = (await res.json()) as { token_holders_count?: string };
    const n = Number(json.token_holders_count);
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

export function getTokens(): Promise<TokenResponse> {
  return cached("tokens", 30_000, async () => {
    const [oilhood, oilhoodHolders, uso, xom] = await Promise.all([
      tokens.oilhood ? dexPair(tokens.oilhood) : null,
      tokens.oilhood ? holders(tokens.oilhood) : null,
      tokens.uso ? dexPair(tokens.uso) : null,
      tokens.xom ? dexPair(tokens.xom) : null,
    ]);
    return {
      oilhood: oilhood || oilhoodHolders !== null
        ? {
            ...(oilhood ?? { priceUsd: null, change24h: null, volume24h: null, liquidityUsd: null, marketCap: null, url: null }),
            holders: oilhoodHolders,
          }
        : null,
      uso,
      xom,
      configured: { oilhood: !!tokens.oilhood, uso: !!tokens.uso, xom: !!tokens.xom },
      updatedAt: new Date().toISOString(),
    };
  });
}
