import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Sun, Moon, BarChart2 } from "lucide-react";
import { ALL_SYMBOLS, prefetchSparklines, type StockMeta, type TimeRange } from "./lib/stocks";
import { VantageChat } from "./components/VantageChat";

import { G, R } from "./lib/format";
import { buildHoldingRows, screenStocks, sortHoldingRows } from "./lib/screener";
import type { AppPage, Holding } from "./types";

import { usePreferences } from "./hooks/usePreferences";
import { useQuotes } from "./hooks/useQuotes";
import { usePortfolio } from "./hooks/usePortfolio";
import { useCloudSync } from "./hooks/useCloudSync";

import { BuySharesDialog, SellSharesDialog } from "./components/trade";
import { OnboardingDialog, buildWatchlistsFromSelection } from "./components/auth";
import { MarketStrip } from "./components/MarketStrip";
import { BankPage } from "./pages/BankPage";
import { HomePage } from "./pages/HomePage";
import { PortfolioPage } from "./pages/PortfolioPage";
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
    theme, setTheme, homeRange, detailRanges, filter, sort, sortDir,
    changeDisplay, watchlists, activeWatchlist, setActiveWatchlist,
    pinnedSymbols, customOrders, activeList, setCustomOrders, togglePin,
  } = prefs;

  const quotes = useQuotes(homeRange, watchlists, activeWatchlist);
  const { stocks, dataStatus, sparkEpoch } = quotes;

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

  // Both Home and Portfolio show the same detail view; build its props once.
  const detailProps = selectedStock ? {
    stock: selectedStock,
    range: selectedDetailRange,
    holding: holdingMap.get(selectedStock.symbol),
    balance,
    onBack: () => setSelectedSymbol(null),
    onRangeChange: (r: TimeRange) => setDetailRange(selectedStock.symbol, r),
    onBuy:  (shares: number) => buyShares(selectedStock.symbol, shares, selectedStock.price),
    onSell: (shares: number) => sellShares(selectedStock.symbol, shares, selectedStock.price),
    signedIn,
    onSignIn: goSignIn,
  } : null;

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
        <PortfolioPage
          prefs={prefs}
          portfolio={portfolio}
          quotes={quotes}
          rows={portfolioStocks}
          cardProps={sharedCardProps}
          detail={detailProps}
          signedIn={signedIn}
          syncFailed={syncFailed}
          onSignIn={goSignIn}
          onRetrySync={retryCloudLoad}
          onSelectSymbol={selectSymbol}
          onToggleWatchlist={toggleWatchlist}
        />
      )}

      {page === "home" && (
        <HomePage
          prefs={prefs}
          quotes={quotes}
          visibleStocks={visibleStocks}
          cardProps={sharedCardProps}
          detail={detailProps}
          search={search}
          setSearch={setSearch}
          sidebarOpen={sidebarOpen}
          onToggleSidebar={() => setSidebarOpen(v => !v)}
          onSelectWatchlist={id => { setActiveWatchlist(id); setSelectedSymbol(null); }}
          onOpenSymbol={openSymbol}
          onToggleWatchlist={toggleWatchlist}
        />
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
