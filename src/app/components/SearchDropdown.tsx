import { Check, Plus } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MiniSparkline } from "./charts";
import { TextSkeleton } from "./common";
import { WatchlistAddMenu } from "./menus";

import { G, R, fmt$, fmtPct } from "../lib/format";
import { STOCKS_META, type SearchResult, type StockMeta, mergeQuotes, prefetchSparklines, searchStocks } from "../lib/stocks";
import { type Watchlist } from "../types";

export function SearchDropdown({
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
