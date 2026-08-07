import type { Holding, Transaction, TxType } from "../types";

/**
 * Positions at or below this many shares are treated as fully closed.
 * Selling a whole position via repeated fractional sells leaves float residue
 * (1e-17 shares); without this the row lingers forever showing "0.0000".
 */
export const SHARE_EPSILON = 1e-9;

/**
 * Add shares to a position, recomputing the weighted average cost.
 * Returns a new array; never mutates the input.
 */
export function applyBuy(
  holdings: Holding[], symbol: string, shares: number, price: number,
): Holding[] {
  const existing = holdings.find(h => h.symbol === symbol);
  if (!existing) return [...holdings, { symbol, shares, avgCost: price }];

  const totalShares = existing.shares + shares;
  // Weighted average: what every share has cost us so far, blended with this fill.
  const avgCost = (existing.avgCost * existing.shares + price * shares) / totalShares;
  return holdings.map(h => h.symbol === symbol ? { symbol, shares: totalShares, avgCost } : h);
}

/**
 * Remove shares from a position, dropping it entirely once it rounds to nothing.
 * Average cost is deliberately unchanged — selling doesn't alter what the
 * remaining shares cost. Returns a new array; never mutates the input.
 */
export function applySell(holdings: Holding[], symbol: string, shares: number): Holding[] {
  return holdings.flatMap(h => {
    if (h.symbol !== symbol) return [h];
    const remaining = h.shares - shares;
    return remaining > SHARE_EPSILON ? [{ ...h, shares: remaining }] : [];
  });
}

/** Market value of a position at the current price. */
export const positionValue = (h: Holding, price: number) => h.shares * price;

/** Unrealised gain/loss for a position, in dollars. */
export const positionProfit = (h: Holding, price: number) => (price - h.avgCost) * h.shares;

/**
 * Unrealised gain/loss as a percentage of cost basis.
 * Guards avgCost === 0, which would otherwise yield Infinity/NaN in the UI.
 */
export const positionProfitPct = (h: Holding, price: number) =>
  h.avgCost > 0 ? ((price - h.avgCost) / h.avgCost) * 100 : 0;

/**
 * Date.now() alone collides when two transactions land in the same millisecond,
 * which produces duplicate React keys in the history list. The counter makes
 * ids unique within a session while staying an opaque string.
 */
let txSeq = 0;

export function newTransaction(
  type: TxType,
  amount: number,
  extra: { symbol?: string; shares?: number; price?: number } = {},
): Transaction {
  const timestamp = Date.now();
  return { id: `tx-${timestamp}-${txSeq++}`, type, amount, timestamp, ...extra };
}
