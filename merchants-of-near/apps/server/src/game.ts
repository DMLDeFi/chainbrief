import {
  addRoute,
  assignBusiness,
  bankDeposit,
  cancelOffer,
  dissolveSubsidiary,
  foundSubsidiary,
  makeOffer,
  respondToOffer,
  setCompanyName,
  fundProject,
  INFRA_KINDS,
  type InfraKind,
  RESOURCES,
  BUSINESS_DEFS,
  removeRoute,
  toggleRoute,
  type BusinessKind,
  buyLand,
  sellBusiness,
  sellLand,
  MARKETS,
  charterCity,
  migrateWorld,
  shipGoods,
  advanceWorld,
  buyBusiness,
  buyListing,
  cancelListing,
  claimMission,
  collectFromBusiness,
  createListing,
  createWorld,
  divestFromMerchant,
  evaluateProgression,
  expandWarehouse,
  fireWorker,
  hireWorker,
  investInMerchant,
  playerTrade,
  proposeDeal,
  publicSnapshot,
  registerPlayer,
  repayLoan,
  requestLoan,
  setBusinessPolicy,
  stepWorld,
  upgradeBusiness,
  type Result,
  type WorldState,
} from '@mon/engine';
import { z } from 'zod';
import type { Store } from './store/types';

const resource = z.enum(RESOURCES);
const id = z.string().min(1).max(64);
const qty = z.number().int().min(1).max(500);
const gold = z.number().positive().max(100000);
const city = z.enum(MARKETS);

/** Every player action is validated against this schema before it reaches the engine. */
export const ActionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('trade'), side: z.enum(['buy', 'sell']), resource, qty, market: city.optional(), limitPrice: z.number().positive().optional() }),
  z.object({ type: z.literal('business.buy'), kind: z.enum(Object.keys(BUSINESS_DEFS) as [BusinessKind, ...BusinessKind[]]), city: city.optional() }),
  z.object({ type: z.literal('route.add'), from: city, to: city, resource, batch: z.number().int().min(5).max(500), keep: z.number().int().min(0).max(5000).optional() }),
  z.object({ type: z.literal('route.remove'), routeId: id }),
  z.object({ type: z.literal('company.name'), name: z.string().min(3).max(32) }),
  z.object({ type: z.literal('company.found'), name: z.string().min(3).max(32) }),
  z.object({ type: z.literal('company.dissolve'), companyId: id }),
  z.object({ type: z.literal('company.assign'), businessId: id, companyId: id.nullable() }),
  z.object({ type: z.literal('offer.make'), businessId: id, price: z.number().int().min(10).max(1_000_000) }),
  z.object({ type: z.literal('offer.respond'), offerId: id, accept: z.boolean() }),
  z.object({ type: z.literal('offer.cancel'), offerId: id }),
  z.object({ type: z.literal('bank.deposit'), businessId: id, amount: z.number().int().min(-1_000_000).max(1_000_000) }),
  z.object({ type: z.literal('city.fund'), city, project: z.enum(INFRA_KINDS as [InfraKind, ...InfraKind[]]), amount: z.number().int().min(10).max(100000) }),
  z.object({ type: z.literal('route.toggle'), routeId: id, active: z.boolean() }),
  z.object({ type: z.literal('business.sell'), businessId: id }),
  z.object({ type: z.literal('land.buy'), city }),
  z.object({ type: z.literal('land.sell'), city }),
  z.object({ type: z.literal('business.hire'), businessId: id }),
  z.object({ type: z.literal('business.fire'), businessId: id }),
  z.object({ type: z.literal('business.upgrade'), businessId: id }),
  z.object({ type: z.literal('business.collect'), businessId: id }),
  z.object({
    type: z.literal('business.policy'),
    businessId: id,
    policy: z.object({ autoBuyInputs: z.boolean().optional(), autoSell: z.boolean().optional(), supplyFromStore: z.boolean().optional(), autoCollect: z.boolean().optional(), recipe: z.string().min(1).max(40).optional(), minSellPrice: z.number().min(0).max(10000).optional(), product: resource.optional() }),
  }),
  z.object({ type: z.literal('warehouse.expand') }),
  z.object({ type: z.literal('invest'), merchantId: id, amount: gold }),
  z.object({ type: z.literal('divest'), merchantId: id }),
  z.object({ type: z.literal('loan.request'), amount: gold }),
  z.object({ type: z.literal('loan.repay'), loanId: id, amount: gold }),
  z.object({ type: z.literal('listing.create'), resource, qty, unitPrice: gold }),
  z.object({ type: z.literal('listing.cancel'), listingId: id }),
  z.object({ type: z.literal('listing.buy'), listingId: id }),
  z.object({ type: z.literal('deal'), merchantId: id, side: z.enum(['buy', 'sell']), resource, qty: z.number().int().min(1).max(200), unitPrice: gold }),
  z.object({ type: z.literal('mission.claim'), missionId: id }),
  z.object({ type: z.literal('city.charter'), city }),
  z.object({ type: z.literal('ship'), from: city, to: city, resource, qty }),
]);
export type Action = z.infer<typeof ActionSchema>;

type Listener = (msg: unknown) => void;

/**
 * GameService owns the single authoritative WorldState. All mutations (ticks,
 * fast-forward, player actions) run synchronously on Node's single thread, so
 * each one is atomic with respect to every other: no interleaving, no partial
 * writes. The engine validates before it mutates, and the ledger it emits is
 * flushed to the store after each mutation.
 */
export class GameService {
  world!: WorldState;
  private timer?: NodeJS.Timeout;
  private listeners = new Set<Listener>();
  private lastFeedId = 0;
  private dirty = false;
  private saving = false;

  constructor(private store: Store, private opts: { seed: number; tickMs: number }) {}

  async init(): Promise<void> {
    const saved = await this.store.loadWorld();
    // Saves from before the multi-city world gain the new cities, depots and route state.
    this.world = saved ? migrateWorld(saved) : createWorld(this.opts.seed);
    this.world.ledger = [];
    this.lastFeedId = this.world.feed.at(-1)?.id ?? 0;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(1), this.opts.tickMs);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.persist(true);
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private broadcast(): void {
    const snap = publicSnapshot(this.world, this.lastFeedId);
    this.lastFeedId = this.world.feed.at(-1)?.id ?? this.lastFeedId;
    const msg = { type: 'snapshot', data: snap };
    for (const l of this.listeners) l(msg);
  }

  tick(n: number): void {
    if (n === 1) stepWorld(this.world);
    else advanceWorld(this.world, n);
    this.dirty = true;
    this.broadcast();
    void this.persist(this.world.tick % 24 === 0);
  }

  /** Fast-forward the shared world by whole days. */
  fastForward(days: number): { fromTick: number; toTick: number; feed: number } {
    const fromTick = this.world.tick;
    const before = this.world.nextFeedId;
    this.tick(days * 24);
    void this.persist(true); // a jump can skip the periodic save points
    return { fromTick, toTick: this.world.tick, feed: this.world.nextFeedId - before };
  }

  /** Persist ledger entries (always) and the world snapshot (when forced or periodically). */
  async persist(snapshot = false): Promise<void> {
    const entries = this.world.ledger.splice(0, this.world.ledger.length);
    if (entries.length) await this.store.appendLedger(entries).catch((e) => console.error('ledger flush failed', e));
    if ((snapshot || this.dirty) && !this.saving) {
      if (!snapshot && this.world.tick % 12 !== 0) return;
      this.saving = true;
      try {
        await this.store.saveWorld(this.world);
        this.dirty = false;
      } catch (e) {
        console.error('world save failed', e);
      } finally {
        this.saving = false;
      }
    }
  }

  ensurePlayer(userId: string, name: string): Result<unknown> {
    if (this.world.players[userId]) return { ok: true, data: this.world.players[userId] };
    const r = registerPlayer(this.world, userId, name);
    void this.persist(true);
    return r;
  }

  /** Apply a validated player action. Only the authenticated user's own state can be targeted. */
  apply(userId: string, action: Action): Result<unknown> {
    const w = this.world;
    const p = w.players[userId];
    if (!p) return { ok: false, error: 'No merchant profile' };
    let r: Result<unknown>;
    switch (action.type) {
      case 'trade':
        r = playerTrade(w, userId, action);
        break;
      case 'city.charter':
        r = charterCity(w, userId, action.city);
        break;
      case 'ship':
        r = shipGoods(w, userId, action);
        break;
      case 'business.buy':
        r = buyBusiness(w, userId, action.kind, action.city ?? 'nearhaven');
        break;
      case 'company.name':
        r = setCompanyName(w, userId, action.name);
        break;
      case 'company.found':
        r = foundSubsidiary(w, userId, action.name);
        break;
      case 'company.dissolve':
        r = dissolveSubsidiary(w, userId, action.companyId);
        break;
      case 'company.assign':
        r = assignBusiness(w, userId, action.businessId, action.companyId);
        break;
      case 'offer.make':
        r = makeOffer(w, userId, action);
        break;
      case 'offer.respond':
        r = respondToOffer(w, userId, action.offerId, action.accept);
        break;
      case 'offer.cancel':
        r = cancelOffer(w, userId, action.offerId);
        break;
      case 'bank.deposit':
        r = bankDeposit(w, userId, action.businessId, action.amount);
        break;
      case 'city.fund':
        r = fundProject(w, userId, action);
        break;
      case 'route.add':
        r = addRoute(w, userId, action);
        break;
      case 'route.remove':
        r = removeRoute(w, userId, action.routeId);
        break;
      case 'route.toggle':
        r = toggleRoute(w, userId, action.routeId, action.active);
        break;
      case 'business.sell':
        r = sellBusiness(w, userId, action.businessId);
        break;
      case 'land.buy':
        r = buyLand(w, userId, action.city);
        break;
      case 'land.sell':
        r = sellLand(w, userId, action.city);
        break;
      case 'business.hire':
        r = hireWorker(w, userId, action.businessId);
        break;
      case 'business.fire':
        r = fireWorker(w, userId, action.businessId);
        break;
      case 'business.upgrade':
        r = upgradeBusiness(w, userId, action.businessId);
        break;
      case 'business.collect':
        r = collectFromBusiness(w, userId, action.businessId);
        break;
      case 'business.policy':
        r = setBusinessPolicy(w, userId, action.businessId, action.policy);
        break;
      case 'warehouse.expand':
        r = expandWarehouse(w, userId);
        break;
      case 'invest':
        r = investInMerchant(w, userId, action.merchantId, action.amount);
        break;
      case 'divest':
        r = divestFromMerchant(w, userId, action.merchantId);
        break;
      case 'loan.request':
        r = requestLoan(w, { kind: 'player', id: userId }, action.amount);
        break;
      case 'loan.repay':
        r = repayLoan(w, userId, action.loanId, action.amount);
        break;
      case 'listing.create':
        r = createListing(w, userId, action.resource, action.qty, action.unitPrice);
        break;
      case 'listing.cancel':
        r = cancelListing(w, userId, action.listingId);
        break;
      case 'listing.buy':
        r = buyListing(w, userId, action.listingId);
        break;
      case 'deal':
        r = proposeDeal(w, userId, action);
        break;
      case 'mission.claim': {
        const c = claimMission(w, p, action.missionId);
        r = c.ok ? { ok: true, data: c.reward } : { ok: false, error: c.error ?? 'Failed' };
        break;
      }
    }
    if (r.ok) {
      evaluateProgression(w, p);
      this.dirty = true;
      void this.persist(false);
    }
    return r;
  }
}
