import type { ComponentProps } from "react";
import { BarChart2, LayoutGrid, List } from "lucide-react";
import { fmt$ } from "../lib/format";
import type { HoldingRowData } from "../lib/screener";
import type { StockMeta } from "../lib/stocks";
import type { Holding } from "../types";
import type { Preferences } from "../hooks/usePreferences";
import type { Portfolio } from "../hooks/usePortfolio";
import type { Quotes } from "../hooks/useQuotes";
import { HoldingListHeader, HoldingRow } from "../components/holdings";
import { StockCard, type CardProps } from "../components/stocks";
import { GuestSaveBanner, SyncErrorBanner } from "../components/auth";
import { StockDetailView } from "./StockDetailView";

export interface PortfolioPageProps {
  prefs: Preferences;
  portfolio: Portfolio;
  quotes: Quotes;
  /** Holdings paired with quotes, already sorted. */
  rows: HoldingRowData[];
  cardProps: (stock: StockMeta, holding?: Holding) => CardProps;
  /** Prebuilt detail-view props, or null when no symbol is open. */
  detail: ComponentProps<typeof StockDetailView> | null;
  signedIn: boolean;
  syncFailed: boolean;
  onSignIn: () => void;
  onRetrySync: () => void;
  onSelectSymbol: (symbol: string) => void;
  onToggleWatchlist: (watchlistId: string, symbol: string) => void;
}

export function PortfolioPage({
  prefs, portfolio, quotes, rows, cardProps, detail,
  signedIn, syncFailed, onSignIn, onRetrySync, onSelectSymbol, onToggleWatchlist,
}: PortfolioPageProps) {
  const {
    changeDisplay, setChangeDisplay, viewMode, setViewMode,
    sort, sortDir, onColumnSort, homeRange, watchlists, pinnedSymbols, togglePin,
  } = prefs;
  const { holdings, totalProfit, portfolioValue } = portfolio;

  if (detail) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden min-h-0">
        <StockDetailView {...detail} />
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-h-0">
      <div
        className="flex-1 overflow-auto p-4"
        style={{ scrollbarWidth: "thin", scrollbarColor: "var(--v-line-strong) transparent" }}
      >
        {syncFailed
          ? <SyncErrorBanner onRetry={onRetrySync} className="mb-4" />
          : !signedIn && <GuestSaveBanner onSignIn={onSignIn} className="mb-4" />}
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
        {rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 gap-2 font-mono text-sm" style={{ color: "var(--v-ink-dim)" }}>
            <BarChart2 size={32} style={{ color: "var(--v-line-strong)" }} />
            <span>No shares owned yet</span>
          </div>
        ) : viewMode === "grid" ? (
          <div className="grid gap-3 grid-cols-[repeat(2,minmax(10.5rem,1fr))] lg:grid-cols-[repeat(3,minmax(11rem,1fr))] xl:grid-cols-[repeat(4,minmax(11rem,1fr))] 2xl:grid-cols-[repeat(5,minmax(11rem,1fr))]">
            {rows.map(({ stock, holding }) => (
              <StockCard key={stock.symbol} {...cardProps(stock, holding)} />
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
              {rows.map(({ stock, holding }) => (
                <HoldingRow
                  key={stock.symbol}
                  stock={stock}
                  holding={holding}
                  range={homeRange}
                  watchlists={watchlists}
                  isPinned={pinnedSymbols.includes(stock.symbol)}
                  changeDisplay={changeDisplay}
                  refreshKey={quotes.sparkEpoch}
                  onSelect={() => onSelectSymbol(stock.symbol)}
                  onToggleWatchlist={onToggleWatchlist}
                  onTogglePin={togglePin}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
