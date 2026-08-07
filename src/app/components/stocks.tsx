import { MoreHorizontal, Star } from "lucide-react";
import { useState, type ComponentProps } from "react";
import { MiniSparkline } from "./charts";
import { TextSkeleton } from "./common";
import { CardMenu, TradeMenu } from "./menus";
import { useRangeChange } from "../hooks/useRangeChange";
import { G, R, fmt$, fmtCap, fmtChangeAmt, fmtPct, fmtVol } from "../lib/format";
import { type StockMeta, type TimeRange } from "../lib/stocks";
import { type ChangeDisplay, type Holding, type SortDir, type SortMode, type Watchlist } from "../types";
import { positionProfit, positionProfitPct } from "../lib/trades";

/** Shared column layout so header labels + row cells stay aligned */
export const LR = {
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

export function ListCols(props: {
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

export function ListHeader({
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

export function StockCard({
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
  const profit = holding ? positionProfit(holding, stock.price) : 0;
  const profitPct = holding ? positionProfitPct(holding, stock.price) : 0;
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

export function StockRow({
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

/**
 * The prop bundle StockCard and StockRow share. App builds one factory and the
 * pages spread it, so the two views can't drift apart.
 */
export type CardProps = ComponentProps<typeof StockCard>;
