import { describe, expect, it, vi } from "vitest";

// quoteChangeForRange reads a module-level history cache. Stub it so these tests
// exercise the screening/sorting logic rather than the quote pipeline.
vi.mock("./stocks", () => ({
  quoteChangeForRange: (symbol: string) => ({
    change: ({ AAPL: 5, MSFT: -3, NVDA: 12, SPY: -1 } as Record<string, number>)[symbol] ?? 0,
    changePercent: ({ AAPL: 2, MSFT: -4, NVDA: 8, SPY: -0.5 } as Record<string, number>)[symbol] ?? 0,
  }),
}));

import { buildHoldingRows, screenStocks, sortHoldingRows } from "./screener";
import type { StockMeta } from "./stocks";
import type { Holding } from "../types";

const stock = (symbol: string, price: number, extra: Partial<StockMeta> = {}) => ({
  symbol, name: symbol + " Inc", price, marketCap: price * 1e9, volume: price * 1000,
  changePercent: 0, sector: "Tech", ...extra,
} as StockMeta);

const STOCKS = [stock("AAPL", 200), stock("MSFT", 400), stock("NVDA", 100), stock("SPY", 600)];
const base = {
  stocks: STOCKS, search: "", filter: "all" as const, sort: "manual" as const,
  sortDir: "desc" as const, homeRange: "1D" as const,
  manualOrder: ["AAPL", "MSFT", "NVDA", "SPY"], pinnedSymbols: [] as string[],
  ownedSymbols: new Set<string>(),
};
const syms = (rows: StockMeta[]) => rows.map(s => s.symbol);

describe("screenStocks", () => {
  it("keeps manual order when sort is manual", () => {
    expect(syms(screenStocks(base))).toEqual(["AAPL", "MSFT", "NVDA", "SPY"]);
  });

  it("honours a reordered manual list", () => {
    expect(syms(screenStocks({ ...base, manualOrder: ["SPY", "NVDA", "AAPL", "MSFT"] })))
      .toEqual(["SPY", "NVDA", "AAPL", "MSFT"]);
  });

  it("floats pinned symbols above unpinned, preserving manual order within groups", () => {
    expect(syms(screenStocks({ ...base, pinnedSymbols: ["NVDA", "SPY"] })))
      .toEqual(["NVDA", "SPY", "AAPL", "MSFT"]);
  });

  it("puts symbols missing from the manual order last rather than first", () => {
    expect(syms(screenStocks({ ...base, manualOrder: ["SPY"] }))[0]).toBe("SPY");
  });

  it("searches symbol and name, case-insensitively", () => {
    expect(syms(screenStocks({ ...base, search: "nvda" }))).toEqual(["NVDA"]);
    expect(syms(screenStocks({ ...base, search: "msft inc" }))).toEqual(["MSFT"]);
  });

  it("filters gainers and losers by range change", () => {
    expect(syms(screenStocks({ ...base, filter: "gainers" })).sort()).toEqual(["AAPL", "NVDA"]);
    expect(syms(screenStocks({ ...base, filter: "losers" })).sort()).toEqual(["MSFT", "SPY"]);
  });

  it("filters to owned symbols only", () => {
    expect(syms(screenStocks({ ...base, filter: "owned", ownedSymbols: new Set(["MSFT"]) })))
      .toEqual(["MSFT"]);
  });

  it("sorts movers by absolute change regardless of direction", () => {
    expect(syms(screenStocks({ ...base, filter: "movers", sort: "price" })))
      .toEqual(["NVDA", "MSFT", "AAPL", "SPY"]);
  });

  it("sorts by price descending, and reverses for asc", () => {
    expect(syms(screenStocks({ ...base, sort: "price" }))).toEqual(["SPY", "MSFT", "AAPL", "NVDA"]);
    expect(syms(screenStocks({ ...base, sort: "price", sortDir: "asc" })))
      .toEqual(["NVDA", "AAPL", "MSFT", "SPY"]);
  });

  it("does not mutate the input array", () => {
    const input = [...STOCKS];
    screenStocks({ ...base, stocks: input, sort: "price" });
    expect(syms(input)).toEqual(["AAPL", "MSFT", "NVDA", "SPY"]);
  });
});

describe("buildHoldingRows", () => {
  const holdings: Holding[] = [
    { symbol: "AAPL", shares: 10, avgCost: 150 },
    { symbol: "GONE", shares: 5, avgCost: 10 },
  ];

  it("pairs holdings with quotes and drops symbols with no quote", () => {
    const rows = buildHoldingRows(holdings, STOCKS);
    expect(rows.map(r => r.stock.symbol)).toEqual(["AAPL"]);
    expect(rows[0].holding.shares).toBe(10);
  });
});

describe("sortHoldingRows", () => {
  const rows = buildHoldingRows(
    [
      { symbol: "AAPL", shares: 1, avgCost: 1 },
      { symbol: "NVDA", shares: 1, avgCost: 1 },
      { symbol: "SPY", shares: 1, avgCost: 1 },
    ],
    STOCKS,
  );

  it("leaves manual sort untouched", () => {
    expect(sortHoldingRows(rows, "manual", "desc", "1D").map(r => r.stock.symbol))
      .toEqual(["AAPL", "NVDA", "SPY"]);
  });

  it("sorts by change percent descending and reverses for asc", () => {
    expect(sortHoldingRows(rows, "change", "desc", "1D").map(r => r.stock.symbol))
      .toEqual(["NVDA", "AAPL", "SPY"]);
    expect(sortHoldingRows(rows, "change", "asc", "1D").map(r => r.stock.symbol))
      .toEqual(["SPY", "AAPL", "NVDA"]);
  });

  it("does not mutate its input", () => {
    const copy = [...rows];
    sortHoldingRows(rows, "price", "desc", "1D");
    expect(rows).toEqual(copy);
  });
});
