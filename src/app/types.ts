import { ALL_SYMBOLS, type TimeRange } from "./lib/stocks";
import { DEFAULT_PREFS, type UserPrefs } from "./lib/firebase";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type AppPage = "home" | "portfolio" | "bank" | "account";
export type FilterMode = "all" | "gainers" | "losers" | "movers" | "owned";
export type SortMode   = "manual" | "change" | "changeAmt" | "price" | "cap" | "volume" | "symbol" | "name";
export type SortDir    = "desc" | "asc";
export type ChangeDisplay = "percent" | "amount";
export type ViewMode   = "grid" | "list";

export interface Watchlist {
  id: string;
  name: string;
  symbols: string[];
}

export interface Holding {
  symbol: string;
  shares: number;
  avgCost: number;
}

export type TxType = "deposit" | "buy" | "sell";

export interface Transaction {
  id: string;
  type: TxType;
  amount: number;
  symbol?: string;
  shares?: number;
  price?: number;
  timestamp: number;
}

export interface Profile {
  name: string;
  email: string;
  pic: string;
}

/** Lifecycle of the signed-in user's Firestore document. */
export type CloudStatus = "idle" | "loading" | "ready" | "error";

// ─── Defaults ──────────────────────────────────────────────────────────────────

export const DEFAULT_WATCHLISTS: Watchlist[] = [
  { id: "portfolio", name: "All Stocks", symbols: [...ALL_SYMBOLS] },
  { id: "wl-tech",  name: "Tech",        symbols: ["AAPL", "MSFT", "NVDA", "GOOGL", "META", "NFLX"] },
  { id: "wl-etfs",  name: "ETFs",        symbols: ["SPY", "QQQ", "GLD"] },
];

export const DEFAULT_PROFILE: Profile = {
  name: "",
  email: "",
  pic: "",
};

export const TIME_RANGES: TimeRange[] = ["1D", "1W", "1M", "3M", "6M", "YTD", "1Y", "2Y", "5Y", "10Y", "ALL"];
export const FILTER_MODES: FilterMode[] = ["all", "gainers", "losers", "movers", "owned"];
export const SORT_MODES: SortMode[] = ["manual", "change", "changeAmt", "price", "cap", "volume", "symbol", "name"];

// ─── Parsers ───────────────────────────────────────────────────────────────────
// Everything below is defensive: cloud and localStorage payloads are untrusted
// and must never throw, or a bad value takes the whole app down.

/** Read a JSON value written by the persistence effects; falls back on any bad/missing data. */
export function readLocal<T>(key: string, fallback: T, valid: (v: unknown) => boolean): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return fallback;
    const parsed = JSON.parse(raw) as unknown;
    return valid(parsed) ? (parsed as T) : fallback;
  } catch {
    return fallback;
  }
}

export function asWatchlists(raw: unknown): Watchlist[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const lists: Watchlist[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const w = item as Record<string, unknown>;
    if (typeof w.id !== "string" || typeof w.name !== "string" || !Array.isArray(w.symbols)) continue;
    lists.push({
      id: w.id,
      name: w.name,
      symbols: w.symbols.filter((s): s is string => typeof s === "string"),
    });
  }
  return lists.length ? lists : null;
}

export function asStringRecord(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

export function asStringListRecord(raw: unknown): Record<string, string[]> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (Array.isArray(v)) out[k] = v.filter((s): s is string => typeof s === "string");
  }
  return out;
}

export function asPrefs(raw: unknown): UserPrefs {
  const p = (raw && typeof raw === "object" ? raw : {}) as Partial<UserPrefs>;
  const homeRange = TIME_RANGES.includes(p.homeRange as TimeRange) ? (p.homeRange as TimeRange) : DEFAULT_PREFS.homeRange;
  const filter = FILTER_MODES.includes(p.filter as FilterMode) ? (p.filter as FilterMode) : DEFAULT_PREFS.filter;
  const sort = SORT_MODES.includes(p.sort as SortMode) ? (p.sort as SortMode) : DEFAULT_PREFS.sort;
  const sortDir = p.sortDir === "asc" || p.sortDir === "desc" ? p.sortDir : DEFAULT_PREFS.sortDir;
  const changeDisplay = p.changeDisplay === "amount" || p.changeDisplay === "percent" ? p.changeDisplay : DEFAULT_PREFS.changeDisplay;
  const viewMode = p.viewMode === "list" || p.viewMode === "grid" ? p.viewMode : DEFAULT_PREFS.viewMode;
  const theme = p.theme === "light" || p.theme === "dark" ? p.theme : DEFAULT_PREFS.theme;
  return {
    homeRange,
    filter,
    sort,
    sortDir,
    changeDisplay,
    viewMode,
    theme,
    activeWatchlist: typeof p.activeWatchlist === "string" && p.activeWatchlist ? p.activeWatchlist : DEFAULT_PREFS.activeWatchlist,
    pinnedSymbols: Array.isArray(p.pinnedSymbols)
      ? p.pinnedSymbols.filter((s): s is string => typeof s === "string")
      : [],
    customOrders: asStringListRecord(p.customOrders),
    detailRanges: asStringRecord(p.detailRanges),
  };
}
