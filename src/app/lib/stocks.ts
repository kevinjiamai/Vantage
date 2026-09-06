export interface StockMeta {
  symbol: string;
  name: string;
  sector: string;
  price: number;
  change: number;
  changePercent: number;
  volume: number;
  avgVolume: number;
  marketCap: number;
  pe: number | null;
  high52w: number;
  low52w: number;
  open: number;
  dayHigh: number;
  dayLow: number;
  eps: number | null;
  dividendYield: number | null;
  stale?: boolean;
  marketState?: string;
  afterHours?: {
    price: number;
    change: number;
    changePercent: number;
  } | null;
  preMarket?: {
    price: number;
    change: number;
    changePercent: number;
  } | null;
}

export interface PricePoint {
  t: number;
  p: number;
  v?: number;
}

export interface SearchResult {
  symbol: string;
  name: string;
  sector: string;
  exchange?: string;
  type?: string;
}

export interface StockNewsItem {
  id: string;
  title: string;
  url: string;
  publisher: string;
  publishedAt?: string | null;
  image?: string | null;
  /** Original CDN image before proxy rewrite */
  rawImage?: string | null;
  summary?: string | null;
}

export type TimeRange =
  | "1D" | "1W" | "1M" | "3M" | "6M" | "YTD"
  | "1Y" | "2Y" | "5Y" | "10Y" | "ALL";

export type QuotesFreshness = "live" | "stale" | "empty";

/** Static universe — live fields filled from yfinance */
export const STOCK_SEED: { symbol: string; name: string; sector: string }[] = [
  { symbol: "AAPL", name: "Apple Inc.", sector: "Technology" },
  { symbol: "MSFT", name: "Microsoft Corp.", sector: "Technology" },
  { symbol: "NVDA", name: "NVIDIA Corp.", sector: "Technology" },
  { symbol: "GOOGL", name: "Alphabet Inc.", sector: "Technology" },
  { symbol: "AMZN", name: "Amazon.com Inc.", sector: "Consumer" },
  { symbol: "META", name: "Meta Platforms", sector: "Technology" },
  { symbol: "TSLA", name: "Tesla Inc.", sector: "Automotive" },
  { symbol: "JPM", name: "JPMorgan Chase", sector: "Finance" },
  { symbol: "V", name: "Visa Inc.", sector: "Finance" },
  { symbol: "SPY", name: "SPDR S&P 500 ETF", sector: "ETF" },
  { symbol: "QQQ", name: "Invesco QQQ Trust", sector: "ETF" },
  { symbol: "NFLX", name: "Netflix Inc.", sector: "Technology" },
  { symbol: "BRK.B", name: "Berkshire Hathaway", sector: "Finance" },
  { symbol: "GLD", name: "SPDR Gold Shares", sector: "Commodity" },
  { symbol: "JNJ", name: "Johnson & Johnson", sector: "Healthcare" },
];

export const ALL_SYMBOLS = STOCK_SEED.map(s => s.symbol);

const QUOTES_LS_KEY = "vantage-quotes-cache";

/** Backend origin for production; empty uses same-origin / Vite proxy in dev. */
const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? "").replace(/\/$/, "");

function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

function emptyMeta(seed: { symbol: string; name: string; sector: string }): StockMeta {
  return {
    ...seed,
    price: 0, change: 0, changePercent: 0, volume: 0, avgVolume: 0,
    marketCap: 0, pe: null, high52w: 0, low52w: 0, open: 0, dayHigh: 0, dayLow: 0,
    eps: null, dividendYield: null, afterHours: null, preMarket: null,
  };
}

function loadPersistedQuotes(): StockMeta[] | null {
  try {
    const raw = localStorage.getItem(QUOTES_LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StockMeta[];
    if (!Array.isArray(parsed) || !parsed.length) return null;
    return parsed.filter(s => s && typeof s.symbol === "string" && Number(s.price) > 0);
  } catch {
    return null;
  }
}

function persistQuotes(quotes: StockMeta[]) {
  const good = quotes.filter(s => s.price > 0);
  if (!good.length) return;
  try {
    localStorage.setItem(QUOTES_LS_KEY, JSON.stringify(good));
  } catch {
    /* ignore quota */
  }
}

function seedWithPersisted(): StockMeta[] {
  const persisted = loadPersistedQuotes();
  const bySym = new Map((persisted ?? []).map(s => [s.symbol, { ...s, stale: true }]));
  return STOCK_SEED.map(seed => {
    const prev = bySym.get(seed.symbol);
    return prev ? { ...prev, name: seed.name, sector: seed.sector, stale: true } : emptyMeta(seed);
  });
}

/** Mutable live snapshot — seeded from last-good local cache when available */
export let STOCKS_META: StockMeta[] = seedWithPersisted();

/** Freshness of the last successful quote merge */
export let lastQuotesFreshness: QuotesFreshness =
  STOCKS_META.some(s => s.price > 0) ? "stale" : "empty";

const historyCache = new Map<string, PricePoint[]>();
const historyInflight = new Map<string, Promise<PricePoint[]>>();
const HISTORY_VERSION = 4;

export type HistoryResolution = "full" | "spark";

function cacheKey(symbol: string, range: TimeRange, resolution: HistoryResolution = "full") {
  const base = `${HISTORY_VERSION}:${symbol}:${range}`;
  return resolution === "spark" ? `${base}:spark` : base;
}

/** Max Recharts points for card sparklines (client safety net). */
export function sparklineMaxPoints(range: TimeRange): number {
  switch (range) {
    case "1D": return 40;
    case "1W": return 48;
    case "1M": return 48;
    case "3M": return 56;
    case "6M":
    case "YTD":
    case "1Y": return 64;
    default: return 72;
  }
}

/** Largest-Triangle-Three-Buckets downsample; preserves first/last. */
export function downsampleLTTB(points: PricePoint[], maxPoints: number): PricePoint[] {
  const n = points.length;
  if (maxPoints < 3 || n <= maxPoints) return points;

  const out: PricePoint[] = [points[0]];
  const bucketSize = (n - 2) / (maxPoints - 2);
  let a = 0;

  for (let i = 0; i < maxPoints - 2; i++) {
    let avgRangeStart = Math.floor((i + 1) * bucketSize) + 1;
    let avgRangeEnd = Math.floor((i + 2) * bucketSize) + 1;
    avgRangeEnd = Math.min(avgRangeEnd, n);

    let avgX = 0;
    let avgY = 0;
    let avgRangeLength = avgRangeEnd - avgRangeStart;
    if (avgRangeLength <= 0) {
      avgRangeLength = 1;
      avgRangeStart = Math.min(avgRangeStart, n - 1);
      avgRangeEnd = avgRangeStart + 1;
    }
    for (let j = avgRangeStart; j < avgRangeEnd; j++) {
      avgX += points[j].t;
      avgY += points[j].p;
    }
    avgX /= avgRangeLength;
    avgY /= avgRangeLength;

    const rangeOffs = Math.floor(i * bucketSize) + 1;
    const rangeTo = Math.min(Math.floor((i + 1) * bucketSize) + 1, n - 1);

    const pointAx = points[a].t;
    const pointAy = points[a].p;
    let maxArea = -1;
    let nextA = rangeOffs;
    for (let j = rangeOffs; j < rangeTo; j++) {
      const area = Math.abs(
        (pointAx - avgX) * (points[j].p - pointAy) - (pointAx - points[j].t) * (avgY - pointAy),
      ) * 0.5;
      if (area > maxArea) {
        maxArea = area;
        nextA = j;
      }
    }
    out.push(points[nextA]);
    a = nextA;
  }

  out.push(points[n - 1]);
  return out;
}

function n(v: unknown, fallback = 0) {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function nNull(v: unknown) {
  if (v == null) return null;
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : null;
}

/**
 * Build a StockMeta from API raw. Never invent fake prices — if the API
 * returned no usable price, keep `prev` (last live/stale) when available.
 */
function asStock(
  raw: Record<string, unknown>,
  seed?: { symbol: string; name: string; sector: string },
  prev?: StockMeta,
): StockMeta {
  const symbol = String(raw.symbol ?? seed?.symbol ?? prev?.symbol ?? "");
  const price = n(raw.price, 0);
  const apiStale = raw.stale === true;
  const unusable = !(price > 0);

  if (unusable && prev && prev.price > 0) {
    return {
      ...prev,
      name: String(raw.name ?? seed?.name ?? prev.name),
      sector: String(raw.sector ?? seed?.sector ?? prev.sector),
      stale: true,
    };
  }

  if (unusable) {
    return {
      ...(prev ?? emptyMeta(seed ?? { symbol, name: symbol, sector: "—" })),
      symbol,
      name: String(raw.name ?? seed?.name ?? prev?.name ?? symbol),
      sector: String(raw.sector ?? seed?.sector ?? prev?.sector ?? "—"),
      stale: true,
    };
  }

  return {
    symbol,
    name: String(raw.name ?? seed?.name ?? prev?.name ?? symbol),
    sector: String(raw.sector ?? seed?.sector ?? prev?.sector ?? "—"),
    price,
    change: n(raw.change, prev?.change ?? 0),
    changePercent: n(raw.changePercent, prev?.changePercent ?? 0),
    volume: n(raw.volume, prev?.volume ?? 0),
    avgVolume: n(raw.avgVolume, prev?.avgVolume ?? 0),
    marketCap: n(raw.marketCap, prev?.marketCap ?? 0),
    pe: nNull(raw.pe) ?? prev?.pe ?? null,
    high52w: n(raw.high52w, prev?.high52w ?? 0),
    low52w: n(raw.low52w, prev?.low52w ?? 0),
    open: n(raw.open, prev?.open ?? 0),
    dayHigh: n(raw.dayHigh, prev?.dayHigh ?? 0),
    dayLow: n(raw.dayLow, prev?.dayLow ?? 0),
    eps: nNull(raw.eps) ?? prev?.eps ?? null,
    dividendYield: nNull(raw.dividendYield) ?? prev?.dividendYield ?? null,
    stale: apiStale,
    marketState: typeof raw.marketState === "string" ? raw.marketState : prev?.marketState,
    afterHours: parseSessionQuote(raw.afterHours, prev?.afterHours),
    preMarket: parseSessionQuote(raw.preMarket, prev?.preMarket),
  };
}

function parseSessionQuote(
  raw: unknown,
  prev: StockMeta["afterHours"] | undefined,
): StockMeta["afterHours"] {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    const p = n(o.price, 0);
    if (p > 0) {
      return {
        price: p,
        change: n(o.change, 0),
        changePercent: n(o.changePercent, 0),
      };
    }
  }
  return raw === null ? null : (prev ?? null);
}

function freshnessFrom(quotes: StockMeta[]): QuotesFreshness {
  const priced = quotes.filter(s => s.price > 0);
  if (!priced.length) return "empty";
  if (priced.some(s => s.stale)) return "stale";
  return "live";
}

/** Pin chart endpoint to displayed quote price */
export function alignHistoryToPrice(points: PricePoint[], lastPrice?: number): PricePoint[] {
  if (!points.length || lastPrice == null || !Number.isFinite(lastPrice)) return points;
  const next = points.slice();
  const last = next[next.length - 1];
  if (last.p === lastPrice) return points;
  next[next.length - 1] = { ...last, p: lastPrice };
  return next;
}

export function invalidateHistory(symbol?: string) {
  if (!symbol) {
    historyCache.clear();
    return;
  }
  const prefix = `${HISTORY_VERSION}:${symbol}:`;
  for (const k of [...historyCache.keys()]) {
    if (k.startsWith(prefix)) historyCache.delete(k);
  }
}

export function invalidateHistoryRange(range: TimeRange) {
  for (const k of [...historyCache.keys()]) {
    if (k.endsWith(`:${range}`) || k.endsWith(`:${range}:spark`)) {
      historyCache.delete(k);
    }
  }
}

/** Server rejects a longer symbol list outright, so requests are split at this size. */
export const QUOTE_BATCH_SIZE = 40;

async function fetchQuoteBatch(batch: string[]): Promise<Map<string, Record<string, unknown>>> {
  const res = await fetch(apiUrl(`/api/quotes?symbols=${encodeURIComponent(batch.join(","))}`));
  if (!res.ok) throw new Error(`Quote fetch failed (${res.status})`);
  const json = await res.json();
  const quotes: Record<string, unknown>[] = json?.quotes ?? [];
  return new Map(quotes.map(q => [String(q.symbol), q]));
}

export async function fetchQuotes(symbols: string[] = ALL_SYMBOLS): Promise<StockMeta[]> {
  const knownExtras = STOCKS_META.map(s => s.symbol).filter(s => !ALL_SYMBOLS.includes(s));
  const request = [...new Set([...symbols, ...knownExtras])];
  // knownExtras grows with every imported symbol, so this list outgrows the
  // server's per-request cap as soon as a watchlist is imported.
  const bySym = new Map<string, Record<string, unknown>>();
  for (let i = 0; i < request.length; i += QUOTE_BATCH_SIZE) {
    const batch = await fetchQuoteBatch(request.slice(i, i + QUOTE_BATCH_SIZE));
    for (const [sym, q] of batch) bySym.set(sym, q);
  }

  const existing = new Map(STOCKS_META.map(s => [s.symbol, s]));
  const seedSet = new Set(STOCK_SEED.map(s => s.symbol));

  for (const seed of STOCK_SEED) {
    const raw = bySym.get(seed.symbol);
    const prev = existing.get(seed.symbol);
    existing.set(seed.symbol, raw ? asStock(raw, seed, prev) : (prev ?? emptyMeta(seed)));
  }

  for (const sym of request) {
    if (seedSet.has(sym)) continue;
    const raw = bySym.get(sym);
    if (raw) existing.set(sym, asStock(raw, undefined, existing.get(sym)));
  }

  STOCKS_META = [...existing.values()];
  lastQuotesFreshness = freshnessFrom(STOCKS_META);
  persistQuotes(STOCKS_META);
  return STOCKS_META;
}

/** Fetch only the given symbols and merge into the live snapshot. */
export async function mergeQuotes(symbols: string[]): Promise<StockMeta[]> {
  const unique = [...new Set(symbols.map(s => s.trim()).filter(Boolean))];
  if (!unique.length) return STOCKS_META;

  const bySym = new Map<string, Record<string, unknown>>();
  // Batches run in series: the backend fans each one out to Yahoo already, and
  // overlapping requests trip its rate limiter.
  for (let i = 0; i < unique.length; i += QUOTE_BATCH_SIZE) {
    const batch = await fetchQuoteBatch(unique.slice(i, i + QUOTE_BATCH_SIZE));
    for (const [sym, q] of batch) bySym.set(sym, q);
  }

  const existing = new Map(STOCKS_META.map(s => [s.symbol, s]));
  for (const sym of unique) {
    const raw = bySym.get(sym);
    if (!raw) continue;
    const seed = STOCK_SEED.find(s => s.symbol === sym);
    existing.set(sym, asStock(raw, seed, existing.get(sym)));
  }
  STOCKS_META = [...existing.values()];
  lastQuotesFreshness = freshnessFrom(STOCKS_META);
  persistQuotes(STOCKS_META);
  return STOCKS_META;
}

export interface ResolvedSymbols {
  /** Symbols the backend could price. */
  found: string[];
  /** Symbols that came back with no price — delisted, or not a Yahoo ticker. */
  missing: string[];
  stocks: StockMeta[];
}

/**
 * Price a candidate symbol list, reporting which ones Yahoo actually knows.
 * Progress is reported per batch so a long import can show movement.
 */
export async function resolveSymbols(
  symbols: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<ResolvedSymbols> {
  const unique = [...new Set(symbols.map(s => s.trim()).filter(Boolean))];
  if (!unique.length) return { found: [], missing: [], stocks: STOCKS_META };

  for (let i = 0; i < unique.length; i += QUOTE_BATCH_SIZE) {
    await mergeQuotes(unique.slice(i, i + QUOTE_BATCH_SIZE));
    onProgress?.(Math.min(i + QUOTE_BATCH_SIZE, unique.length), unique.length);
  }

  const priced = new Map(STOCKS_META.map(s => [s.symbol, s.price]));
  const found: string[] = [];
  const missing: string[] = [];
  for (const sym of unique) {
    if ((priced.get(sym) ?? 0) > 0) found.push(sym);
    else missing.push(sym);
  }
  return { found, missing, stocks: STOCKS_META };
}

/** Fetch symbols and merge into the live snapshot (for search/detail of any ticker). */
export async function ensureQuotes(symbols: string[]): Promise<StockMeta[]> {
  const unique = [...new Set(symbols.map(s => s.trim()).filter(Boolean))];
  if (!unique.length) return STOCKS_META;
  // Always refresh requested symbols so session fields (pre/post market) stay current
  return mergeQuotes(unique);
}

export async function fetchHistory(
  symbol: string,
  range: TimeRange,
  lastPrice?: number,
  opts?: { resolution?: HistoryResolution },
): Promise<PricePoint[]> {
  const resolution: HistoryResolution = opts?.resolution ?? "full";
  const key = cacheKey(symbol, range, resolution);
  const cached = historyCache.get(key);
  // Prefer cache only when points include volume
  if (cached?.length && cached.some(p => typeof p.v === "number")) {
    return alignHistoryToPrice(cached, lastPrice);
  }

  const inflight = historyInflight.get(key);
  if (inflight) {
    const pts = await inflight;
    return alignHistoryToPrice(pts, lastPrice);
  }

  const promise = (async () => {
    const qs = new URLSearchParams({
      range,
      resolution,
    });
    const res = await fetch(
      apiUrl(`/api/history/${encodeURIComponent(symbol)}?${qs.toString()}`)
    );
    if (!res.ok) throw new Error(`History fetch failed (${res.status})`);
    const json = await res.json();
    let points: PricePoint[] = (json?.points ?? [])
      .filter((p: PricePoint) => Number.isFinite(p.t) && Number.isFinite(p.p))
      .map((p: PricePoint) => ({
        t: Number(p.t),
        p: Number(p.p),
        v: typeof p.v === "number" && Number.isFinite(p.v) ? p.v : 0,
      }));
    const apiLast = typeof json?.lastPrice === "number" ? json.lastPrice : undefined;
    points = alignHistoryToPrice(points, apiLast);
    if (points.length) historyCache.set(key, points);
    return points;
  })().finally(() => {
    historyInflight.delete(key);
  });

  historyInflight.set(key, promise);
  const pts = await promise;
  return alignHistoryToPrice(pts, lastPrice);
}

/** Sync read of cached history only (empty until fetched). */
export function getHistory(
  symbol: string,
  range: TimeRange,
  lastPrice?: number,
  opts?: { resolution?: HistoryResolution },
): PricePoint[] {
  const resolution: HistoryResolution = opts?.resolution ?? "full";
  return alignHistoryToPrice(historyCache.get(cacheKey(symbol, range, resolution)) ?? [], lastPrice);
}

export function clearHistoryCache() {
  historyCache.clear();
}

/** $ / % move over a history series (first → last). */
export function changeFromPoints(
  points: PricePoint[],
  fallback: { change: number; changePercent: number } = { change: 0, changePercent: 0 },
): { change: number; changePercent: number } {
  if (points.length < 2) return fallback;
  const first = points[0].p;
  const last = points[points.length - 1].p;
  if (!Number.isFinite(first) || !Number.isFinite(last) || first === 0) return fallback;
  const change = last - first;
  return { change, changePercent: (change / first) * 100 };
}

/**
 * Quote change for UI: 1D uses live day change; other ranges use history
 * first→last (prefer full cache, fall back to spark; else day change).
 */
export function quoteChangeForRange(
  symbol: string,
  range: TimeRange,
  stock: Pick<StockMeta, "change" | "changePercent" | "price">,
): { change: number; changePercent: number } {
  const day = { change: stock.change, changePercent: stock.changePercent };
  if (range === "1D") return day;
  const full = getHistory(symbol, range, stock.price);
  if (full.length >= 2) return changeFromPoints(full, day);
  return changeFromPoints(getHistory(symbol, range, stock.price, { resolution: "spark" }), day);
}

export interface SymbolPerformance {
  symbol: string;
  changePercent: number;
}

/**
 * Percent change over a range for many symbols in one request.
 * Backed by a single batched download server-side, so this takes hundreds of
 * symbols where /api/quotes caps at QUOTE_BATCH_SIZE.
 */
export async function fetchPerformance(
  symbols: string[],
  range: TimeRange,
): Promise<SymbolPerformance[]> {
  const unique = [...new Set(symbols.map(s => s.trim()).filter(Boolean))];
  if (!unique.length) return [];
  const qs = new URLSearchParams({ range, symbols: unique.join(",") });
  const res = await fetch(apiUrl(`/api/performance?${qs.toString()}`));
  if (!res.ok) throw new Error(`Performance fetch failed (${res.status})`);
  const json = await res.json();
  const rows: Record<string, unknown>[] = json?.results ?? [];
  return rows.flatMap(r => {
    const pct = r.changePercent;
    return typeof pct === "number" && Number.isFinite(pct)
      ? [{ symbol: String(r.symbol), changePercent: pct }]
      : [];
  });
}

export interface ScreenRow {
  symbol: string;
  [metric: string]: number | string | null;
}

export interface ScreenResult {
  results: ScreenRow[];
  matched: number;
  screened: number;
  requested: number;
  no_data: string[];
  truncated: boolean;
}

/** Filter and rank symbols by server-computed indicators. */
export async function fetchScreen(
  symbols: string[],
  opts: { where?: string; sort?: string; limit?: number } = {},
): Promise<ScreenResult> {
  const unique = [...new Set(symbols.map(s => s.trim()).filter(Boolean))];
  const qs = new URLSearchParams({ symbols: unique.join(",") });
  if (opts.where) qs.set("where", opts.where);
  if (opts.sort) qs.set("sort", opts.sort);
  if (opts.limit) qs.set("limit", String(opts.limit));
  const res = await fetch(apiUrl(`/api/screen?${qs.toString()}`));
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(detail?.detail ?? `Screen failed (${res.status})`);
  }
  return res.json();
}

export async function searchStocks(query: string): Promise<SearchResult[]> {
  const q = query.trim();
  if (!q) return [];
  const res = await fetch(apiUrl(`/api/search?q=${encodeURIComponent(q)}`));
  if (!res.ok) throw new Error(`Search failed (${res.status})`);
  const json = await res.json();
  return (json?.results ?? []) as SearchResult[];
}

export async function fetchStockNews(symbol: string, limit = 8): Promise<StockNewsItem[]> {
  const sym = symbol.trim().toUpperCase();
  if (!sym) return [];
  const qs = `limit=${encodeURIComponent(String(limit))}`;
  const path = `/api/news/${encodeURIComponent(sym)}?${qs}`;

  const urls = [
    apiUrl(path),
    `https://vantage-api-eni1.onrender.com${path}`,
  ].filter((u, i, arr) => u && arr.indexOf(u) === i);

  let lastErr: Error | null = null;
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) {
        lastErr = new Error(`News fetch failed (${res.status})`);
        continue;
      }
      const json = await res.json();
      const items = (json?.news ?? []) as StockNewsItem[];
      return items
        .filter(item => item && typeof item.title === "string" && item.title.trim() && typeof item.url === "string")
        .map(item => {
          const rawImage = typeof item.image === "string" && item.image.startsWith("http") ? item.image : null;
          return {
            id: String(item.id || item.url),
            title: item.title.trim(),
            url: item.url,
            publisher: item.publisher || "Yahoo Finance",
            publishedAt: item.publishedAt ?? null,
            summary: item.summary ?? null,
            rawImage,
            image: rawImage,
          };
        });
    } catch (err) {
      lastErr = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw lastErr ?? new Error("News fetch failed");
}

/** Prefetch sparkline-resolution history for cards/list. */
export async function prefetchSparklines(symbols: string[], range: TimeRange = "1D") {
  const concurrency = 4;
  let i = 0;
  async function worker() {
    while (i < symbols.length) {
      const idx = i++;
      try {
        await fetchHistory(symbols[idx], range, undefined, { resolution: "spark" });
      } catch { /* ignore */ }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, symbols.length) }, () => worker()));
}
