import type { ComponentProps } from "react";
import { BarChart2, ChevronLeft, ChevronRight } from "lucide-react";
import type { StockMeta } from "../lib/stocks";
import type { Holding } from "../types";
import type { Preferences } from "../hooks/usePreferences";
import type { Quotes } from "../hooks/useQuotes";
import { ListHeader, StockCard, StockRow, type CardProps } from "../components/stocks";
import { WatchlistSidebar } from "../components/watchlists";
import { Toolbar } from "../components/toolbar";
import { StockDetailView } from "./StockDetailView";

export interface HomePageProps {
  prefs: Preferences;
  quotes: Quotes;
  /** Stocks after search, filter and sort. */
  visibleStocks: StockMeta[];
  cardProps: (stock: StockMeta, holding?: Holding) => CardProps;
  /** Prebuilt detail-view props, or null when no symbol is open. */
  detail: ComponentProps<typeof StockDetailView> | null;
  search: string;
  setSearch: (s: string) => void;
  sidebarOpen: boolean;
  onToggleSidebar: () => void;
  onSelectWatchlist: (id: string) => void;
  onOpenSymbol: (symbol: string) => void;
  onToggleWatchlist: (watchlistId: string, symbol: string) => void;
}

export function HomePage({
  prefs, quotes, visibleStocks, cardProps, detail,
  search, setSearch, sidebarOpen, onToggleSidebar,
  onSelectWatchlist, onOpenSymbol, onToggleWatchlist,
}: HomePageProps) {
  const {
    watchlists, activeWatchlist, createWatchlist, importWatchlist, deleteWatchlist,
    renameWatchlist, reorderWatchlists, homeRange, setHomeRange,
    filter, setFilter, sort, sortDir, onSortSelect, onColumnSort,
    changeDisplay, setChangeDisplay, viewMode, setViewMode,
  } = prefs;

  return (
    <div className="flex flex-1 overflow-hidden min-h-0">
      <WatchlistSidebar
        watchlists={watchlists}
        activeId={activeWatchlist}
        open={sidebarOpen}
        onSelect={onSelectWatchlist}
        onCreate={createWatchlist}
        onImport={(name, symbols, stocks) => {
          const id = importWatchlist(name, symbols);
          quotes.hydrate(stocks);
          onSelectWatchlist(id);
        }}
        onDelete={deleteWatchlist}
        onRename={renameWatchlist}
        onReorder={reorderWatchlists}
      />

      <button
        type="button"
        onClick={onToggleSidebar}
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
        {detail ? (
          <StockDetailView {...detail} />
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
              stocks={quotes.stocks}
              onSelectSymbol={onOpenSymbol}
              onToggleWatchlist={onToggleWatchlist}
              onStocksHydrated={quotes.hydrate}
              refreshKey={quotes.sparkEpoch}
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
                    <StockCard key={stock.symbol} {...cardProps(stock)} />
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
                      <StockRow key={stock.symbol} {...cardProps(stock)} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
