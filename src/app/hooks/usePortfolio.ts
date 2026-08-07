import { useCallback, useMemo } from "react";
import type { StockMeta } from "../lib/stocks";
import type { Holding, Transaction } from "../types";
import { applyBuy, applySell, newTransaction } from "../lib/trades";
import { usePersistentState } from "./usePersistentState";

const isNum = (v: unknown) => typeof v === "number" && Number.isFinite(v);

/** Bulk state handed over by the cloud loader. */
export interface PortfolioSnapshot {
  balance?: unknown;
  holdings?: unknown;
  transactions?: unknown;
}

export interface Portfolio {
  balance: number;
  holdings: Holding[];
  transactions: Transaction[];
  /** symbol -> holding, for O(1) lookup while rendering rows. */
  holdingMap: Map<string, Holding>;
  /** Live market value of every holding. */
  portfolioValue: number;
  /** What those holdings cost, at average cost. */
  totalCost: number;
  totalProfit: number;
  deposit: (amount: number) => void;
  buyShares: (symbol: string, shares: number, price: number) => void;
  sellShares: (symbol: string, shares: number, price: number) => void;
  /** Back to an empty account. Used on sign-out and by "reset trade history". */
  reset: () => void;
  /** Adopt cloud state, ignoring any field that isn't the right shape. */
  replace: (snapshot: PortfolioSnapshot) => void;
}

/**
 * Bank balance, holdings and transaction log, persisted to localStorage.
 * `stocks` is only needed to price holdings at market.
 */
export function usePortfolio(stocks: StockMeta[]): Portfolio {
  const [balance, setBalance] = usePersistentState("vantage-balance", 0, isNum);
  const [holdings, setHoldings] = usePersistentState<Holding[]>("vantage-holdings", [], Array.isArray);
  const [transactions, setTransactions] = usePersistentState<Transaction[]>("vantage-tx", [], Array.isArray);

  const deposit = useCallback((amount: number) => {
    setBalance(b => b + amount);
    setTransactions(prev => [newTransaction("deposit", amount), ...prev]);
  }, [setBalance, setTransactions]);

  const buyShares = useCallback((symbol: string, shares: number, price: number) => {
    const cost = shares * price;
    setBalance(b => b - cost);
    setHoldings(prev => applyBuy(prev, symbol, shares, price));
    setTransactions(prev => [newTransaction("buy", cost, { symbol, shares, price }), ...prev]);
  }, [setBalance, setHoldings, setTransactions]);

  const sellShares = useCallback((symbol: string, shares: number, price: number) => {
    const proceeds = shares * price;
    setBalance(b => b + proceeds);
    setHoldings(prev => applySell(prev, symbol, shares));
    setTransactions(prev => [newTransaction("sell", proceeds, { symbol, shares, price }), ...prev]);
  }, [setBalance, setHoldings, setTransactions]);

  const reset = useCallback(() => {
    setBalance(0);
    setHoldings([]);
    setTransactions([]);
  }, [setBalance, setHoldings, setTransactions]);

  const replace = useCallback((snapshot: PortfolioSnapshot) => {
    if (isNum(snapshot.balance)) setBalance(snapshot.balance as number);
    if (Array.isArray(snapshot.holdings)) setHoldings(snapshot.holdings as Holding[]);
    if (Array.isArray(snapshot.transactions)) setTransactions(snapshot.transactions as Transaction[]);
  }, [setBalance, setHoldings, setTransactions]);

  const holdingMap = useMemo(() => {
    const m = new Map<string, Holding>();
    holdings.forEach(h => m.set(h.symbol, h));
    return m;
  }, [holdings]);

  const portfolioValue = useMemo(
    () => holdings.reduce((sum, h) => {
      const stock = stocks.find(s => s.symbol === h.symbol);
      return sum + (stock ? stock.price * h.shares : 0);
    }, 0),
    [holdings, stocks],
  );

  const totalCost = useMemo(
    () => holdings.reduce((sum, h) => sum + h.avgCost * h.shares, 0),
    [holdings],
  );

  return {
    balance, holdings, transactions,
    holdingMap, portfolioValue, totalCost,
    totalProfit: portfolioValue - totalCost,
    deposit, buyShares, sellShares, reset, replace,
  };
}
