import { useState, useEffect, useMemo, useRef, useCallback } from "react";

import { Sun, Moon, ChevronLeft, ChevronRight, BarChart2, LayoutGrid, List } from "lucide-react";
import { STOCKS_META, ALL_SYMBOLS, fetchQuotes, ensureQuotes, lastQuotesFreshness, prefetchSparklines, invalidateHistoryRange, clearHistoryCache, quoteChangeForRange, type StockMeta, type TimeRange } from "./lib/stocks";
import { loadUserState, saveUserState, flushUserState, onSyncResult, subscribeAuth, signIn, signUp, signOut, deleteAccount, DEFAULT_PREFS, type UserState, type UserPrefs } from "./lib/firebase";
import type { User } from "firebase/auth";
import { VantageChat } from "./components/VantageChat";

import { G, R, fmt$ } from "./lib/format";
import { DEFAULT_WATCHLISTS, DEFAULT_PROFILE, TIME_RANGES, readLocal, asWatchlists, asPrefs, type AppPage, type FilterMode, type SortMode, type SortDir, type ChangeDisplay, type ViewMode, type Watchlist, type Holding, type Transaction, type Profile, type CloudStatus } from "./types";

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
  const [page,            setPage]           = useState<AppPage>("home");
  const [theme,           setTheme]          = useState<"dark" | "light">("dark");
  const [homeRange,       setHomeRange]      = useState<TimeRange>("1D");
  const [detailRanges,    setDetailRanges]   = useState<Record<string, TimeRange>>({});
  const [filter,          setFilter]         = useState<FilterMode>("all");
  const [sort,            setSort]           = useState<SortMode>("manual");
  const [sortDir,         setSortDir]        = useState<SortDir>("desc");
  const [changeDisplay,   setChangeDisplay]  = useState<ChangeDisplay>("percent");
  const [search,          setSearch]         = useState("");
  const [viewMode,        setViewMode]       = useState<ViewMode>("grid");
  const [watchlists,      setWatchlists]     = useState<Watchlist[]>(DEFAULT_WATCHLISTS);
  const [activeWatchlist, setActiveWatchlist]= useState("portfolio");
  const [sidebarOpen,     setSidebarOpen]    = useState(() =>
    typeof window !== "undefined" ? window.matchMedia("(min-width: 768px)").matches : true,
  );
  const [selectedSymbol,  setSelectedSymbol] = useState<string | null>(null);
  const [pinnedSymbols,   setPinnedSymbols]  = useState<string[]>([]);
  const [customOrders,    setCustomOrders]   = useState<Record<string, string[]>>({});
  const [balance,         setBalance]        = useState(() =>
    readLocal("vantage-balance", 0, v => typeof v === "number" && Number.isFinite(v)),
  );
  const [holdings,        setHoldings]       = useState<Holding[]>(() =>
    readLocal<Holding[]>("vantage-holdings", [], Array.isArray),
  );
  const [transactions,    setTransactions]   = useState<Transaction[]>(() =>
    readLocal<Transaction[]>("vantage-tx", [], Array.isArray),
  );
  const [profile,         setProfile]        = useState<Profile>(() =>
    readLocal<Profile>("vantage-profile", DEFAULT_PROFILE, v => !!v && typeof v === "object" && !Array.isArray(v)),
  );
  const [user,            setUser]           = useState<User | null>(null);
  const [needsNameSetup,  setNeedsNameSetup] = useState(false);
  const [setupComplete,   setSetupComplete]  = useState(false);
  const [cloudStatus,     setCloudStatus]    = useState<CloudStatus>("idle");
  const [stocks,          setStocks]         = useState<StockMeta[]>(STOCKS_META);
  const [dataStatus,      setDataStatus]     = useState<"loading" | "live" | "stale" | "error">(
    STOCKS_META.some(s => s.price > 0) ? "stale" : "loading",
  );
  const [sparkEpoch,      setSparkEpoch]     = useState(0);
  const [tradeDialog,     setTradeDialog]    = useState<{ symbol: string; mode: "buy" | "sell" } | null>(null);

  const dragSymbolRef = useRef<string | null>(null);
  const [dragOver, setDragOver] = useState<string | null>(null);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

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
    }, 60_000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, []);

  // When the toolbar range changes, load matching history for visible symbols
  useEffect(() => {
    const list = watchlists.find(w => w.id === activeWatchlist);
    const syms = list?.symbols ?? ALL_SYMBOLS;
    prefetchSparklines(syms, homeRange)
      .then(() => setSparkEpoch(e => e + 1))
      .catch(() => {});
  }, [homeRange, activeWatchlist, watchlists]);

  useEffect(() => { localStorage.setItem("vantage-balance", JSON.stringify(balance)); }, [balance]);
  useEffect(() => { localStorage.setItem("vantage-holdings", JSON.stringify(holdings)); }, [holdings]);
  useEffect(() => { localStorage.setItem("vantage-tx", JSON.stringify(transactions)); }, [transactions]);
  useEffect(() => { localStorage.setItem("vantage-profile", JSON.stringify(profile)); }, [profile]);

  // ─── Auth + Firestore sync ────────────────────────────────────────────────────
  const cloudReady = useRef(false);
  const authSettled = useRef(false);
  /** Name captured during sign-up, so onboarding never has to ask for it again. */
  const pendingSignupName = useRef("");

  // True cloud-sync state. Previously "signed in but not yet loaded" and "signed in
  // but the load failed" were both indistinguishable from "guest".
  const syncing = !!user && (cloudStatus === "idle" || cloudStatus === "loading");
  const syncFailed = !!user && cloudStatus === "error";
  const setupDone = setupComplete || syncFailed;
  const signedIn = !!user && (setupDone || syncing);

  const buildCloudState = useCallback((): UserState => ({
    balance,
    holdings,
    transactions,
    profile,
    setupComplete: true,
    watchlists,
    prefs: {
      homeRange,
      filter,
      sort,
      sortDir,
      changeDisplay,
      viewMode,
      theme,
      activeWatchlist,
      pinnedSymbols,
      customOrders,
      detailRanges,
    },
  }), [
    balance, holdings, transactions, profile, watchlists,
    homeRange, filter, sort, sortDir, changeDisplay, viewMode, theme,
    activeWatchlist, pinnedSymbols, customOrders, detailRanges,
  ]);

  const applyPrefs = useCallback((prefs: UserPrefs, lists: Watchlist[]) => {
    setHomeRange(prefs.homeRange as TimeRange);
    setFilter(prefs.filter as FilterMode);
    setSort(prefs.sort as SortMode);
    setSortDir(prefs.sortDir as SortDir);
    setChangeDisplay(prefs.changeDisplay as ChangeDisplay);
    setViewMode(prefs.viewMode as ViewMode);
    setTheme(prefs.theme === "light" ? "light" : "dark");
    setPinnedSymbols(prefs.pinnedSymbols);
    setCustomOrders(prefs.customOrders);
    const ranges: Record<string, TimeRange> = {};
    for (const [sym, r] of Object.entries(prefs.detailRanges)) {
      if (TIME_RANGES.includes(r as TimeRange)) ranges[sym] = r as TimeRange;
    }
    setDetailRanges(ranges);
    const active = lists.some(w => w.id === prefs.activeWatchlist)
      ? prefs.activeWatchlist
      : (lists[0]?.id ?? "portfolio");
    setActiveWatchlist(active);
  }, []);

  const clearTradeData = useCallback(() => {
    setBalance(0);
    setHoldings([]);
    setTransactions([]);
  }, []);

  const resetToGuest = useCallback(() => {
    clearTradeData();
    setProfile(DEFAULT_PROFILE);
    setWatchlists(DEFAULT_WATCHLISTS);
    setActiveWatchlist("portfolio");
    setPinnedSymbols([]);
    setCustomOrders({});
    setDetailRanges({});
    setHomeRange("1D");
    setFilter("all");
    setSort("manual");
    setSortDir("desc");
    setChangeDisplay("percent");
    setViewMode("grid");
    setNeedsNameSetup(false);
    setSetupComplete(false);
    cloudReady.current = false;
    pendingSignupName.current = "";
  }, [clearTradeData]);

  const loadCloudState = useCallback(async (next: User) => {
    cloudReady.current = false;
    setCloudStatus("loading");
    const email = next.email ?? "";
    // Identity comes from the Auth user, not Firestore. Seed it up front so a
    // failed cloud read can't leave the account page blank.
    const authName = next.displayName || pendingSignupName.current;
    setProfile(prev => ({
      ...prev,
      email: prev.email || email,
      name: prev.name || authName,
    }));
    try {
      const saved = await loadUserState(next.uid);
      if (saved?.setupComplete && saved.profile?.name) {
        if (typeof saved.balance === "number") setBalance(saved.balance);
        if (Array.isArray(saved.holdings)) setHoldings(saved.holdings as Holding[]);
        if (Array.isArray(saved.transactions)) setTransactions(saved.transactions as Transaction[]);
        setProfile({
          ...DEFAULT_PROFILE,
          ...saved.profile,
          email: saved.profile.email || email,
        });
        const lists = asWatchlists(saved.watchlists) ?? DEFAULT_WATCHLISTS;
        setWatchlists(lists);
        applyPrefs(asPrefs(saved.prefs), lists);
        const symbols = [...new Set(lists.flatMap(w => w.symbols))];
        if (symbols.length) {
          ensureQuotes(symbols)
            .then(live => setStocks([...live]))
            .catch(() => {});
        }
        setNeedsNameSetup(false);
        setSetupComplete(true);
      } else {
        // The read SUCCEEDED and there is genuinely no completed profile —
        // this is the only case where onboarding is the right answer.
        clearTradeData();
        setProfile({ ...DEFAULT_PROFILE, email, name: authName });
        setNeedsNameSetup(true);
        setSetupComplete(false);
        setPage("account");
      }
      cloudReady.current = true;
      setCloudStatus("ready");
    } catch (err) {
      // The read FAILED, so we have no idea what's in the cloud. Treating that as
      // "new user" is what re-asked for the name and made the app look signed out.
      // Keep local state, keep the user signed in, and leave writes disabled so we
      // can't overwrite good cloud data with a blank slate.
      console.warn("Firestore load failed:", err);
      cloudReady.current = false;
      setCloudStatus("error");
    }
  }, [applyPrefs, clearTradeData]);

  useEffect(() => {
    return subscribeAuth(next => {
      setUser(next);
      if (!next) {
        // Firebase emits null once on startup before it resolves a session. Only
        // clear on a real sign-out, otherwise it wipes the restored guest state.
        if (authSettled.current) resetToGuest();
        authSettled.current = true;
        setCloudStatus("idle");
        return;
      }
      authSettled.current = true;
      void loadCloudState(next);
    });
  }, [resetToGuest, loadCloudState]);

  const retryCloudLoad = useCallback(() => {
    if (user) void loadCloudState(user);
  }, [user, loadCloudState]);

  // App drives the auth call so the sign-up name is recorded BEFORE Firebase fires
  // onAuthStateChanged. Setting it after signUp() resolves is already too late —
  // the listener has run and built the profile with an empty name.
  const handleAuth = useCallback(async (
    mode: "signin" | "signup", email: string, password: string, name: string,
  ) => {
    if (mode === "signup") {
      pendingSignupName.current = name;
      try {
        await signUp(email, password, name);
      } catch (err) {
        pendingSignupName.current = "";
        throw err;
      }
    } else {
      await signIn(email, password);
    }
  }, []);

  // Surface write failures the same way as read failures instead of only logging.
  useEffect(() => {
    onSyncResult(err => setCloudStatus(prev => (err ? "error" : prev === "error" ? "ready" : prev)));
    return () => onSyncResult(null);
  }, []);

  // cloudStatus is in the deps so a recovered sync flushes pending local changes
  // instead of waiting for the next unrelated edit.
  useEffect(() => {
    if (!cloudReady.current || !user || !setupComplete) return;
    saveUserState(user.uid, buildCloudState());
  }, [buildCloudState, user, setupComplete, cloudStatus]);

  // The cloud write is debounced; make sure it lands if the page is hidden or closed.
  useEffect(() => {
    const onHide = () => {
      if (document.visibilityState === "hidden") flushUserState();
    };
    document.addEventListener("visibilitychange", onHide);
    window.addEventListener("pagehide", flushUserState);
    return () => {
      document.removeEventListener("visibilitychange", onHide);
      window.removeEventListener("pagehide", flushUserState);
    };
  }, []);

  const handleOnboarding = useCallback((name: string, selectedSymbols: string[]) => {
    if (!user) return;
    const nextProfile: Profile = {
      ...profile,
      name,
      email: user.email ?? profile.email,
      pic: profile.pic || "",
    };
    const lists = buildWatchlistsFromSelection(new Set(selectedSymbols));
    setProfile(nextProfile);
    setWatchlists(lists);
    setActiveWatchlist("portfolio");
    setPinnedSymbols([]);
    setCustomOrders({});
    setDetailRanges({});
    setHomeRange("1D");
    setFilter("all");
    setSort("manual");
    setSortDir("desc");
    setChangeDisplay("percent");
    setViewMode("grid");
    clearTradeData();
    setNeedsNameSetup(false);
    setSetupComplete(true);
    cloudReady.current = true;
    pendingSignupName.current = "";
    saveUserState(user.uid, {
      balance: 0,
      holdings: [],
      transactions: [],
      profile: nextProfile,
      setupComplete: true,
      watchlists: lists,
      prefs: {
        ...DEFAULT_PREFS,
        activeWatchlist: "portfolio",
      },
    });
    ensureQuotes(selectedSymbols)
      .then(live => setStocks([...live]))
      .catch(() => {});
    setPage("home");
  }, [user, profile, clearTradeData]);

  const handleSignOut = useCallback(async () => {
    await signOut();
  }, []);

  const handleDeleteAccount = useCallback(async () => {
    await deleteAccount();
  }, []);

  const goSignIn = useCallback(() => {
    setSelectedSymbol(null);
    setPage("account");
  }, []);

  const holdingMap = useMemo(() => {
    const m = new Map<string, Holding>();
    holdings.forEach(h => m.set(h.symbol, h));
    return m;
  }, [holdings]);

  const portfolioValue = useMemo(
    () => holdings.reduce((sum, h) => {
      const stock = stocks.find(s => s.symbol === h.symbol);
      return sum + (stock ? stock.price * h.shares : 0);
    }, 0),
    [holdings, stocks]
  );
  const totalCost = useMemo(
    () => holdings.reduce((sum, h) => sum + h.avgCost * h.shares, 0),
    [holdings]
  );
  const totalProfit = portfolioValue - totalCost;

  const activeList   = watchlists.find(w => w.id === activeWatchlist) ?? watchlists[0];
  const activeStocks = useMemo(
    () => stocks.filter(s => activeList.symbols.includes(s.symbol)),
    [activeList, stocks]
  );

  const portfolioStocks = useMemo(() => {
    const rows = holdings
      .map(h => {
        const stock = stocks.find(s => s.symbol === h.symbol);
        return stock ? { stock, holding: h } : null;
      })
      .filter((x): x is { stock: StockMeta; holding: Holding } => x != null);

    if (sort === "manual") return rows;

    const rangeDelta = (x: StockMeta) => quoteChangeForRange(x.symbol, homeRange, x);
    const cmp: Record<Exclude<SortMode, "manual">, (a: StockMeta, b: StockMeta) => number> = {
      change:    (a, b) => rangeDelta(b).changePercent - rangeDelta(a).changePercent,
      changeAmt: (a, b) => rangeDelta(b).change - rangeDelta(a).change,
      price:     (a, b) => b.price - a.price,
      cap:       (a, b) => b.marketCap - a.marketCap,
      volume:    (a, b) => b.volume - a.volume,
      symbol:    (a, b) => b.symbol.localeCompare(a.symbol),
      name:      (a, b) => b.name.localeCompare(a.name),
    };
    rows.sort((a, b) => cmp[sort](a.stock, b.stock));
    if (sortDir === "asc") rows.reverse();
    return rows;
  }, [holdings, stocks, sort, sortDir, homeRange, sparkEpoch]);

  const visibleStocks = useMemo(() => {
    let s = [...activeStocks];
    const rangeDelta = (x: StockMeta) => quoteChangeForRange(x.symbol, homeRange, x);
    const owned = new Set(holdings.map(h => h.symbol));

    if (search) {
      const q = search.toLowerCase();
      s = s.filter(x => x.symbol.toLowerCase().includes(q) || x.name.toLowerCase().includes(q));
    }

    if (filter === "gainers") s = s.filter(x => rangeDelta(x).changePercent > 0);
    else if (filter === "losers") s = s.filter(x => rangeDelta(x).changePercent < 0);
    else if (filter === "owned") s = s.filter(x => owned.has(x.symbol));

    if (sort === "manual") {
      const order = customOrders[activeWatchlist] ?? activeList.symbols;
      s.sort((a, b) => {
        const ai = order.indexOf(a.symbol);
        const bi = order.indexOf(b.symbol);
        return (ai === -1 ? 9999 : ai) - (bi === -1 ? 9999 : bi);
      });
      s.sort((a, b) => {
        const ap = pinnedSymbols.includes(a.symbol);
        const bp = pinnedSymbols.includes(b.symbol);
        if (ap === bp) return 0;
        return ap ? -1 : 1;
      });
    } else if (filter === "movers") {
      s.sort((a, b) => Math.abs(rangeDelta(b).changePercent) - Math.abs(rangeDelta(a).changePercent));
    } else {
      // $/% sorts use the toolbar range (1Y etc.), not always 1D day change
      const cmp: Record<Exclude<SortMode, "manual">, (a: StockMeta, b: StockMeta) => number> = {
        change:    (a, b) => rangeDelta(b).changePercent - rangeDelta(a).changePercent,
        changeAmt: (a, b) => rangeDelta(b).change - rangeDelta(a).change,
        price:     (a, b) => b.price - a.price,
        cap:       (a, b) => b.marketCap - a.marketCap,
        volume:    (a, b) => b.volume - a.volume,
        symbol:    (a, b) => b.symbol.localeCompare(a.symbol),
        name:      (a, b) => b.name.localeCompare(a.name),
      };
      s.sort(cmp[sort]);
      if (sortDir === "asc") s.reverse();
    }

    return s;
  }, [activeStocks, search, filter, sort, sortDir, customOrders, activeWatchlist, pinnedSymbols, activeList.symbols, homeRange, sparkEpoch, holdings]);

  const selectedStock = selectedSymbol ? stocks.find(s => s.symbol === selectedSymbol) ?? null : null;

  const allStocksList = watchlists.find(w => w.id === "portfolio");
  const allStocksMeta = useMemo(
    () => stocks.filter(s => (allStocksList?.symbols ?? ALL_SYMBOLS).includes(s.symbol)),
    [allStocksList, stocks]
  );
  const gainCount = allStocksMeta.filter(s => s.changePercent > 0).length;
  const lossCount = allStocksMeta.filter(s => s.changePercent < 0).length;

  const createWatchlist = useCallback((name: string) => {
    const id = "wl-" + name.toLowerCase().replace(/\s+/g, "-") + "-" + Date.now();
    setWatchlists(prev => [...prev, { id, name, symbols: [] }]);
  }, []);

  const deleteWatchlist = useCallback((id: string) => {
    setWatchlists(prev => prev.filter(w => w.id !== id));
    if (activeWatchlist === id) setActiveWatchlist("portfolio");
  }, [activeWatchlist]);

  const renameWatchlist = useCallback((id: string, name: string) => {
    setWatchlists(prev => prev.map(w => (w.id === id ? { ...w, name } : w)));
  }, []);

  const reorderWatchlists = useCallback((fromId: string, toId: string) => {
    setWatchlists(prev => {
      const fi = prev.findIndex(w => w.id === fromId);
      const ti = prev.findIndex(w => w.id === toId);
      if (fi < 0 || ti < 0 || fi === ti) return prev;
      const next = [...prev];
      const [moved] = next.splice(fi, 1);
      next.splice(ti, 0, moved);
      return next;
    });
  }, []);

  const toggleWatchlist = useCallback((watchlistId: string, symbol: string) => {
    setWatchlists(prev => {
      const target = prev.find(w => w.id === watchlistId);
      if (!target) return prev;
      const removing = target.symbols.includes(symbol);

      let next = prev.map(w => {
        if (w.id !== watchlistId) return w;
        return {
          ...w,
          symbols: removing
            ? w.symbols.filter(s => s !== symbol)
            : [...w.symbols, symbol],
        };
      });

      if (!removing) {
        // Adding anywhere also ensures it's in All Stocks
        next = next.map(w => {
          if (w.id !== "portfolio" || w.symbols.includes(symbol)) return w;
          return { ...w, symbols: [...w.symbols, symbol] };
        });
      } else if (watchlistId === "portfolio") {
        // Removing from All Stocks removes from every watchlist
        next = next.map(w => ({ ...w, symbols: w.symbols.filter(s => s !== symbol) }));
      } else {
        // Removed from a user list — if gone from all user lists, drop from All Stocks too
        const stillInUserList = next.some(w => w.id !== "portfolio" && w.symbols.includes(symbol));
        if (!stillInUserList) {
          next = next.map(w =>
            w.id === "portfolio" ? { ...w, symbols: w.symbols.filter(s => s !== symbol) } : w
          );
        }
      }

      return next;
    });
    // Load live quote for newly added tickers from search
    ensureQuotes([symbol])
      .then(live => setStocks([...live]))
      .catch(() => {});
  }, []);

  const togglePin = useCallback((symbol: string) => {
    setPinnedSymbols(prev => prev.includes(symbol) ? prev.filter(s => s !== symbol) : [...prev, symbol]);
  }, []);

  const hydrateStocks = useCallback((live: StockMeta[]) => {
    setStocks([...live]);
    setSparkEpoch(e => e + 1);
  }, []);

  const openSymbol = useCallback(async (symbol: string) => {
    setSearch("");
    setSelectedSymbol(symbol);
    setPage("home");
    // Ensure searchable tickers land in All Stocks so they stay available
    setWatchlists(prev => prev.map(w => {
      if (w.id !== "portfolio" || w.symbols.includes(symbol)) return w;
      return { ...w, symbols: [...w.symbols, symbol] };
    }));
    try {
      const live = await ensureQuotes([symbol]);
      setStocks([...live]);
      setDataStatus("live");
      const r = detailRanges[symbol] ?? "1D";
      prefetchSparklines([symbol], r).catch(() => {});
    } catch {
      /* keep whatever quote we have */
    }
  }, [detailRanges]);

  const selectSymbol = useCallback((symbol: string) => {
    setSelectedSymbol(symbol);
    ensureQuotes([symbol])
      .then(live => { setStocks([...live]); setDataStatus("live"); })
      .catch(() => {});
  }, []);

  const setDetailRange = useCallback((symbol: string, r: TimeRange) => {
    setDetailRanges(prev => (prev[symbol] === r ? prev : { ...prev, [symbol]: r }));
    prefetchSparklines([symbol], r).catch(() => {});
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
  }, [dragOver, activeWatchlist, activeList.symbols]);

  const deposit = useCallback((amount: number) => {
    setBalance(b => b + amount);
    setTransactions(prev => [{
      id: "tx-" + Date.now(),
      type: "deposit",
      amount,
      timestamp: Date.now(),
    }, ...prev]);
  }, []);

  const buyShares = useCallback((symbol: string, shares: number, price: number) => {
    const cost = shares * price;
    setBalance(b => b - cost);
    setHoldings(prev => {
      const existing = prev.find(h => h.symbol === symbol);
      if (!existing) return [...prev, { symbol, shares, avgCost: price }];
      const totalShares = existing.shares + shares;
      const avgCost = (existing.avgCost * existing.shares + price * shares) / totalShares;
      return prev.map(h => h.symbol === symbol ? { symbol, shares: totalShares, avgCost } : h);
    });
    setTransactions(prev => [{
      id: "tx-" + Date.now(),
      type: "buy",
      amount: cost,
      symbol,
      shares,
      price,
      timestamp: Date.now(),
    }, ...prev]);
  }, []);

  const sellShares = useCallback((symbol: string, shares: number, price: number) => {
    const proceeds = shares * price;
    setBalance(b => b + proceeds);
    setHoldings(prev => prev.flatMap(h => {
      if (h.symbol !== symbol) return [h];
      const remaining = h.shares - shares;
      return remaining > 1e-9 ? [{ ...h, shares: remaining }] : [];
    }));
    setTransactions(prev => [{
      id: "tx-" + Date.now(),
      type: "sell",
      amount: proceeds,
      symbol,
      shares,
      price,
      timestamp: Date.now(),
    }, ...prev]);
  }, []);

  const resetTradeHistory = useCallback(() => {
    setBalance(0);
    setHoldings([]);
    setTransactions([]);
  }, []);

  const goToPage = (p: AppPage) => {
    setPage(p);
    setSelectedSymbol(null);
  };

  const isDraggable = sort === "manual" && page === "home";

  const onSortSelect = useCallback((s: SortMode) => {
    if (s === sort) {
      setSortDir(d => (d === "desc" ? "asc" : "desc"));
    } else {
      setSort(s);
      setSortDir("desc");
    }
  }, [sort]);

  const onColumnSort = useCallback((s: SortMode) => {
    if (s === sort) {
      setSortDir(d => (d === "asc" ? "desc" : "asc"));
    } else {
      setSort(s);
      setSortDir("asc");
    }
  }, [sort]);

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
          initialName={profile.name || pendingSignupName.current}
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
