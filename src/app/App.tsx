import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Sun, Moon, ChevronLeft, ChevronRight, BarChart2, LayoutGrid, List } from "lucide-react";
import { ALL_SYMBOLS, prefetchSparklines, type StockMeta, type TimeRange } from "./lib/stocks";
import { VantageChat } from "./components/VantageChat";

import { G, R, fmt$ } from "./lib/format";
import { buildHoldingRows, screenStocks, sortHoldingRows } from "./lib/screener";
import type { AppPage, Holding } from "./types";

import { usePreferences } from "./hooks/usePreferences";
import { useQuotes } from "./hooks/useQuotes";
import { usePortfolio } from "./hooks/usePortfolio";
import { useCloudSync } from "./hooks/useCloudSync";

import { ListHeader, StockCard, StockRow } from "./components/stocks";
import { HoldingListHeader, HoldingRow } from "./components/holdings";
import { WatchlistSidebar } from "./components/watchlists";
import { Toolbar } from "./components/toolbar";
import { BuySharesDialog, SellSharesDialog } from "./components/trade";
import { GuestSaveBanner, OnboardingDialog, SyncErrorBanner, buildWatchlistsFromSelection } from "./components/auth";
import { MarketStrip } from "./components/MarketStrip";
import { StockDetailView } from "./pages/StockDetailView";
import { BankPage } from "./pages/BankPage";
import { AccountPage } from "./pages/AccountPage";

const NAV_ITEMS: { id: AppPage; label: string }[] = [
  { id: "home",      label: "Home" },
  { id: "portfolio", label: "Portfolio" },
  { id: "bank",      label: "Bank" },
  { id: "account",   label: "Account" },
];

export default function App() {
  // ─── Local UI state (nothing persisted, nothing shared) ─────────────────────
  const [page,           setPage]           = useState<AppPage>("home");
  const [search,         setSearch]         = useState("");
  const [selectedSymbol, setSelectedSymbol] = useState<string | null>(null);
  const [tradeDialog,    setTradeDialog]    = useState<{ symbol: string; mode: "buy" | "sell" } | null>(null);
  const [sidebarOpen,    setSidebarOpen]    = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(min-width: 768px)").matches : true,
  );
  const dragSymbolRef = useRef<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  // ─── Domain state ───────────────────────────────────────────────────────────
  const prefs = usePreferences();
  const {
    theme, setTheme, homeRange, setHomeRange, detailRanges,
    filter, setFilter, sort, sortDir, changeDisplay, setChangeDisplay,
    viewMode, setViewMode, watchlists, activeWatchlist, setActiveWatchlist,
    pinnedSymbols, customOrders, activeList, setCustomOrders,
    onSortSelect, onColumnSort, togglePin,
    createWatchlist, deleteWatchlist, renameWatchlist, reorderWatchlists,
  } = prefs;

  const quotes = useQuotes(homeRange, watchlists, activeWatchlist);
  const { stocks, dataStatus, sparkEpoch, hydrate: hydrateStocks } = quotes;

  const portfolio = usePortfolio(stocks);
  const {
    balance, holdings, transactions, holdingMap,
    portfolioValue, totalCost, totalProfit,
    deposit, buyShares, sellShares, reset: resetTradeHistory,
  } = portfolio;

  const cloud = useCloudSync(portfolio, prefs, quotes, setPage);
  const {
    user, profile, setProfile, signedIn, syncFailed, needsNameSetup,
    handleAuth, handleSignOut, handleDeleteAccount,
    retry: retryCloudLoad, completeOnboarding,
  } = cloud;

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  // ─── Actions that span two concerns ─────────────────────────────────────────

  /** Watchlist membership plus a quote fetch for newly added tickers. */
  const toggleWatchlist = useCallback((watchlistId: string, symbol: string) => {
    prefs.toggleWatchlist(watchlistId, symbol);
    void quotes.ensure([symbol]);
  }, [prefs, quotes]);

  const setDetailRange = useCallback((symbol: string, r: TimeRange) => {
    prefs.setDetailRange(symbol, r, () => {
      prefetchSparklines([symbol], r).catch(() => {});
    });
  }, [prefs]);

  const selectSymbol = useCallback((symbol: string) => {
    setSelectedSymbol(symbol);
    void quotes.ensure([symbol], true);
  }, [quotes]);

  /** Search result chosen: show it, and keep it in All Stocks so it stays available. */
  const openSymbol = useCallback(async (symbol: string) => {
    setSearch("");
    setSelectedSymbol(symbol);
    setPage("home");
    prefs.ensureInAllStocks(symbol);
    await quotes.ensure([symbol], true);
    prefetchSparklines([symbol], detailRanges[symbol] ?? "1D").catch(() => {});
  }, [prefs, quotes, detailRanges]);

  const handleOnboarding = useCallback((name: string, selectedSymbols: string[]) => {
    completeOnboarding(name, selectedSymbols, buildWatchlistsFromSelection(new Set(selectedSymbols)));
  }, [completeOnboarding]);

  const goToPage = (p: AppPage) => {
    setPage(p);
    setSelectedSymbol(null);
  };

  const goSignIn = useCallback(() => {
    setSelectedSymbol(null);
    setPage("account");
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
  }, [dragOver, activeWatchlist, activeList.symbols, setCustomOrders]);

  // ─── Derived views ──────────────────────────────────────────────────────────
  const activeStocks = useMemo(
    () => stocks.filter(s => activeList.symbols.includes(s.symbol)),
    [activeList, stocks],
  );

  const portfolioStocks = useMemo(
    // sparkEpoch participates because range comparators read cached history.
    () => sortHoldingRows(buildHoldingRows(holdings, stocks), sort, sortDir, homeRange),
    [holdings, stocks, sort, sortDir, homeRange, sparkEpoch],
  );

  const visibleStocks = useMemo(
    () => screenStocks({
      stocks: activeStocks, search, filter, sort, sortDir, homeRange,
      manualOrder: customOrders[activeWatchlist] ?? activeList.symbols,
      pinnedSymbols,
      ownedSymbols: new Set(holdings.map(h => h.symbol)),
    }),
    [activeStocks, search, filter, sort, sortDir, homeRange, customOrders,
     activeWatchlist, activeList.symbols, pinnedSymbols, holdings, sparkEpoch],
  );

  const selectedStock = selectedSymbol ? stocks.find(s => s.symbol === selectedSymbol) ?? null : null;

  const allStocksList = watchlists.find(w => w.id === "portfolio");
  const allStocksMeta = useMemo(
    () => stocks.filter(s => (allStocksList?.symbols ?? ALL_SYMBOLS).includes(s.symbol)),
    [allStocksList, stocks],
  );
  const gainCount = allStocksMeta.filter(s => s.changePercent > 0).length;
  const lossCount = allStocksMeta.filter(s => s.changePercent < 0).length;

  const isDraggable = sort === "manual" && page === "home";

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
          initialName={profile.name}
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
