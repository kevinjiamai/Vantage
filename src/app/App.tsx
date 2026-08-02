import { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback, useId } from "react";
import { createPortal } from "react-dom";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";
import {
  Search, Sun, Moon, Plus, ChevronLeft, ChevronRight, ChevronDown, Filter, ArrowUpDown,
  X, Check, TrendingUp, TrendingDown, Star, BarChart2, Minus,
  MoreHorizontal, LayoutGrid, List, Landmark, Wallet, Settings,
  Eye, EyeOff, User as UserIcon, ExternalLink, Newspaper,
} from "lucide-react";
import {
  STOCKS_META, ALL_SYMBOLS, getHistory, fetchQuotes, fetchHistory, ensureQuotes, mergeQuotes,
  lastQuotesFreshness,
  prefetchSparklines, searchStocks, fetchStockNews, alignHistoryToPrice, invalidateHistoryRange, clearHistoryCache,
  quoteChangeForRange, downsampleLTTB, sparklineMaxPoints,
  type StockMeta, type SearchResult, type StockNewsItem, type TimeRange,
} from "./lib/stocks";
import { loadUserState, saveUserState, flushUserState, onSyncResult, subscribeAuth, signIn, signUp, signOut, deleteAccount, authErrorMessage, DEFAULT_PREFS, type UserState, type UserPrefs } from "./lib/firebase";
import type { User } from "firebase/auth";
import { VantageChat } from "./components/VantageChat";

// ─── Palette ───────────────────────────────────────────────────────────────────

const G = "#34d399";
const R = "#f87171";

// ─── Formatters ────────────────────────────────────────────────────────────────

const fmt$ = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

const fmtPct = (n: number) => (n >= 0 ? "+" : "") + n.toFixed(2) + "%";

const fmtChangeAmt = (n: number) => (n >= 0 ? "+" : "-") + fmt$(Math.abs(n));

const fmtVol = (n: number) => {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(0) + "K";
  return String(n);
};

const fmtCap = (n: number) => {
  if (n >= 1e12) return "$" + (n / 1e12).toFixed(2) + "T";
  if (n >= 1e9)  return "$" + (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6)  return "$" + (n / 1e6).toFixed(1) + "M";
  return "$" + n.toFixed(0);
};

const fmtTime = (t: number, range: TimeRange) => {
  const d = new Date(t);
  if (range === "1D") return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (range === "1W" || range === "1M" || range === "3M") {
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  if (range === "6M" || range === "YTD") {
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  if (range === "1Y") {
    return d.toLocaleDateString("en-US", { month: "short" });
  }
  if (range === "2Y") {
    return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
  }
  // 5Y / 10Y / ALL
  return d.toLocaleDateString("en-US", { year: "numeric" });
};

const fmtPriceTick = (p: number, min: number, max: number) => {
  const spread = max - min;
  if (spread < 1) return "$" + p.toFixed(2);
  if (spread < 20) return "$" + p.toFixed(1);
  if (p >= 1000) return "$" + p.toFixed(0);
  return "$" + p.toFixed(0);
};

/** Tight Y domain so sparklines show real movement (not scaled from $0). */
function priceDomain(points: { p: number }[]): [number, number] {
  const prices = points.map(d => d.p).filter(Number.isFinite);
  if (!prices.length) return [0, 1];
  let min = Math.min(...prices);
  let max = Math.max(...prices);
  if (min === max) {
    const pad = Math.max(Math.abs(min) * 0.01, 0.5);
    return [min - pad, max + pad];
  }
  const pad = (max - min) * 0.12;
  return [min - pad, max + pad];
}

/** Evenly spaced ticks in time (constant visual spacing on a linear X axis). */
function evenTimeTicks(t0: number, t1: number, count: number): number[] {
  if (!(t1 > t0) || count < 2) return [t0];
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    out.push(t0 + (i / (count - 1)) * (t1 - t0));
  }
  return out;
}

const fmtWhen = (t: number) =>
  new Date(t).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

// ─── Types ─────────────────────────────────────────────────────────────────────

type AppPage = "home" | "portfolio" | "bank" | "account";
type FilterMode = "all" | "gainers" | "losers" | "movers" | "owned";
type SortMode   = "manual" | "change" | "changeAmt" | "price" | "cap" | "volume" | "symbol" | "name";
type SortDir    = "desc" | "asc";
type ChangeDisplay = "percent" | "amount";
type ViewMode   = "grid" | "list";

interface Watchlist {
  id: string;
  name: string;
  symbols: string[];
}

interface Holding {
  symbol: string;
  shares: number;
  avgCost: number;
}

type TxType = "deposit" | "buy" | "sell";

interface Transaction {
  id: string;
  type: TxType;
  amount: number;
  symbol?: string;
  shares?: number;
  price?: number;
  timestamp: number;
}

interface Profile {
  name: string;
  email: string;
  pic: string;
}

/** Lifecycle of the signed-in user's Firestore document. */
type CloudStatus = "idle" | "loading" | "ready" | "error";

const DEFAULT_WATCHLISTS: Watchlist[] = [
  { id: "portfolio", name: "All Stocks", symbols: [...ALL_SYMBOLS] },
  { id: "wl-tech",  name: "Tech",        symbols: ["AAPL", "MSFT", "NVDA", "GOOGL", "META", "NFLX"] },
  { id: "wl-etfs",  name: "ETFs",        symbols: ["SPY", "QQQ", "GLD"] },
];

const DEFAULT_PROFILE: Profile = {
  name: "",
  email: "",
  pic: "",
};

/** Read a JSON value written by the persistence effects; falls back on any bad/missing data. */
function readLocal<T>(key: string, fallback: T, valid: (v: unknown) => boolean): T {
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

const TIME_RANGES: TimeRange[] = ["1D", "1W", "1M", "3M", "6M", "YTD", "1Y", "2Y", "5Y", "10Y", "ALL"];
const FILTER_MODES: FilterMode[] = ["all", "gainers", "losers", "movers", "owned"];
const SORT_MODES: SortMode[] = ["manual", "change", "changeAmt", "price", "cap", "volume", "symbol", "name"];

function asWatchlists(raw: unknown): Watchlist[] | null {
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

function asStringRecord(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

function asStringListRecord(raw: unknown): Record<string, string[]> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (Array.isArray(v)) out[k] = v.filter((s): s is string => typeof s === "string");
  }
  return out;
}

function asPrefs(raw: unknown): UserPrefs {
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

function ProfileAvatar({ pic, size, className = "" }: { pic: string; size: number; className?: string }) {
  if (pic) {
    return (
      <img
        src={pic}
        alt=""
        className={`rounded-full object-cover border flex-shrink-0 ${className}`}
        style={{ width: size, height: size, borderColor: "var(--v-line-strong)", background: "var(--v-line)" }}
      />
    );
  }
  return (
    <div
      className={`rounded-full flex items-center justify-center border flex-shrink-0 ${className}`}
      style={{ width: size, height: size, borderColor: "var(--v-line-strong)", background: "var(--v-line)" }}
    >
      <UserIcon size={Math.round(size * 0.45)} style={{ color: "var(--v-ink-dim)" }} />
    </div>
  );
}

/** Shimmer bar for text / numeric placeholders */
function TextSkeleton({
  width = "4rem", height = "0.75rem", className = "", rounded = "rounded-md",
}: {
  width?: string | number;
  height?: string | number;
  className?: string;
  rounded?: string;
}) {
  return (
    <span
      className={`v-skeleton ${rounded} ${className}`}
      style={{ width, height }}
      aria-hidden
    />
  );
}

/** Animated chart wave loader */
function ChartSkeleton({ height = 260, className = "" }: { height?: number; className?: string }) {
  const uid = useId();
  const fillId = `chart-skel-fill-${uid}`;
  return (
    <div
      className={`v-chart-loader flex items-center justify-center ${className}`}
      style={{ height }}
      role="status"
      aria-label="Loading chart"
    >
      <svg viewBox="0 0 320 120" preserveAspectRatio="none" aria-hidden>
        <defs>
          <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--v-ink-dim)" stopOpacity="0.22" />
            <stop offset="100%" stopColor="var(--v-ink-dim)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path
          className="v-chart-fill"
          d="M8 88 C 40 86, 52 40, 80 48 S 120 96, 150 70 S 200 20, 230 36 S 280 90, 312 58 L 312 120 L 8 120 Z"
          fill={`url(#${fillId})`}
        />
        <path
          className="v-chart-path"
          d="M8 88 C 40 86, 52 40, 80 48 S 120 96, 150 70 S 200 20, 230 36 S 280 90, 312 58"
        />
      </svg>
    </div>
  );
}

/** Live $/% change for the selected chart range (1D = day quote). */
function useRangeChange(symbol: string, range: TimeRange, stock: StockMeta, refreshKey = 0) {
  const [delta, setDelta] = useState(() => quoteChangeForRange(symbol, range, stock));
  const [loading, setLoading] = useState(() => {
    if (range === "1D") return false;
    return getHistory(symbol, range, stock.price).length < 2
      && getHistory(symbol, range, stock.price, { resolution: "spark" }).length < 2;
  });
  const stockRef = useRef(stock);
  stockRef.current = stock;

  useEffect(() => {
    let cancelled = false;
    const s = stockRef.current;

    if (range === "1D") {
      setDelta({ change: s.change, changePercent: s.changePercent });
      setLoading(false);
      return;
    }

    // Hold previous delta + show loading until spark history for this range is ready
    setLoading(true);
    fetchHistory(symbol, range, s.price, { resolution: "spark" })
      .then(() => {
        if (cancelled) return;
        setDelta(quoteChangeForRange(symbol, range, stockRef.current));
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setDelta(quoteChangeForRange(symbol, range, stockRef.current));
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [symbol, range, refreshKey]);

  // Keep 1D day-change in sync when quote updates (without flashing loaders)
  useEffect(() => {
    if (range !== "1D") return;
    setDelta({ change: stock.change, changePercent: stock.changePercent });
  }, [range, stock.change, stock.changePercent]);

  return { change: delta.change, changePercent: delta.changePercent, loading };
}

const NAV_ITEMS: { id: AppPage; label: string }[] = [
  { id: "home",      label: "Home" },
  { id: "portfolio", label: "Portfolio" },
  { id: "bank",      label: "Bank" },
  { id: "account",   label: "Account" },
];

// ─── MiniSparkline ─────────────────────────────────────────────────────────────

function MiniSparkline({ symbol, range, isGain, height = 52, lastPrice, refreshKey = 0 }: {
  symbol: string; range: TimeRange; isGain: boolean; height?: number; lastPrice?: number; refreshKey?: number;
}) {
  const [data, setData] = useState(() => getHistory(symbol, range, lastPrice, { resolution: "spark" }));
  const [loading, setLoading] = useState(() => getHistory(symbol, range, lastPrice, { resolution: "spark" }).length < 2);
  const uid = useId();
  const gradId = `spark-${uid}`;
  const chartData = useMemo(
    () => downsampleLTTB(data, sparklineMaxPoints(range)),
    [data, range],
  );
  const seriesGain = chartData.length >= 2 ? chartData[chartData.length - 1].p >= chartData[0].p : isGain;
  const color = seriesGain ? G : R;
  const domain = useMemo(() => priceDomain(chartData), [chartData]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchHistory(symbol, range, lastPrice, { resolution: "spark" }).then(pts => {
      if (cancelled) return;
      setData(pts);
      setLoading(false);
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [symbol, range, lastPrice, refreshKey]);

  if (loading || chartData.length < 2) {
    return <ChartSkeleton height={height} className="rounded-md" />;
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={chartData} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor={color} stopOpacity={0.18} />
            <stop offset="95%" stopColor={color} stopOpacity={0}    />
          </linearGradient>
        </defs>
        {/* Critical: without a tight domain, Recharts scales from 0 → flat line */}
        <YAxis hide domain={domain} />
        <Area
          type="linear" dataKey="p"
          stroke={color} strokeWidth={1.5}
          fill={`url(#${gradId})`}
          dot={false} isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ─── CardMenu ──────────────────────────────────────────────────────────────────

function CardMenu({
  symbol, watchlists, isPinned, onTogglePin, onToggleWatchlist, onClose,
}: {
  symbol: string;
  watchlists: Watchlist[];
  isPinned: boolean;
  onTogglePin: () => void;
  onToggleWatchlist: (id: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute right-0 top-8 z-50 min-w-[176px] rounded-xl border py-1.5 shadow-2xl"
      style={{ background: "var(--v-panel)", borderColor: "var(--v-line-strong)" }}
      onClick={e => e.stopPropagation()}
    >
      <button
        className="w-full text-left px-3 py-2 text-xs flex items-center gap-2.5 transition-colors hover:bg-white/5"
        style={{ color: "var(--v-ink)" }}
        onClick={() => onTogglePin()}
      >
        <Star size={11} fill={isPinned ? G : "none"} style={{ color: isPinned ? G : "var(--v-ink-dim)", flexShrink: 0 }} />
        {isPinned ? "Unpin from top" : "Pin to top"}
      </button>

      <div className="my-1 mx-3" style={{ borderTop: "1px solid var(--v-line)" }} />

      <div className="px-3 pb-1 text-[10px] font-mono uppercase tracking-widest" style={{ color: "var(--v-ink-dim)" }}>
        Add to watchlist
      </div>
      {watchlists.filter(w => w.id !== "portfolio").length === 0 && (
        <div className="px-3 py-1.5 text-xs" style={{ color: "var(--v-ink-dim)" }}>No lists yet</div>
      )}
      {watchlists.filter(w => w.id !== "portfolio").map(wl => {
        const has = wl.symbols.includes(symbol);
        return (
          <button
            key={wl.id}
            className="w-full text-left px-3 py-1.5 text-xs flex items-center gap-2.5 transition-colors hover:bg-white/5"
            style={{ color: "var(--v-ink)" }}
            onClick={() => onToggleWatchlist(wl.id)}
          >
            {has
              ? <Check size={10} color={G} style={{ flexShrink: 0 }} />
              : <Plus  size={10} style={{ color: "var(--v-ink-dim)", flexShrink: 0 }} />}
            {wl.name}
          </button>
        );
      })}
    </div>
  );
}

// ─── TradeMenu (portfolio card ⋮) ──────────────────────────────────────────────

function TradeMenu({
  onBuy, onSell, onClose,
}: {
  onBuy: () => void;
  onSell: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute right-0 top-8 z-50 min-w-[148px] rounded-xl border py-1.5 shadow-2xl"
      style={{ background: "var(--v-panel)", borderColor: "var(--v-line-strong)" }}
      onClick={e => e.stopPropagation()}
    >
      <button
        className="w-full text-left px-3 py-2 text-xs flex items-center gap-2.5 transition-colors hover:bg-white/5"
        style={{ color: "var(--v-ink)" }}
        onClick={() => { onBuy(); onClose(); }}
      >
        <Plus size={11} style={{ color: G, flexShrink: 0 }} />
        Buy shares
      </button>
      <button
        className="w-full text-left px-3 py-2 text-xs flex items-center gap-2.5 transition-colors hover:bg-white/5"
        style={{ color: "var(--v-ink)" }}
        onClick={() => { onSell(); onClose(); }}
      >
        <Minus size={11} style={{ color: R, flexShrink: 0 }} />
        Sell shares
      </button>
    </div>
  );
}

// ─── WatchlistAddMenu (for search results) ─────────────────────────────────────

function WatchlistAddMenu({
  symbol, watchlists, onToggle, onClose,
}: {
  symbol: string;
  watchlists: Watchlist[];
  onToggle: (id: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [onClose]);

  const lists = watchlists.filter(w => w.id !== "portfolio");

  return (
    <div
      ref={ref}
      className="absolute left-0 top-7 z-[80] min-w-[164px] rounded-xl border py-1.5 shadow-2xl"
      style={{ background: "var(--v-panel)", borderColor: "var(--v-line-strong)" }}
      onMouseDown={e => e.preventDefault()}
    >
      <div className="px-3 pb-1 text-[10px] font-mono uppercase tracking-widest" style={{ color: "var(--v-ink-dim)" }}>
        Add to watchlist
      </div>
      {lists.length === 0 && (
        <div className="px-3 py-1.5 text-xs" style={{ color: "var(--v-ink-dim)" }}>No lists yet</div>
      )}
      {lists.map(wl => {
        const has = wl.symbols.includes(symbol);
        return (
          <button
            key={wl.id}
            className="w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors hover:bg-white/5"
            style={{ color: "var(--v-ink)" }}
            onClick={() => onToggle(wl.id)}
          >
            {has
              ? <Check size={10} color={G} style={{ flexShrink: 0 }} />
              : <Plus  size={10} style={{ color: "var(--v-ink-dim)", flexShrink: 0 }} />}
            {wl.name}
          </button>
        );
      })}
    </div>
  );
}

// ─── SearchDropdown ────────────────────────────────────────────────────────────

function SearchDropdown({
  query, stocks, watchlists, onSelectSymbol, onToggleWatchlist, onClose, onStocksHydrated, refreshKey = 0,
  anchorRef,
}: {
  query: string;
  stocks: StockMeta[];
  watchlists: Watchlist[];
  onSelectSymbol: (symbol: string) => void;
  onToggleWatchlist: (watchlistId: string, symbol: string) => void;
  onClose: () => void;
  onStocksHydrated?: (stocks: StockMeta[]) => void;
  refreshKey?: number;
  anchorRef?: React.RefObject<HTMLElement | null>;
}) {
  const [addMenuFor, setAddMenuFor] = useState<string | null>(null);
  const [remote, setRemote] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [localSpark, setLocalSpark] = useState(0);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 1) {
      setRemote([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const t = window.setTimeout(() => {
      searchStocks(q)
        .then(rows => { if (!cancelled) setRemote(rows); })
        .catch(() => { if (!cancelled) setRemote([]); })
        .finally(() => { if (!cancelled) setLoading(false); });
    }, 220);
    return () => { cancelled = true; window.clearTimeout(t); };
  }, [query]);

  // Load live quotes + 1D history for every search hit so sparklines/prices match market data
  useEffect(() => {
    if (!remote.length) return;
    let cancelled = false;
    const syms = remote.map(r => r.symbol);
    mergeQuotes(syms)
      .then(async live => {
        if (cancelled) return;
        onStocksHydrated?.([...live]);
        await prefetchSparklines(syms, "1D");
        // nudge re-render after history lands
        if (!cancelled) {
          setLocalSpark(n => n + 1);
          onStocksHydrated?.([...STOCKS_META]);
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [remote, onStocksHydrated]);

  const results = useMemo(() => {
    return remote.slice(0, 10).map(hit => {
      const live = stocks.find(m => m.symbol === hit.symbol);
      if (live) return live;
      return {
        symbol: hit.symbol,
        name: hit.name,
        sector: hit.sector || "—",
        price: 0, change: 0, changePercent: 0, volume: 0, avgVolume: 0,
        marketCap: 0, pe: null, high52w: 0, low52w: 0, open: 0, dayHigh: 0, dayLow: 0,
        eps: null, dividendYield: null, afterHours: null, preMarket: null,
      } satisfies StockMeta;
    });
  }, [remote, stocks]);

  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || anchorRef?.current?.contains(t)) return;
      onClose();
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [onClose, anchorRef]);

  useLayoutEffect(() => {
    const el = anchorRef?.current;
    if (!el) {
      setPos(null);
      return;
    }
    const update = () => {
      const r = el.getBoundingClientRect();
      setPos({ top: r.bottom + 6, left: r.left, width: r.width });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [anchorRef, query, loading, results.length]);

  if (!query.trim() || !pos) return null;

  const panelStyle = {
    top: pos.top,
    left: pos.left,
    width: pos.width,
    background: "var(--v-panel)",
    borderColor: "var(--v-line-strong)",
  } as const;

  if (!loading && results.length === 0) {
    return createPortal(
      <div
        ref={ref}
        className="fixed z-[200] rounded-2xl border shadow-2xl px-3 py-3 text-xs font-mono"
        style={{ ...panelStyle, color: "var(--v-ink-dim)" }}
        onMouseDown={e => e.preventDefault()}
      >
        No stocks found
      </div>,
      document.body,
    );
  }

  return createPortal(
    <div
      ref={ref}
      className="fixed z-[200] rounded-2xl border shadow-2xl overflow-visible"
      style={panelStyle}
      onMouseDown={e => e.preventDefault()}
    >
      <div
        className="px-3 py-2 text-[10px] font-mono uppercase tracking-widest border-b rounded-t-2xl flex items-center gap-2"
        style={{ color: "var(--v-ink-dim)", borderColor: "var(--v-line)" }}
      >
        {loading && results.length === 0 ? (
          <>
            <TextSkeleton width="4.5rem" height="0.55rem" />
          </>
        ) : (
          `${results.length} result${results.length !== 1 ? "s" : ""}`
        )}
      </div>
      <div className="rounded-b-2xl overflow-visible">
      {loading && results.length === 0 ? (
        Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className={`flex items-center gap-3 px-3 py-2.5 border-b ${i === 3 ? "border-0 rounded-b-2xl" : ""}`}
            style={{ borderColor: "var(--v-line)" }}
          >
            <TextSkeleton width={24} height={24} rounded="rounded-lg" />
            <div className="flex-1 flex flex-col gap-1.5 min-w-0">
              <TextSkeleton width="3.5rem" height="0.7rem" />
              <TextSkeleton width="8rem" height="0.55rem" />
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <TextSkeleton width="3.25rem" height="0.7rem" />
              <TextSkeleton width="2.5rem" height="0.55rem" />
            </div>
          </div>
        ))
      ) : results.map((stock, idx) => {
        const isGain = stock.changePercent >= 0;
        const inAnyList = watchlists.some(w => w.symbols.includes(stock.symbol));
        const isLast = idx === results.length - 1;
        return (
          <div
            key={stock.symbol}
            className={`group/row relative flex items-center gap-3 px-3 py-2.5 transition-colors hover:bg-white/5 border-b ${isLast ? "border-0 rounded-b-2xl" : ""}`}
            style={{ borderColor: "var(--v-line)", zIndex: addMenuFor === stock.symbol ? 70 : 1 }}
          >
            <div className="relative flex-shrink-0" style={{ zIndex: addMenuFor === stock.symbol ? 80 : undefined }} onClick={e => e.stopPropagation()}>
              <button
                className="w-6 h-6 rounded-lg flex items-center justify-center transition-all hover:bg-white/10"
                style={{
                  background: inAnyList ? "rgba(52,211,153,0.12)" : "var(--v-line-strong)",
                  color: inAnyList ? G : "var(--v-ink-dim)",
                }}
                onClick={() => setAddMenuFor(v => v === stock.symbol ? null : stock.symbol)}
                title="Add to watchlist"
              >
                {inAnyList
                  ? <Check size={10} />
                  : <Plus  size={10} />}
              </button>
              {addMenuFor === stock.symbol && (
                <WatchlistAddMenu
                  symbol={stock.symbol}
                  watchlists={watchlists}
                  onToggle={id => onToggleWatchlist(id, stock.symbol)}
                  onClose={() => setAddMenuFor(null)}
                />
              )}
            </div>

            <button
              className="flex-1 flex items-center gap-3 min-w-0 text-left"
              onClick={() => { onSelectSymbol(stock.symbol); onClose(); }}
            >
              <div className="min-w-0 flex-1">
                <div className="font-mono text-[12px] font-semibold tracking-wide" style={{ color: "var(--v-ink)" }}>
                  {stock.symbol}
                </div>
                <div className="text-[11px] truncate" style={{ color: "var(--v-ink-dim)" }}>
                  {stock.name}
                </div>
              </div>

              <div className="w-16 flex-shrink-0 opacity-70">
                <MiniSparkline
                  symbol={stock.symbol}
                  range="1D"
                  isGain={isGain}
                  height={28}
                  lastPrice={stock.price > 0 ? stock.price : undefined}
                  refreshKey={(refreshKey ?? 0) + localSpark}
                />
              </div>

              <div className="flex-shrink-0 text-right">
                {stock.price > 0 ? (
                  <>
                    <div className="font-mono text-[12px] font-semibold" style={{ color: "var(--v-ink)" }}>
                      {fmt$(stock.price)}
                    </div>
                    <div
                      className="text-[10px] font-mono font-medium"
                      style={{ color: isGain ? G : R }}
                    >
                      {fmtPct(stock.changePercent)}
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-end gap-1">
                    <TextSkeleton width="3.25rem" height="0.7rem" />
                    <TextSkeleton width="2.5rem" height="0.55rem" />
                  </div>
                )}
              </div>
            </button>
          </div>
        );
      })}
      </div>
    </div>,
    document.body,
  );
}

// ─── StockCard (grid) ──────────────────────────────────────────────────────────

function StockCard({
  stock, range, watchlists, isPinned, isDraggable, isDragOver,
  holding, onSelect, onToggleWatchlist, onTogglePin, onTrade,
  onDragStart, onDragOver, onDragEnd, refreshKey = 0, changeDisplay = "percent",
}: {
  stock: StockMeta; range: TimeRange; watchlists: Watchlist[];
  isPinned: boolean; isDraggable: boolean; isDragOver: boolean;
  holding?: Holding;
  refreshKey?: number;
  changeDisplay?: ChangeDisplay;
  onTrade?: (symbol: string, mode: "buy" | "sell") => void;
  onSelect: () => void;
  onToggleWatchlist: (watchlistId: string, symbol: string) => void;
  onTogglePin: (symbol: string) => void;
  onDragStart: (symbol: string) => void;
  onDragOver: (symbol: string) => void;
  onDragEnd: () => void;
}) {
  const delta = useRangeChange(stock.symbol, range, stock, refreshKey);
  const isGain = delta.changePercent >= 0;
  const [menuOpen, setMenuOpen] = useState(false);
  const profit = holding ? (stock.price - holding.avgCost) * holding.shares : 0;
  const profitPct = holding && holding.avgCost > 0
    ? ((stock.price - holding.avgCost) / holding.avgCost) * 100
    : 0;
  const profitUp = profit >= 0;

  return (
    <div
      className="group relative flex flex-col gap-3 p-4 rounded-2xl border transition-all duration-150"
      style={{
        background:   "var(--v-panel)",
        borderColor:  isDragOver ? "var(--v-ink-soft)" : isPinned ? "rgba(52,211,153,0.35)" : "var(--v-line)",
        boxShadow:    isDragOver ? "0 0 0 2px color-mix(in srgb, var(--v-ink) 15%, transparent)" : undefined,
        cursor:       isDraggable ? "grab" : "pointer",
        opacity:      isDragOver ? 0.7 : 1,
      }}
      draggable={isDraggable}
      onDragStart={isDraggable ? e => { e.dataTransfer.effectAllowed = "move"; onDragStart(stock.symbol); } : undefined}
      onDragOver={isDraggable ? e => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; onDragOver(stock.symbol); } : undefined}
      onDragEnd={isDraggable ? onDragEnd : undefined}
      onClick={onSelect}
      onMouseEnter={e => { if (!isDragOver && !isPinned) e.currentTarget.style.borderColor = "var(--v-line-strong)"; }}
      onMouseLeave={e => { if (!isDragOver && !isPinned) e.currentTarget.style.borderColor = "var(--v-line)"; }}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-mono text-[13px] font-semibold tracking-wider flex items-center gap-1.5" style={{ color: "var(--v-ink)" }}>
            {stock.symbol}
            {isPinned && <Star size={11} fill={G} style={{ color: G, flexShrink: 0 }} />}
          </div>
          <div className="text-[11px] truncate mt-0.5" style={{ color: "var(--v-ink-dim)" }}>
            {stock.name}
          </div>
        </div>
        <div className="relative flex-shrink-0" onClick={e => e.stopPropagation()}>
          <button
            className="w-6 h-6 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ background: "var(--v-line-strong)" }}
            onClick={() => setMenuOpen(v => !v)}
          >
            <MoreHorizontal size={12} style={{ color: "var(--v-ink-soft)" }} />
          </button>
          {menuOpen && (holding ? (
            <TradeMenu
              onBuy={() => onTrade?.(stock.symbol, "buy")}
              onSell={() => onTrade?.(stock.symbol, "sell")}
              onClose={() => setMenuOpen(false)}
            />
          ) : (
            <CardMenu
              symbol={stock.symbol}
              watchlists={watchlists}
              isPinned={isPinned}
              onTogglePin={() => onTogglePin(stock.symbol)}
              onToggleWatchlist={id => onToggleWatchlist(id, stock.symbol)}
              onClose={() => setMenuOpen(false)}
            />
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {stock.price > 0 ? (
          <>
            <span className="font-mono text-[18px] font-semibold leading-none" style={{ color: "var(--v-ink)" }}>
              {fmt$(stock.price)}
            </span>
            {delta.loading ? (
              <TextSkeleton width="2.75rem" height="1.1rem" rounded="rounded-md" />
            ) : (
              <span
                className="text-[11px] font-mono font-medium px-1.5 py-0.5 rounded-md"
                style={{ color: isGain ? G : R, background: isGain ? "rgba(52,211,153,0.1)" : "rgba(248,113,130,0.1)" }}
              >
                {changeDisplay === "amount" ? fmtChangeAmt(delta.change) : fmtPct(delta.changePercent)}
              </span>
            )}
          </>
        ) : (
          <>
            <TextSkeleton width="4.5rem" height="1.1rem" />
            <TextSkeleton width="2.75rem" height="1.1rem" rounded="rounded-md" />
          </>
        )}
      </div>

      {holding ? (
        <div className="flex flex-col gap-2">
          <div className="flex justify-between items-baseline">
            <span className="text-[10px] font-mono uppercase tracking-widest" style={{ color: "var(--v-ink-dim)" }}>Shares</span>
            <span className="font-mono text-[14px] font-semibold" style={{ color: "var(--v-ink)" }}>
              {holding.shares.toLocaleString("en-US", { maximumFractionDigits: 4 })}
            </span>
          </div>
          <div className="flex justify-between items-baseline">
            <span className="text-[10px] font-mono uppercase tracking-widest" style={{ color: "var(--v-ink-dim)" }}>Profit</span>
            <span className="font-mono text-[14px] font-semibold" style={{ color: profitUp ? G : R }}>
              {profitUp ? "+" : ""}{fmt$(profit)} ({fmtPct(profitPct)})
            </span>
          </div>
          <div className="flex justify-between text-[10px] font-mono pt-1" style={{ color: "var(--v-ink-dim)", borderTop: "1px solid var(--v-line)" }}>
            <span>Avg {fmt$(holding.avgCost)}</span>
            <span>Value {fmt$(stock.price * holding.shares)}</span>
          </div>
        </div>
      ) : (
        <>
          <div className="-mx-1">
            <MiniSparkline symbol={stock.symbol} range={range} isGain={isGain} lastPrice={stock.price} refreshKey={refreshKey} />
          </div>
          <div
            className="flex justify-between text-[10px] font-mono pt-1"
            style={{ color: "var(--v-ink-dim)", borderTop: "1px solid var(--v-line)" }}
          >
            <span>Vol {fmtVol(stock.volume)}</span>
            <span>{fmtCap(stock.marketCap)}</span>
          </div>
        </>
      )}
    </div>
  );
}

// ─── StockRow (list view) ──────────────────────────────────────────────────────

/** Shared column layout so header labels + row cells stay aligned */
const LR = {
  pad: "px-4",
  symbol: "w-44 sm:w-52 flex-shrink-0 overflow-hidden text-left",
  chart:  "w-36 sm:w-44 flex-shrink-0 min-w-0 text-left",
  price:  "w-[4.75rem] flex-shrink-0 text-left tabular-nums",
  change: "w-[4.5rem] flex-shrink-0 text-left",
  volume: "w-[4.25rem] flex-shrink-0 text-left tabular-nums",
  cap:    "w-[4.25rem] flex-shrink-0 text-left tabular-nums",
  open:   "w-[4.25rem] flex-shrink-0 text-left tabular-nums",
  high:   "w-[4.25rem] flex-shrink-0 text-left tabular-nums",
  low:    "w-[4.25rem] flex-shrink-0 text-left tabular-nums",
  menu:   "w-6 flex-shrink-0",
} as const;

function ListCols(props: {
  symbol: React.ReactNode;
  chart: React.ReactNode;
  price: React.ReactNode;
  change: React.ReactNode;
  volume: React.ReactNode;
  cap: React.ReactNode;
  open: React.ReactNode;
  high: React.ReactNode;
  low: React.ReactNode;
}) {
  const { symbol, chart, price, change, volume, cap, open, high, low } = props;
  return (
    <div className="flex items-center flex-1 min-w-[44rem]">
      <div className={LR.symbol}>{symbol}</div>

      <div className="w-6 sm:w-10 flex-shrink-0" aria-hidden />

      <div className={LR.chart}>{chart}</div>

      <div className="w-8 sm:w-12 flex-shrink-0" aria-hidden />

      <div className="flex items-center gap-3 flex-shrink-0">
        <div className={LR.price}>{price}</div>
        <div className={LR.change}>{change}</div>
      </div>

      <div className="w-4 sm:w-6 flex-shrink-0" aria-hidden />

      <div className="flex items-center gap-3 flex-shrink-0">
        <div className={LR.volume}>{volume}</div>
        <div className={LR.cap}>{cap}</div>
        <div className={LR.open}>{open}</div>
        <div className={LR.high}>{high}</div>
        <div className={LR.low}>{low}</div>
      </div>
    </div>
  );
}

function ListHeader({
  sort, sortDir, changeDisplay, onColumnSort,
}: {
  sort: SortMode;
  sortDir: SortDir;
  changeDisplay: ChangeDisplay;
  onColumnSort: (s: SortMode) => void;
}) {
  const changeSort: SortMode = changeDisplay === "amount" ? "changeAmt" : "change";

  const SortLabel = ({
    mode, children,
  }: {
    mode: SortMode;
    children: React.ReactNode;
  }) => {
    const active = sort === mode;
    return (
      <button
        type="button"
        onClick={() => onColumnSort(mode)}
        className="inline-flex items-center gap-0.5 text-left text-[9px] font-mono uppercase tracking-widest"
        style={{ color: "var(--v-ink-dim)" }}
      >
        {children}
        {active && (
          <span className="normal-case tracking-normal opacity-70" aria-hidden>
            {sortDir === "asc" ? "↑" : "↓"}
          </span>
        )}
      </button>
    );
  };

  return (
    <div
      className={`flex items-center gap-3 ${LR.pad} pb-1.5 mb-1 text-[9px] font-mono uppercase tracking-widest min-w-[44rem]`}
      style={{ color: "var(--v-ink-dim)" }}
    >
      <ListCols
        symbol={<SortLabel mode="symbol">Symbol</SortLabel>}
        chart="Chart"
        price={<SortLabel mode="price">Price</SortLabel>}
        change={<SortLabel mode={changeSort}>Change</SortLabel>}
        volume={<SortLabel mode="volume">Volume</SortLabel>}
        cap={<SortLabel mode="cap">Mkt Cap</SortLabel>}
        open="Open"
        high="High"
        low="Low"
      />
      <span className={LR.menu} aria-hidden />
    </div>
  );
}

function StockRow({
  stock, range, watchlists, isPinned, isDraggable, isDragOver,
  onSelect, onToggleWatchlist, onTogglePin,
  onDragStart, onDragOver, onDragEnd, refreshKey = 0, changeDisplay = "percent",
}: {
  stock: StockMeta; range: TimeRange; watchlists: Watchlist[];
  isPinned: boolean; isDraggable: boolean; isDragOver: boolean;
  refreshKey?: number;
  changeDisplay?: ChangeDisplay;
  onSelect: () => void;
  onToggleWatchlist: (watchlistId: string, symbol: string) => void;
  onTogglePin: (symbol: string) => void;
  onDragStart: (symbol: string) => void;
  onDragOver: (symbol: string) => void;
  onDragEnd: () => void;
}) {
  const delta = useRangeChange(stock.symbol, range, stock, refreshKey);
  const isGain = delta.changePercent >= 0;
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div
      className={`group flex items-center gap-3 ${LR.pad} py-3 rounded-xl border transition-all duration-150 min-w-[44rem]`}
      style={{
        background:  "var(--v-panel)",
        borderColor: isDragOver ? "var(--v-ink-soft)" : isPinned ? "rgba(52,211,153,0.35)" : "var(--v-line)",
        opacity:     isDragOver ? 0.7 : 1,
        cursor:      isDraggable ? "grab" : "pointer",
      }}
      draggable={isDraggable}
      onDragStart={isDraggable ? e => { e.dataTransfer.effectAllowed = "move"; onDragStart(stock.symbol); } : undefined}
      onDragOver={isDraggable ? e => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; onDragOver(stock.symbol); } : undefined}
      onDragEnd={isDraggable ? onDragEnd : undefined}
      onClick={onSelect}
      onMouseEnter={e => { if (!isDragOver && !isPinned) e.currentTarget.style.borderColor = "var(--v-line-strong)"; }}
      onMouseLeave={e => { if (!isDragOver && !isPinned) e.currentTarget.style.borderColor = "var(--v-line)"; }}
    >
      <ListCols
        symbol={(
          <>
            <div className="font-mono text-[13px] font-semibold tracking-wider flex items-center gap-1.5 truncate" style={{ color: "var(--v-ink)" }}>
              {stock.symbol}
              {isPinned && <Star size={8} fill={G} style={{ color: G, flexShrink: 0 }} />}
            </div>
            <div className="text-[11px] truncate" style={{ color: "var(--v-ink-dim)" }}>{stock.name}</div>
          </>
        )}
        chart={<MiniSparkline symbol={stock.symbol} range={range} isGain={isGain} height={44} lastPrice={stock.price > 0 ? stock.price : undefined} refreshKey={refreshKey} />}
        price={stock.price > 0 ? (
          <span className="font-mono text-[14px] font-semibold truncate" style={{ color: "var(--v-ink)" }}>
            {fmt$(stock.price)}
          </span>
        ) : (
          <TextSkeleton width="3.5rem" height="0.85rem" />
        )}
        change={stock.price > 0 && !delta.loading ? (
          <span
            className="flex w-fit items-center text-[11px] font-mono font-medium px-1.5 py-0.5 rounded-md truncate max-w-full"
            style={{ color: isGain ? G : R, background: isGain ? "rgba(52,211,153,0.1)" : "rgba(248,113,130,0.1)" }}
          >
            {changeDisplay === "amount" ? fmtChangeAmt(delta.change) : fmtPct(delta.changePercent)}
          </span>
        ) : (
          <TextSkeleton width="2.75rem" height="1.1rem" rounded="rounded-md" />
        )}
        volume={stock.volume > 0 ? (
          <span className="font-mono text-[11px] truncate" style={{ color: "var(--v-ink-dim)" }}>
            {fmtVol(stock.volume)}
          </span>
        ) : (
          <TextSkeleton width="2.5rem" height="0.65rem" />
        )}
        cap={stock.marketCap > 0 ? (
          <span className="font-mono text-[11px] truncate" style={{ color: "var(--v-ink-dim)" }}>
            {fmtCap(stock.marketCap)}
          </span>
        ) : (
          <TextSkeleton width="2.75rem" height="0.65rem" />
        )}
        open={stock.open > 0 ? (
          <span className="font-mono text-[11px] truncate" style={{ color: "var(--v-ink-dim)" }}>
            {fmt$(stock.open)}
          </span>
        ) : (
          <TextSkeleton width="2.75rem" height="0.65rem" />
        )}
        high={stock.dayHigh > 0 ? (
          <span className="font-mono text-[11px] truncate" style={{ color: "var(--v-ink-dim)" }}>
            {fmt$(stock.dayHigh)}
          </span>
        ) : (
          <TextSkeleton width="2.75rem" height="0.65rem" />
        )}
        low={stock.dayLow > 0 ? (
          <span className="font-mono text-[11px] truncate" style={{ color: "var(--v-ink-dim)" }}>
            {fmt$(stock.dayLow)}
          </span>
        ) : (
          <TextSkeleton width="2.75rem" height="0.65rem" />
        )}
      />

      <div className={`relative ${LR.menu}`} onClick={e => e.stopPropagation()}>
        <button
          className="w-6 h-6 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ background: "var(--v-line-strong)" }}
          onClick={() => setMenuOpen(v => !v)}
        >
          <MoreHorizontal size={12} style={{ color: "var(--v-ink-soft)" }} />
        </button>
        {menuOpen && (
          <CardMenu
            symbol={stock.symbol}
            watchlists={watchlists}
            isPinned={isPinned}
            onTogglePin={() => onTogglePin(stock.symbol)}
            onToggleWatchlist={id => onToggleWatchlist(id, stock.symbol)}
            onClose={() => setMenuOpen(false)}
          />
        )}
      </div>
    </div>
  );
}

// ─── Holding list (portfolio) ──────────────────────────────────────────────────

const HR = {
  pad: "px-4",
  symbol: "w-44 sm:w-52 flex-shrink-0 overflow-hidden text-left",
  price:  "w-[4.75rem] flex-shrink-0 text-left tabular-nums",
  change: "w-[4.5rem] flex-shrink-0 text-left",
  shares: "w-[4.5rem] flex-shrink-0 text-left tabular-nums",
  avg:    "w-[4.75rem] flex-shrink-0 text-left tabular-nums",
  profit: "w-[6.25rem] flex-shrink-0 text-left tabular-nums",
  value:  "w-[5rem] flex-shrink-0 text-left tabular-nums",
  menu:   "w-6 flex-shrink-0",
} as const;

function HoldingCols(props: {
  symbol: React.ReactNode;
  price: React.ReactNode;
  change: React.ReactNode;
  shares: React.ReactNode;
  avg: React.ReactNode;
  profit: React.ReactNode;
  value: React.ReactNode;
}) {
  const { symbol, price, change, shares, avg, profit, value } = props;
  return (
    <div className="flex items-center flex-1 min-w-[43.25rem]">
      <div className={HR.symbol}>{symbol}</div>
      <div className="w-6 sm:w-10 flex-shrink-0" aria-hidden />
      <div className="flex items-center gap-3 flex-shrink-0">
        <div className={HR.price}>{price}</div>
        <div className={HR.change}>{change}</div>
      </div>
      <div className="w-5 sm:w-8 flex-shrink-0" aria-hidden />
      <div className="flex items-center gap-5 flex-shrink-0">
        <div className={HR.shares}>{shares}</div>
        <div className={HR.avg}>{avg}</div>
        <div className={HR.profit}>{profit}</div>
        <div className={HR.value}>{value}</div>
      </div>
      <div className="flex-1 min-w-[0.5rem]" aria-hidden />
    </div>
  );
}

function HoldingListHeader({
  sort, sortDir, changeDisplay, onColumnSort,
}: {
  sort: SortMode;
  sortDir: SortDir;
  changeDisplay: ChangeDisplay;
  onColumnSort: (s: SortMode) => void;
}) {
  const changeSort: SortMode = changeDisplay === "amount" ? "changeAmt" : "change";

  const SortLabel = ({ mode, children }: { mode: SortMode; children: React.ReactNode }) => {
    const active = sort === mode;
    return (
      <button
        type="button"
        onClick={() => onColumnSort(mode)}
        className="inline-flex items-center gap-0.5 text-left text-[9px] font-mono uppercase tracking-widest"
        style={{ color: "var(--v-ink-dim)" }}
      >
        {children}
        {active && (
          <span className="normal-case tracking-normal opacity-70" aria-hidden>
            {sortDir === "asc" ? "↑" : "↓"}
          </span>
        )}
      </button>
    );
  };

  return (
    <div
      className={`flex items-center gap-3 ${HR.pad} pb-1.5 mb-1 text-[9px] font-mono uppercase tracking-widest min-w-[43.25rem]`}
      style={{ color: "var(--v-ink-dim)" }}
    >
      <HoldingCols
        symbol={<SortLabel mode="symbol">Symbol</SortLabel>}
        price={<SortLabel mode="price">Price</SortLabel>}
        change={<SortLabel mode={changeSort}>Change</SortLabel>}
        shares="Shares"
        avg="Avg cost"
        profit="Profit"
        value="Value"
      />
      <span className={HR.menu} aria-hidden />
    </div>
  );
}

function HoldingRow({
  stock, holding, range, watchlists, isPinned,
  onSelect, onToggleWatchlist, onTogglePin,
  refreshKey = 0, changeDisplay = "percent",
}: {
  stock: StockMeta;
  holding: Holding;
  range: TimeRange;
  watchlists: Watchlist[];
  isPinned: boolean;
  refreshKey?: number;
  changeDisplay?: ChangeDisplay;
  onSelect: () => void;
  onToggleWatchlist: (watchlistId: string, symbol: string) => void;
  onTogglePin: (symbol: string) => void;
}) {
  const delta = useRangeChange(stock.symbol, range, stock, refreshKey);
  const isGain = delta.changePercent >= 0;
  const [menuOpen, setMenuOpen] = useState(false);
  const value = stock.price * holding.shares;
  const profit = (stock.price - holding.avgCost) * holding.shares;
  const profitPct = holding.avgCost > 0 ? ((stock.price - holding.avgCost) / holding.avgCost) * 100 : 0;

  return (
    <div
      className={`group flex items-center gap-3 ${HR.pad} py-3 rounded-xl border transition-all duration-150 min-w-[43.25rem]`}
      style={{
        background:  "var(--v-panel)",
        borderColor: isPinned ? "rgba(52,211,153,0.35)" : "var(--v-line)",
        cursor: "pointer",
      }}
      onClick={onSelect}
      onMouseEnter={e => { if (!isPinned) e.currentTarget.style.borderColor = "var(--v-line-strong)"; }}
      onMouseLeave={e => { if (!isPinned) e.currentTarget.style.borderColor = "var(--v-line)"; }}
    >
      <HoldingCols
        symbol={(
          <>
            <div className="font-mono text-[13px] font-semibold tracking-wider flex items-center gap-1.5 truncate" style={{ color: "var(--v-ink)" }}>
              {stock.symbol}
              {isPinned && <Star size={8} fill={G} style={{ color: G, flexShrink: 0 }} />}
            </div>
            <div className="text-[11px] truncate" style={{ color: "var(--v-ink-dim)" }}>{stock.name}</div>
          </>
        )}
        price={stock.price > 0 ? (
          <span className="font-mono text-[14px] font-semibold truncate" style={{ color: "var(--v-ink)" }}>
            {fmt$(stock.price)}
          </span>
        ) : (
          <TextSkeleton width="3.5rem" height="0.85rem" />
        )}
        change={stock.price > 0 && !delta.loading ? (
          <span
            className="flex w-fit items-center text-[11px] font-mono font-medium px-1.5 py-0.5 rounded-md truncate max-w-full"
            style={{ color: isGain ? G : R, background: isGain ? "rgba(52,211,153,0.1)" : "rgba(248,113,130,0.1)" }}
          >
            {changeDisplay === "amount" ? fmtChangeAmt(delta.change) : fmtPct(delta.changePercent)}
          </span>
        ) : (
          <TextSkeleton width="2.75rem" height="1.1rem" rounded="rounded-md" />
        )}
        shares={(
          <span className="font-mono text-[11px] truncate" style={{ color: "var(--v-ink-dim)" }}>
            {holding.shares.toLocaleString("en-US", { maximumFractionDigits: 4 })}
          </span>
        )}
        avg={(
          <span className="font-mono text-[11px] truncate" style={{ color: "var(--v-ink-dim)" }}>
            {fmt$(holding.avgCost)}
          </span>
        )}
        profit={stock.price > 0 ? (
          // Gain/loss is always shown as both $ and %, independent of the
          // change-display toggle — that toggle is for the price column.
          <div className="flex flex-col leading-tight min-w-0" style={{ color: profit >= 0 ? G : R }}>
            <span className="font-mono text-[11px] truncate">
              {profit >= 0 ? "+" : ""}{fmt$(profit)}
            </span>
            <span className="font-mono text-[10px] opacity-75 truncate">
              {fmtPct(profitPct)}
            </span>
          </div>
        ) : (
          <TextSkeleton width="2.75rem" height="0.65rem" />
        )}
        value={stock.price > 0 ? (
          <span className="font-mono text-[11px] truncate" style={{ color: "var(--v-ink)" }}>
            {fmt$(value)}
          </span>
        ) : (
          <TextSkeleton width="3rem" height="0.65rem" />
        )}
      />

      <div className={`relative ${HR.menu}`} onClick={e => e.stopPropagation()}>
        <button
          className="w-6 h-6 rounded-lg flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ background: "var(--v-line-strong)" }}
          onClick={() => setMenuOpen(v => !v)}
        >
          <MoreHorizontal size={12} style={{ color: "var(--v-ink-soft)" }} />
        </button>
        {menuOpen && (
          <CardMenu
            symbol={stock.symbol}
            watchlists={watchlists}
            isPinned={isPinned}
            onTogglePin={() => onTogglePin(stock.symbol)}
            onToggleWatchlist={id => onToggleWatchlist(id, stock.symbol)}
            onClose={() => setMenuOpen(false)}
          />
        )}
      </div>
    </div>
  );
}

// ─── WatchlistSidebar ──────────────────────────────────────────────────────────

function WatchlistItemMenu({
  onRename, onDelete, onClose,
}: {
  onRename: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute right-0 top-7 z-50 min-w-[124px] rounded-xl border py-1.5 shadow-2xl"
      style={{ background: "var(--v-panel)", borderColor: "var(--v-line-strong)" }}
      onClick={e => e.stopPropagation()}
    >
      <button
        className="w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors hover:bg-white/5"
        style={{ color: "var(--v-ink)" }}
        onClick={onRename}
      >
        Rename
      </button>
      <button
        className="w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors hover:bg-white/5"
        style={{ color: R }}
        onClick={onDelete}
      >
        Delete
      </button>
    </div>
  );
}

function WatchlistSidebar({
  watchlists, activeId, onSelect, onCreate, onDelete, onRename, onReorder, open,
}: {
  watchlists: Watchlist[];
  activeId: string;
  onSelect: (id: string) => void;
  onCreate: (name: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onReorder: (fromId: string, toId: string) => void;
  open: boolean;
}) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const dragIdRef = useRef<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<Watchlist | null>(null);
  const renameRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (creating) inputRef.current?.focus(); }, [creating]);
  useEffect(() => { if (renamingId) renameRef.current?.focus(); }, [renamingId]);

  const submit = () => {
    if (name.trim()) { onCreate(name.trim()); setName(""); setCreating(false); }
  };

  const commitRename = () => {
    if (renamingId && renameValue.trim()) onRename(renamingId, renameValue.trim());
    setRenamingId(null);
    setRenameValue("");
  };

  const finishDrag = () => {
    const from = dragIdRef.current;
    const to = dragOverId;
    dragIdRef.current = null;
    setDragOverId(null);
    if (from && to && from !== to) onReorder(from, to);
  };

  const allStocks = watchlists.find(w => w.id === "portfolio");
  const userLists = watchlists.filter(w => w.id !== "portfolio");

  return (
    <aside
      className={`flex flex-col flex-shrink-0 border-r overflow-hidden transition-[width,opacity] duration-200 ease-out ${
        open ? "w-40 sm:w-52 opacity-100" : "w-0 opacity-0 border-r-0 pointer-events-none"
      }`}
      style={{ background: "var(--v-panel)", borderColor: "var(--v-line)" }}
      aria-hidden={!open}
    >
      <div className="px-3 pt-4 pb-4 flex-1 overflow-y-auto w-40 sm:w-52">
        <div className="flex items-center justify-between px-2 mb-1.5">
          <div className="text-[9px] font-mono font-semibold tracking-[0.15em] uppercase" style={{ color: "var(--v-ink-dim)" }}>
            Watchlists
          </div>
          <button
            className="w-5 h-5 rounded flex items-center justify-center hover:bg-white/10 transition-colors"
            onClick={() => setCreating(true)}
          >
            <Plus size={12} style={{ color: "var(--v-ink-dim)" }} />
          </button>
        </div>

        {allStocks && (
          <SidebarItem
            label="All Stocks"
            count={allStocks.symbols.length}
            active={activeId === "portfolio"}
            onClick={() => onSelect("portfolio")}
          />
        )}

        {userLists.map(wl => (
          renamingId === wl.id ? (
            <div key={wl.id} className="px-2 mt-1">
              <input
                ref={renameRef}
                value={renameValue}
                onChange={e => setRenameValue(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter") commitRename();
                  if (e.key === "Escape") { setRenamingId(null); setRenameValue(""); }
                }}
                onBlur={commitRename}
                className="w-full px-2.5 py-1.5 rounded-lg text-xs outline-none"
                style={{
                  background: "var(--v-line-strong)", color: "var(--v-ink)",
                  border: "1px solid var(--v-line-strong)", fontFamily: "Geist Mono, monospace",
                }}
              />
            </div>
          ) : (
            <div
              key={wl.id}
              className="group/item relative flex items-center"
              style={{ opacity: dragOverId === wl.id ? 0.6 : 1, cursor: "grab" }}
              draggable
              onDragStart={e => { e.dataTransfer.effectAllowed = "move"; dragIdRef.current = wl.id; }}
              onDragOver={e => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; setDragOverId(wl.id); }}
              onDragEnd={finishDrag}
            >
              <SidebarItem
                label={wl.name} count={wl.symbols.length}
                active={activeId === wl.id} onClick={() => onSelect(wl.id)}
                className="flex-1"
              />
              <button
                className="w-5 h-5 rounded opacity-0 group-hover/item:opacity-100 flex items-center justify-center hover:bg-white/10 transition-all mr-1"
                style={{ opacity: menuFor === wl.id ? 1 : undefined }}
                onClick={() => setMenuFor(v => (v === wl.id ? null : wl.id))}
              >
                <MoreHorizontal size={11} style={{ color: "var(--v-ink-dim)" }} />
              </button>
              {menuFor === wl.id && (
                <WatchlistItemMenu
                  onRename={() => { setRenamingId(wl.id); setRenameValue(wl.name); setMenuFor(null); }}
                  onDelete={() => { setConfirmDelete(wl); setMenuFor(null); }}
                  onClose={() => setMenuFor(null)}
                />
              )}
            </div>
          )
        ))}

        {creating && (
          <div className="px-2 mt-1">
            <input
              ref={inputRef}
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") submit();
                if (e.key === "Escape") { setCreating(false); setName(""); }
              }}
              onBlur={() => { if (!name.trim()) { setCreating(false); setName(""); } }}
              placeholder="List name…"
              className="w-full px-2.5 py-1.5 rounded-lg text-xs outline-none"
              style={{
                background: "var(--v-line-strong)", color: "var(--v-ink)",
                border: "1px solid var(--v-line-strong)", fontFamily: "Geist Mono, monospace",
              }}
            />
          </div>
        )}
      </div>

      {confirmDelete && (
        <DialogShell
          title="Delete watchlist"
          onClose={() => setConfirmDelete(null)}
          footer={
            <>
              <button
                className="px-3.5 py-2 rounded-lg text-xs font-medium transition-colors hover:bg-white/5"
                style={{ color: "var(--v-ink-soft)" }}
                onClick={() => setConfirmDelete(null)}
              >
                Cancel
              </button>
              <button
                className="px-4 py-2 rounded-lg text-xs font-semibold transition-opacity hover:opacity-90"
                style={{ background: R, color: "#0a0a0a" }}
                onClick={() => { onDelete(confirmDelete.id); setConfirmDelete(null); }}
              >
                Delete
              </button>
            </>
          }
        >
          <p className="text-sm" style={{ color: "var(--v-ink-soft)" }}>
            Delete <span className="font-semibold" style={{ color: "var(--v-ink)" }}>“{confirmDelete.name}”</span>?
            This can’t be undone.
          </p>
        </DialogShell>
      )}
    </aside>
  );
}

function SidebarItem({
  label, count, active, onClick, className = "",
}: {
  label: string; count: number; active: boolean; onClick: () => void; className?: string;
}) {
  return (
    <button
      className={`w-full flex items-center justify-between gap-2 px-2 py-1.5 rounded-lg text-[12px] transition-all ${className}`}
      style={{
        background: active ? "var(--v-line-strong)" : "transparent",
        color:      active ? "var(--v-ink)"         : "var(--v-ink-soft)",
        fontWeight: active ? 600 : 400,
      }}
      onClick={onClick}
    >
      <span className="truncate text-left">{label}</span>
      <span className="text-[10px] font-mono flex-shrink-0" style={{ color: "var(--v-ink-dim)" }}>{count}</span>
    </button>
  );
}

// ─── Toolbar ───────────────────────────────────────────────────────────────────

const RANGES: TimeRange[] = ["1D", "1W", "1M", "3M", "6M", "YTD", "1Y", "2Y", "5Y", "10Y", "ALL"];
const DETAIL_RANGES = RANGES;

/** Responsive collapse for narrow windows — 1D/3M/1Y/ALL always remain */
const RANGE_TIER: Record<TimeRange, string> = {
  "1D":  "",
  "1W":  "hidden xl:block",
  "1M":  "hidden lg:block",
  "3M":  "",
  "6M":  "hidden lg:block",
  "YTD": "hidden xl:block",
  "1Y":  "",
  "2Y":  "hidden xl:block",
  "5Y":  "hidden lg:block",
  "10Y": "hidden 2xl:block",
  "ALL": "",
};

/** Ranges that are hidden at some breakpoints (shown via ▾ overflow menu) */
const RANGE_OVERFLOW: TimeRange[] = ["1W", "1M", "6M", "YTD", "2Y", "5Y", "10Y"];

function RangePicker({
  range, setRange, ranges = RANGES,
}: {
  range: TimeRange;
  setRange: (r: TimeRange) => void;
  ranges?: TimeRange[];
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);

  useEffect(() => {
    if (!moreOpen) return;
    const h = (e: MouseEvent) => {
      const t = e.target as Node;
      if (moreRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setMoreOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [moreOpen]);

  useLayoutEffect(() => {
    if (!moreOpen || !moreRef.current) {
      setMenuPos(null);
      return;
    }
    const update = () => {
      const r = moreRef.current!.getBoundingClientRect();
      setMenuPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [moreOpen]);

  const overflowActive = RANGE_OVERFLOW.includes(range);

  return (
    <div className="flex items-center rounded-lg p-0.5 flex-shrink-0" style={{ background: "var(--v-line)" }}>
      {ranges.map(r => (
        <button
          key={r}
          onClick={() => setRange(r)}
          className={`px-3 py-1 rounded-md text-[10px] sm:text-[11px] font-mono font-medium transition-all flex-shrink-0 ${range === r ? "" : RANGE_TIER[r]}`}
          style={{
            background: range === r ? "var(--v-ink)"   : "transparent",
            color:      range === r ? "var(--v-panel)" : "var(--v-ink-soft)",
          }}
        >
          {r}
        </button>
      ))}
      <div ref={moreRef} className="relative flex-shrink-0 self-stretch flex items-center 2xl:hidden">
        <button
          type="button"
          onClick={() => setMoreOpen(v => !v)}
          className="h-full px-1.5 rounded-md flex items-center justify-center transition-all"
          style={{
            background: overflowActive || moreOpen ? "var(--v-ink)" : "transparent",
            color:      overflowActive || moreOpen ? "var(--v-panel)" : "var(--v-ink-soft)",
          }}
          title="More ranges"
          aria-label="More ranges"
          aria-expanded={moreOpen}
        >
          <ChevronDown size={12} />
        </button>
        {moreOpen && menuPos && createPortal(
          <div
            ref={menuRef}
            className="fixed z-[200] min-w-[5.5rem] rounded-xl border py-1.5 shadow-2xl"
            style={{ top: menuPos.top, right: menuPos.right, background: "var(--v-panel)", borderColor: "var(--v-line-strong)" }}
          >
            {RANGE_OVERFLOW.map(r => (
              <button
                key={r}
                className="w-full text-left px-3 py-1.5 text-[11px] font-mono flex items-center gap-2 hover:bg-white/5 transition-colors"
                style={{ color: r === range ? "var(--v-ink)" : "var(--v-ink-soft)" }}
                onClick={() => { setRange(r); setMoreOpen(false); }}
              >
                {r === range ? <Check size={10} color={G} /> : <span className="w-[10px]" />}
                {r}
              </button>
            ))}
          </div>,
          document.body,
        )}
      </div>
    </div>
  );
}

const FILTER_OPTS: { value: FilterMode; label: string }[] = [
  { value: "all",     label: "All"        },
  { value: "gainers", label: "Gainers"    },
  { value: "losers",  label: "Losers"     },
  { value: "movers",  label: "Top Movers" },
  { value: "owned",   label: "Owned"      },
];

const SORT_OPTS: { value: SortMode; label: string }[] = [
  { value: "manual",    label: "Manual"     },
  { value: "change",    label: "% Change"   },
  { value: "changeAmt", label: "$ Change"   },
  { value: "price",     label: "Price"      },
  { value: "cap",       label: "Market Cap" },
  { value: "volume",    label: "Volume"     },
  { value: "symbol",    label: "Symbol"     },
  { value: "name",      label: "Name"       },
];

function DropdownMenu<T extends string>({
  options, value, onChange, icon, label, activeSuffix,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  icon: React.ReactNode;
  label: string;
  activeSuffix?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !ref.current) {
      setMenuPos(null);
      return;
    }
    const update = () => {
      const r = ref.current!.getBoundingClientRect();
      setMenuPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  const active = value !== options[0].value;

  return (
    <div ref={ref} className="relative">
      <button
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
        style={{ background: active ? "var(--v-line-strong)" : "var(--v-line)", color: "var(--v-ink)" }}
        onClick={() => setOpen(v => !v)}
      >
        {icon}
        <span className="hidden sm:inline">
          {options.find(o => o.value === value)?.label ?? label}
          {activeSuffix ? ` ${activeSuffix}` : ""}
        </span>
      </button>
      {open && menuPos && createPortal(
        <div
          ref={menuRef}
          className="fixed z-[200] min-w-[148px] rounded-xl border py-1.5 shadow-2xl"
          style={{ top: menuPos.top, right: menuPos.right, background: "var(--v-panel)", borderColor: "var(--v-line-strong)" }}
        >
          {options.map(o => (
            <button
              key={o.value}
              className="w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-white/5 transition-colors"
              style={{ color: o.value === value ? "var(--v-ink)" : "var(--v-ink-soft)" }}
              onClick={() => { onChange(o.value); setOpen(false); }}
            >
              {o.value === value ? <Check size={10} color={G} /> : <span className="w-[10px]" />}
              {o.label}
              {o.value === value && activeSuffix ? (
                <span className="ml-auto font-mono" style={{ color: "var(--v-ink-dim)" }}>{activeSuffix}</span>
              ) : null}
            </button>
          ))}
        </div>,
        document.body,
      )}
    </div>
  );
}

function Toolbar({
  range, setRange, filter, setFilter, sort, sortDir, onSortSelect,
  changeDisplay, setChangeDisplay,
  search, setSearch, viewMode, setViewMode,
  stocks, watchlists, onSelectSymbol, onToggleWatchlist, onStocksHydrated, refreshKey = 0,
}: {
  range: TimeRange;    setRange:  (r: TimeRange)  => void;
  filter: FilterMode; setFilter: (f: FilterMode) => void;
  sort: SortMode;     sortDir: SortDir;
  onSortSelect: (s: SortMode) => void;
  changeDisplay: ChangeDisplay;
  setChangeDisplay: (c: ChangeDisplay) => void;
  search: string;     setSearch: (s: string)     => void;
  viewMode: ViewMode; setViewMode: (v: ViewMode) => void;
  stocks: StockMeta[];
  watchlists: Watchlist[];
  onSelectSymbol: (symbol: string) => void;
  onToggleWatchlist: (watchlistId: string, symbol: string) => void;
  onStocksHydrated?: (stocks: StockMeta[]) => void;
  refreshKey?: number;
}) {
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  const showDropdown = searchOpen && search.trim().length > 0;

  return (
    <div
      className="flex flex-nowrap items-center gap-2.5 px-4 py-2 border-b sticky top-0 z-40 backdrop-blur-md overflow-x-auto no-scrollbar"
      style={{
        background:  "color-mix(in srgb, var(--v-panel) 85%, transparent)",
        borderColor: "var(--v-line)",
      }}
    >
      <div ref={searchRef} className="relative flex-1 min-w-[12rem]">
        <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--v-ink-dim)" }} />
        <input
          value={search}
          onChange={e => { setSearch(e.target.value); setSearchOpen(true); }}
          onFocus={() => { setSearchFocused(true); setSearchOpen(true); }}
          onBlur={() => setSearchFocused(false)}
          placeholder="Search all stocks…"
          className="w-full pl-7 pr-7 py-1.5 rounded-lg text-xs outline-none"
          style={{
            background:   "var(--v-line)",
            color:        "var(--v-ink)",
            fontFamily:   "Geist Mono, monospace",
            borderWidth:  1,
            borderStyle:  "solid",
            borderColor:  searchFocused || showDropdown ? "var(--v-line-strong)" : "transparent",
          }}
        />
        {search && (
          <button className="absolute right-2 top-1/2 -translate-y-1/2" onClick={() => setSearch("")}>
            <X size={11} style={{ color: "var(--v-ink-dim)" }} />
          </button>
        )}

        {showDropdown && (
          <SearchDropdown
            query={search}
            stocks={stocks}
            watchlists={watchlists}
            onSelectSymbol={sym => { onSelectSymbol(sym); setSearchOpen(false); }}
            onToggleWatchlist={onToggleWatchlist}
            onClose={() => setSearchOpen(false)}
            onStocksHydrated={onStocksHydrated}
            refreshKey={refreshKey}
            anchorRef={searchRef}
          />
        )}
      </div>

      <div className="flex items-center gap-2.5 flex-shrink-0">
        <RangePicker range={range} setRange={setRange} />

        <DropdownMenu options={FILTER_OPTS} value={filter} onChange={setFilter} icon={<Filter size={12} />} label="Filter" />
        <DropdownMenu
          options={SORT_OPTS}
          value={sort}
          onChange={onSortSelect}
          icon={<ArrowUpDown size={12} />}
          label="Sort"
          activeSuffix={sort === "manual" ? undefined : sortDir === "desc" ? "↓" : "↑"}
        />

        <button
          onClick={() => setChangeDisplay(changeDisplay === "percent" ? "amount" : "percent")}
          className="flex items-center justify-center w-8 py-1.5 rounded-lg text-xs font-mono font-semibold transition-colors flex-shrink-0"
          style={{ background: "var(--v-line)", color: "var(--v-ink)" }}
          title={changeDisplay === "percent" ? "Showing % change — click for $ change" : "Showing $ change — click for % change"}
        >
          {changeDisplay === "percent" ? "%" : "$"}
        </button>

        <div className="flex rounded-lg p-0.5 flex-shrink-0" style={{ background: "var(--v-line)" }}>
          <button
            onClick={() => setViewMode("grid")}
            className="w-7 h-7 rounded-md flex items-center justify-center transition-all"
            style={{
              background: viewMode === "grid" ? "var(--v-ink)"   : "transparent",
              color:      viewMode === "grid" ? "var(--v-panel)" : "var(--v-ink-soft)",
            }}
            title="Grid view"
          >
            <LayoutGrid size={13} />
          </button>
          <button
            onClick={() => setViewMode("list")}
            className="w-7 h-7 rounded-md flex items-center justify-center transition-all"
            style={{
              background: viewMode === "list" ? "var(--v-ink)"   : "transparent",
              color:      viewMode === "list" ? "var(--v-panel)" : "var(--v-ink-soft)",
            }}
            title="List view"
          >
            <List size={13} />
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── DetailChart ───────────────────────────────────────────────────────────────

function DetailChart({ symbol, range, isGain, lastPrice }: { symbol: string; range: TimeRange; isGain: boolean; lastPrice?: number }) {
  const [data, setData] = useState(() => getHistory(symbol, range, lastPrice));
  const [loading, setLoading] = useState(() => getHistory(symbol, range, lastPrice).length < 2);
  const uid = useId();
  const gradId = `dc-${uid}`;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchHistory(symbol, range, lastPrice)
      .then(pts => {
        if (!cancelled) { setData(pts); setLoading(false); }
      })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [symbol, range, lastPrice]);

  // Plot by index (not timestamp) so overnight/weekend gaps don't render as long straight lines
  const indexed = useMemo(
    () => data.map((d, i) => ({ t: d.t, p: d.p, v: typeof d.v === "number" ? d.v : 0, i })),
    [data],
  );
  const seriesGain = data.length >= 2 ? data[data.length - 1].p >= data[0].p : isGain;
  const color = seriesGain ? G : R;
  const domain = useMemo(() => priceDomain(data), [data]);
  const [yMin, yMax] = domain;
  const narrow = width > 0 && width < 360;
  const compact = width > 0 && width < 480;
  const chartH = narrow ? 180 : compact ? 210 : 260;
  const yAxisW = narrow ? 36 : compact ? 44 : 56;
  const chartMargin = narrow
    ? { top: 4, right: 2, bottom: 16, left: 0 }
    : compact
      ? { top: 6, right: 6, bottom: 18, left: 4 }
      : { top: 8, right: 12, bottom: 22, left: 18 };
  const xTicks = useMemo(() => {
    if (data.length < 2) return [];
    const n = data.length;
    const count = Math.min(narrow ? 4 : compact ? 5 : 6, n);
    const out: number[] = [];
    for (let k = 0; k < count; k++) {
      out.push(Math.round((k / (count - 1)) * (n - 1)));
    }
    return [...new Set(out)];
  }, [data, narrow, compact]);
  const yTicks = useMemo(() => {
    const [lo, hi] = domain;
    if (!(hi > lo)) return [lo];
    if (narrow) return [lo, hi];
    return [lo, lo + (hi - lo) / 3, lo + (2 * (hi - lo)) / 3, hi];
  }, [domain, narrow]);

  if (loading) {
    return (
      <div ref={wrapRef}>
        <ChartSkeleton height={chartH || 220} />
      </div>
    );
  }

  if (data.length < 2) {
    return (
      <div ref={wrapRef} className="flex items-center justify-center font-mono text-xs" style={{ height: chartH || 220, color: "var(--v-ink-dim)" }}>
        No chart data
      </div>
    );
  }

  return (
    <div ref={wrapRef}>
      <ResponsiveContainer width="100%" height={chartH}>
        <AreaChart data={indexed} margin={chartMargin}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={color} stopOpacity={0.25} />
              <stop offset="95%" stopColor={color} stopOpacity={0}    />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="i"
            type="number"
            domain={[0, indexed.length - 1]}
            ticks={xTicks}
            tickFormatter={i => {
              const pt = indexed[Number(i)];
              return pt ? fmtTime(pt.t, range) : "";
            }}
            tick={{ fontFamily: "Geist Mono, monospace", fontSize: narrow ? 9 : 10, fill: "var(--v-ink-dim)" }}
            axisLine={false}
            tickLine={false}
            tickMargin={narrow ? 8 : 12}
            padding={{ left: narrow ? 2 : 8, right: narrow ? 2 : 8 }}
            interval={0}
          />
          <YAxis
            dataKey="p"
            domain={domain}
            ticks={yTicks}
            tickFormatter={p => fmtPriceTick(Number(p), yMin, yMax)}
            tick={{ fontFamily: "Geist Mono, monospace", fontSize: narrow ? 9 : 10, fill: "var(--v-ink-dim)" }}
            axisLine={false}
            tickLine={false}
            width={yAxisW}
            orientation="right"
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const row = (payload.find(p => p.payload)?.payload ?? payload[0].payload) as {
                t: number; p: number; v?: number;
              };
              const vol = typeof row.v === "number" ? row.v : 0;
              return (
                <div
                  className="px-2.5 py-2 rounded-xl border text-xs font-mono shadow-xl"
                  style={{ background: "var(--v-panel)", borderColor: "var(--v-line-strong)", color: "var(--v-ink)" }}
                >
                  <div className="mb-0.5" style={{ color: "var(--v-ink-dim)" }}>{fmtTime(row.t, range)}</div>
                  <div className="font-semibold">{fmt$(row.p)}</div>
                  <div className="mt-0.5" style={{ color: "var(--v-ink-dim)" }}>
                    Vol {vol > 0 ? fmtVol(vol) : "—"}
                  </div>
                </div>
              );
            }}
          />
          <Area type="linear" dataKey="p" stroke={color} strokeWidth={1.5} fill={`url(#${gradId})`} dot={false} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── StatCell ──────────────────────────────────────────────────────────────────

function StatCell({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <div className="text-[9px] font-mono uppercase tracking-[0.12em]" style={{ color: "var(--v-ink-dim)" }}>{label}</div>
      <div className="text-[13px] font-mono font-medium tabular-nums truncate" style={{ color: accent ?? "var(--v-ink)" }}>{value}</div>
    </div>
  );
}

// ─── DialogShell ───────────────────────────────────────────────────────────────

function DialogShell({
  title, onClose, children, footer, dismissible = true, wide = false,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  footer: React.ReactNode;
  dismissible?: boolean;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!dismissible) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [onClose, dismissible]);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.55)" }}
      onClick={dismissible ? onClose : undefined}
    >
      <div
        className={`w-full rounded-2xl border shadow-2xl overflow-hidden flex flex-col max-h-[min(90vh,720px)] ${wide ? "max-w-lg" : "max-w-sm"}`}
        style={{ background: "var(--v-panel)", borderColor: "var(--v-line-strong)" }}
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b flex-shrink-0" style={{ borderColor: "var(--v-line)" }}>
          <div className="font-mono text-[13px] font-semibold tracking-wide" style={{ color: "var(--v-ink)" }}>{title}</div>
          {dismissible && (
            <button
              className="w-7 h-7 rounded-lg flex items-center justify-center hover:bg-white/10 transition-colors"
              onClick={onClose}
            >
              <X size={14} style={{ color: "var(--v-ink-dim)" }} />
            </button>
          )}
        </div>
        <div className="px-5 py-4 overflow-y-auto flex-1" style={{ scrollbarWidth: "thin", scrollbarColor: "var(--v-line-strong) transparent" }}>
          {children}
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t flex-shrink-0" style={{ borderColor: "var(--v-line)" }}>
          {footer}
        </div>
      </div>
    </div>
  );
}

const DEPOSIT_MIN = 1;
const DEPOSIT_MAX = 1_000_000;

function DepositDialog({ onClose, onDeposit }: { onClose: () => void; onDeposit: (amount: number) => void }) {
  const [raw, setRaw] = useState("");
  const amount = parseFloat(raw);
  const valid = Number.isFinite(amount) && amount >= DEPOSIT_MIN && amount <= DEPOSIT_MAX;
  const outOfRange = raw !== "" && Number.isFinite(amount) && !valid;

  return (
    <DialogShell
      title="Add Money"
      onClose={onClose}
      footer={
        <>
          <button
            className="px-3.5 py-2 rounded-lg text-xs font-medium transition-colors hover:bg-white/5"
            style={{ color: "var(--v-ink-soft)" }}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="px-4 py-2 rounded-lg text-xs font-semibold transition-opacity disabled:opacity-40"
            style={{ background: G, color: "#0a0a0a" }}
            disabled={!valid}
            onClick={() => { if (valid) { onDeposit(amount); onClose(); } }}
          >
            Deposit
          </button>
        </>
      }
    >
      <label className="block text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: "var(--v-ink-dim)" }}>
        Amount (USD)
      </label>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm" style={{ color: "var(--v-ink-dim)" }}>$</span>
        <input
          autoFocus
          type="number"
          min="0"
          step="0.01"
          value={raw}
          onChange={e => setRaw(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && valid) { onDeposit(amount); onClose(); } }}
          placeholder="0.00"
          className="w-full pl-7 pr-3 py-2.5 rounded-xl text-sm font-mono outline-none"
          style={{ background: "var(--v-line)", color: "var(--v-ink)", border: "1px solid var(--v-line-strong)" }}
        />
      </div>
      <div className="mt-2 text-[11px] font-mono" style={{ color: outOfRange ? R : "var(--v-ink-dim)" }}>
        {outOfRange
          ? `Amount must be between ${fmt$(DEPOSIT_MIN)} and ${fmt$(DEPOSIT_MAX)}`
          : `Enter an amount between ${fmt$(DEPOSIT_MIN)} and ${fmt$(DEPOSIT_MAX)}`}
      </div>
    </DialogShell>
  );
}

function BuySharesDialog({
  stock, balance, onClose, onBuy,
}: {
  stock: StockMeta;
  balance: number;
  onClose: () => void;
  onBuy: (shares: number) => void;
}) {
  const [raw, setRaw] = useState("1");
  const shares = parseFloat(raw);
  const cost = Number.isFinite(shares) && shares > 0 ? shares * stock.price : 0;
  const valid = Number.isFinite(shares) && shares > 0 && cost <= balance;

  return (
    <DialogShell
      title={`Buy ${stock.symbol}`}
      onClose={onClose}
      footer={
        <>
          <button
            className="px-3.5 py-2 rounded-lg text-xs font-medium transition-colors hover:bg-white/5"
            style={{ color: "var(--v-ink-soft)" }}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="px-4 py-2 rounded-lg text-xs font-semibold transition-opacity disabled:opacity-40"
            style={{ background: G, color: "#0a0a0a" }}
            disabled={!valid}
            onClick={() => { if (valid) { onBuy(shares); onClose(); } }}
          >
            Buy shares
          </button>
        </>
      }
    >
      <div className="flex justify-between text-xs mb-4 font-mono" style={{ color: "var(--v-ink-soft)" }}>
        <span>{fmt$(stock.price)} / share</span>
        <span>Bank {fmt$(balance)}</span>
      </div>
      <label className="block text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: "var(--v-ink-dim)" }}>
        Shares
      </label>
      <input
        autoFocus
        type="number"
        min="0"
        step="any"
        value={raw}
        onChange={e => setRaw(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter" && valid) { onBuy(shares); onClose(); } }}
        className="w-full px-3 py-2.5 rounded-xl text-sm font-mono outline-none"
        style={{ background: "var(--v-line)", color: "var(--v-ink)", border: "1px solid var(--v-line-strong)" }}
      />
      <div className="mt-3 flex justify-between text-xs font-mono">
        <span style={{ color: "var(--v-ink-dim)" }}>Total</span>
        <span style={{ color: cost > balance ? R : "var(--v-ink)" }}>{fmt$(cost)}</span>
      </div>
      {cost > balance && (
        <div className="mt-2 text-[11px] font-mono" style={{ color: R }}>Insufficient bank balance</div>
      )}
    </DialogShell>
  );
}

function SellSharesDialog({
  stock, holding, onClose, onSell,
}: {
  stock: StockMeta;
  holding: Holding;
  onClose: () => void;
  onSell: (shares: number) => void;
}) {
  const [raw, setRaw] = useState("1");
  const shares = parseFloat(raw);
  const proceeds = Number.isFinite(shares) && shares > 0 ? shares * stock.price : 0;
  const valid = Number.isFinite(shares) && shares > 0 && shares <= holding.shares;

  return (
    <DialogShell
      title={`Sell ${stock.symbol}`}
      onClose={onClose}
      footer={
        <>
          <button
            className="px-3.5 py-2 rounded-lg text-xs font-medium transition-colors hover:bg-white/5"
            style={{ color: "var(--v-ink-soft)" }}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="px-4 py-2 rounded-lg text-xs font-semibold transition-opacity disabled:opacity-40"
            style={{ background: R, color: "#0a0a0a" }}
            disabled={!valid}
            onClick={() => { if (valid) { onSell(shares); onClose(); } }}
          >
            Sell shares
          </button>
        </>
      }
    >
      <div className="flex justify-between text-xs mb-4 font-mono" style={{ color: "var(--v-ink-soft)" }}>
        <span>{fmt$(stock.price)} / share</span>
        <span>
          Owned {holding.shares.toLocaleString("en-US", { maximumFractionDigits: 4 })}
        </span>
      </div>
      <label className="block text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: "var(--v-ink-dim)" }}>
        Shares
      </label>
      <div className="relative">
        <input
          autoFocus
          type="number"
          min="0"
          step="any"
          value={raw}
          onChange={e => setRaw(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && valid) { onSell(shares); onClose(); } }}
          className="w-full px-3 py-2.5 pr-14 rounded-xl text-sm font-mono outline-none"
          style={{ background: "var(--v-line)", color: "var(--v-ink)", border: "1px solid var(--v-line-strong)" }}
        />
        <button
          className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 rounded-md text-[10px] font-mono font-semibold hover:bg-white/10 transition-colors"
          style={{ background: "var(--v-line-strong)", color: "var(--v-ink-soft)" }}
          onClick={() => setRaw(String(holding.shares))}
        >
          MAX
        </button>
      </div>
      <div className="mt-3 flex justify-between text-xs font-mono">
        <span style={{ color: "var(--v-ink-dim)" }}>Proceeds</span>
        <span style={{ color: "var(--v-ink)" }}>{fmt$(proceeds)}</span>
      </div>
      {Number.isFinite(shares) && shares > holding.shares && (
        <div className="mt-2 text-[11px] font-mono" style={{ color: R }}>You only own {holding.shares.toLocaleString("en-US", { maximumFractionDigits: 4 })} shares</div>
      )}
    </DialogShell>
  );
}

// ─── StockDetailView ───────────────────────────────────────────────────────────

function StockDetailView({
  stock, range, holding, balance, onBack, onRangeChange, onBuy, onSell, signedIn, onSignIn,
}: {
  stock: StockMeta;
  range: TimeRange;
  holding?: Holding;
  balance: number;
  onBack: () => void;
  onRangeChange: (r: TimeRange) => void;
  onBuy: (shares: number) => void;
  onSell: (shares: number) => void;
  signedIn: boolean;
  onSignIn: () => void;
}) {
  const delta = useRangeChange(stock.symbol, range, stock);
  const isGain = delta.changePercent >= 0;
  const [buyOpen, setBuyOpen] = useState(false);
  const [sellOpen, setSellOpen] = useState(false);
  const [news, setNews] = useState<StockNewsItem[]>([]);
  const [newsStatus, setNewsStatus] = useState<"loading" | "live" | "empty" | "error">("loading");
  const owned = !!holding && holding.shares > 0;
  const pct52 = Math.max(0, Math.min(100,
    ((stock.price - stock.low52w) / (stock.high52w - stock.low52w)) * 100
  ));
  const profit = holding ? (stock.price - holding.avgCost) * holding.shares : 0;
  const profitPct = holding && holding.avgCost > 0
    ? ((stock.price - holding.avgCost) / holding.avgCost) * 100
    : 0;

  useEffect(() => {
    let cancelled = false;
    setNewsStatus("loading");
    setNews([]);
    const load = async () => {
      try {
        const items = await fetchStockNews(stock.symbol);
        if (cancelled) return;
        setNews(items);
        setNewsStatus(items.length ? "live" : "empty");
      } catch {
        if (cancelled) return;
        setNews([]);
        setNewsStatus("error");
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [stock.symbol]);

  return (
    <div
      className="@container flex flex-col h-full min-h-0 overflow-auto"
      style={{ scrollbarWidth: "thin", scrollbarColor: "var(--v-line-strong) transparent" }}
    >
      <div
        className="sticky top-0 z-20 flex items-center gap-2 px-3 @[420px]:px-5 py-2.5 border-b backdrop-blur-xl"
        style={{ background: "color-mix(in srgb, var(--v-bg) 92%, transparent)", borderColor: "var(--v-line)" }}
      >
        <button
          className="flex items-center gap-0.5 text-xs transition-opacity hover:opacity-60 flex-shrink-0"
          style={{ color: "var(--v-ink-soft)" }}
          onClick={onBack}
        >
          <ChevronLeft size={14} />
          <span className="hidden @[360px]:inline">Back</span>
        </button>
        <div className="w-px h-4 flex-shrink-0" style={{ background: "var(--v-line-strong)" }} />
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <span className="font-mono text-sm @[420px]:text-base font-semibold tracking-wider flex-shrink-0" style={{ color: "var(--v-ink)" }}>{stock.symbol}</span>
          <span className="text-xs truncate min-w-0 hidden @[400px]:inline" style={{ color: "var(--v-ink-soft)" }}>{stock.name}</span>
        </div>
        <div className="flex items-center gap-1.5 @[420px]:gap-2.5 flex-shrink-0">
          <button
            className="px-2.5 @[420px]:px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition-opacity hover:opacity-90"
            style={{ background: G, color: "#0a0a0a" }}
            onClick={() => setBuyOpen(true)}
          >
            <Plus size={12} strokeWidth={2.5} />
            Buy
          </button>
          <button
            className="px-2.5 @[420px]:px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition-opacity hover:opacity-90 disabled:opacity-50"
            style={{
              background: owned ? R : "var(--v-line-strong)",
              color:      owned ? "#0a0a0a" : "var(--v-ink-dim)",
              cursor:     owned ? "pointer" : "not-allowed",
            }}
            disabled={!owned}
            title={owned ? "Sell shares" : "No shares owned"}
            onClick={() => owned && setSellOpen(true)}
          >
            <Minus size={12} strokeWidth={2.5} />
            Sell
          </button>
        </div>
      </div>

      {!signedIn && (
        <GuestSaveBanner onSignIn={onSignIn} className="mx-3 @[420px]:mx-5 mt-3" />
      )}

      <div className="flex flex-col gap-3 px-3 @[420px]:px-5 pt-4 pb-6 w-full min-w-0">
        <div className="flex flex-wrap gap-2.5">
          <div
            className="rounded-2xl border px-4 py-2.5 grid grid-cols-2 gap-x-6 w-[15.75rem]"
            style={{ background: "var(--v-panel)", borderColor: "var(--v-line)" }}
          >
            <div className="min-w-0">
              <div className="text-[9px] font-mono uppercase tracking-widest" style={{ color: "var(--v-ink-dim)" }}>
                {stock.marketState === "REGULAR" ? "Live" : "At Close"}
              </div>
              {stock.price > 0 ? (
                <div className="font-mono text-sm font-semibold mt-0.5 tabular-nums" style={{ color: "var(--v-ink)" }}>
                  {fmt$(stock.price)}
                </div>
              ) : (
                <TextSkeleton width="4rem" height="0.9rem" className="mt-1.5" />
              )}
            </div>
            <div className="min-w-0">
              <div className="text-[9px] font-mono uppercase tracking-widest" style={{ color: "var(--v-ink-dim)" }}>Change</div>
              {stock.price > 0 ? (
                <div
                  className="font-mono text-sm font-semibold mt-0.5 tabular-nums"
                  style={{ color: stock.changePercent >= 0 ? G : R }}
                >
                  {fmtChangeAmt(stock.change)} ({fmtPct(stock.changePercent)})
                </div>
              ) : (
                <TextSkeleton width="5.5rem" height="0.9rem" className="mt-1.5" />
              )}
            </div>
          </div>

          {stock.preMarket && stock.preMarket.price > 0 && (
            <div
              className="rounded-2xl border px-4 py-2.5 grid grid-cols-2 gap-x-6 w-[15.75rem]"
              style={{ background: "var(--v-panel)", borderColor: "var(--v-line)" }}
            >
              <div className="min-w-0">
                <div className="text-[9px] font-mono uppercase tracking-widest" style={{ color: "var(--v-ink-dim)" }}>Pre-Market</div>
                <div className="font-mono text-sm font-semibold mt-0.5 tabular-nums" style={{ color: "var(--v-ink)" }}>
                  {fmt$(stock.preMarket.price)}
                </div>
              </div>
              <div className="min-w-0">
                <div className="text-[9px] font-mono uppercase tracking-widest" style={{ color: "var(--v-ink-dim)" }}>Change</div>
                <div
                  className="font-mono text-sm font-semibold mt-0.5 tabular-nums"
                  style={{ color: stock.preMarket.changePercent >= 0 ? G : R }}
                >
                  {fmtChangeAmt(stock.preMarket.change)} ({fmtPct(stock.preMarket.changePercent)})
                </div>
              </div>
            </div>
          )}

          {stock.afterHours && stock.afterHours.price > 0 && (
            <div
              className="rounded-2xl border px-4 py-2.5 grid grid-cols-2 gap-x-6 w-[15.75rem]"
              style={{ background: "var(--v-panel)", borderColor: "var(--v-line)" }}
            >
              <div className="min-w-0">
                <div className="text-[9px] font-mono uppercase tracking-widest" style={{ color: "var(--v-ink-dim)" }}>After Hours</div>
                <div className="font-mono text-sm font-semibold mt-0.5 tabular-nums" style={{ color: "var(--v-ink)" }}>
                  {fmt$(stock.afterHours.price)}
                </div>
              </div>
              <div className="min-w-0">
                <div className="text-[9px] font-mono uppercase tracking-widest" style={{ color: "var(--v-ink-dim)" }}>Change</div>
                <div
                  className="font-mono text-sm font-semibold mt-0.5 tabular-nums"
                  style={{ color: stock.afterHours.changePercent >= 0 ? G : R }}
                >
                  {fmtChangeAmt(stock.afterHours.change)} ({fmtPct(stock.afterHours.changePercent)})
                </div>
              </div>
            </div>
          )}

          {holding && (
            <div
              className="rounded-2xl border px-4 py-2.5 grid grid-cols-3 gap-x-5 w-[22.5rem]"
              style={{ background: "var(--v-panel)", borderColor: "var(--v-line)" }}
            >
              <div className="min-w-0">
                <div className="text-[9px] font-mono uppercase tracking-widest" style={{ color: "var(--v-ink-dim)" }}>Owned</div>
                <div className="font-mono text-sm font-semibold mt-0.5 tabular-nums" style={{ color: "var(--v-ink)" }}>
                  {holding.shares.toLocaleString("en-US", { maximumFractionDigits: 4 })} shares
                </div>
              </div>
              <div className="min-w-0">
                <div className="text-[9px] font-mono uppercase tracking-widest" style={{ color: "var(--v-ink-dim)" }}>Avg cost</div>
                <div className="font-mono text-sm font-semibold mt-0.5 tabular-nums" style={{ color: "var(--v-ink)" }}>{fmt$(holding.avgCost)}</div>
              </div>
              <div className="min-w-0">
                <div className="text-[9px] font-mono uppercase tracking-widest" style={{ color: "var(--v-ink-dim)" }}>Profit</div>
                <div className="font-mono text-sm font-semibold mt-0.5 tabular-nums" style={{ color: profit >= 0 ? G : R }}>
                  {profit >= 0 ? "+" : ""}{fmt$(profit)}
                  <span className="text-[11px] font-medium opacity-75 ml-1">{fmtPct(profitPct)}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Wide: Today/Fundamentals beside chart. Narrow: stacked under chart. */}
        <div className="flex flex-col @[640px]:flex-row @[640px]:items-start gap-3 min-w-0">
          <div className="flex-1 min-w-0">
            <div className="flex justify-end mb-2 overflow-x-auto no-scrollbar">
              <RangePicker range={range} setRange={onRangeChange} ranges={DETAIL_RANGES} />
            </div>
            <DetailChart symbol={stock.symbol} range={range} isGain={isGain} lastPrice={stock.price} />
          </div>

          <div className="w-full @[640px]:w-[19.5rem] flex-shrink-0 flex flex-col gap-3">
            <div className="rounded-2xl border p-4" style={{ background: "var(--v-panel)", borderColor: "var(--v-line)" }}>
              <div className="text-[9px] font-mono uppercase tracking-[0.15em] mb-3" style={{ color: "var(--v-ink-dim)" }}>Today</div>
              <div className="grid grid-cols-3 gap-x-4 gap-y-4">
                <StatCell label="Open"    value={fmt$(stock.open)}        />
                <StatCell label="High"    value={fmt$(stock.dayHigh)}     />
                <StatCell label="Low"     value={fmt$(stock.dayLow)}      />
                <StatCell label="Volume"  value={fmtVol(stock.volume)}    />
                <StatCell label="Avg Vol" value={fmtVol(stock.avgVolume)} />
                <StatCell label="Sector"  value={stock.sector}            />
              </div>
            </div>

            <div className="rounded-2xl border p-4" style={{ background: "var(--v-panel)", borderColor: "var(--v-line)" }}>
              <div className="text-[9px] font-mono uppercase tracking-[0.15em] mb-3" style={{ color: "var(--v-ink-dim)" }}>Fundamentals</div>
              <div className="grid grid-cols-3 gap-x-4 gap-y-4">
                <StatCell label="Market Cap" value={fmtCap(stock.marketCap)} />
                <StatCell label="P/E"        value={stock.pe  != null ? stock.pe.toFixed(1) : "—"} />
                <StatCell label="EPS"        value={stock.eps != null ? fmt$(stock.eps)      : "—"} />
                <StatCell label="52W High"   value={fmt$(stock.high52w)} />
                <StatCell label="52W Low"    value={fmt$(stock.low52w)}  />
                <StatCell label="Div Yield"  value={stock.dividendYield != null ? stock.dividendYield.toFixed(2) + "%" : "—"} />
              </div>

              <div className="mt-5">
                <div className="text-[9px] font-mono uppercase tracking-[0.15em] mb-2.5" style={{ color: "var(--v-ink-dim)" }}>52-Week Range</div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-mono w-14 text-right flex-shrink-0 tabular-nums" style={{ color: "var(--v-ink-dim)" }}>{fmt$(stock.low52w)}</span>
                  <div className="flex-1 relative h-1.5 rounded-full" style={{ background: "var(--v-line-strong)" }}>
                    <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: pct52 + "%", background: isGain ? G : R }} />
                    <div
                      className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 shadow"
                      style={{ left: `calc(${pct52}% - 6px)`, borderColor: isGain ? G : R, background: "var(--v-panel)" }}
                    />
                  </div>
                  <span className="text-[10px] font-mono w-14 flex-shrink-0 tabular-nums" style={{ color: "var(--v-ink-dim)" }}>{fmt$(stock.high52w)}</span>
                </div>
                <div className="flex justify-center mt-1.5">
                  <span className="text-[10px] font-mono tabular-nums" style={{ color: isGain ? G : R }}>▲ Current: {fmt$(stock.price)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div
          className="rounded-2xl border flex-shrink-0"
          style={{ background: "var(--v-panel)", borderColor: "var(--v-line-strong)" }}
          data-testid="stock-news"
        >
          <div className="px-4 py-3 border-b flex items-center justify-between gap-2" style={{ borderColor: "var(--v-line)" }}>
            <div className="flex items-center gap-2">
              <Newspaper size={14} style={{ color: G }} />
              <div className="text-[11px] font-mono uppercase tracking-[0.12em] font-semibold" style={{ color: "var(--v-ink)" }}>
                Live news
              </div>
            </div>
            <div className="text-[10px] font-mono" style={{ color: "var(--v-ink-dim)" }}>
              {newsStatus === "loading" ? "loading…"
                : newsStatus === "live" ? `${news.length} headline${news.length === 1 ? "" : "s"}`
                : newsStatus === "error" ? "unavailable"
                : "none"}
            </div>
          </div>
          {newsStatus === "loading" && (
            <div className="flex flex-col gap-0">
              {[0, 1, 2].map(i => (
                <div key={i} className="flex gap-3 px-3 py-3 border-b last:border-b-0" style={{ borderColor: "var(--v-line)" }}>
                  <div
                    className="h-14 w-20 rounded-lg flex-shrink-0"
                    style={{ background: "var(--v-line-strong)" }}
                  />
                  <div className="flex-1 flex flex-col gap-2 justify-center">
                    <div className="h-3 rounded" style={{ width: "90%", background: "var(--v-line-strong)" }} />
                    <div className="h-3 rounded" style={{ width: "60%", background: "var(--v-line-strong)" }} />
                  </div>
                </div>
              ))}
            </div>
          )}
          {newsStatus === "error" && (
            <div className="px-4 py-6 text-center text-sm font-mono" style={{ color: "var(--v-ink-dim)" }}>
              News unavailable
            </div>
          )}
          {newsStatus === "empty" && (
            <div className="px-4 py-6 text-center text-sm font-mono" style={{ color: "var(--v-ink-dim)" }}>
              No recent headlines
            </div>
          )}
          {newsStatus === "live" && (
            <div className="flex flex-col">
              {news.map((item, idx) => (
                <a
                  key={item.id || `${item.url}-${idx}`}
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex gap-3 px-3 py-3 transition-colors hover:bg-white/5 border-b last:border-b-0"
                  style={{ borderColor: "var(--v-line)" }}
                >
                  <div
                    className="h-14 w-20 rounded-lg overflow-hidden flex-shrink-0 border flex items-center justify-center"
                    style={{ background: "var(--v-line)", borderColor: "var(--v-line-strong)" }}
                  >
                    {item.image ? (
                      <img
                        src={item.image}
                        alt=""
                        className="w-full h-full object-cover"
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        onError={e => {
                          const el = e.currentTarget;
                          if (item.rawImage && el.dataset.fallback !== "1") {
                            el.dataset.fallback = "1";
                            el.src = item.rawImage;
                            return;
                          }
                          el.style.visibility = "hidden";
                        }}
                      />
                    ) : (
                      <Newspaper size={18} style={{ color: "var(--v-ink-dim)" }} />
                    )}
                  </div>
                  <div className="min-w-0 flex-1 self-center">
                    <div className="text-[12px] font-medium leading-snug" style={{ color: "var(--v-ink)" }}>
                      {item.title}
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-[10px] font-mono" style={{ color: "var(--v-ink-dim)" }}>
                      <span className="truncate">{item.publisher || "Yahoo Finance"}</span>
                      <ExternalLink size={10} className="flex-shrink-0 opacity-70" />
                    </div>
                  </div>
                </a>
              ))}
            </div>
          )}
        </div>

        <div
          className="px-3 py-2.5 rounded-xl text-[11px] font-mono"
          style={{ background: "var(--v-line)", color: "var(--v-ink-dim)" }}
        >
          Live market data via yfinance
        </div>
      </div>

      {buyOpen && (
        <BuySharesDialog
          stock={stock}
          balance={balance}
          onClose={() => setBuyOpen(false)}
          onBuy={onBuy}
        />
      )}
      {sellOpen && holding && (
        <SellSharesDialog
          stock={stock}
          holding={holding}
          onClose={() => setSellOpen(false)}
          onSell={onSell}
        />
      )}
    </div>
  );
}

// ─── MarketStrip ───────────────────────────────────────────────────────────────

function MarketStrip({ stocks, status }: { stocks: StockMeta[]; status: "loading" | "live" | "stale" | "error" }) {
  const indices = stocks.filter(s => ["SPY", "QQQ", "GLD"].includes(s.symbol));
  const statusLabel =
    status === "loading" ? "loading…"
    : status === "error" ? "yfinance offline"
    : status === "stale" ? "delayed"
    : "yfinance";
  return (
    <div
      className="flex items-center gap-5 px-5 py-1.5 border-b overflow-x-auto no-scrollbar"
      style={{ borderColor: "var(--v-line)", background: "var(--v-panel)" }}
    >
      {status === "loading" && indices.every(s => s.price <= 0) ? (
        <>
          {["SPY", "QQQ", "GLD"].map(sym => (
            <div key={sym} className="flex items-center gap-2 flex-shrink-0">
              <span className="text-[11px] font-mono" style={{ color: "var(--v-ink-soft)" }}>{sym}</span>
              <TextSkeleton width="3.25rem" height="0.65rem" />
              <TextSkeleton width="2.5rem" height="0.65rem" />
            </div>
          ))}
        </>
      ) : (
        indices.map(s => (
          <div key={s.symbol} className="flex items-center gap-2 flex-shrink-0 text-[11px] font-mono">
            <span style={{ color: "var(--v-ink-soft)" }}>{s.symbol}</span>
            {s.price > 0 ? (
              <>
                <span style={{ color: "var(--v-ink)" }}>{fmt$(s.price)}</span>
                <span style={{ color: s.changePercent >= 0 ? G : R }}>{fmtPct(s.changePercent)}</span>
              </>
            ) : (
              <>
                <TextSkeleton width="3.25rem" height="0.65rem" />
                <TextSkeleton width="2.5rem" height="0.65rem" />
              </>
            )}
          </div>
        ))
      )}
      <div className="ml-auto text-[10px] font-mono flex-shrink-0" style={{ color: "var(--v-ink-dim)" }}>
        {new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })} ET ·{" "}
        {statusLabel}
      </div>
    </div>
  );
}

// ─── BankPage ──────────────────────────────────────────────────────────────────

function BankPage({
  balance, transactions, onDeposit, signedIn, onSignIn, syncFailed, onRetrySync,
}: {
  balance: number;
  transactions: Transaction[];
  onDeposit: (amount: number) => void;
  signedIn: boolean;
  onSignIn: () => void;
  syncFailed: boolean;
  onRetrySync: () => void;
}) {
  const [depositOpen, setDepositOpen] = useState(false);
  const TX_PAGE = 6;
  const [txPage, setTxPage] = useState(0);
  const txPages = Math.max(1, Math.ceil(transactions.length / TX_PAGE));

  useEffect(() => {
    setTxPage(p => Math.min(p, Math.max(0, txPages - 1)));
  }, [txPages]);

  const pageTx = transactions.slice(txPage * TX_PAGE, txPage * TX_PAGE + TX_PAGE);

  return (
    <div className="flex-1 overflow-y-auto p-5" style={{ scrollbarWidth: "thin", scrollbarColor: "var(--v-line-strong) transparent" }}>
      <div className="max-w-2xl mx-auto flex flex-col gap-4">
        {syncFailed
          ? <SyncErrorBanner onRetry={onRetrySync} />
          : !signedIn && <GuestSaveBanner onSignIn={onSignIn} />}

        <div className="rounded-2xl border p-6" style={{ background: "var(--v-panel)", borderColor: "var(--v-line)" }}>
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: "var(--v-ink-dim)" }}>
                <Landmark size={12} /> Bank balance
              </div>
              <div className="font-mono text-3xl font-semibold tracking-tight" style={{ color: "var(--v-ink)" }}>
                {fmt$(balance)}
              </div>
            </div>
            <button
              className="px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 flex-shrink-0"
              style={{ background: G, color: "#0a0a0a" }}
              onClick={() => setDepositOpen(true)}
            >
              <Plus size={12} strokeWidth={2.5} />
              Add money
            </button>
          </div>
        </div>

        <div className="rounded-2xl border overflow-hidden" style={{ background: "var(--v-panel)", borderColor: "var(--v-line)" }}>
          <div className="px-5 py-3.5 border-b flex items-center justify-between gap-3" style={{ borderColor: "var(--v-line)" }}>
            <div className="text-[10px] font-mono uppercase tracking-widest" style={{ color: "var(--v-ink-dim)" }}>
              Transaction history
            </div>
            {transactions.length > 0 && (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  className="w-7 h-7 rounded-md flex items-center justify-center transition-opacity disabled:opacity-30 hover:bg-white/5"
                  style={{ color: "var(--v-ink-soft)", border: "1px solid var(--v-line-strong)" }}
                  disabled={txPage <= 0}
                  onClick={() => setTxPage(p => Math.max(0, p - 1))}
                  aria-label="Previous transactions"
                >
                  <ChevronLeft size={14} />
                </button>
                <span className="text-[11px] font-mono tabular-nums min-w-[3.5rem] text-center" style={{ color: "var(--v-ink-dim)" }}>
                  {txPage + 1}/{txPages}
                </span>
                <button
                  type="button"
                  className="w-7 h-7 rounded-md flex items-center justify-center transition-opacity disabled:opacity-30 hover:bg-white/5"
                  style={{ color: "var(--v-ink-soft)", border: "1px solid var(--v-line-strong)" }}
                  disabled={txPage >= txPages - 1}
                  onClick={() => setTxPage(p => Math.min(txPages - 1, p + 1))}
                  aria-label="Next transactions"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            )}
          </div>
          {transactions.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm font-mono" style={{ color: "var(--v-ink-dim)" }}>
              No transactions yet
            </div>
          ) : (
            <div className="divide-y" style={{ borderColor: "var(--v-line)" }}>
              {pageTx.map(tx => {
                const isBuy = tx.type === "buy";
                const inflow = !isBuy; // deposits and sells add money
                const sharesStr = tx.shares?.toLocaleString("en-US", { maximumFractionDigits: 4 });
                return (
                  <div key={tx.id} className="flex items-center gap-3 px-5 py-3.5" style={{ borderColor: "var(--v-line)" }}>
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ background: inflow ? "rgba(52,211,153,0.12)" : "rgba(248,113,130,0.12)" }}
                    >
                      {tx.type === "deposit" && <Wallet size={14} style={{ color: G }} />}
                      {tx.type === "buy" && <TrendingUp size={14} style={{ color: R }} />}
                      {tx.type === "sell" && <TrendingDown size={14} style={{ color: G }} />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium" style={{ color: "var(--v-ink)" }}>
                        {tx.type === "deposit" && "Deposit"}
                        {tx.type === "buy" && `Bought ${sharesStr} ${tx.symbol}`}
                        {tx.type === "sell" && `Sold ${sharesStr} ${tx.symbol}`}
                      </div>
                      <div className="text-[11px] font-mono mt-0.5" style={{ color: "var(--v-ink-dim)" }}>
                        {fmtWhen(tx.timestamp)}
                        {tx.type !== "deposit" && tx.price != null && ` · ${fmt$(tx.price)}/sh`}
                      </div>
                    </div>
                    <div
                      className="font-mono text-[13px] font-semibold flex-shrink-0"
                      style={{ color: inflow ? G : R }}
                    >
                      {inflow ? "+" : "−"}{fmt$(tx.amount)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {depositOpen && (
        <DepositDialog onClose={() => setDepositOpen(false)} onDeposit={onDeposit} />
      )}
    </div>
  );
}

const TECH_STARTER = ["AAPL", "MSFT", "NVDA", "GOOGL", "META", "NFLX"] as const;

const ONBOARDING_SECTORS: { sector: string; stocks: { symbol: string; name: string }[] }[] = [
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

function buildWatchlistsFromSelection(selected: Set<string>): Watchlist[] {
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

function AuthPanel({
  onAuth,
}: {
  /** Performs the actual sign-in/sign-up. Throws so this panel can show the error. */
  onAuth: (mode: "signin" | "signup", email: string, password: string, name: string) => Promise<void>;
}) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const e = email.trim();
    const n = name.trim();
    if (!e || password.length < 6) {
      setError(password.length > 0 && password.length < 6
        ? "Password must be at least 6 characters."
        : "Enter email and password.");
      return;
    }
    if (mode === "signup" && (n.length < 1 || n.length > 80)) {
      setError("Enter your name (1–80 characters).");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onAuth(mode, e, password, n);
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-sm mx-auto w-full flex flex-col gap-4">
      <div className="text-center mb-1">
        <div className="font-mono text-lg font-semibold tracking-tight" style={{ color: "var(--v-ink)" }}>
          {mode === "signin" ? "Sign in" : "Create account"}
        </div>
        <div className="text-xs mt-1" style={{ color: "var(--v-ink-soft)" }}>
          {mode === "signin"
            ? "Sign in to sync bank & portfolio to your account"
            : "Create an account to sync bank & portfolio across devices"}
        </div>
      </div>

      <div className="flex rounded-lg p-0.5" style={{ background: "var(--v-line)" }}>
        {(["signin", "signup"] as const).map(m => (
          <button
            key={m}
            type="button"
            className="flex-1 py-1.5 rounded-md text-xs font-medium transition-all"
            style={{
              background: mode === m ? "var(--v-ink)" : "transparent",
              color: mode === m ? "var(--v-panel)" : "var(--v-ink-soft)",
            }}
            onClick={() => { setMode(m); setError(null); }}
          >
            {m === "signin" ? "Sign in" : "Sign up"}
          </button>
        ))}
      </div>

      {mode === "signup" && (
        <div>
          <label className="block text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: "var(--v-ink-dim)" }}>
            Name
          </label>
          <input
            type="text"
            autoComplete="name"
            maxLength={80}
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") submit(); }}
            className="w-full px-3 py-2.5 rounded-xl text-sm font-mono outline-none"
            style={{ background: "var(--v-line)", color: "var(--v-ink)", border: "1px solid var(--v-line-strong)" }}
          />
        </div>
      )}

      <div>
        <label className="block text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: "var(--v-ink-dim)" }}>
          Email
        </label>
        <input
          type="email"
          autoComplete="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") submit(); }}
          className="w-full px-3 py-2.5 rounded-xl text-sm font-mono outline-none"
          style={{ background: "var(--v-line)", color: "var(--v-ink)", border: "1px solid var(--v-line-strong)" }}
        />
      </div>
      <div>
        <label className="block text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: "var(--v-ink-dim)" }}>
          Password
        </label>
        <div className="relative">
          <input
            type={showPassword ? "text" : "password"}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") submit(); }}
            className="w-full pl-3 pr-10 py-2.5 rounded-xl text-sm font-mono outline-none"
            style={{ background: "var(--v-line)", color: "var(--v-ink)", border: "1px solid var(--v-line-strong)" }}
          />
          <button
            type="button"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center rounded-md hover:bg-white/10 transition-colors"
            onClick={() => setShowPassword(v => !v)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            tabIndex={-1}
          >
            {showPassword
              ? <EyeOff size={14} style={{ color: "var(--v-ink-dim)" }} />
              : <Eye size={14} style={{ color: "var(--v-ink-dim)" }} />}
          </button>
        </div>
      </div>

      {error && (
        <div className="text-xs font-mono" style={{ color: R }}>{error}</div>
      )}

      <button
        type="button"
        disabled={busy}
        className="w-full py-2.5 rounded-xl text-xs font-semibold transition-opacity disabled:opacity-50"
        style={{ background: G, color: "#0a0a0a" }}
        onClick={submit}
      >
        {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
      </button>
    </div>
  );
}

function OnboardingDialog({
  email, initialName, onComplete,
}: {
  email: string;
  initialName: string;
  onComplete: (name: string, selected: string[]) => void;
}) {
  // A name given at sign-up is already the user's name — don't ask for it twice.
  const knownName = initialName.trim().slice(0, 80);
  const [step, setStep] = useState<"name" | "stocks">(knownName ? "stocks" : "name");
  const [name, setName] = useState(knownName);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(TECH_STARTER));
  const [sectorTab, setSectorTab] = useState(ONBOARDING_SECTORS[0].sector);
  const trimmed = name.trim();
  const nameValid = trimmed.length >= 1 && trimmed.length <= 80;

  const countsBySector = useMemo(() => {
    const map = new Map<string, number>();
    for (const group of ONBOARDING_SECTORS) {
      map.set(group.sector, group.stocks.filter(s => selected.has(s.symbol)).length);
    }
    return map;
  }, [selected]);

  const maxSectorCount = Math.max(0, ...countsBySector.values());
  const stocksValid = maxSectorCount >= 3;
  const activeGroup = ONBOARDING_SECTORS.find(g => g.sector === sectorTab) ?? ONBOARDING_SECTORS[0];

  const toggle = (symbol: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(symbol)) next.delete(symbol);
      else next.add(symbol);
      return next;
    });
  };

  return (
    <DialogShell
      title={step === "name" ? "Welcome to Vantage" : "Build your watchlists"}
      onClose={() => {}}
      dismissible={false}
      wide={step === "stocks"}
      footer={
        step === "name" ? (
          <button
            className="px-4 py-2 rounded-lg text-xs font-semibold transition-opacity disabled:opacity-40"
            style={{ background: G, color: "#0a0a0a" }}
            disabled={!nameValid}
            onClick={() => { if (nameValid) setStep("stocks"); }}
          >
            Continue
          </button>
        ) : (
          <>
            <button
              className="px-3.5 py-2 rounded-lg text-xs font-medium transition-colors hover:bg-white/5"
              style={{ color: "var(--v-ink-soft)" }}
              onClick={() => setStep("name")}
            >
              Back
            </button>
            <button
              className="px-4 py-2 rounded-lg text-xs font-semibold transition-opacity disabled:opacity-40"
              style={{ background: G, color: "#0a0a0a" }}
              disabled={!stocksValid}
              onClick={() => { if (stocksValid) onComplete(trimmed, [...selected]); }}
            >
              Finish
            </button>
          </>
        )
      }
    >
      {step === "name" ? (
        <>
        
          <label className="block text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: "var(--v-ink-dim)" }}>
            Display name
          </label>
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && nameValid) setStep("stocks"); }}
            placeholder="Your name"
            className="w-full px-3 py-2.5 rounded-xl text-sm font-mono outline-none"
            style={{ background: "var(--v-line)", color: "var(--v-ink)", border: "1px solid var(--v-line-strong)" }}
          />
          <div className="mt-2 text-[11px] font-mono truncate" style={{ color: "var(--v-ink-dim)" }}>
            Signed in as {email}
          </div>
        </>
      ) : (
        <>
          <div className="text-xs mb-3" style={{ color: "var(--v-ink-soft)" }}>
            Select at least 3 stocksfrom one sector to get started.
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-2 mb-3" style={{ scrollbarWidth: "thin" }}>
            {ONBOARDING_SECTORS.map(g => {
              const n = countsBySector.get(g.sector) ?? 0;
              const active = sectorTab === g.sector;
              return (
                <button
                  key={g.sector}
                  type="button"
                  className="flex-shrink-0 px-2.5 py-1.5 rounded-lg text-[11px] font-mono font-medium"
                  style={{
                    background: active ? "var(--v-ink)" : "var(--v-line)",
                    color: active ? "var(--v-panel)" : "var(--v-ink-soft)",
                  }}
                  onClick={() => setSectorTab(g.sector)}
                >
                  {g.sector === "Technology" ? "Tech" : g.sector}
                  <span className="ml-1 opacity-70">{n}</span>
                </button>
              );
            })}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {activeGroup.stocks.map(s => {
              const on = selected.has(s.symbol);
              return (
                <button
                  key={s.symbol}
                  type="button"
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-colors"
                  style={{
                    background: on ? "rgba(52,211,153,0.12)" : "var(--v-line)",
                    border: `1px solid ${on ? "rgba(52,211,153,0.45)" : "var(--v-line-strong)"}`,
                  }}
                  onClick={() => toggle(s.symbol)}
                >
                  <span
                    className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0"
                    style={{
                      background: on ? G : "transparent",
                      border: on ? "none" : "1px solid var(--v-ink-dim)",
                    }}
                  >
                    {on && <Check size={10} color="#0a0a0a" strokeWidth={3} />}
                  </span>
                  <span className="min-w-0">
                    <span className="block font-mono text-[12px] font-semibold" style={{ color: "var(--v-ink)" }}>
                      {s.symbol}
                    </span>
                    <span className="block text-[10px] truncate" style={{ color: "var(--v-ink-dim)" }}>
                      {s.name}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mt-3 text-[11px] font-mono" style={{ color: stocksValid ? G : "var(--v-ink-dim)" }}>
            {stocksValid
              ? `${selected.size} selected · ready`
              : `Select at least 3 in one sector (${maxSectorCount}/3)`}
          </div>
        </>
      )}
    </DialogShell>
  );
}

function GuestSaveBanner({
  onSignIn, className = "",
}: {
  onSignIn: () => void;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-wrap items-center gap-3 px-4 py-3 rounded-xl text-[12px] ${className}`}
      style={{ background: "rgba(52,211,153,0.08)", border: "1px solid rgba(52,211,153,0.25)", color: "var(--v-ink-soft)" }}
    >
      <div className="flex-1 min-w-[12rem] leading-relaxed">
        You’re not signed in — bank & portfolio changes won’t be saved.
      </div>
      <button
        type="button"
        className="px-3 py-1.5 rounded-lg text-[11px] font-semibold flex-shrink-0"
        style={{ background: G, color: "#0a0a0a" }}
        onClick={onSignIn}
      >
        Sign in to save
      </button>
    </div>
  );
}

function SyncErrorBanner({
  onRetry, className = "",
}: {
  onRetry: () => void;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-wrap items-center gap-3 px-4 py-3 rounded-xl text-[12px] ${className}`}
      style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.3)", color: "var(--v-ink-soft)" }}
    >
      <div className="flex-1 min-w-[12rem] leading-relaxed">
        You’re signed in, but we couldn’t reach your saved data. Changes aren’t syncing right now.
      </div>
      <button
        type="button"
        className="px-3 py-1.5 rounded-lg text-[11px] font-semibold flex-shrink-0"
        style={{ background: R, color: "#0a0a0a" }}
        onClick={onRetry}
      >
        Retry
      </button>
    </div>
  );
}

// ─── AccountPage ───────────────────────────────────────────────────────────────

function ManageAccountDialog({
  profile, onClose, onSave, onReset, onDeleteAccount,
}: {
  profile: Profile;
  onClose: () => void;
  onSave: (p: Profile) => void;
  onReset: () => void;
  onDeleteAccount: () => Promise<void>;
}) {
  const [name, setName] = useState(profile.name);
  const [pic, setPic] = useState(profile.pic);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const onPickFile = (file: File | null) => {
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") setPic(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const handleDelete = async () => {
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await onDeleteAccount();
    } catch (err) {
      setDeleteError(authErrorMessage(err));
      setDeleteBusy(false);
    }
  };

  return (
    <DialogShell
      title="Manage account"
      onClose={onClose}
      footer={
        <>
          <button
            className="px-3.5 py-2 rounded-lg text-xs font-medium transition-colors hover:bg-white/5"
            style={{ color: "var(--v-ink-soft)" }}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="px-4 py-2 rounded-lg text-xs font-semibold"
            style={{ background: G, color: "#0a0a0a" }}
            onClick={() => {
              onSave({
                ...profile,
                name: name.trim() || profile.name,
                pic,
              });
              onClose();
            }}
          >
            Save
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-4">
          <ProfileAvatar pic={pic} size={56} />
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: "var(--v-ink-dim)" }}>
              Profile photo
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={e => onPickFile(e.target.files?.[0] ?? null)}
            />
            <div className="flex gap-2">
              <button
                className="px-3 py-1.5 rounded-lg text-xs font-medium"
                style={{ background: "var(--v-line)", color: "var(--v-ink)" }}
                onClick={() => fileRef.current?.click()}
              >
                Upload photo
              </button>
              {pic && (
                <button
                  className="px-3 py-1.5 rounded-lg text-xs font-medium"
                  style={{ color: "var(--v-ink-soft)" }}
                  onClick={() => setPic("")}
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        </div>
        <div>
          <label className="block text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: "var(--v-ink-dim)" }}>
            Name
          </label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            className="w-full px-3 py-2.5 rounded-xl text-sm font-mono outline-none"
            style={{ background: "var(--v-line)", color: "var(--v-ink)", border: "1px solid var(--v-line-strong)" }}
          />
        </div>
        <div>
          <label className="block text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: "var(--v-ink-dim)" }}>
            Email
          </label>
          <input
            type="email"
            value={profile.email}
            readOnly
            className="w-full px-3 py-2.5 rounded-xl text-sm font-mono outline-none opacity-70"
            style={{ background: "var(--v-line)", color: "var(--v-ink)", border: "1px solid var(--v-line-strong)" }}
          />
        </div>

        <div className="pt-2" style={{ borderTop: "1px solid var(--v-line)" }}>
          <div className="text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: "var(--v-ink-dim)" }}>
            Danger zone
          </div>
          {!confirmReset ? (
            <button
              className="w-full px-3 py-2.5 rounded-xl text-xs font-medium text-left transition-colors hover:bg-white/5"
              style={{ color: R, border: "1px solid rgba(248,113,130,0.35)" }}
              onClick={() => { setConfirmReset(true); setConfirmDelete(false); }}
            >
              Reset trade history
            </button>
          ) : (
            <div className="rounded-xl p-3" style={{ border: "1px solid rgba(248,113,130,0.35)", background: "rgba(248,113,130,0.08)" }}>
              <div className="text-xs mb-3" style={{ color: "var(--v-ink-soft)" }}>
                Sets bank to $0 and clears portfolio + transactions. This can’t be undone.
              </div>
              <div className="flex gap-2">
                <button
                  className="flex-1 px-3 py-2 rounded-lg text-xs font-medium"
                  style={{ color: "var(--v-ink-soft)", background: "var(--v-line)" }}
                  onClick={() => setConfirmReset(false)}
                >
                  Cancel
                </button>
                <button
                  className="flex-1 px-3 py-2 rounded-lg text-xs font-semibold"
                  style={{ background: R, color: "#0a0a0a" }}
                  onClick={() => { onReset(); onClose(); }}
                >
                  Reset
                </button>
              </div>
            </div>
          )}

          {!confirmDelete ? (
            <button
              className="w-full mt-2 px-3 py-2.5 rounded-xl text-xs font-medium text-left transition-colors hover:bg-white/5"
              style={{ color: R, border: "1px solid rgba(248,113,130,0.35)" }}
              onClick={() => { setConfirmDelete(true); setConfirmReset(false); setDeleteError(null); }}
            >
              Delete account
            </button>
          ) : (
            <div className="mt-2 rounded-xl p-3" style={{ border: "1px solid rgba(248,113,130,0.35)", background: "rgba(248,113,130,0.08)" }}>
              <div className="text-xs mb-3" style={{ color: "var(--v-ink-soft)" }}>
                Permanently deletes your account and all synced data. This can’t be undone.
              </div>
              {deleteError && (
                <div className="text-[11px] font-mono mb-2" style={{ color: R }}>{deleteError}</div>
              )}
              <div className="flex gap-2">
                <button
                  className="flex-1 px-3 py-2 rounded-lg text-xs font-medium"
                  style={{ color: "var(--v-ink-soft)", background: "var(--v-line)" }}
                  disabled={deleteBusy}
                  onClick={() => setConfirmDelete(false)}
                >
                  Cancel
                </button>
                <button
                  className="flex-1 px-3 py-2 rounded-lg text-xs font-semibold disabled:opacity-50"
                  style={{ background: R, color: "#0a0a0a" }}
                  disabled={deleteBusy}
                  onClick={handleDelete}
                >
                  {deleteBusy ? "Deleting…" : "Delete"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </DialogShell>
  );
}

function AccountPage({
  user, profile, setProfile, balance, holdings, totalProfit, portfolioValue, totalCost,
  onResetTradeHistory, onSignOut, onDeleteAccount, onAuthDone,
}: {
  user: User | null;
  profile: Profile;
  setProfile: (p: Profile) => void;
  balance: number;
  holdings: Holding[];
  totalProfit: number;
  portfolioValue: number;
  totalCost: number;
  onResetTradeHistory: () => void;
  onSignOut: () => void;
  onDeleteAccount: () => Promise<void>;
  onAuthDone: (mode: "signin" | "signup", email: string, password: string, name: string) => Promise<void>;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const profitUp = totalProfit >= 0;
  const profitPct = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0;
  const shareCount = holdings.reduce((a, h) => a + h.shares, 0);

  useEffect(() => {
    if (!menuOpen) return;
    const h = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [menuOpen]);

  if (!user) {
    return (
      <div className="flex-1 overflow-y-auto p-5" style={{ scrollbarWidth: "thin", scrollbarColor: "var(--v-line-strong) transparent" }}>
        <div className="max-w-md mx-auto mt-10 rounded-2xl border p-6" style={{ background: "var(--v-panel)", borderColor: "var(--v-line)" }}>
          <AuthPanel onAuth={onAuthDone} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-5" style={{ scrollbarWidth: "thin", scrollbarColor: "var(--v-line-strong) transparent" }}>
      <div className="max-w-2xl mx-auto flex flex-col gap-4">
        <div className="relative rounded-2xl border p-6 flex items-center gap-4" style={{ background: "var(--v-panel)", borderColor: "var(--v-line)" }}>
          <div className="absolute top-4 right-4" ref={menuRef}>
            <button
              className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/10 transition-colors"
              onClick={() => setMenuOpen(v => !v)}
              title="Account menu"
            >
              <Settings size={15} style={{ color: "var(--v-ink-soft)" }} />
            </button>
            {menuOpen && (
              <div
                className="absolute right-0 top-9 z-50 min-w-[168px] rounded-xl border py-1.5 shadow-2xl"
                style={{ background: "var(--v-panel)", borderColor: "var(--v-line-strong)" }}
              >
                <button
                  className="w-full text-left px-3 py-2 text-xs transition-colors hover:bg-white/5"
                  style={{ color: "var(--v-ink)" }}
                  onClick={() => { setMenuOpen(false); setManageOpen(true); }}
                >
                  Manage account
                </button>
                <button
                  className="w-full text-left px-3 py-2 text-xs transition-colors hover:bg-white/5"
                  style={{ color: "var(--v-ink-soft)" }}
                  onClick={() => { setMenuOpen(false); onSignOut(); }}
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
          <ProfileAvatar pic={profile.pic} size={64} />
          <div className="min-w-0 flex-1 pr-8">
            <div className="font-mono text-lg font-semibold tracking-tight truncate" style={{ color: "var(--v-ink)" }}>
              {profile.name || "Your account"}
            </div>
            <div className="text-xs mt-0.5 truncate" style={{ color: "var(--v-ink-soft)" }}>
              {profile.email}
            </div>
          </div>
        </div>

        <div className="text-[10px] font-mono uppercase tracking-widest px-1" style={{ color: "var(--v-ink-dim)" }}>
          Analytics
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl border p-4" style={{ background: "var(--v-panel)", borderColor: "var(--v-line)" }}>
            <div className="text-[9px] font-mono uppercase tracking-widest mb-2" style={{ color: "var(--v-ink-dim)" }}>Total profit</div>
            <div className="font-mono text-xl font-semibold" style={{ color: profitUp ? G : R }}>
              {profitUp ? "+" : ""}{fmt$(totalProfit)}
            </div>
            <div className="text-[11px] font-mono mt-1" style={{ color: profitUp ? G : R }}>
              {fmtPct(profitPct)}
            </div>
          </div>
          <div className="rounded-2xl border p-4" style={{ background: "var(--v-panel)", borderColor: "var(--v-line)" }}>
            <div className="text-[9px] font-mono uppercase tracking-widest mb-2" style={{ color: "var(--v-ink-dim)" }}>Portfolio value</div>
            <div className="font-mono text-xl font-semibold" style={{ color: "var(--v-ink)" }}>
              {fmt$(portfolioValue)}
            </div>
            <div className="text-[11px] font-mono mt-1" style={{ color: "var(--v-ink-dim)" }}>
              Cost basis {fmt$(totalCost)}
            </div>
          </div>
          <div className="rounded-2xl border p-4" style={{ background: "var(--v-panel)", borderColor: "var(--v-line)" }}>
            <div className="text-[9px] font-mono uppercase tracking-widest mb-2" style={{ color: "var(--v-ink-dim)" }}>Bank cash</div>
            <div className="font-mono text-xl font-semibold" style={{ color: "var(--v-ink)" }}>
              {fmt$(balance)}
            </div>
          </div>
          <div className="rounded-2xl border p-4" style={{ background: "var(--v-panel)", borderColor: "var(--v-line)" }}>
            <div className="text-[9px] font-mono uppercase tracking-widest mb-2" style={{ color: "var(--v-ink-dim)" }}>Positions</div>
            <div className="font-mono text-xl font-semibold" style={{ color: "var(--v-ink)" }}>
              {holdings.length}
            </div>
            <div className="text-[11px] font-mono mt-1" style={{ color: "var(--v-ink-dim)" }}>
              {shareCount.toLocaleString("en-US", { maximumFractionDigits: 2 })} shares
            </div>
          </div>
        </div>
      </div>

      {manageOpen && (
        <ManageAccountDialog
          profile={profile}
          onClose={() => setManageOpen(false)}
          onSave={setProfile}
          onReset={onResetTradeHistory}
          onDeleteAccount={onDeleteAccount}
        />
      )}
    </div>
  );
}

// ─── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [page,            setPage]           = useState<AppPage>("home");
  const [theme,           setTheme]          = useState<"dark" | "light">("dark");
  const [homeRange,       setHomeRange]      = useState<TimeRange>("1D");
  const [detailRanges,    setDetailRanges]   = useState<Record<string, TimeRange>>({});
  const [filter,          setFilter]         = useState<FilterMode>("all");
  const [sort,            setSort]           = useState<SortMode>("manual");
  const [sortDir,         setSortDir]        = useState<SortDir>("desc");
  const [changeDisplay,   setChangeDisplay]  = useState<ChangeDisplay>("percent");
  const [search,          setSearch]         = useState("");
  const [viewMode,        setViewMode]       = useState<ViewMode>("grid");
  const [watchlists,      setWatchlists]     = useState<Watchlist[]>(DEFAULT_WATCHLISTS);
  const [activeWatchlist, setActiveWatchlist]= useState("portfolio");
  const [sidebarOpen,     setSidebarOpen]    = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(min-width: 768px)").matches : true,
  );
  const [selectedSymbol,  setSelectedSymbol] = useState<string | null>(null);
  const [pinnedSymbols,   setPinnedSymbols]  = useState<string[]>([]);
  const [customOrders,    setCustomOrders]   = useState<Record<string, string[]>>({});
  const [balance,         setBalance]        = useState(() =>
    readLocal("vantage-balance", 0, v => typeof v === "number" && Number.isFinite(v)),
  );
  const [holdings,        setHoldings]       = useState<Holding[]>(() =>
    readLocal<Holding[]>("vantage-holdings", [], Array.isArray),
  );
  const [transactions,    setTransactions]   = useState<Transaction[]>(() =>
    readLocal<Transaction[]>("vantage-tx", [], Array.isArray),
  );
  const [profile,         setProfile]        = useState<Profile>(() =>
    readLocal<Profile>("vantage-profile", DEFAULT_PROFILE, v => !!v && typeof v === "object" && !Array.isArray(v)),
  );
  const [user,            setUser]           = useState<User | null>(null);
  const [needsNameSetup,  setNeedsNameSetup] = useState(false);
  const [setupComplete,   setSetupComplete]  = useState(false);
  const [cloudStatus,     setCloudStatus]    = useState<CloudStatus>("idle");
  const [stocks,          setStocks]         = useState<StockMeta[]>(STOCKS_META);
  const [dataStatus,      setDataStatus]     = useState<"loading" | "live" | "stale" | "error">(
    STOCKS_META.some(s => s.price > 0) ? "stale" : "loading",
  );
  const [sparkEpoch,      setSparkEpoch]     = useState(0);
  const [tradeDialog,     setTradeDialog]    = useState<{ symbol: string; mode: "buy" | "sell" } | null>(null);

  const dragSymbolRef = useRef<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  useEffect(() => {
    let cancelled = false;
    clearHistoryCache();
    const applyQuotes = (live: StockMeta[]) => {
      setStocks([...live]);
      setDataStatus(lastQuotesFreshness === "live" ? "live" : live.some(s => s.price > 0) ? "stale" : "error");
    };
    (async () => {
      try {
        const live = await fetchQuotes();
        if (cancelled) return;
        applyQuotes(live);
        await prefetchSparklines(ALL_SYMBOLS, homeRange);
        if (!cancelled) setSparkEpoch(e => e + 1);
      } catch {
        if (cancelled) return;
        // Keep last-good (local / in-memory) prices instead of fake placeholders
        if (STOCKS_META.some(s => s.price > 0)) {
          setStocks([...STOCKS_META]);
          setDataStatus("stale");
        } else {
          setDataStatus("error");
        }
      }
    })();
    const id = window.setInterval(() => {
      fetchQuotes()
        .then(async live => {
          if (cancelled) return;
          applyQuotes(live);
          invalidateHistoryRange("1D");
          await prefetchSparklines(live.map(s => s.symbol), "1D");
          if (!cancelled) setSparkEpoch(e => e + 1);
        })
        .catch(() => {
          if (cancelled) return;
          if (STOCKS_META.some(s => s.price > 0)) setDataStatus("stale");
          else setDataStatus("error");
        });
    }, 60_000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, []);

  // When the toolbar range changes, load matching history for visible symbols
  useEffect(() => {
    const list = watchlists.find(w => w.id === activeWatchlist);
    const syms = list?.symbols ?? ALL_SYMBOLS;
    prefetchSparklines(syms, homeRange)
      .then(() => setSparkEpoch(e => e + 1))
      .catch(() => {});
  }, [homeRange, activeWatchlist, watchlists]);

  useEffect(() => { localStorage.setItem("vantage-balance", JSON.stringify(balance)); }, [balance]);
  useEffect(() => { localStorage.setItem("vantage-holdings", JSON.stringify(holdings)); }, [holdings]);
  useEffect(() => { localStorage.setItem("vantage-tx", JSON.stringify(transactions)); }, [transactions]);
  useEffect(() => { localStorage.setItem("vantage-profile", JSON.stringify(profile)); }, [profile]);

  // ─── Auth + Firestore sync ────────────────────────────────────────────────────
  const cloudReady = useRef(false);
  const authSettled = useRef(false);
  /** Name captured during sign-up, so onboarding never has to ask for it again. */
  const pendingSignupName = useRef("");

  // True cloud-sync state. Previously "signed in but not yet loaded" and "signed in
  // but the load failed" were both indistinguishable from "guest".
  const syncing = !!user && (cloudStatus === "idle" || cloudStatus === "loading");
  const syncFailed = !!user && cloudStatus === "error";
  const setupDone = setupComplete || syncFailed;
  const signedIn = !!user && (setupDone || syncing);

  const buildCloudState = useCallback((): UserState => ({
    balance,
    holdings,
    transactions,
    profile,
    setupComplete: true,
    watchlists,
    prefs: {
      homeRange,
      filter,
      sort,
      sortDir,
      changeDisplay,
      viewMode,
      theme,
      activeWatchlist,
      pinnedSymbols,
      customOrders,
      detailRanges,
    },
  }), [
    balance, holdings, transactions, profile, watchlists,
    homeRange, filter, sort, sortDir, changeDisplay, viewMode, theme,
    activeWatchlist, pinnedSymbols, customOrders, detailRanges,
  ]);

  const applyPrefs = useCallback((prefs: UserPrefs, lists: Watchlist[]) => {
    setHomeRange(prefs.homeRange as TimeRange);
    setFilter(prefs.filter as FilterMode);
    setSort(prefs.sort as SortMode);
    setSortDir(prefs.sortDir as SortDir);
    setChangeDisplay(prefs.changeDisplay as ChangeDisplay);
    setViewMode(prefs.viewMode as ViewMode);
    setTheme(prefs.theme === "light" ? "light" : "dark");
    setPinnedSymbols(prefs.pinnedSymbols);
    setCustomOrders(prefs.customOrders);
    const ranges: Record<string, TimeRange> = {};
    for (const [sym, r] of Object.entries(prefs.detailRanges)) {
      if (TIME_RANGES.includes(r as TimeRange)) ranges[sym] = r as TimeRange;
    }
    setDetailRanges(ranges);
    const active = lists.some(w => w.id === prefs.activeWatchlist)
      ? prefs.activeWatchlist
      : (lists[0]?.id ?? "portfolio");
    setActiveWatchlist(active);
  }, []);

  const clearTradeData = useCallback(() => {
    setBalance(0);
    setHoldings([]);
    setTransactions([]);
  }, []);

  const resetToGuest = useCallback(() => {
    clearTradeData();
    setProfile(DEFAULT_PROFILE);
    setWatchlists(DEFAULT_WATCHLISTS);
    setActiveWatchlist("portfolio");
    setPinnedSymbols([]);
    setCustomOrders({});
    setDetailRanges({});
    setHomeRange("1D");
    setFilter("all");
    setSort("manual");
    setSortDir("desc");
    setChangeDisplay("percent");
    setViewMode("grid");
    setNeedsNameSetup(false);
    setSetupComplete(false);
    cloudReady.current = false;
    pendingSignupName.current = "";
  }, [clearTradeData]);

  const loadCloudState = useCallback(async (next: User) => {
    cloudReady.current = false;
    setCloudStatus("loading");
    const email = next.email ?? "";
    // Identity comes from the Auth user, not Firestore. Seed it up front so a
    // failed cloud read can't leave the account page blank.
    const authName = next.displayName || pendingSignupName.current;
    setProfile(prev => ({
      ...prev,
      email: prev.email || email,
      name: prev.name || authName,
    }));
    try {
      const saved = await loadUserState(next.uid);
      if (saved?.setupComplete && saved.profile?.name) {
        if (typeof saved.balance === "number") setBalance(saved.balance);
        if (Array.isArray(saved.holdings)) setHoldings(saved.holdings as Holding[]);
        if (Array.isArray(saved.transactions)) setTransactions(saved.transactions as Transaction[]);
        setProfile({
          ...DEFAULT_PROFILE,
          ...saved.profile,
          email: saved.profile.email || email,
        });
        const lists = asWatchlists(saved.watchlists) ?? DEFAULT_WATCHLISTS;
        setWatchlists(lists);
        applyPrefs(asPrefs(saved.prefs), lists);
        const symbols = [...new Set(lists.flatMap(w => w.symbols))];
        if (symbols.length) {
          ensureQuotes(symbols)
            .then(live => setStocks([...live]))
            .catch(() => {});
        }
        setNeedsNameSetup(false);
        setSetupComplete(true);
      } else {
        // The read SUCCEEDED and there is genuinely no completed profile —
        // this is the only case where onboarding is the right answer.
        clearTradeData();
        setProfile({ ...DEFAULT_PROFILE, email, name: authName });
        setNeedsNameSetup(true);
        setSetupComplete(false);
        setPage("account");
      }
      cloudReady.current = true;
      setCloudStatus("ready");
    } catch (err) {
      // The read FAILED, so we have no idea what's in the cloud. Treating that as
      // "new user" is what re-asked for the name and made the app look signed out.
      // Keep local state, keep the user signed in, and leave writes disabled so we
      // can't overwrite good cloud data with a blank slate.
      console.warn("Firestore load failed:", err);
      cloudReady.current = false;
      setCloudStatus("error");
    }
  }, [applyPrefs, clearTradeData]);

  useEffect(() => {
    return subscribeAuth(next => {
      setUser(next);
      if (!next) {
        // Firebase emits null once on startup before it resolves a session. Only
        // clear on a real sign-out, otherwise it wipes the restored guest state.
        if (authSettled.current) resetToGuest();
        authSettled.current = true;
        setCloudStatus("idle");
        return;
      }
      authSettled.current = true;
      void loadCloudState(next);
    });
  }, [resetToGuest, loadCloudState]);

  const retryCloudLoad = useCallback(() => {
    if (user) void loadCloudState(user);
  }, [user, loadCloudState]);

  // App drives the auth call so the sign-up name is recorded BEFORE Firebase fires
  // onAuthStateChanged. Setting it after signUp() resolves is already too late —
  // the listener has run and built the profile with an empty name.
  const handleAuth = useCallback(async (
    mode: "signin" | "signup", email: string, password: string, name: string,
  ) => {
    if (mode === "signup") {
      pendingSignupName.current = name;
      try {
        await signUp(email, password, name);
      } catch (err) {
        pendingSignupName.current = "";
        throw err;
      }
    } else {
      await signIn(email, password);
    }
  }, []);

  // Surface write failures the same way as read failures instead of only logging.
  useEffect(() => {
    onSyncResult(err => setCloudStatus(prev => (err ? "error" : prev === "error" ? "ready" : prev)));
    return () => onSyncResult(null);
  }, []);

  // cloudStatus is in the deps so a recovered sync flushes pending local changes
  // instead of waiting for the next unrelated edit.
  useEffect(() => {
    if (!cloudReady.current || !user || !setupComplete) return;
    saveUserState(user.uid, buildCloudState());
  }, [buildCloudState, user, setupComplete, cloudStatus]);

  // The cloud write is debounced; make sure it lands if the page is hidden or closed.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") flushUserState();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flushUserState);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flushUserState);
    };
  }, []);

  const handleOnboarding = useCallback((name: string, selectedSymbols: string[]) => {
    if (!user) return;
    const nextProfile: Profile = {
      ...profile,
      name,
      email: user.email ?? profile.email,
      pic: profile.pic || "",
    };
    const lists = buildWatchlistsFromSelection(new Set(selectedSymbols));
    setProfile(nextProfile);
    setWatchlists(lists);
    setActiveWatchlist("portfolio");
    setPinnedSymbols([]);
    setCustomOrders({});
    setDetailRanges({});
    setHomeRange("1D");
    setFilter("all");
    setSort("manual");
    setSortDir("desc");
    setChangeDisplay("percent");
    setViewMode("grid");
    clearTradeData();
    setNeedsNameSetup(false);
    setSetupComplete(true);
    cloudReady.current = true;
    pendingSignupName.current = "";
    saveUserState(user.uid, {
      balance: 0,
      holdings: [],
      transactions: [],
      profile: nextProfile,
      setupComplete: true,
      watchlists: lists,
      prefs: {
        ...DEFAULT_PREFS,
        activeWatchlist: "portfolio",
      },
    });
    ensureQuotes(selectedSymbols)
      .then(live => setStocks([...live]))
      .catch(() => {});
    setPage("home");
  }, [user, profile, clearTradeData]);

  const handleSignOut = useCallback(async () => {
    await signOut();
  }, []);

  const handleDeleteAccount = useCallback(async () => {
    await deleteAccount();
  }, []);

  const goSignIn = useCallback(() => {
    setSelectedSymbol(null);
    setPage("account");
  }, []);

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
    [holdings, stocks]
  );
  const totalCost = useMemo(
    () => holdings.reduce((sum, h) => sum + h.avgCost * h.shares, 0),
    [holdings]
  );
  const totalProfit = portfolioValue - totalCost;

  const activeList   = watchlists.find(w => w.id === activeWatchlist) ?? watchlists[0];
  const activeStocks = useMemo(
    () => stocks.filter(s => activeList.symbols.includes(s.symbol)),
    [activeList, stocks]
  );

  const portfolioStocks = useMemo(() => {
    const rows = holdings
      .map(h => {
        const stock = stocks.find(s => s.symbol === h.symbol);
        return stock ? { stock, holding: h } : null;
      })
      .filter((x): x is { stock: StockMeta; holding: Holding } => x != null);

    if (sort === "manual") return rows;

    const rangeDelta = (x: StockMeta) => quoteChangeForRange(x.symbol, homeRange, x);
    const cmp: Record<Exclude<SortMode, "manual">, (a: StockMeta, b: StockMeta) => number> = {
      change:    (a, b) => rangeDelta(b).changePercent - rangeDelta(a).changePercent,
      changeAmt: (a, b) => rangeDelta(b).change - rangeDelta(a).change,
      price:     (a, b) => b.price - a.price,
      cap:       (a, b) => b.marketCap - a.marketCap,
      volume:    (a, b) => b.volume - a.volume,
      symbol:    (a, b) => b.symbol.localeCompare(a.symbol),
      name:      (a, b) => b.name.localeCompare(a.name),
    };
    rows.sort((a, b) => cmp[sort](a.stock, b.stock));
    if (sortDir === "asc") rows.reverse();
    return rows;
  }, [holdings, stocks, sort, sortDir, homeRange, sparkEpoch]);

  const visibleStocks = useMemo(() => {
    let s = [...activeStocks];
    const rangeDelta = (x: StockMeta) => quoteChangeForRange(x.symbol, homeRange, x);
    const owned = new Set(holdings.map(h => h.symbol));

    if (search) {
      const q = search.toLowerCase();
      s = s.filter(x => x.symbol.toLowerCase().includes(q) || x.name.toLowerCase().includes(q));
    }

    if (filter === "gainers") s = s.filter(x => rangeDelta(x).changePercent > 0);
    else if (filter === "losers") s = s.filter(x => rangeDelta(x).changePercent < 0);
    else if (filter === "owned") s = s.filter(x => owned.has(x.symbol));

    if (sort === "manual") {
      const order = customOrders[activeWatchlist] ?? activeList.symbols;
      s.sort((a, b) => {
        const ai = order.indexOf(a.symbol);
        const bi = order.indexOf(b.symbol);
        return (ai === -1 ? 9999 : ai) - (bi === -1 ? 9999 : bi);
      });
      s.sort((a, b) => {
        const ap = pinnedSymbols.includes(a.symbol);
        const bp = pinnedSymbols.includes(b.symbol);
        if (ap === bp) return 0;
        return ap ? -1 : 1;
      });
    } else if (filter === "movers") {
      s.sort((a, b) => Math.abs(rangeDelta(b).changePercent) - Math.abs(rangeDelta(a).changePercent));
    } else {
      // $/% sorts use the toolbar range (1Y etc.), not always 1D day change
      const cmp: Record<Exclude<SortMode, "manual">, (a: StockMeta, b: StockMeta) => number> = {
        change:    (a, b) => rangeDelta(b).changePercent - rangeDelta(a).changePercent,
        changeAmt: (a, b) => rangeDelta(b).change - rangeDelta(a).change,
        price:     (a, b) => b.price - a.price,
        cap:       (a, b) => b.marketCap - a.marketCap,
        volume:    (a, b) => b.volume - a.volume,
        symbol:    (a, b) => b.symbol.localeCompare(a.symbol),
        name:      (a, b) => b.name.localeCompare(a.name),
      };
      s.sort(cmp[sort]);
      if (sortDir === "asc") s.reverse();
    }

    return s;
  }, [activeStocks, search, filter, sort, sortDir, customOrders, activeWatchlist, pinnedSymbols, activeList.symbols, homeRange, sparkEpoch, holdings]);

  const selectedStock = selectedSymbol ? stocks.find(s => s.symbol === selectedSymbol) ?? null : null;

  const allStocksList = watchlists.find(w => w.id === "portfolio");
  const allStocksMeta = useMemo(
    () => stocks.filter(s => (allStocksList?.symbols ?? ALL_SYMBOLS).includes(s.symbol)),
    [allStocksList, stocks]
  );
  const gainCount = allStocksMeta.filter(s => s.changePercent > 0).length;
  const lossCount = allStocksMeta.filter(s => s.changePercent < 0).length;

  const createWatchlist = useCallback((name: string) => {
    const id = "wl-" + name.toLowerCase().replace(/\s+/g, "-") + "-" + Date.now();
    setWatchlists(prev => [...prev, { id, name, symbols: [] }]);
  }, []);

  const deleteWatchlist = useCallback((id: string) => {
    setWatchlists(prev => prev.filter(w => w.id !== id));
    if (activeWatchlist === id) setActiveWatchlist("portfolio");
  }, [activeWatchlist]);

  const renameWatchlist = useCallback((id: string, name: string) => {
    setWatchlists(prev => prev.map(w => (w.id === id ? { ...w, name } : w)));
  }, []);

  const reorderWatchlists = useCallback((fromId: string, toId: string) => {
    setWatchlists(prev => {
      const fi = prev.findIndex(w => w.id === fromId);
      const ti = prev.findIndex(w => w.id === toId);
      if (fi < 0 || ti < 0 || fi === ti) return prev;
      const next = [...prev];
      const [moved] = next.splice(fi, 1);
      next.splice(ti, 0, moved);
      return next;
    });
  }, []);

  const toggleWatchlist = useCallback((watchlistId: string, symbol: string) => {
    setWatchlists(prev => {
      const target = prev.find(w => w.id === watchlistId);
      if (!target) return prev;
      const removing = target.symbols.includes(symbol);

      let next = prev.map(w => {
        if (w.id !== watchlistId) return w;
        return {
          ...w,
          symbols: removing
            ? w.symbols.filter(s => s !== symbol)
            : [...w.symbols, symbol],
        };
      });

      if (!removing) {
        // Adding anywhere also ensures it's in All Stocks
        next = next.map(w => {
          if (w.id !== "portfolio" || w.symbols.includes(symbol)) return w;
          return { ...w, symbols: [...w.symbols, symbol] };
        });
      } else if (watchlistId === "portfolio") {
        // Removing from All Stocks removes from every watchlist
        next = next.map(w => ({ ...w, symbols: w.symbols.filter(s => s !== symbol) }));
      } else {
        // Removed from a user list — if gone from all user lists, drop from All Stocks too
        const stillInUserList = next.some(w => w.id !== "portfolio" && w.symbols.includes(symbol));
        if (!stillInUserList) {
          next = next.map(w =>
            w.id === "portfolio" ? { ...w, symbols: w.symbols.filter(s => s !== symbol) } : w
          );
        }
      }

      return next;
    });
    // Load live quote for newly added tickers from search
    ensureQuotes([symbol])
      .then(live => setStocks([...live]))
      .catch(() => {});
  }, []);

  const togglePin = useCallback((symbol: string) => {
    setPinnedSymbols(prev => prev.includes(symbol) ? prev.filter(s => s !== symbol) : [...prev, symbol]);
  }, []);

  const hydrateStocks = useCallback((live: StockMeta[]) => {
    setStocks([...live]);
    setSparkEpoch(e => e + 1);
  }, []);

  const openSymbol = useCallback(async (symbol: string) => {
    setSearch("");
    setSelectedSymbol(symbol);
    setPage("home");
    // Ensure searchable tickers land in All Stocks so they stay available
    setWatchlists(prev => prev.map(w => {
      if (w.id !== "portfolio" || w.symbols.includes(symbol)) return w;
      return { ...w, symbols: [...w.symbols, symbol] };
    }));
    try {
      const live = await ensureQuotes([symbol]);
      setStocks([...live]);
      setDataStatus("live");
      const r = detailRanges[symbol] ?? "1D";
      prefetchSparklines([symbol], r).catch(() => {});
    } catch {
      /* keep whatever quote we have */
    }
  }, [detailRanges]);

  const selectSymbol = useCallback((symbol: string) => {
    setSelectedSymbol(symbol);
    ensureQuotes([symbol])
      .then(live => { setStocks([...live]); setDataStatus("live"); })
      .catch(() => {});
  }, []);

  const setDetailRange = useCallback((symbol: string, r: TimeRange) => {
    setDetailRanges(prev => (prev[symbol] === r ? prev : { ...prev, [symbol]: r }));
    prefetchSparklines([symbol], r).catch(() => {});
  }, []);

  const handleDragStart = useCallback((symbol: string) => { dragSymbolRef.current = symbol; }, []);
  const handleDragOver  = useCallback((symbol: string) => { setDragOver(symbol); }, []);
  const handleDragEnd   = useCallback(() => {
    const from = dragSymbolRef.current;
    const to   = dragOver;
    dragSymbolRef.current = null;
    setDragOver(null);
    if (!from || !to || from === to) return;
    setCustomOrders(prev => {
      const base  = prev[activeWatchlist] ?? activeList.symbols;
      const order = [...base];
      if (!order.includes(from)) order.push(from);
      if (!order.includes(to))   order.push(to);
      const fi = order.indexOf(from);
      const ti = order.indexOf(to);
      order.splice(fi, 1);
      order.splice(ti, 0, from);
      return { ...prev, [activeWatchlist]: order };
    });
  }, [dragOver, activeWatchlist, activeList.symbols]);

  const deposit = useCallback((amount: number) => {
    setBalance(b => b + amount);
    setTransactions(prev => [{
      id: "tx-" + Date.now(),
      type: "deposit",
      amount,
      timestamp: Date.now(),
    }, ...prev]);
  }, []);

  const buyShares = useCallback((symbol: string, shares: number, price: number) => {
    const cost = shares * price;
    setBalance(b => b - cost);
    setHoldings(prev => {
      const existing = prev.find(h => h.symbol === symbol);
      if (!existing) return [...prev, { symbol, shares, avgCost: price }];
      const totalShares = existing.shares + shares;
      const avgCost = (existing.avgCost * existing.shares + price * shares) / totalShares;
      return prev.map(h => h.symbol === symbol ? { symbol, shares: totalShares, avgCost } : h);
    });
    setTransactions(prev => [{
      id: "tx-" + Date.now(),
      type: "buy",
      amount: cost,
      symbol,
      shares,
      price,
      timestamp: Date.now(),
    }, ...prev]);
  }, []);

  const sellShares = useCallback((symbol: string, shares: number, price: number) => {
    const proceeds = shares * price;
    setBalance(b => b + proceeds);
    setHoldings(prev => prev.flatMap(h => {
      if (h.symbol !== symbol) return [h];
      const remaining = h.shares - shares;
      return remaining > 1e-9 ? [{ ...h, shares: remaining }] : [];
    }));
    setTransactions(prev => [{
      id: "tx-" + Date.now(),
      type: "sell",
      amount: proceeds,
      symbol,
      shares,
      price,
      timestamp: Date.now(),
    }, ...prev]);
  }, []);

  const resetTradeHistory = useCallback(() => {
    setBalance(0);
    setHoldings([]);
    setTransactions([]);
  }, []);

  const goToPage = (p: AppPage) => {
    setPage(p);
    setSelectedSymbol(null);
  };

  const isDraggable = sort === "manual" && page === "home";

  const onSortSelect = useCallback((s: SortMode) => {
    if (s === sort) {
      setSortDir(d => (d === "desc" ? "asc" : "desc"));
    } else {
      setSort(s);
      setSortDir("desc");
    }
  }, [sort]);

  const onColumnSort = useCallback((s: SortMode) => {
    if (s === sort) {
      setSortDir(d => (d === "asc" ? "desc" : "asc"));
    } else {
      setSort(s);
      setSortDir("asc");
    }
  }, [sort]);

  const sharedCardProps = (stock: StockMeta, holding?: Holding) => ({
    stock, range: homeRange, watchlists,
    holding,
    refreshKey: sparkEpoch,
    changeDisplay,
    onTrade: (symbol: string, mode: "buy" | "sell") => setTradeDialog({ symbol, mode }),
    isPinned:  pinnedSymbols.includes(stock.symbol),
    isDraggable: isDraggable && !holding,
    isDragOver: dragOver === stock.symbol,
    onSelect:  () => selectSymbol(stock.symbol),
    onToggleWatchlist: toggleWatchlist,
    onTogglePin: togglePin,
    onDragStart: handleDragStart,
    onDragOver:  handleDragOver,
    onDragEnd:   handleDragEnd,
  });

  const selectedDetailRange = selectedSymbol ? (detailRanges[selectedSymbol] ?? "1D") : "1D";

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={{ background: "var(--v-bg)", color: "var(--v-ink)" }}>
      {/* Header */}
      <header
        className="flex-shrink-0 flex items-center gap-5 px-5 h-12 border-b z-50 backdrop-blur-xl overflow-x-auto no-scrollbar"
        style={{ background: "color-mix(in srgb, var(--v-panel) 92%, transparent)", borderColor: "var(--v-line)" }}
      >
        <div className="flex items-center gap-2.5 flex-shrink-0">
          <BarChart2 size={18} color={G} strokeWidth={2.5} />
          <span className="hidden sm:inline font-mono text-[13px] font-semibold tracking-[0.18em]" style={{ color: "var(--v-ink)" }}>VANTAGE</span>
        </div>

        <nav className="flex items-stretch h-full gap-1 flex-shrink-0">
          {NAV_ITEMS.map(item => {
            const active = page === item.id;
            return (
              <button
                key={item.id}
                onClick={() => goToPage(item.id)}
                className="relative px-3 h-full text-[12px] font-medium transition-colors"
                style={{ color: active ? "var(--v-ink)" : "var(--v-ink-soft)" }}
              >
                {item.label}
                {active && (
                  <span
                    className="absolute left-2 right-2 bottom-0 h-[2px] rounded-full"
                    style={{ background: G }}
                  />
                )}
              </button>
            );
          })}
        </nav>

        <div className="flex-1 min-w-4" />
        <div className="hidden sm:flex items-center gap-1.5 font-mono text-[11px] flex-shrink-0 whitespace-nowrap">
          <span style={{ color: G }}>{gainCount}↑</span>
          <span style={{ color: "var(--v-ink-dim)" }}>/</span>
          <span style={{ color: R }}>{lossCount}↓</span>
          <span className="ml-1.5" style={{ color: "var(--v-ink-dim)" }}>All Stocks</span>
        </div>
        <button
          className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/10 transition-colors flex-shrink-0"
          onClick={() => setTheme(t => t === "dark" ? "light" : "dark")}
        >
          {theme === "dark"
            ? <Sun  size={15} style={{ color: "var(--v-ink-soft)" }} />
            : <Moon size={15} style={{ color: "var(--v-ink-soft)" }} />}
        </button>
      </header>

      <MarketStrip stocks={stocks} status={dataStatus} />

      {page === "bank" && (
        <BankPage
          balance={balance}
          transactions={transactions}
          onDeposit={deposit}
          signedIn={signedIn}
          onSignIn={goSignIn}
          syncFailed={syncFailed}
          onRetrySync={retryCloudLoad}
        />
      )}

      {page === "account" && (
        <AccountPage
          user={user}
          profile={profile}
          setProfile={setProfile}
          balance={balance}
          holdings={holdings}
          totalProfit={totalProfit}
          portfolioValue={portfolioValue}
          totalCost={totalCost}
          onResetTradeHistory={resetTradeHistory}
          onSignOut={handleSignOut}
          onDeleteAccount={handleDeleteAccount}
          onAuthDone={handleAuth}
        />
      )}

      {page === "portfolio" && (
        <div className="flex-1 flex flex-col overflow-hidden min-h-0">
          {selectedStock ? (
            <StockDetailView
              stock={selectedStock}
              range={selectedDetailRange}
              holding={holdingMap.get(selectedStock.symbol)}
              balance={balance}
              onBack={() => setSelectedSymbol(null)}
              onRangeChange={r => setDetailRange(selectedStock.symbol, r)}
              onBuy={shares => buyShares(selectedStock.symbol, shares, selectedStock.price)}
              onSell={shares => sellShares(selectedStock.symbol, shares, selectedStock.price)}
              signedIn={signedIn}
              onSignIn={goSignIn}
            />
          ) : (
            <div
              className="flex-1 overflow-auto p-4"
              style={{ scrollbarWidth: "thin", scrollbarColor: "var(--v-line-strong) transparent" }}
            >
              {syncFailed
                ? <SyncErrorBanner onRetry={retryCloudLoad} className="mb-4" />
                : !signedIn && <GuestSaveBanner onSignIn={goSignIn} className="mb-4" />}
              <div className="flex items-center justify-between gap-3 mb-4 px-1">
                <div>
                  <div className="font-mono text-[13px] font-semibold tracking-wide" style={{ color: "var(--v-ink)" }}>
                    Your holdings
                  </div>
                  <div className="text-[11px] mt-0.5" style={{ color: "var(--v-ink-dim)" }}>
                    {holdings.length === 0
                      ? "Buy shares from a stock’s detail page"
                      : `${holdings.length} position${holdings.length !== 1 ? "s" : ""} · P/L ${totalProfit >= 0 ? "+" : ""}${fmt$(totalProfit)}`}
                  </div>
                </div>
                <div className="flex items-center gap-3 flex-shrink-0">
                  <button
                    onClick={() => setChangeDisplay(changeDisplay === "percent" ? "amount" : "percent")}
                    className="flex items-center justify-center w-8 py-1.5 rounded-lg text-xs font-mono font-semibold transition-colors"
                    style={{ background: "var(--v-line)", color: "var(--v-ink)" }}
                    title={changeDisplay === "percent" ? "Showing % — click for $" : "Showing $ — click for %"}
                  >
                    {changeDisplay === "percent" ? "%" : "$"}
                  </button>
                  <div className="flex rounded-lg p-0.5" style={{ background: "var(--v-line)" }}>
                    <button
                      onClick={() => setViewMode("grid")}
                      className="w-7 h-7 rounded-md flex items-center justify-center transition-all"
                      style={{
                        background: viewMode === "grid" ? "var(--v-ink)"   : "transparent",
                        color:      viewMode === "grid" ? "var(--v-panel)" : "var(--v-ink-soft)",
                      }}
                      title="Grid view"
                    >
                      <LayoutGrid size={13} />
                    </button>
                    <button
                      onClick={() => setViewMode("list")}
                      className="w-7 h-7 rounded-md flex items-center justify-center transition-all"
                      style={{
                        background: viewMode === "list" ? "var(--v-ink)"   : "transparent",
                        color:      viewMode === "list" ? "var(--v-panel)" : "var(--v-ink-soft)",
                      }}
                      title="List view"
                    >
                      <List size={13} />
                    </button>
                  </div>
                  <div className="font-mono text-sm font-semibold" style={{ color: "var(--v-ink)" }}>
                    {fmt$(portfolioValue)}
                  </div>
                </div>
              </div>
              {portfolioStocks.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-64 gap-2 font-mono text-sm" style={{ color: "var(--v-ink-dim)" }}>
                  <BarChart2 size={32} style={{ color: "var(--v-line-strong)" }} />
                  <span>No shares owned yet</span>
                </div>
              ) : viewMode === "grid" ? (
                <div className="grid gap-3 grid-cols-[repeat(2,minmax(10.5rem,1fr))] lg:grid-cols-[repeat(3,minmax(11rem,1fr))] xl:grid-cols-[repeat(4,minmax(11rem,1fr))] 2xl:grid-cols-[repeat(5,minmax(11rem,1fr))]">
                  {portfolioStocks.map(({ stock, holding }) => (
                    <StockCard key={stock.symbol} {...sharedCardProps(stock, holding)} />
                  ))}
                </div>
              ) : (
                <div className="min-w-max">
                  <HoldingListHeader
                    sort={sort}
                    sortDir={sortDir}
                    changeDisplay={changeDisplay}
                    onColumnSort={onColumnSort}
                  />
                  <div className="flex flex-col gap-1.5">
                    {portfolioStocks.map(({ stock, holding }) => (
                      <HoldingRow
                        key={stock.symbol}
                        stock={stock}
                        holding={holding}
                        range={homeRange}
                        watchlists={watchlists}
                        isPinned={pinnedSymbols.includes(stock.symbol)}
                        changeDisplay={changeDisplay}
                        refreshKey={sparkEpoch}
                        onSelect={() => selectSymbol(stock.symbol)}
                        onToggleWatchlist={toggleWatchlist}
                        onTogglePin={togglePin}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {page === "home" && (
        <div className="flex flex-1 overflow-hidden min-h-0">
          <WatchlistSidebar
            watchlists={watchlists}
            activeId={activeWatchlist}
            open={sidebarOpen}
            onSelect={id => { setActiveWatchlist(id); setSelectedSymbol(null); }}
            onCreate={createWatchlist}
            onDelete={deleteWatchlist}
            onRename={renameWatchlist}
            onReorder={reorderWatchlists}
          />

          <button
            type="button"
            onClick={() => setSidebarOpen(v => !v)}
            className="flex-shrink-0 self-stretch w-4 flex items-center justify-center border-r z-20 transition-colors hover:bg-white/5"
            style={{
              background: "var(--v-panel)",
              borderColor: "var(--v-line)",
              color: "var(--v-ink-soft)",
            }}
            title={sidebarOpen ? "Hide watchlists" : "Show watchlists"}
            aria-label={sidebarOpen ? "Hide watchlists" : "Show watchlists"}
            aria-expanded={sidebarOpen}
          >
            {sidebarOpen
              ? <ChevronLeft size={12} />
              : <ChevronRight size={12} />}
          </button>

          <div className="flex-1 flex flex-col overflow-hidden min-w-0 min-h-0">
            {selectedStock ? (
              <StockDetailView
                stock={selectedStock}
                range={selectedDetailRange}
                holding={holdingMap.get(selectedStock.symbol)}
                balance={balance}
                onBack={() => setSelectedSymbol(null)}
                onRangeChange={r => setDetailRange(selectedStock.symbol, r)}
                onBuy={shares => buyShares(selectedStock.symbol, shares, selectedStock.price)}
                onSell={shares => sellShares(selectedStock.symbol, shares, selectedStock.price)}
                signedIn={signedIn}
                onSignIn={goSignIn}
              />
            ) : (
              <>
                <Toolbar
                  range={homeRange}     setRange={setHomeRange}
                  filter={filter}   setFilter={setFilter}
                  sort={sort}       sortDir={sortDir} onSortSelect={onSortSelect}
                  changeDisplay={changeDisplay} setChangeDisplay={setChangeDisplay}
                  search={search}   setSearch={setSearch}
                  viewMode={viewMode} setViewMode={setViewMode}
                  watchlists={watchlists}
                  stocks={stocks}
                  onSelectSymbol={openSymbol}
                  onToggleWatchlist={toggleWatchlist}
                  onStocksHydrated={hydrateStocks}
                  refreshKey={sparkEpoch}
                />

                <div
                  className="flex-1 overflow-auto p-4"
                  style={{ scrollbarWidth: "thin", scrollbarColor: "var(--v-line-strong) transparent" }}
                  onDragOver={e => e.preventDefault()}
                >
                  {visibleStocks.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full gap-2 font-mono text-sm" style={{ color: "var(--v-ink-dim)" }}>
                      <BarChart2 size={32} style={{ color: "var(--v-line-strong)" }} />
                      <span>No stocks match your filters</span>
                    </div>
                  ) : viewMode === "grid" ? (
                    <div className="grid gap-3 grid-cols-[repeat(2,minmax(10.5rem,1fr))] lg:grid-cols-[repeat(3,minmax(11rem,1fr))] xl:grid-cols-[repeat(4,minmax(11rem,1fr))] 2xl:grid-cols-[repeat(5,minmax(11rem,1fr))]">
                      {visibleStocks.map(stock => (
                        <StockCard key={stock.symbol} {...sharedCardProps(stock)} />
                      ))}
                    </div>
                  ) : (
                    <div className="min-w-max">
                      <ListHeader
                        sort={sort}
                        sortDir={sortDir}
                        changeDisplay={changeDisplay}
                        onColumnSort={onColumnSort}
                      />
                      <div className="flex flex-col gap-1.5">
                        {visibleStocks.map(stock => (
                          <StockRow key={stock.symbol} {...sharedCardProps(stock)} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {needsNameSetup && user && (
        <OnboardingDialog
          email={profile.email || user.email || ""}
          initialName={profile.name || pendingSignupName.current}
          onComplete={handleOnboarding}
        />
      )}

      {tradeDialog && (() => {
        const stock = stocks.find(s => s.symbol === tradeDialog.symbol);
        if (!stock) return null;
        if (tradeDialog.mode === "buy") {
          return (
            <BuySharesDialog
              stock={stock}
              balance={balance}
              onClose={() => setTradeDialog(null)}
              onBuy={shares => buyShares(stock.symbol, shares, stock.price)}
            />
          );
        }
        const holding = holdingMap.get(stock.symbol);
        if (!holding) return null;
        return (
          <SellSharesDialog
            stock={stock}
            holding={holding}
            onClose={() => setTradeDialog(null)}
            onSell={shares => sellShares(stock.symbol, shares, stock.price)}
          />
        );
      })()}

      <VantageChat
        context={{
          signedIn,
          watchlistSymbols: [...new Set(watchlists.flatMap(w => w.symbols))],
          holdings,
          stocks: stocks.map(s => ({
            symbol: s.symbol,
            name: s.name,
            sector: s.sector,
            price: s.price,
            changePercent: s.changePercent,
          })),
        }}
      />
    </div>
  );
}
