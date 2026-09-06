from __future__ import annotations

import json
import math
import os
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import numpy as np
import yfinance as yf
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Vantage yfinance API")
_DEFAULT_CORS = (
    "http://localhost:5173,http://127.0.0.1:5173,"
    "https://vantage-orcin-rho.vercel.app,"
    "https://vantage-keirawang1.vercel.app,"
    "https://vantage-g2jl.vercel.app,"
    "https://vantage-g2jl-keirawang1.vercel.app"
)
_CORS_ORIGINS = list(dict.fromkeys(
    [o.strip() for o in os.environ.get("VANTAGE_CORS_ORIGINS", _DEFAULT_CORS).split(",") if o.strip()]
    + [
        "https://vantage-orcin-rho.vercel.app",
        "https://vantage-keirawang1.vercel.app",
    ]
))
# Vercel production + preview deployments, plus any local Vite port
_CORS_ORIGIN_REGEX = os.environ.get(
    "VANTAGE_CORS_ORIGIN_REGEX",
    r"https://(vantage|vantage-g2jl)(-[a-z0-9-]+)*\.vercel\.app|http://(localhost|127\.0\.0\.1):\d+",
).strip() or None
app.add_middleware(
    CORSMiddleware,
    allow_origins=_CORS_ORIGINS,
    allow_origin_regex=_CORS_ORIGIN_REGEX,
    allow_methods=["GET"],
    allow_headers=["*"],
)

MAX_SYMBOLS = 40
# One batched download, so this can be far larger than MAX_SYMBOLS.
MAX_PERF_SYMBOLS = 500
MAX_SEARCH_LEN = 64
_SYMBOL_RE = re.compile(r"^[A-Za-z0-9.^=_-]{1,15}$")  # "=" admits futures (ES=F)


def _normalize_symbol(symbol: str) -> str:
    s = symbol.strip().upper()
    if not _SYMBOL_RE.match(s):
        raise HTTPException(400, "invalid symbol")
    return s

RANGE_MAP = {
    "1D":  {"period": "1d",  "interval": "5m"},
    "1W":  {"period": "5d",  "interval": "15m"},
    "1M":  {"period": "1mo", "interval": "30m"},
    "3M":  {"period": "3mo", "interval": "1h"},
    "6M":  {"period": "6mo", "interval": "1h"},
    "YTD": {"period": "ytd", "interval": "1h"},
    "1Y":  {"period": "1y",  "interval": "1h"},
    "2Y":  {"period": "2y",  "interval": "1d"},
    "5Y":  {"period": "5y",  "interval": "1d"},
    "10Y": {"period": "10y", "interval": "1d"},
    "ALL": {"period": "max", "interval": "1d"},
}

# Coarser intervals for card/list sparklines (smaller Yahoo payloads).
SPARK_RANGE_MAP = {
    "1D":  {"period": "1d",  "interval": "15m"},
    "1W":  {"period": "5d",  "interval": "60m"},
    "1M":  {"period": "1mo", "interval": "1d"},
    "3M":  {"period": "3mo", "interval": "1d"},
    "6M":  {"period": "6mo", "interval": "1d"},
    "YTD": {"period": "ytd", "interval": "1d"},
    "1Y":  {"period": "1y",  "interval": "1d"},
    "2Y":  {"period": "2y",  "interval": "1wk"},
    "5Y":  {"period": "5y",  "interval": "1wk"},
    "10Y": {"period": "10y", "interval": "1wk"},
    "ALL": {"period": "max", "interval": "1wk"},
}

SPARK_MAX_POINTS = {
    "1D": 48, "1W": 56, "1M": 48, "3M": 64, "6M": 72,
    "YTD": 72, "1Y": 72, "2Y": 80, "5Y": 80, "10Y": 80, "ALL": 80,
}


def _downsample_lttb(points: list[dict[str, float]], max_points: int) -> list[dict[str, float]]:
    """Largest-Triangle-Three-Buckets downsample; preserves first/last."""
    n = len(points)
    if max_points < 3 or n <= max_points:
        return points

    out: list[dict[str, float]] = [points[0]]
    bucket_size = (n - 2) / (max_points - 2)
    a = 0

    for i in range(max_points - 2):
        avg_range_start = int(math.floor((i + 1) * bucket_size)) + 1
        avg_range_end = int(math.floor((i + 2) * bucket_size)) + 1
        avg_range_end = min(avg_range_end, n)

        avg_x = 0.0
        avg_y = 0.0
        avg_range_length = avg_range_end - avg_range_start
        if avg_range_length <= 0:
            avg_range_length = 1
            avg_range_start = min(avg_range_start, n - 1)
            avg_range_end = avg_range_start + 1
        for j in range(avg_range_start, avg_range_end):
            avg_x += float(points[j]["t"])
            avg_y += float(points[j]["p"])
        avg_x /= avg_range_length
        avg_y /= avg_range_length

        range_offs = int(math.floor(i * bucket_size)) + 1
        range_to = int(math.floor((i + 1) * bucket_size)) + 1
        range_to = min(range_to, n - 1)

        point_a_x = float(points[a]["t"])
        point_a_y = float(points[a]["p"])
        max_area = -1.0
        next_a = range_offs
        for j in range(range_offs, range_to):
            area = abs(
                (point_a_x - avg_x) * (float(points[j]["p"]) - point_a_y)
                - (point_a_x - float(points[j]["t"])) * (avg_y - point_a_y)
            ) * 0.5
            if area > max_area:
                max_area = area
                next_a = j
        out.append(points[next_a])
        a = next_a

    out.append(points[-1])
    return out

# TTL cache: Yahoo aggressively rate-limits, so serve cached data and fall
# back to stale entries when yfinance errors out. Persisted to disk so
# restarts still have last-good quotes instead of zeros / client fakes.
_CACHE: dict[str, tuple[float, Any]] = {}
_CACHE_LOCK = threading.Lock()
_CACHE_PATH = Path(__file__).resolve().parent / ".yf_cache.json"

QUOTE_TTL = 60.0
HISTORY_TTL = {
    "1D": 120.0, "1W": 300.0, "1M": 600.0, "3M": 900.0, "6M": 900.0,
    "YTD": 900.0, "1Y": 1800.0, "2Y": 3600.0, "5Y": 3600.0, "10Y": 3600.0,
    "ALL": 3600.0,
}
SEARCH_TTL = 300.0
NEWS_TTL = 300.0
# Daily bars, so a long TTL is correct; the cold batch is slow (~30s/200 symbols).
PERFORMANCE_TTL = 3600.0
# Yahoo returns large batches half-empty; smaller chunks fetch reliably.
PERF_CHUNK = 50


def _cache_load() -> None:
    if not _CACHE_PATH.exists():
        return
    try:
        raw = json.loads(_CACHE_PATH.read_text())
        if not isinstance(raw, dict):
            return
        loaded: dict[str, tuple[float, Any]] = {}
        for k, entry in raw.items():
            if not isinstance(entry, (list, tuple)) or len(entry) != 2:
                continue
            ts, value = entry
            if isinstance(ts, (int, float)) and value is not None:
                loaded[str(k)] = (float(ts), value)
        with _CACHE_LOCK:
            _CACHE.update(loaded)
    except Exception:
        pass


def _cache_save() -> None:
    with _CACHE_LOCK:
        snapshot = {
            k: [ts, v]
            for k, (ts, v) in _CACHE.items()
            if not str(k).startswith("img:")
        }
    try:
        tmp = _CACHE_PATH.with_suffix(".tmp")
        tmp.write_text(json.dumps(snapshot, default=str))
        os.replace(tmp, _CACHE_PATH)
    except Exception:
        pass


def _cache_get(key: str, ttl: float) -> tuple[Any, bool]:
    """Returns (value, fresh). value is None if missing entirely."""
    with _CACHE_LOCK:
        entry = _CACHE.get(key)
    if entry is None:
        return None, False
    ts, value = entry
    return value, (time.time() - ts) < ttl


def _cache_put(key: str, value: Any) -> None:
    with _CACHE_LOCK:
        _CACHE[key] = (time.time(), value)
    _cache_save()


_cache_load()

SECTORS = {
    "AAPL": "Technology",
    "MSFT": "Technology",
    "NVDA": "Technology",
    "GOOGL": "Technology",
    "AMZN": "Consumer",
    "META": "Technology",
    "TSLA": "Automotive",
    "JPM": "Finance",
    "V": "Finance",
    "SPY": "ETF",
    "QQQ": "ETF",
    "NFLX": "Technology",
    "BRK.B": "Finance",
    "GLD": "Commodity",
    "JNJ": "Healthcare",
}


def _yf_symbol(symbol: str) -> str:
    """Yahoo uses dashes for class shares (BRK.B → BRK-B)."""
    return symbol.strip().upper().replace(".", "-")


def _num(v: Any) -> float | None:
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if math.isnan(f) or math.isinf(f):
        return None
    return f


def _live_price(t: yf.Ticker) -> float | None:
    try:
        fast = dict(t.fast_info) if t.fast_info is not None else {}
    except Exception:
        fast = {}
    for k in ("lastPrice", "last_price", "regularMarketPrice", "currentPrice"):
        n = _num(fast.get(k))
        if n is not None:
            return n
    try:
        info = t.info or {}
    except Exception:
        info = {}
    for k in ("regularMarketPrice", "currentPrice", "previousClose"):
        n = _num(info.get(k))
        if n is not None:
            return n
    return None


def _quote_one(symbol: str) -> dict[str, Any]:
    display = symbol.strip().upper()
    t = yf.Ticker(_yf_symbol(display))
    info: dict[str, Any] = {}
    try:
        info = t.info or {}
    except Exception:
        info = {}

    fast: dict[str, Any] = {}
    try:
        fast = dict(t.fast_info) if t.fast_info is not None else {}
    except Exception:
        fast = {}

    def pick(*keys: str) -> float | None:
        for k in keys:
            if k in fast:
                n = _num(fast.get(k))
                if n is not None:
                    return n
            if k in info:
                n = _num(info.get(k))
                if n is not None:
                    return n
        return None

    price = pick("lastPrice", "last_price", "regularMarketPrice", "currentPrice") or 0.0
    prev = pick("previousClose", "previous_close", "regularMarketPreviousClose") or 0.0
    change = pick("regularMarketChange")
    change_pct = pick("regularMarketChangePercent")
    if change is None and prev:
        change = price - prev
    if change_pct is None and prev:
        change_pct = ((price - prev) / prev) * 100 if prev else 0.0
    if change is None:
        change = 0.0
    if change_pct is None:
        change_pct = 0.0

    div = pick("dividendYield", "trailingAnnualDividendYield")
    if div is not None and div <= 1:
        div = div * 100

    name = (
        info.get("longName")
        or info.get("shortName")
        or info.get("displayName")
        or display
    )

    market_state = str(info.get("marketState") or fast.get("marketState") or "").upper()
    post_price = pick("postMarketPrice", "post_market_price")
    post_change = pick("postMarketChange", "post_market_change")
    post_change_pct = pick("postMarketChangePercent", "post_market_change_percent")
    pre_price = pick("preMarketPrice", "pre_market_price")
    pre_change = pick("preMarketChange", "pre_market_change")
    pre_change_pct = pick("preMarketChangePercent", "pre_market_change_percent")
    reg_price = pick("regularMarketPrice") or 0.0
    last = pick("lastPrice", "last_price")

    is_pre = market_state in ("PRE", "PREPRE") or market_state.startswith("PRE")
    is_post = market_state in ("POST", "POSTPOST") or market_state.startswith("POST")

    # Prefer regular-session price for the main quote outside regular hours
    if (is_pre or is_post or market_state == "CLOSED") and reg_price > 0:
        price = reg_price
        change = pick("regularMarketChange")
        change_pct = pick("regularMarketChangePercent")
        if change is None and prev:
            change = price - prev
        if change_pct is None and prev:
            change_pct = ((price - prev) / prev) * 100 if prev else 0.0
        if change is None:
            change = 0.0
        if change_pct is None:
            change_pct = 0.0

    def _ext_quote(
        px: float | None,
        ch: float | None,
        ch_pct: float | None,
        *,
        fallback_last: bool,
    ) -> dict[str, float] | None:
        use = px
        if (not use or use <= 0) and fallback_last and last and reg_price and abs(last - reg_price) > 1e-4:
            use = last
        if not use or use <= 0:
            return None
        c = ch
        cp = ch_pct
        if c is None:
            c = use - price
        if cp is None:
            cp = ((use - price) / price) * 100 if price else 0.0
        return {"price": use, "change": c or 0.0, "changePercent": cp or 0.0}

    # After hours — when in POST, or when Yahoo still exposes postMarketPrice
    after_hours = None
    if is_post or (post_price and post_price > 0):
        after_hours = _ext_quote(post_price, post_change, post_change_pct, fallback_last=is_post)

    # Pre-market — when in PRE, or when Yahoo exposes preMarketPrice
    pre_market = None
    if is_pre or (pre_price and pre_price > 0):
        pre_market = _ext_quote(pre_price, pre_change, pre_change_pct, fallback_last=is_pre)

    # If state is missing but last ≠ regular during off-hours, treat as extended
    if pre_market is None and after_hours is None and last and reg_price and abs(last - reg_price) > 1e-4:
        if market_state != "REGULAR":
            # Morning (local) → pre, otherwise after
            try:
                hour = datetime.now().astimezone().hour
            except Exception:
                hour = datetime.now(timezone.utc).hour
            ext = _ext_quote(last, None, None, fallback_last=False)
            if hour < 13:
                pre_market = ext
            else:
                after_hours = ext

    return {
        "symbol": display,
        "name": str(name),
        "sector": SECTORS.get(display) or info.get("sector") or "—",
        "price": price,
        "change": change,
        "changePercent": change_pct,
        "volume": pick("lastVolume", "regularMarketVolume", "volume") or 0.0,
        "avgVolume": pick("threeMonthAverageVolume", "averageVolume", "averageDailyVolume3Month") or 0.0,
        "marketCap": pick("marketCap", "market_cap") or 0.0,
        "pe": pick("trailingPE", "forwardPE"),
        "high52w": pick("yearHigh", "fiftyTwoWeekHigh", "fifty_two_week_high") or 0.0,
        "low52w": pick("yearLow", "fiftyTwoWeekLow", "fifty_two_week_low") or 0.0,
        "open": pick("open", "regularMarketOpen") or 0.0,
        "dayHigh": pick("dayHigh", "regularMarketDayHigh") or 0.0,
        "dayLow": pick("dayLow", "regularMarketDayLow") or 0.0,
        "eps": pick("trailingEps", "epsTrailingTwelveMonths"),
        "dividendYield": div,
        "marketState": market_state or None,
        "afterHours": after_hours,
        "preMarket": pre_market,
        "stale": False,
        "asOf": time.time(),
    }


def _empty_quote(sym: str, err: str | None = None) -> dict[str, Any]:
    q: dict[str, Any] = {
        "symbol": sym,
        "name": sym,
        "sector": SECTORS.get(sym, "—"),
        "price": 0,
        "change": 0,
        "changePercent": 0,
        "volume": 0,
        "avgVolume": 0,
        "marketCap": 0,
        "pe": None,
        "high52w": 0,
        "low52w": 0,
        "open": 0,
        "dayHigh": 0,
        "dayLow": 0,
        "eps": None,
        "dividendYield": None,
        "marketState": None,
        "afterHours": None,
        "preMarket": None,
        "stale": True,
    }
    if err:
        q["error"] = err
    return q


def _stale_quote(sym: str, err: str | None = None) -> dict[str, Any]:
    """Prefer last-good cached quote over empty zeros when Yahoo fails."""
    with _CACHE_LOCK:
        entry = _CACHE.get(f"q:{sym}")
    if entry is not None:
        ts, value = entry
        if isinstance(value, dict) and value.get("price"):
            out = dict(value)
            out["stale"] = True
            out["asOf"] = ts
            if err:
                out["error"] = err
            return out
    return _empty_quote(sym, err)


@app.get("/api/quotes")
def quotes(symbols: str = Query(..., description="Comma-separated tickers")):
    raw = [s for s in symbols.split(",") if s.strip()]
    if not raw:
        raise HTTPException(400, "symbols required")
    if len(raw) > MAX_SYMBOLS:
        raise HTTPException(400, f"max {MAX_SYMBOLS} symbols")
    syms = [_normalize_symbol(s) for s in raw]

    by_sym: dict[str, dict[str, Any]] = {}
    to_fetch: list[str] = []
    for s in syms:
        cached, fresh = _cache_get(f"q:{s}", QUOTE_TTL)
        if cached is not None and fresh and isinstance(cached, dict) and cached.get("price"):
            q = dict(cached)
            q["stale"] = False
            by_sym[s] = q
        else:
            to_fetch.append(s)

    # Keep concurrency low — Yahoo rate-limits hard on parallel .info hits
    if to_fetch:
        with ThreadPoolExecutor(max_workers=min(3, len(to_fetch))) as pool:
            futs = {pool.submit(_quote_one, s): s for s in to_fetch}
            for fut in as_completed(futs):
                sym = futs[fut]
                q: dict[str, Any] | None = None
                try:
                    q = fut.result()
                except Exception:
                    q = None
                if q is not None and q.get("price"):
                    _cache_put(f"q:{sym}", q)
                    by_sym[sym] = q
                else:
                    by_sym[sym] = _stale_quote(sym)

    return {"quotes": [by_sym[s] for s in syms]}


@app.get("/api/history/{symbol}")
def history(
    symbol: str,
    range: str = Query("1D"),
    resolution: str = Query("full"),
):
    key = range.upper()
    res = (resolution or "full").strip().lower()
    if res not in ("full", "spark"):
        raise HTTPException(400, "invalid resolution")

    cfg = (SPARK_RANGE_MAP if res == "spark" else RANGE_MAP).get(key)
    if not cfg:
        raise HTTPException(400, "invalid range")

    display = _normalize_symbol(symbol)
    cache_key = f"h:{display}:{key}" + (":spark" if res == "spark" else "")
    cached, fresh = _cache_get(cache_key, HISTORY_TTL.get(key, 600.0))
    if cached is not None and fresh:
        out = dict(cached) if isinstance(cached, dict) else cached
        if isinstance(out, dict):
            out["stale"] = False
        return out

    failed = False
    df = None
    t = yf.Ticker(_yf_symbol(display))
    try:
        # Unadjusted closes so chart aligns with quote price; include pre/post on 1D
        df = t.history(
            period=cfg["period"],
            interval=cfg["interval"],
            auto_adjust=False,
            prepost=(key == "1D"),
        )
    except Exception:
        failed = True

    if df is None or df.empty:
        if cached is not None:
            out = dict(cached) if isinstance(cached, dict) else {"points": []}
            if isinstance(out, dict):
                out["stale"] = True
            return out  # stale beats nothing when Yahoo is rate-limiting
        if failed:
            raise HTTPException(502, "upstream quote error")
        return {"points": [], "stale": True}

    points: list[dict[str, float]] = []
    for ts, row in df.iterrows():
        close = _num(row.get("Close"))
        if close is None:
            continue
        t_ms = int(ts.timestamp() * 1000)
        vol = _num(row.get("Volume")) or 0.0
        points.append({"t": t_ms, "p": close, "v": vol})

    # Snap final point to live quote so graph matches displayed price
    live = _live_price(t)
    if live is not None and points:
        points[-1] = {"t": points[-1]["t"], "p": live, "v": points[-1].get("v", 0)}
    elif live is not None and not points:
        points = [{"t": int(time.time() * 1000), "p": live, "v": 0}]

    if res == "spark" and points:
        points = _downsample_lttb(points, SPARK_MAX_POINTS.get(key, 64))

    result = {"points": points, "lastPrice": live, "stale": False, "resolution": res}
    if points:
        _cache_put(cache_key, result)
    return result


def _perf_download(syms: list[str], period: str) -> dict[str, dict[str, Any]]:
    """Percent change per symbol for one chunk. Missing symbols are omitted."""
    # auto_adjust=False keeps price return, matching what the cards show.
    # Adjusted closes fold dividends back in and would make the chat quote a
    # different number than the UI for the same ticker and period.
    raw_df = yf.download(
        syms, period=period, interval="1d", auto_adjust=False,
        progress=False, threads=True,
    )
    try:
        close = raw_df["Close"]
    except Exception:
        close = raw_df
    # download() returns a flat frame for one symbol, a column MultiIndex for many.
    if len(syms) == 1 and getattr(close, "ndim", 1) == 1:
        close = close.to_frame(syms[0])

    out: dict[str, dict[str, Any]] = {}
    cols = getattr(close, "columns", [])
    for sym in syms:
        if sym not in cols:
            continue
        ser = close[sym].dropna()
        if len(ser) < 2:
            continue
        first, last = _num(ser.iloc[0]), _num(ser.iloc[-1])
        if not first or first <= 0 or last is None:
            continue
        out[sym] = {
            "symbol": sym,
            "changePercent": (last / first - 1.0) * 100.0,
            "change": last - first,
            "start": first,
            "end": last,
        }
    return out


@app.get("/api/performance")
def performance(
    symbols: str = Query(..., description="Comma-separated tickers"),
    # Aliased: the query param is "range", but that name shadows the builtin.
    range_: str = Query("YTD", alias="range"),
):
    """Percent change over a range for many symbols.

    Cached per symbol rather than per request: Yahoo throttles large batches
    and returns them half-empty, and a whole-response cache would then pin
    that partial result for the full TTL. Per-symbol entries mean a throttled
    run only leaves the symbols it missed to be retried by the next call.
    """
    if range_ not in RANGE_MAP:
        raise HTTPException(400, f"unknown range {range_}")
    raw = [s for s in symbols.split(",") if s.strip()]
    if not raw:
        raise HTTPException(400, "symbols required")
    if len(raw) > MAX_PERF_SYMBOLS:
        raise HTTPException(400, f"max {MAX_PERF_SYMBOLS} symbols")
    syms = list(dict.fromkeys(_normalize_symbol(s) for s in raw))

    by_sym: dict[str, dict[str, Any]] = {}
    to_fetch: list[str] = []
    for sym in syms:
        cached, fresh = _cache_get(f"perf:{range_}:{sym}", PERFORMANCE_TTL)
        if cached is not None and fresh and isinstance(cached, dict):
            by_sym[sym] = cached
        else:
            to_fetch.append(sym)

    # Chunked so one throttled request cannot wipe out the whole result set.
    for i in range(0, len(to_fetch), PERF_CHUNK):
        chunk = to_fetch[i:i + PERF_CHUNK]
        try:
            fetched = _perf_download(chunk, SPARK_RANGE_MAP[range_]["period"])
        except Exception:
            continue
        for sym, row in fetched.items():
            _cache_put(f"perf:{range_}:{sym}", row)
            by_sym[sym] = row

    results = [
        by_sym.get(sym, {"symbol": sym, "changePercent": None, "error": "no data"})
        for sym in syms
    ]
    return {
        "range": range_,
        "results": results,
        "found": sum(1 for r in results if r.get("changePercent") is not None),
        "requested": len(syms),
    }


# ─── Screener ──────────────────────────────────────────────────────────────────
# Indicators are computed here, never by the model: the assistant picks a filter,
# deterministic code decides what matches.

SCREEN_TTL = 3600.0
SCREEN_CHUNK = 50

# metric -> human description, surfaced to the model through the tool schema.
SCREEN_METRICS = {
    "price":             "last close",
    "changePercent":     "1-day percent change",
    "ret_1m":            "percent change over 1 month",
    "ret_3m":            "percent change over 3 months",
    "ret_6m":            "percent change over 6 months",
    "ret_ytd":           "percent change year to date",
    "ret_1y":            "percent change over 1 year",
    "pct_off_52w_high":  "percent below the 52-week high (0 = at the high, negative = below)",
    "pct_off_52w_low":   "percent above the 52-week low",
    "rsi14":             "14-day RSI (below 30 oversold, above 70 overbought)",
    "pct_vs_ma50":       "percent above/below the 50-day moving average",
    "pct_vs_ma200":      "percent above/below the 200-day moving average",
    "vol_vs_50d":        "latest volume as a multiple of the 50-day average (1.5 = 50% above)",
    "atr_pct":           "14-day average true range as a percent of price (volatility)",
    "volume":            "latest session volume",
}

_OPS = {
    "<": lambda a, b: a < b, "<=": lambda a, b: a <= b,
    ">": lambda a, b: a > b, ">=": lambda a, b: a >= b,
    "=": lambda a, b: a == b, "==": lambda a, b: a == b,
    "!=": lambda a, b: a != b,
}
_CLAUSE_RE = re.compile(r"^([A-Za-z0-9_]+)\s*(<=|>=|!=|==|<|>|=)\s*(-?\d+(?:\.\d+)?)$")


def _pct_change(ser, periods: int) -> float | None:
    if len(ser) <= periods:
        return None
    a, b = _num(ser.iloc[-periods - 1]), _num(ser.iloc[-1])
    return (b / a - 1.0) * 100.0 if a and a > 0 and b is not None else None


def _indicators(close, high, low, vol) -> dict[str, Any] | None:
    """Indicator snapshot from ~2y of daily bars. None when there is too little data."""
    if len(close) < 30:
        return None
    last = _num(close.iloc[-1])
    if not last or last <= 0:
        return None

    out: dict[str, Any] = {"price": last, "volume": _num(vol.iloc[-1]) or 0.0}
    out["changePercent"] = _pct_change(close, 1)
    for key, periods in (("ret_1m", 21), ("ret_3m", 63), ("ret_6m", 126), ("ret_1y", 252)):
        out[key] = _pct_change(close, periods)

    ytd = close[close.index >= f"{close.index[-1].year}-01-01"]
    if len(ytd) >= 2:
        first = _num(ytd.iloc[0])
        out["ret_ytd"] = (last / first - 1.0) * 100.0 if first and first > 0 else None
    else:
        out["ret_ytd"] = None

    window = min(len(close), 252)
    hi52, lo52 = _num(high.iloc[-window:].max()), _num(low.iloc[-window:].min())
    out["pct_off_52w_high"] = (last / hi52 - 1.0) * 100.0 if hi52 else None
    out["pct_off_52w_low"] = (last / lo52 - 1.0) * 100.0 if lo52 else None

    delta = close.diff()
    gain = delta.clip(lower=0).rolling(14).mean()
    loss = (-delta.clip(upper=0)).rolling(14).mean()
    g, l_ = _num(gain.iloc[-1]), _num(loss.iloc[-1])
    if g is None or l_ is None:
        out["rsi14"] = None
    elif l_ == 0:
        out["rsi14"] = 100.0
    else:
        out["rsi14"] = 100.0 - 100.0 / (1.0 + g / l_)

    for key, n in (("pct_vs_ma50", 50), ("pct_vs_ma200", 200)):
        ma = _num(close.iloc[-n:].mean()) if len(close) >= n else None
        out[key] = (last / ma - 1.0) * 100.0 if ma and ma > 0 else None

    v50 = _num(vol.iloc[-50:].mean()) if len(vol) >= 50 else None
    out["vol_vs_50d"] = (out["volume"] / v50) if v50 and v50 > 0 else None

    prev = close.shift(1)
    tr = (high - low).combine((high - prev).abs(), max).combine((low - prev).abs(), max)
    atr = _num(tr.iloc[-14:].mean()) if len(tr) >= 14 else None
    out["atr_pct"] = (atr / last) * 100.0 if atr else None

    return {k: (round(v, 4) if isinstance(v, float) else v) for k, v in out.items()}


def _screen_rows(syms: list[str]) -> dict[str, dict[str, Any]]:
    """Indicator snapshots for syms, cached per symbol."""
    import pandas as pd

    rows: dict[str, dict[str, Any]] = {}
    todo: list[str] = []
    for sym in syms:
        cached, fresh = _cache_get(f"scr:{sym}", SCREEN_TTL)
        if cached is not None and fresh and isinstance(cached, dict):
            rows[sym] = cached
        else:
            todo.append(sym)

    for i in range(0, len(todo), SCREEN_CHUNK):
        chunk = todo[i:i + SCREEN_CHUNK]
        try:
            raw = yf.download(chunk, period="2y", interval="1d", auto_adjust=False,
                              progress=False, threads=True, group_by="ticker")
        except Exception:
            continue
        for sym in chunk:
            try:
                df = raw[sym] if len(chunk) > 1 else raw
                df = df.dropna(subset=["Close"])
                if not len(df):
                    continue
                ind = _indicators(df["Close"].astype(float), df["High"].astype(float),
                                  df["Low"].astype(float), df["Volume"].astype(float))
            except Exception:
                ind = None
            if ind:
                ind["symbol"] = sym
                _cache_put(f"scr:{sym}", ind)
                rows[sym] = ind
    return rows


@app.get("/api/screen")
def screen(
    symbols: str = Query(..., description="Comma-separated tickers"),
    where: str = Query("", description="Comma-separated clauses, e.g. rsi14<30,vol_vs_50d>=1.5"),
    sort: str = Query("", description="Metric to sort by; prefix with - for descending"),
    limit: int = Query(25, ge=1, le=200),
):
    raw = [s for s in symbols.split(",") if s.strip()]
    if not raw:
        raise HTTPException(400, "symbols required")
    if len(raw) > MAX_PERF_SYMBOLS:
        raise HTTPException(400, f"max {MAX_PERF_SYMBOLS} symbols")
    syms = list(dict.fromkeys(_normalize_symbol(s) for s in raw))

    clauses = []
    for part in (c.strip() for c in where.split(",")):
        if not part:
            continue
        m = _CLAUSE_RE.match(part)
        if not m:
            raise HTTPException(400, f"bad clause {part!r}; expected metric<op>number")
        metric, op, value = m.group(1), m.group(2), float(m.group(3))
        if metric not in SCREEN_METRICS:
            raise HTTPException(400, f"unknown metric {metric!r}")
        clauses.append((metric, op, value))

    sort_key, desc = sort.lstrip("-"), sort.startswith("-")
    if sort_key and sort_key not in SCREEN_METRICS:
        raise HTTPException(400, f"unknown sort metric {sort_key!r}")

    rows = _screen_rows(syms)

    matched, skipped = [], []
    for sym in syms:
        row = rows.get(sym)
        if row is None:
            skipped.append(sym)
            continue
        ok = True
        for metric, op, value in clauses:
            v = row.get(metric)
            # A missing indicator fails the clause rather than passing silently.
            if v is None or not _OPS[op](v, value):
                ok = False
                break
        if ok:
            matched.append(row)

    if sort_key:
        matched.sort(key=lambda r: (r.get(sort_key) is None, r.get(sort_key) or 0), reverse=desc)

    return {
        "results": matched[:limit],
        "matched": len(matched),
        "screened": len(syms) - len(skipped),
        "requested": len(syms),
        "no_data": skipped,
        "truncated": len(matched) > limit,
    }


@app.get("/api/screen/metrics")
def screen_metrics():
    return {"metrics": SCREEN_METRICS, "operators": sorted(_OPS)}


# ─── Patterns ──────────────────────────────────────────────────────────────────
# Detectors return their measurements and a list of quality flags, never a bare
# boolean. Numeric criteria alone pass formations that are obviously wrong on
# sight — a gap-driven "recovery", a leveraged ETN — so the caller has to see
# why a match might be junk.

PATTERN_TTL = 3600.0
PATTERN_CHUNK = 50

_LEVERAGED_RE = re.compile(
    r"\b(?:[23]x|ultra(?:pro|short)?|leveraged|inverse|bull\s*[23]x|bear\s*[23]x|daily\s*[23]x)\b",
    re.I,
)


# Backstop for the name check, which is only as good as the quote cache.
_LEVERAGED_TICKERS = {
    "SOXL", "SOXS", "TQQQ", "SQQQ", "FNGU", "FNGD", "NVDL", "NVDS", "TSLL", "TSLQ",
    "UPRO", "SPXU", "SPXL", "SPXS", "LABU", "LABD", "YINN", "YANG", "UVXY", "SVXY",
    "TNA", "TZA", "FAS", "FAZ", "ERX", "ERY", "NUGT", "DUST", "JNUG", "JDST",
    "BOIL", "KOLD", "UCO", "SCO", "AGQ", "ZSL", "TMF", "TMV", "UDOW", "SDOW",
    "QLD", "SSO", "UWM", "AAPU", "AAPD", "MSFU", "MSFD", "GGLL", "AMZU", "METU",
}


def _is_leveraged(sym: str) -> bool:
    if sym in _LEVERAGED_TICKERS:
        return True
    with _CACHE_LOCK:
        entry = _CACHE.get(f"q:{sym}")
    name = ""
    if entry and isinstance(entry[1], dict):
        name = str(entry[1].get("name") or "")
    return bool(_LEVERAGED_RE.search(name))


def _detect_cup_and_handle(c, h, l, v) -> dict[str, Any] | None:
    """Highest-scoring cup-and-handle in the window, or None.

    Thresholds follow the classic description: a prior advance, a rounded base
    12-35% deep, a right rim back near the left one, and a shallow handle in the
    upper third on lighter volume.
    """
    n = len(c)
    if n < 120:
        return None
    best = None

    for rim_i in range(max(0, n - 325), n - 35):
        rim = h[rim_i]
        if rim < h[max(0, rim_i - 15):rim_i + 1].max():
            continue
        pre = c[max(0, rim_i - 250):rim_i + 1]
        if len(pre) < 40 or pre.min() <= 0 or rim / pre.min() - 1 < 0.30:
            continue

        bot_i = rim_i + 1 + int(np.argmin(l[rim_i + 1:n]))
        bottom = l[bot_i]
        if bottom <= 0:
            continue
        depth = (rim - bottom) / rim
        if not (0.12 <= depth <= 0.35):
            continue
        if bot_i - rim_i < 15 or n - bot_i < 15:
            continue

        cup = l[rim_i:n]
        roundness = float((cup <= bottom + 0.33 * (rim - bottom)).sum()) / len(cup)
        if roundness < 0.12:
            continue

        right_i = bot_i + int(np.argmax(h[bot_i:n]))
        right_rim = h[right_i]
        recovery = (right_rim - bottom) / (rim - bottom)
        if not (0.90 <= recovery <= 1.10) or n - right_i < 5:
            continue

        handle_low = l[right_i:n].min()
        h_depth = (right_rim - handle_low) / right_rim
        h_len = n - right_i
        if not (0.03 <= h_depth <= 0.12) or not (5 <= h_len <= 50):
            continue
        if handle_low < bottom + 0.60 * (rim - bottom):
            continue

        pivot = h[right_i:n].max()
        last = c[-1]
        dist = (pivot - last) / pivot
        if not (-0.02 <= dist <= 0.10):
            continue

        cup_v = v[rim_i:right_i].mean()
        handle_v = v[right_i:n].mean()
        vol_ratio = float(handle_v / cup_v) if cup_v else None
        if vol_ratio is not None and vol_ratio > 1.20:
            continue

        # Biggest single session on the way up: a gap this size is news, not a base.
        right = c[bot_i:right_i + 1]
        max_day = float(np.max(right[1:] / right[:-1] - 1.0)) if len(right) > 1 else 0.0

        score = (roundness * 2 + (1 - abs(1 - recovery)) * 2
                 + (1.2 - (vol_ratio if vol_ratio is not None else 1.2))
                 + (0.10 - h_depth) * 5 + (0.10 - max(dist, 0.0)) * 5)
        cand = {
            "cup_weeks": round((n - rim_i) / 5, 1),
            "depth_pct": round(depth * 100, 2),
            "roundness": round(roundness, 3),
            "recovery_pct": round(recovery * 100, 1),
            "handle_sessions": int(h_len),
            "handle_depth_pct": round(h_depth * 100, 2),
            "handle_volume_ratio": round(vol_ratio, 2) if vol_ratio is not None else None,
            "pivot": round(float(pivot), 2),
            "last": round(float(last), 2),
            "pct_to_pivot": round(dist * 100, 2),
            "max_single_day_gain_pct": round(max_day * 100, 2),
            "score": round(float(score), 3),
        }
        if best is None or cand["score"] > best["score"]:
            best = cand
    return best


def _flag_cup(m: dict[str, Any], sym: str) -> list[str]:
    flags = []
    if _is_leveraged(sym):
        flags.append("leveraged_product: daily rebalancing distorts chart patterns")
    if m["handle_sessions"] < 10:
        flags.append(f"young_handle: {m['handle_sessions']} sessions, under the 1-2 week norm")
    if m["depth_pct"] > 33:
        flags.append(f"deep_cup: {m['depth_pct']}% exceeds the classic 12-33%")
    if m["max_single_day_gain_pct"] > 15:
        flags.append(
            f"gap_recovery: right side includes a {m['max_single_day_gain_pct']}% session, "
            "so the base may be news-driven rather than rounded"
        )
    if m["roundness"] < 0.20:
        flags.append("shallow_rounding: price spent little time near the lows (V-shaped)")
    return flags


def _detect_flat_base(c, h, l, v) -> dict[str, Any] | None:
    """A tight sideways range in the upper part of the 52-week range."""
    n = len(c)
    if n < 60:
        return None
    for weeks in (12, 10, 8, 7, 6, 5):
        span = weeks * 5
        if n < span + 10:
            continue
        hi, lo = h[-span:].max(), l[-span:].min()
        if lo <= 0:
            continue
        width = (hi - lo) / hi
        if width > 0.15:
            continue
        window = min(n, 252)
        hi52 = h[-window:].max()
        if hi52 <= 0 or (hi / hi52) < 0.85:
            continue
        last = c[-1]
        dist = (hi - last) / hi
        if not (-0.02 <= dist <= 0.08):
            continue
        base_v = v[-span:].mean()
        prior_v = v[-span * 2:-span].mean() if n >= span * 2 else base_v
        return {
            "base_weeks": weeks,
            "width_pct": round(width * 100, 2),
            "pct_off_52w_high": round((last / hi52 - 1) * 100, 2),
            "pivot": round(float(hi), 2),
            "last": round(float(last), 2),
            "pct_to_pivot": round(dist * 100, 2),
            "volume_ratio": round(float(base_v / prior_v), 2) if prior_v else None,
            "score": round(float(1 - width), 3),
        }
    return None


def _flag_flat(m: dict[str, Any], sym: str) -> list[str]:
    flags = []
    if _is_leveraged(sym):
        flags.append("leveraged_product: daily rebalancing distorts chart patterns")
    if m["base_weeks"] <= 5:
        flags.append(
            f"short_base: {m['base_weeks']} weeks is the shortest this accepts; "
            "longer bases are more reliable"
        )
    if m["width_pct"] > 12:
        flags.append(f"loose_base: {m['width_pct']}% range is wide for a flat base")
    return flags


PATTERNS = {
    "cup_and_handle": (_detect_cup_and_handle, _flag_cup,
                       "Rounded multi-week base with a shallow pullback near the rim."),
    "flat_base": (_detect_flat_base, _flag_flat,
                  "Tight sideways range high in the 52-week range."),
}


def _pattern_rows(syms: list[str], pattern: str) -> dict[str, dict[str, Any]]:
    detect, flag, _ = PATTERNS[pattern]
    rows: dict[str, dict[str, Any]] = {}
    todo: list[str] = []
    for sym in syms:
        cached, fresh = _cache_get(f"pat:{pattern}:{sym}", PATTERN_TTL)
        if cached is not None and fresh and isinstance(cached, dict):
            if cached.get("match"):
                rows[sym] = cached
        else:
            todo.append(sym)

    for i in range(0, len(todo), PATTERN_CHUNK):
        chunk = todo[i:i + PATTERN_CHUNK]
        try:
            raw = yf.download(chunk, period="2y", interval="1d", auto_adjust=False,
                              progress=False, threads=True, group_by="ticker")
        except Exception:
            continue
        for sym in chunk:
            found = None
            try:
                df = raw[sym] if len(chunk) > 1 else raw
                df = df.dropna(subset=["Close"])
                if len(df) >= 60:
                    found = detect(
                        df["Close"].astype(float).to_numpy(),
                        df["High"].astype(float).to_numpy(),
                        df["Low"].astype(float).to_numpy(),
                        df["Volume"].astype(float).to_numpy(),
                    )
            except Exception:
                found = None
            entry = {"symbol": sym, "match": bool(found)}
            if found:
                entry.update(found)
                entry["flags"] = flag(found, sym)
            _cache_put(f"pat:{pattern}:{sym}", entry)
            if found:
                rows[sym] = entry
    return rows


@app.get("/api/patterns")
def patterns(
    symbols: str = Query(..., description="Comma-separated tickers"),
    pattern: str = Query("cup_and_handle"),
    limit: int = Query(25, ge=1, le=100),
):
    if pattern not in PATTERNS:
        raise HTTPException(400, f"unknown pattern {pattern!r}; try {sorted(PATTERNS)}")
    raw = [s for s in symbols.split(",") if s.strip()]
    if not raw:
        raise HTTPException(400, "symbols required")
    if len(raw) > MAX_PERF_SYMBOLS:
        raise HTTPException(400, f"max {MAX_PERF_SYMBOLS} symbols")
    syms = list(dict.fromkeys(_normalize_symbol(s) for s in raw))

    rows = _pattern_rows(syms, pattern)
    matches = sorted(rows.values(), key=lambda r: -r.get("score", 0))
    clean = [m for m in matches if not m.get("flags")]
    return {
        "pattern": pattern,
        "description": PATTERNS[pattern][2],
        "results": matches[:limit],
        "matched": len(matches),
        "unflagged": len(clean),
        "screened": len(syms),
        "note": (
            "Numeric criteria only. Every match carries `flags` naming why it may be "
            "unreliable; report those alongside the match and never present a flagged "
            "formation as clean. Confirm visually before relying on any of them."
        ),
    }


@app.get("/api/patterns/list")
def patterns_list():
    return {"patterns": {k: v[2] for k, v in PATTERNS.items()}}


@app.get("/api/search")
def search(q: str = Query(..., min_length=1, max_length=MAX_SEARCH_LEN)):
    query = q.strip()
    if not query:
        return {"results": []}
    if len(query) > MAX_SEARCH_LEN:
        raise HTTPException(400, "query too long")

    cache_key = f"s:{query.lower()}"
    cached, fresh = _cache_get(cache_key, SEARCH_TTL)
    if cached is not None and fresh:
        return cached

    try:
        s = yf.Search(query, max_results=12, news_count=0)
        quotes = s.quotes or []
    except Exception:
        if cached is not None:
            out = dict(cached) if isinstance(cached, dict) else cached
            if isinstance(out, dict):
                out["stale"] = True
            return out
        raise HTTPException(502, "upstream search error")

    results = []
    seen: set[str] = set()
    for item in quotes:
        sym = str(item.get("symbol") or "").strip()
        if not sym or sym in seen:
            continue
        qtype = str(item.get("quoteType") or item.get("typeDisp") or "")
        # Prefer equities / ETFs / funds
        if qtype and qtype.upper() not in {
            "EQUITY", "ETF", "MUTUALFUND", "INDEX", "CRYPTOCURRENCY", "ECNQUOTE", ""
        }:
            continue
        seen.add(sym)
        results.append({
            "symbol": sym,
            "name": str(item.get("longname") or item.get("shortname") or sym),
            "sector": str(item.get("sector") or item.get("typeDisp") or "—"),
            "exchange": str(item.get("exchDisp") or item.get("exchange") or ""),
            "type": qtype,
        })
    out = {"results": results[:10]}
    _cache_put(cache_key, out)
    return out


def _news_thumb(content: dict[str, Any]) -> str | None:
    thumb = content.get("thumbnail")
    if not isinstance(thumb, dict):
        return None
    resolutions = thumb.get("resolutions")
    if isinstance(resolutions, list) and resolutions:
        for pref in ("640x800", "170x128", "original"):
            for r in resolutions:
                if isinstance(r, dict) and r.get("tag") == pref and r.get("url"):
                    return str(r["url"])
        for r in resolutions:
            if isinstance(r, dict) and r.get("url"):
                return str(r["url"])
    url = thumb.get("originalUrl") or thumb.get("url")
    return str(url) if url else None


def _parse_news_item(item: Any) -> dict[str, Any] | None:
    if not isinstance(item, dict):
        return None

    # Newer yfinance shape: { id, content: { title, thumbnail, clickThroughUrl, ... } }
    content = item.get("content") if isinstance(item.get("content"), dict) else None
    if content:
        title = str(content.get("title") or "").strip()
        if not title:
            return None
        link = ""
        for key in ("clickThroughUrl", "canonicalUrl"):
            u = content.get(key)
            if isinstance(u, dict) and u.get("url"):
                link = str(u["url"])
                break
            if isinstance(u, str) and u.startswith("http"):
                link = u
                break
        if not link:
            return None
        provider = content.get("provider") if isinstance(content.get("provider"), dict) else {}
        pub = content.get("pubDate") or content.get("displayTime") or ""
        return {
            "id": str(item.get("id") or content.get("id") or link),
            "title": title,
            "url": link,
            "publisher": str(provider.get("displayName") or "Yahoo Finance"),
            "publishedAt": str(pub) if pub else None,
            "image": _news_thumb(content),
            "summary": str(content.get("summary") or content.get("description") or "") or None,
        }

    # Legacy flat shape
    title = str(item.get("title") or "").strip()
    link = str(item.get("link") or item.get("url") or "").strip()
    if not title or not link.startswith("http"):
        return None
    image = None
    thumb = item.get("thumbnail")
    if isinstance(thumb, dict):
        resolutions = thumb.get("resolutions")
        if isinstance(resolutions, list):
            for r in resolutions:
                if isinstance(r, dict) and r.get("url"):
                    image = str(r["url"])
                    break
    return {
        "id": str(item.get("uuid") or item.get("id") or link),
        "title": title,
        "url": link,
        "publisher": str(item.get("publisher") or "Yahoo Finance"),
        "publishedAt": str(item.get("providerPublishTime") or item.get("pubDate") or "") or None,
        "image": image,
        "summary": str(item.get("summary") or "") or None,
    }


@app.get("/api/news/{symbol}")
def news(symbol: str, limit: int = Query(8, ge=1, le=20)):
    sym = _normalize_symbol(symbol)
    cache_key = f"n:{sym}:{limit}"
    cached, fresh = _cache_get(cache_key, NEWS_TTL)
    if cached is not None and fresh:
        return cached

    try:
        raw = yf.Ticker(sym).news or []
    except Exception:
        if cached is not None:
            out = dict(cached) if isinstance(cached, dict) else {"symbol": sym, "news": [], "stale": True}
            if isinstance(out, dict):
                out["stale"] = True
            return out
        raise HTTPException(502, "upstream news error")

    items: list[dict[str, Any]] = []
    seen: set[str] = set()
    for entry in raw:
        parsed = _parse_news_item(entry)
        if not parsed:
            continue
        key = parsed["url"]
        if key in seen:
            continue
        seen.add(key)
        items.append(parsed)
        if len(items) >= limit:
            break

    out = {"symbol": sym, "news": items, "stale": False}
    if items:
        _cache_put(cache_key, out)
    return out


@app.get("/api/img")
def proxy_image(u: str = Query(..., min_length=8, max_length=2000)):
    """Proxy news thumbnails so browsers aren't blocked by hotlink/referrer rules."""
    import urllib.request
    from fastapi.responses import Response

    url = u.strip()
    if not (url.startswith("https://") or url.startswith("http://")):
        raise HTTPException(400, "invalid image url")
    host = url.split("/")[2].lower()
    allowed = (
        host.endswith("yimg.com")
        or host.endswith("yahoo.com")
        or host.endswith("yahooapis.com")
        or host.endswith("cloudfront.net")
        or host.endswith("googleusercontent.com")
    )
    if not allowed:
        raise HTTPException(400, "host not allowed")

    # In-memory only — never persist binary blobs into the JSON quote cache
    cache_key = f"img:{url}"
    with _CACHE_LOCK:
        entry = _CACHE.get(cache_key)
    if entry is not None:
        ts, cached = entry
        if (time.time() - ts) < 3600.0 and isinstance(cached, dict) and cached.get("body"):
            return Response(
                content=cached["body"],
                media_type=str(cached.get("type") or "image/jpeg"),
                headers={"Cache-Control": "public, max-age=3600"},
            )

    try:
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "Mozilla/5.0 VantageNews/1.0", "Accept": "image/*"},
        )
        with urllib.request.urlopen(req, timeout=12) as resp:
            data = resp.read()
            ctype = resp.headers.get("Content-Type") or "image/jpeg"
    except Exception:
        raise HTTPException(502, "image fetch failed")

    if not data or len(data) > 2_500_000:
        raise HTTPException(502, "image too large or empty")

    with _CACHE_LOCK:
        _CACHE[cache_key] = (time.time(), {"body": data, "type": ctype})
    return Response(
        content=data,
        media_type=ctype,
        headers={"Cache-Control": "public, max-age=3600"},
    )


@app.get("/api/health")
def health():
    return {"ok": True, "source": "yfinance"}


if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=os.environ.get("RENDER") is None)
