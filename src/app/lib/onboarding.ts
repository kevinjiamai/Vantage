import { ALL_SYMBOLS } from "./stocks";
import type { Watchlist } from "../types";

export const TECH_STARTER = ["AAPL", "MSFT", "NVDA", "GOOGL", "META", "NFLX"] as const;

export const ONBOARDING_SECTORS: { sector: string; stocks: { symbol: string; name: string }[] }[] = [
  {
    sector: "Technology",
    stocks: [
      { symbol: "AAPL", name: "Apple" },
      { symbol: "MSFT", name: "Microsoft" },
      { symbol: "NVDA", name: "NVIDIA" },
      { symbol: "GOOGL", name: "Alphabet" },
      { symbol: "META", name: "Meta" },
      { symbol: "NFLX", name: "Netflix" },
      { symbol: "AMD", name: "AMD" },
      { symbol: "ORCL", name: "Oracle" },
    ],
  },
  {
    sector: "Finance",
    stocks: [
      { symbol: "JPM", name: "JPMorgan" },
      { symbol: "V", name: "Visa" },
      { symbol: "BRK.B", name: "Berkshire" },
      { symbol: "MA", name: "Mastercard" },
      { symbol: "BAC", name: "Bank of America" },
      { symbol: "GS", name: "Goldman Sachs" },
    ],
  },
  {
    sector: "Consumer",
    stocks: [
      { symbol: "AMZN", name: "Amazon" },
      { symbol: "COST", name: "Costco" },
      { symbol: "WMT", name: "Walmart" },
      { symbol: "NKE", name: "Nike" },
      { symbol: "SBUX", name: "Starbucks" },
      { symbol: "MCD", name: "McDonald's" },
    ],
  },
  {
    sector: "Healthcare",
    stocks: [
      { symbol: "JNJ", name: "J&J" },
      { symbol: "UNH", name: "UnitedHealth" },
      { symbol: "LLY", name: "Eli Lilly" },
      { symbol: "PFE", name: "Pfizer" },
      { symbol: "ABBV", name: "AbbVie" },
      { symbol: "MRK", name: "Merck" },
    ],
  },
  {
    sector: "Automotive",
    stocks: [
      { symbol: "TSLA", name: "Tesla" },
      { symbol: "F", name: "Ford" },
      { symbol: "GM", name: "GM" },
      { symbol: "RIVN", name: "Rivian" },
    ],
  },
  {
    sector: "ETF",
    stocks: [
      { symbol: "SPY", name: "S&P 500" },
      { symbol: "QQQ", name: "Nasdaq 100" },
      { symbol: "GLD", name: "Gold" },
      { symbol: "IWM", name: "Russell 2000" },
      { symbol: "VTI", name: "Total Market" },
    ],
  },
];

export function buildWatchlistsFromSelection(selected: Set<string>): Watchlist[] {
  const all = [...selected];
  const lists: Watchlist[] = [
    { id: "portfolio", name: "All Stocks", symbols: all.length ? all : [...ALL_SYMBOLS] },
  ];
  for (const group of ONBOARDING_SECTORS) {
    const syms = group.stocks.map(s => s.symbol).filter(s => selected.has(s));
    if (syms.length === 0) continue;
    const id = "wl-" + group.sector.toLowerCase().replace(/\s+/g, "-");
    lists.push({ id, name: group.sector === "Technology" ? "Tech" : group.sector, symbols: syms });
  }
  return lists;
}

// ─── Auth forms ────────────────────────────────────────────────────────────────
