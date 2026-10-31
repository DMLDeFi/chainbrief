"use client";

import { useQuery } from "@tanstack/react-query";
import type { MarketResponse, NewsItem, TokenResponse } from "@/lib/types";

async function get<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return res.json();
}

export function useMarket() {
  return useQuery({ queryKey: ["market"], queryFn: () => get<MarketResponse>("/api/market"), refetchInterval: 60_000 });
}

export function useTokens() {
  return useQuery({ queryKey: ["tokens"], queryFn: () => get<TokenResponse>("/api/token"), refetchInterval: 30_000 });
}

export function useNews() {
  return useQuery({
    queryKey: ["news"],
    queryFn: () => get<{ items: NewsItem[]; live: boolean }>("/api/news"),
    refetchInterval: 10 * 60_000,
  });
}
