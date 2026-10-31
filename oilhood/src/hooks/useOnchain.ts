"use client";

import { erc20Abi, formatUnits, zeroAddress, type Address } from "viem";
import { useBalance, useReadContracts } from "wagmi";
import { BURN_ADDRESSES, creatorWallet } from "@/config/site";
import { robinhood } from "@/lib/wagmi";

/** Balance of one ERC-20 for an account, as a float. */
export function useTokenBalances(account: Address | undefined, list: (Address | undefined)[]) {
  const targets = list.filter((a): a is Address => !!a);
  const { data, isLoading } = useReadContracts({
    allowFailure: true,
    contracts: account
      ? targets.flatMap((address) => [
          { address, abi: erc20Abi, functionName: "balanceOf", args: [account], chainId: robinhood.id } as const,
          { address, abi: erc20Abi, functionName: "decimals", chainId: robinhood.id } as const,
        ])
      : [],
    query: { enabled: !!account && targets.length > 0, refetchInterval: 30_000 },
  });

  const balances: Record<string, number | null> = {};
  targets.forEach((address, i) => {
    const bal = data?.[i * 2]?.result as bigint | undefined;
    const dec = data?.[i * 2 + 1]?.result as number | undefined;
    balances[address.toLowerCase()] = bal !== undefined && dec !== undefined ? Number(formatUnits(bal, dec)) : null;
  });
  return { balances, isLoading };
}

/** Total supply, burned amount, and creator wallet ETH for the transparency tracker. */
export function useSupply(token: Address | undefined) {
  const address = token ?? zeroAddress;
  const { data } = useReadContracts({
    allowFailure: true,
    contracts: [
      { address, abi: erc20Abi, functionName: "totalSupply", chainId: robinhood.id },
      { address, abi: erc20Abi, functionName: "decimals", chainId: robinhood.id },
      { address, abi: erc20Abi, functionName: "balanceOf", args: [BURN_ADDRESSES[0]], chainId: robinhood.id },
      { address, abi: erc20Abi, functionName: "balanceOf", args: [BURN_ADDRESSES[1]], chainId: robinhood.id },
    ],
    query: { enabled: !!token, refetchInterval: 60_000 },
  });
  const creator = useBalance({
    address: creatorWallet,
    chainId: robinhood.id,
    query: { enabled: !!creatorWallet, refetchInterval: 60_000 },
  });

  const dec = data?.[1]?.result as number | undefined;
  const toNum = (v: unknown) => (typeof v === "bigint" && dec !== undefined ? Number(formatUnits(v, dec)) : null);
  const supply = toNum(data?.[0]?.result);
  const burnedParts = (data ?? []).slice(2).map((r) => toNum(r.result));
  const burned = burnedParts.some((v) => v !== null) ? burnedParts.reduce<number>((s, v) => s + (v ?? 0), 0) : null;

  return {
    supply,
    burned,
    burnedPct: supply && burned !== null ? (burned / supply) * 100 : null,
    creatorEth: creator.data ? Number(formatUnits(creator.data.value, creator.data.decimals)) : null,
  };
}
