'use client';
import { useEffect, useState } from 'react';
import { api, type Me } from '@/lib/api';
import { disconnectWallet, nearConfig, sendContractCall, signInWithNear, viewContract, type NearConfig } from '@/lib/near';
import { refreshMe, toast } from '@/lib/store';
import { nearToYocto, yoctoToNear } from '@/lib/format';
import { Badge, Drawer, Empty } from '../../ui';
import { IconExternal, IconWallet } from '../../icons';

interface Deed { token_id: string; owner_id: string; kind: string; business_id: string; level: number; listed_price: string | null; sales: number }

export function WalletPanel({ me, onClose }: { me: Me; onClose: () => void }) {
  const [cfg, setCfg] = useState<NearConfig | null>(null);
  const [mine, setMine] = useState<Deed[] | null>(null);
  const [listed, setListed] = useState<Deed[] | null>(null);
  const [chainError, setChainError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [price, setPrice] = useState<Record<string, number>>({});
  const account = me.user.nearAccountId;

  const load = async () => {
    const c = await nearConfig();
    setCfg(c);
    if (!c.contractId) return;
    try {
      setListed(await viewContract<Deed[]>('listed_deeds', { limit: 50 }));
      if (account) setMine(await viewContract<Deed[]>('deeds_of', { account_id: account, limit: 50 }));
      setChainError(null);
    } catch (e) {
      setChainError((e as Error).message);
    }
  };
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [account]);

  const connect = async () => {
    setBusy(true);
    try {
      const { accountId } = await signInWithNear();
      toast(`Linked ${accountId}`, 'good');
      await refreshMe();
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  };

  const call = async (methodName: string, args: Record<string, unknown>, deposit: string, kind: string, ref: string) => {
    if (!cfg?.contractId) return;
    setBusy(true);
    try {
      const tx = await sendContractCall({ receiverId: cfg.contractId, methodName, args, deposit, gas: cfg.gas }, kind, ref);
      toast(`Transaction ${tx.status}${tx.error ? `: ${tx.error}` : ''}`, tx.status === 'success' ? 'good' : 'info');
      if (tx.status === 'success') await api('/near/sync', { body: {} }).catch(() => undefined);
      await Promise.all([load(), refreshMe()]);
    } catch (e) {
      toast((e as Error).message, 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer wide title="NEAR Wallet" subtitle="Ownership and settlement on NEAR Protocol" icon={<IconWallet />} onClose={onClose}>
      <div className="grid gap-4 md:grid-cols-[1fr_1.2fr]">
        <div className="space-y-4">
          <div className="rounded-xl border border-near/30 bg-near/5 p-4">
            <div className="label">Connected account</div>
            {account ? (
              <>
                <div className="num mt-1 break-all text-lg font-bold text-near">{account}</div>
                <p className="mt-1 text-xs text-muted">Verified with a NEP-413 signed message and an on-chain access-key check.</p>
                <button onClick={async () => { await disconnectWallet(); toast('Wallet session closed in this browser'); }} className="btn btn-ghost mt-3 px-3 py-1.5 text-xs">Disconnect wallet session</button>
              </>
            ) : (
              <>
                <p className="mt-1 text-sm text-parchment-dim">The game is fully playable without a wallet. Link one to mint business deeds, record achievements and trade deeds for NEAR.</p>
                <button disabled={busy} onClick={connect} className="btn btn-near mt-3 w-full py-2.5">Connect NEAR wallet</button>
              </>
            )}
          </div>
          <div className="panel p-4 text-sm">
            <div className="label mb-2">What lives on-chain</div>
            <ul className="space-y-1.5 text-parchment-dim">
              <li><b className="text-parchment">Business deeds</b> — minted with a server-signed certificate proving you own the business; the contract verifies it with ed25519.</li>
              <li><b className="text-parchment">Deed marketplace</b> — list and buy deeds for NEAR. Payment and ownership settle atomically; the game then moves the business to the buyer.</li>
              <li><b className="text-parchment">Achievement badges</b> — soulbound, certificate-verified.</li>
              <li><b className="text-parchment">Everything else</b> (hourly trades, production, AI decisions) stays off-chain so play is instant and free.</li>
            </ul>
          </div>
          <div className="panel p-4 text-xs text-muted">
            <div>Network: <b className="text-parchment">{cfg?.networkId ?? '…'}</b></div>
            <div>Contract: <b className="break-all text-parchment">{cfg?.contractId ?? 'not configured on this server'}</b></div>
            <div className="break-all">Game authority key: {cfg?.gameAuthority ?? '—'}</div>
          </div>
        </div>
        <div className="space-y-4">
          {!cfg?.contractId ? (
            <Empty>This server has no contract configured (NEAR_CONTRACT_ID). See the README for the two-command testnet deployment.</Empty>
          ) : chainError ? (
            <Empty>Could not reach NEAR RPC: {chainError}</Empty>
          ) : (
            <>
              <div>
                <div className="label mb-2">Your deeds</div>
                {!account ? <p className="text-sm text-muted">Connect a wallet to see your deeds.</p> : !mine?.length ? <Empty>No deeds yet — claim one from the Businesses panel.</Empty> : (
                  <div className="space-y-2">{mine.map((d) => (
                    <div key={d.token_id} className="rounded-xl border border-line/60 bg-black/20 p-3">
                      <div className="flex items-center justify-between"><span className="font-semibold capitalize">{d.kind} · Lv {d.level}</span>{d.listed_price ? <Badge tone="near">listed {yoctoToNear(d.listed_price)} Ⓝ</Badge> : <Badge tone="muted">not listed</Badge>}</div>
                      <div className="num text-[11px] text-muted">{d.token_id} · {d.sales} sale(s)</div>
                      <div className="mt-2 flex gap-2">
                        {d.listed_price ? (
                          <button disabled={busy} onClick={() => call('delist_deed', { token_id: d.token_id }, '0', 'deed_listing', d.token_id)} className="btn btn-ghost px-3 py-1 text-xs">Delist</button>
                        ) : (
                          <>
                            <input className="input num !w-28 !py-1" type="number" step="0.1" min={0.1} placeholder="NEAR" value={price[d.token_id] ?? ''} onChange={(e) => setPrice({ ...price, [d.token_id]: Number(e.target.value) })} />
                            <button disabled={busy || !(price[d.token_id] > 0)} onClick={() => call('list_deed', { token_id: d.token_id, price: nearToYocto(price[d.token_id]) }, '0', 'deed_listing', d.token_id)} className="btn btn-near px-3 py-1 text-xs">List for sale</button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}</div>
                )}
              </div>
              <div>
                <div className="label mb-2">Deeds for sale</div>
                {!listed?.length ? <Empty>No deeds are listed right now.</Empty> : (
                  <div className="space-y-2">{listed.map((d) => (
                    <div key={d.token_id} className="flex items-center gap-3 rounded-xl border border-line/60 bg-black/20 p-3">
                      <div className="flex-1"><div className="font-semibold capitalize">{d.kind} · Lv {d.level}</div><div className="num text-[11px] text-muted">owner {d.owner_id}</div></div>
                      <span className="num font-bold text-near">{yoctoToNear(d.listed_price)} Ⓝ</span>
                      {d.owner_id !== account && <button disabled={busy || !account} onClick={() => call('buy_deed', { token_id: d.token_id }, d.listed_price!, 'deed_purchase', d.token_id)} className="btn btn-near px-3 py-1 text-xs">Buy</button>}
                    </div>
                  ))}</div>
                )}
              </div>
              <a className="inline-flex items-center gap-1 text-xs text-near hover:underline" href={`${cfg.explorerTx.replace('/txns/', '/address/')}${cfg.contractId}`} target="_blank" rel="noreferrer">View contract on NearBlocks <IconExternal size={12} /></a>
            </>
          )}
        </div>
      </div>
    </Drawer>
  );
}
