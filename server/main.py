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
