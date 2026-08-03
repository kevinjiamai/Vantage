import { MoreHorizontal, Star } from "lucide-react";
import { useState } from "react";
import { TextSkeleton } from "./common";
import { CardMenu } from "./menus";

import { useRangeChange } from "../hooks/useRangeChange";
import { G, R, fmt$, fmtChangeAmt, fmtPct } from "../lib/format";
import { type StockMeta, type TimeRange } from "../lib/stocks";
import { type ChangeDisplay, type Holding, type SortDir, type SortMode, type Watchlist } from "../types";

export const HR = {
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

export function HoldingCols(props: {
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

export function HoldingListHeader({
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

export function HoldingRow({
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
