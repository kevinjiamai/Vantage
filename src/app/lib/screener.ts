import { quoteChangeForRange, type StockMeta, type TimeRange } from "./stocks";
import type { FilterMode, Holding, SortDir, SortMode } from "../types";

export interface HoldingRowData {
  stock: StockMeta;
  holding: Holding;
}

type Comparators = Record<Exclude<SortMode, "manual">, (a: StockMeta, b: StockMeta) => number>;

/**
 * $/% comparators use the toolbar range (1Y etc.), not always the 1D change.
 * All of them sort descending; callers reverse for ascending.
 */
function comparators(homeRange: TimeRange): Comparators {
  const d = (x: StockMeta) => quoteChangeForRange(x.symbol, homeRange, x);
  return {
    change:    (a, b) => d(b).changePercent - d(a).changePercent,
    changeAmt: (a, b) => d(b).change - d(a).change,
    price:     (a, b) => b.price - a.price,
    cap:       (a, b) => b.marketCap - a.marketCap,
    volume:    (a, b) => b.volume - a.volume,
    symbol:    (a, b) => b.symbol.localeCompare(a.symbol),
    name:      (a, b) => b.name.localeCompare(a.name),
  };
}

/** Pair holdings with live quotes, dropping any symbol we have no quote for. */
export function buildHoldingRows(holdings: Holding[], stocks: StockMeta[]): HoldingRowData[] {
  return holdings
    .map(h => {
      const stock = stocks.find(s => s.symbol === h.symbol);
      return stock ? { stock, holding: h } : null;
    })
    .filter((x): x is HoldingRowData => x != null);
}

export function sortHoldingRows(
  rows: HoldingRowData[], sort: SortMode, sortDir: SortDir, homeRange: TimeRange,
): HoldingRowData[] {
  if (sort === "manual") return rows;
  const cmp = comparators(homeRange);
  const out = [...rows];
  out.sort((a, b) => cmp[sort](a.stock, b.stock));
  if (sortDir === "asc") out.reverse();
  return out;
}

export interface ScreenArgs {
  stocks: StockMeta[];
  search: string;
  filter: FilterMode;
  sort: SortMode;
  sortDir: SortDir;
  homeRange: TimeRange;
  /** Manual drag order for the active watchlist, if the user has set one. */
  manualOrder: string[];
  pinnedSymbols: string[];
  ownedSymbols: Set<string>;
}

/** Search + filter + sort for the main stock grid. */
export function screenStocks({
  stocks, search, filter, sort, sortDir, homeRange, manualOrder, pinnedSymbols, ownedSymbols,
}: ScreenArgs): StockMeta[] {
  let s = [...stocks];
  const rangeDelta = (x: StockMeta) => quoteChangeForRange(x.symbol, homeRange, x);

  if (search) {
    const q = search.toLowerCase();
    s = s.filter(x => x.symbol.toLowerCase().includes(q) || x.name.toLowerCase().includes(q));
  }

  if (filter === "gainers") s = s.filter(x => rangeDelta(x).changePercent > 0);
  else if (filter === "losers") s = s.filter(x => rangeDelta(x).changePercent < 0);
  else if (filter === "owned") s = s.filter(x => ownedSymbols.has(x.symbol));

  if (sort === "manual") {
    s.sort((a, b) => {
      const ai = manualOrder.indexOf(a.symbol);
      const bi = manualOrder.indexOf(b.symbol);
      return (ai === -1 ? 9999 : ai) - (bi === -1 ? 9999 : bi);
    });
    // Pins float to the top, preserving manual order within each group.
    s.sort((a, b) => {
      const ap = pinnedSymbols.includes(a.symbol);
      const bp = pinnedSymbols.includes(b.symbol);
      if (ap === bp) return 0;
      return ap ? -1 : 1;
    });
  } else if (filter === "movers") {
    s.sort((a, b) => Math.abs(rangeDelta(b).changePercent) - Math.abs(rangeDelta(a).changePercent));
  } else {
    s.sort(comparators(homeRange)[sort]);
    if (sortDir === "asc") s.reverse();
  }

  return s;
}
