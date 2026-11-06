import type { ActorRef, Loan, MerchantState, Result, WorldState } from './types';
import { clamp, dayOf, fail, money, newId, ok, pushFeed, fmt } from './internal';
import { debtOf, merchantNetWorth, playerNetWorth } from './valuation';

export const BANKER_ID = 'banker';
export const LOAN_TERM_DAYS = 7;

export interface CreditDecision {
  approved: boolean;
  riskScore: number;
  dailyRate: number;
  maxAmount: number;
  reasons: string[];
}

export function getBanker(world: WorldState): MerchantState | undefined {
  const b = world.merchants[BANKER_ID];
  return b && b.status !== 'bankrupt' ? b : undefined;
}

function borrowerName(world: WorldState, ref: ActorRef): string {
  if (ref.kind === 'player') return world.players[ref.id]?.name ?? ref.id;
  if (ref.kind === 'merchant') return world.merchants[ref.id]?.name ?? ref.id;
  return ref.id;
}

/** Recent defaults on the banker's books, which make the banker more cautious. */
export function recentDefaults(world: WorldState): number {
  const since = world.tick - 7 * 24;
  return Object.values(world.loans).filter((l) => l.status === 'defaulted' && l.issuedTick >= since).length;
}

/**
 * Deterministic credit model. The banker scores each request on leverage,
 * earnings trend, repayment history and reputation, then compares the score to
 * its own risk appetite (which tightens after defaults).
 */
export function evaluateCredit(world: WorldState, ref: ActorRef, amount: number): CreditDecision {
  const banker = getBanker(world);
  const reasons: string[] = [];
  if (!banker) return { approved: false, riskScore: 1, dailyRate: 0, maxAmount: 0, reasons: ['The bank is closed'] };

  let worth = 0;
  let trend = 0;
  let defaults = 0;
  let repaid = 0;
  let repBonus = 0;
  if (ref.kind === 'player') {
    const p = world.players[ref.id];
    if (!p) return { approved: false, riskScore: 1, dailyRate: 0, maxAmount: 0, reasons: ['Unknown borrower'] };
    worth = playerNetWorth(world, p);
    const h = p.history.slice(-5);
    if (h.length >= 2) trend = (h[h.length - 1].netWorth - h[0].netWorth) / Math.max(50, h[0].netWorth) / (h.length - 1);
    defaults = p.credit.defaults;
    repaid = p.credit.repaid;
    repBonus = clamp(p.reputation / 100, 0, 1) * 0.15;
  } else if (ref.kind === 'merchant') {
    const m = world.merchants[ref.id];
    if (!m || m.status === 'bankrupt') return { approved: false, riskScore: 1, dailyRate: 0, maxAmount: 0, reasons: ['Borrower is bankrupt'] };
    worth = merchantNetWorth(world, m);
    const h = m.history.slice(-5);
    if (h.length) trend = h.reduce((s, d) => s + d.profit, 0) / h.length / Math.max(50, worth);
    defaults = m.stats.defaults;
    repaid = m.stats.repaid;
    repBonus = m.status === 'struggling' ? -0.1 : 0;
  }

  const existing = debtOf(world, ref);
  const leverage = (existing + amount) / Math.max(worth, 1);
  const caution = recentDefaults(world) * 0.06;
  const risk = clamp(0.12 + 0.55 * leverage - 2 * trend + 0.3 * defaults - 0.04 * repaid - repBonus + caution, 0, 1);
  const appetite = banker.personality.risk * (1 - Math.min(0.5, caution));
  const maxAmount = money(Math.max(0, Math.min(banker.gold * 0.3, worth * 1.2 - existing)));

  if (leverage > 1) reasons.push(`Debt would be ${(leverage * 100).toFixed(0)}% of net worth`);
  if (trend < 0) reasons.push('Earnings have been falling');
  if (trend > 0.01) reasons.push('Earnings are growing');
  if (defaults > 0) reasons.push(`${defaults} previous default(s)`);
  if (repaid > 0) reasons.push(`${repaid} loan(s) repaid on time`);
  if (caution > 0) reasons.push('The bank is cautious after recent defaults');

  const approved = amount >= 10 && risk <= appetite && amount <= maxAmount;
  if (amount < 10) reasons.push('Minimum loan is 10 gold');
  if (amount > maxAmount) reasons.push(`Amount exceeds credit limit of ${fmt(maxAmount)} gold`);
  if (risk > appetite) reasons.push(`Risk score ${(risk * 100).toFixed(0)} exceeds the bank's limit of ${(appetite * 100).toFixed(0)}`);
  return { approved, riskScore: money(risk), dailyRate: money((0.004 + risk * 0.018) * 10000) / 10000, maxAmount, reasons };
}

/** Request a loan. Gold moves from the banker's vault to the borrower only when approved. */
export function requestLoan(world: WorldState, ref: ActorRef, amount: number): Result<{ loan: Loan; decision: CreditDecision }> {
  amount = money(amount);
  if (!(amount > 0) || !Number.isFinite(amount)) return fail('Invalid amount');
  const banker = getBanker(world);
  if (!banker) return fail('The bank is closed');
  const decision = evaluateCredit(world, ref, amount);
  const name = borrowerName(world, ref);
  banker.decisions.push({
    tick: world.tick,
    action: decision.approved ? `Approved ${fmt(amount)}g loan to ${name}` : `Refused ${fmt(amount)}g loan to ${name}`,
    reasons: decision.reasons.length ? decision.reasons : [`Risk score ${(decision.riskScore * 100).toFixed(0)}`],
  });
  if (banker.decisions.length > 40) banker.decisions.shift();
  if (!decision.approved) {
    banker.memory.push({ tick: world.tick, kind: 'refuse', counterparty: ref.id, qty: amount, note: `Refused ${name}: ${decision.reasons.join('; ')}` });
    pushFeed(world, { kind: 'loan', actor: banker.id, text: `${banker.name} refused a ${fmt(amount)}g loan to ${name} (risk ${(decision.riskScore * 100).toFixed(0)}).`, data: { amount, risk: decision.riskScore }, severity: 'bad' });
    return { ok: false, error: `Loan refused: ${decision.reasons.join('; ')}` };
  }
  const total = money(amount * (1 + decision.dailyRate * LOAN_TERM_DAYS));
  const loan: Loan = {
    id: newId(world, 'loan'),
    borrower: ref,
    principal: amount,
    outstanding: total,
    dailyRate: decision.dailyRate,
    installment: money(total / LOAN_TERM_DAYS),
    issuedTick: world.tick,
    termDays: LOAN_TERM_DAYS,
    missed: 0,
    status: 'active',
    riskScore: decision.riskScore,
  };
  world.loans[loan.id] = loan;
  banker.gold = money(banker.gold - amount);
  creditBorrower(world, ref, amount);
  banker.stats.loans += 1;
  banker.memory.push({ tick: world.tick, kind: 'loan', counterparty: ref.id, qty: amount, note: `Lent ${fmt(amount)}g to ${name} at ${(decision.dailyRate * 100).toFixed(2)}%/day` });
  pushFeed(world, { kind: 'loan', actor: banker.id, text: `${banker.name} approved a ${fmt(amount)}g loan to ${name} at ${(decision.dailyRate * 100).toFixed(2)}% per day.`, data: { amount, rate: decision.dailyRate }, severity: 'info' });
  return ok({ loan, decision });
}

function creditBorrower(world: WorldState, ref: ActorRef, amount: number) {
  if (ref.kind === 'player') {
    const p = world.players[ref.id];
    p.gold = money(p.gold + amount);
    world.ledger.push({ tick: world.tick, playerId: p.id, type: 'loan.received', goldDelta: amount, details: {} });
  } else if (ref.kind === 'merchant') {
    const m = world.merchants[ref.id];
    m.gold = money(m.gold + amount);
  }
}

function borrowerGold(world: WorldState, ref: ActorRef): { get: () => number; take: (x: number) => void } {
  if (ref.kind === 'player') {
    const p = world.players[ref.id];
    return { get: () => p?.gold ?? 0, take: (x) => (p.gold = money(p.gold - x)) };
  }
  const m = world.merchants[ref.id];
  return { get: () => (m && m.status !== 'bankrupt' ? m.gold : 0), take: (x) => (m.gold = money(m.gold - x)) };
}

/** Pay down a loan early (player action). */
export function repayLoan(world: WorldState, playerId: string, loanId: string, amount: number): Result<Loan> {
  const loan = world.loans[loanId];
  if (!loan || loan.borrower.kind !== 'player' || loan.borrower.id !== playerId) return fail('Loan not found');
  if (loan.status !== 'active') return fail('Loan is not active');
  const p = world.players[playerId];
  const pay = money(Math.min(amount, loan.outstanding));
  if (!(pay > 0)) return fail('Invalid amount');
  if (p.gold < pay) return fail('Not enough gold');
  applyPayment(world, loan, pay);
  return ok(loan);
}

function applyPayment(world: WorldState, loan: Loan, pay: number) {
  const banker = world.merchants[BANKER_ID];
  borrowerGold(world, loan.borrower).take(pay);
  if (loan.borrower.kind === 'player') world.ledger.push({ tick: world.tick, playerId: loan.borrower.id, type: 'loan.repayment', goldDelta: -pay, details: { loanId: loan.id } });
  if (banker) banker.gold = money(banker.gold + pay);
  loan.outstanding = money(loan.outstanding - pay);
  if (loan.outstanding <= 0.01) {
    loan.outstanding = 0;
    loan.status = 'repaid';
    if (banker) banker.memory.push({ tick: world.tick, kind: 'repay', counterparty: loan.borrower.id, note: `${borrowerName(world, loan.borrower)} repaid loan ${loan.id}` });
    if (loan.borrower.kind === 'merchant') world.merchants[loan.borrower.id].stats.repaid += 1;
    if (loan.borrower.kind === 'player') {
      const p = world.players[loan.borrower.id];
      p.credit.repaid += 1;
      p.reputation = clamp(p.reputation + 4, 0, 100);
    }
    pushFeed(world, { kind: 'loan', actor: BANKER_ID, text: `${borrowerName(world, loan.borrower)} fully repaid a ${fmt(loan.principal)}g loan.`, severity: 'good' });
  }
}

/** Daily collections: installments are drawn automatically; three misses is a default. */
export function collectLoans(world: WorldState): void {
  for (const loan of Object.values(world.loans)) {
    if (loan.status !== 'active') continue;
    if (dayOf(world.tick) <= dayOf(loan.issuedTick)) continue;
    const g = borrowerGold(world, loan.borrower);
    const due = money(Math.min(loan.installment, loan.outstanding));
    if (g.get() >= due) {
      applyPayment(world, loan, due);
    } else {
      const partial = money(Math.max(0, g.get()));
      if (partial > 0) applyPayment(world, loan, partial);
      if (loan.status !== 'active') continue;
      loan.missed += 1;
      if (loan.missed >= 3) defaultLoan(world, loan);
    }
  }
  // Banker adapts its appetite: tighten after defaults, relax slowly otherwise.
  const banker = getBanker(world);
  if (banker) {
    const d = recentDefaults(world);
    const active = Object.values(world.loans).filter((l) => l.status === 'active');
    const book = active.reduce((s, l) => s + l.outstanding, 0);
    banker.decisions.push({
      tick: world.tick,
      action: `Reviewed the loan book: ${active.length} active loan${active.length === 1 ? '' : 's'}, ${fmt(book)}g outstanding`,
      reasons: [`Vault holds ${fmt(banker.gold)}g`, `Risk appetite ${(banker.personality.risk * 100).toFixed(0)}`, `${d} default(s) in the last week`],
    });
    if (banker.decisions.length > 40) banker.decisions.shift();
    const before = banker.personality.risk;
    banker.personality.risk = clamp(d > 0 ? before - 0.03 * d : before + 0.01, 0.25, 0.6);
    if (Math.abs(banker.personality.risk - before) >= 0.02) {
      banker.decisions.push({ tick: world.tick, action: banker.personality.risk < before ? 'Tightened lending standards' : 'Eased lending standards', reasons: [`${d} default(s) in the last week`] });
    }
  }
}

function defaultLoan(world: WorldState, loan: Loan) {
  loan.status = 'defaulted';
  const banker = world.merchants[BANKER_ID];
  const name = borrowerName(world, loan.borrower);
  if (loan.borrower.kind === 'player') {
    const p = world.players[loan.borrower.id];
    p.credit.defaults += 1;
    p.reputation = clamp(p.reputation - 15, 0, 100);
  } else if (loan.borrower.kind === 'merchant') {
    world.merchants[loan.borrower.id].stats.defaults += 1;
  }
  if (banker) {
    banker.stats.defaults += 1;
    banker.memory.push({ tick: world.tick, kind: 'refuse', counterparty: loan.borrower.id, note: `${name} defaulted owing ${fmt(loan.outstanding)}g` });
  }
  pushFeed(world, { kind: 'loan', actor: BANKER_ID, text: `${name} defaulted on a loan, leaving ${fmt(loan.outstanding)}g unpaid.`, data: { outstanding: loan.outstanding }, severity: 'bad' });
}

export function activeLoansOf(world: WorldState, ref: ActorRef): Loan[] {
  return Object.values(world.loans).filter((l) => l.status === 'active' && l.borrower.kind === ref.kind && l.borrower.id === ref.id);
}
