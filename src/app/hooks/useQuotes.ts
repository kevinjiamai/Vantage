import { useCallback, useEffect, useState } from "react";
import {
  STOCKS_META, ALL_SYMBOLS, fetchQuotes, ensureQuotes, lastQuotesFreshness,
  prefetchSparklines, invalidateHistoryRange, clearHistoryCache,
  type StockMeta, type TimeRange,
} from "../lib/stocks";
import type { Watchlist } from "../types";

export type DataStatus = "loading" | "live" | "stale" | "error";

const POLL_MS = 60_000;

export interface Quotes {
  stocks: StockMeta[];
  dataStatus: DataStatus;
  /** Bumped whenever sparkline history changes, to force chart re-reads. */
  sparkEpoch: number;
  /** Adopt a fetched quote list and invalidate sparklines. */
  hydrate: (live: StockMeta[]) => void;
  /** Fetch quotes for symbols we may not have yet; ignores failures. */
  ensure: (symbols: string[], markLive?: boolean) => Promise<void>;
}

/**
 * Live quote feed: initial load, a 60s poll, and sparkline prefetching for
 * whichever watchlist is on screen.
 */
export function useQuotes(
  homeRange: TimeRange,
  watchlists: Watchlist[],
  activeWatchlist: string,
): Quotes {
  const [stocks, setStocks] = useState<StockMeta[]>(STOCKS_META);
  const [dataStatus, setDataStatus] = useState<DataStatus>(
    STOCKS_META.some(s => s.price > 0) ? "stale" : "loading",
  );
  const [sparkEpoch, setSparkEpoch] = useState(0);

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
    }, POLL_MS);
    return () => { cancelled = true; window.clearInterval(id); };
    // Mount-only on purpose: homeRange is read for the first prefetch, but the
    // effect below handles every later range change without restarting the poll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When the toolbar range changes, load matching history for visible symbols
  useEffect(() => {
    const list = watchlists.find(w => w.id === activeWatchlist);
    const syms = list?.symbols ?? ALL_SYMBOLS;
    prefetchSparklines(syms, homeRange)
      .then(() => setSparkEpoch(e => e + 1))
      .catch(() => {});
  }, [homeRange, activeWatchlist, watchlists]);

  const hydrate = useCallback((live: StockMeta[]) => {
    setStocks([...live]);
    setSparkEpoch(e => e + 1);
  }, []);

  const ensure = useCallback(async (symbols: string[], markLive = false) => {
    if (!symbols.length) return;
    try {
      const live = await ensureQuotes(symbols);
      setStocks([...live]);
      if (markLive) setDataStatus("live");
    } catch {
      /* keep whatever quote we already have */
    }
  }, []);

  return { stocks, dataStatus, sparkEpoch, hydrate, ensure };
}
