import { useCallback, useState, type Dispatch, type SetStateAction } from "react";
import type { TimeRange } from "../lib/stocks";
import type { UserPrefs } from "../lib/firebase";
import {
  DEFAULT_WATCHLISTS, TIME_RANGES,
  type ChangeDisplay, type FilterMode, type SortDir, type SortMode, type ViewMode, type Watchlist,
} from "../types";

export type Theme = "dark" | "light";

type Setter<T> = Dispatch<SetStateAction<T>>;

export interface Preferences {
  theme: Theme;
  setTheme: Setter<Theme>;
  homeRange: TimeRange;
  setHomeRange: Setter<TimeRange>;
  detailRanges: Record<string, TimeRange>;
  filter: FilterMode;
  setFilter: Setter<FilterMode>;
  sort: SortMode;
  sortDir: SortDir;
  changeDisplay: ChangeDisplay;
  setChangeDisplay: Setter<ChangeDisplay>;
  viewMode: ViewMode;
  setViewMode: Setter<ViewMode>;
  watchlists: Watchlist[];
  activeWatchlist: string;
  setActiveWatchlist: Setter<string>;
  pinnedSymbols: string[];
  customOrders: Record<string, string[]>;

  /** The watchlist currently on screen, falling back to the first one. */
  activeList: Watchlist;

  setDetailRange: (symbol: string, r: TimeRange, onChange?: (symbol: string, r: TimeRange) => void) => void;
  /** Toolbar behaviour: same column toggles direction, new column resets it. */
  onSortSelect: (s: SortMode) => void;
  /** Column headers start ascending instead. */
  onColumnSort: (s: SortMode) => void;
  togglePin: (symbol: string) => void;
  createWatchlist: (name: string) => void;
  /** Create a list from imported symbols; returns the new list id. */
  importWatchlist: (name: string, symbols: string[]) => string;
  deleteWatchlist: (id: string) => void;
  renameWatchlist: (id: string, name: string) => void;
  reorderWatchlists: (fromId: string, toId: string) => void;
  toggleWatchlist: (watchlistId: string, symbol: string) => void;
  setCustomOrders: Setter<Record<string, string[]>>;
  ensureInAllStocks: (symbol: string) => void;

  /** Adopt cloud prefs. `lists` decides whether the saved active list survives. */
  apply: (prefs: UserPrefs, lists: Watchlist[]) => void;
  /** Back to first-run defaults (sign-out, onboarding). */
  reset: () => void;
  setWatchlists: Setter<Watchlist[]>;
}

export function usePreferences(): Preferences {
  const [theme, setTheme] = useState<Theme>("dark");
  const [homeRange, setHomeRange] = useState<TimeRange>("1D");
  const [detailRanges, setDetailRanges] = useState<Record<string, TimeRange>>({});
  const [filter, setFilter] = useState<FilterMode>("all");
  const [sort, setSort] = useState<SortMode>("manual");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [changeDisplay, setChangeDisplay] = useState<ChangeDisplay>("percent");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [watchlists, setWatchlists] = useState<Watchlist[]>(DEFAULT_WATCHLISTS);
  const [activeWatchlist, setActiveWatchlist] = useState("portfolio");
  const [pinnedSymbols, setPinnedSymbols] = useState<string[]>([]);
  const [customOrders, setCustomOrders] = useState<Record<string, string[]>>({});

  const activeList = watchlists.find(w => w.id === activeWatchlist) ?? watchlists[0];

  const setDetailRange = useCallback((
    symbol: string, r: TimeRange, onChange?: (symbol: string, r: TimeRange) => void,
  ) => {
    setDetailRanges(prev => (prev[symbol] === r ? prev : { ...prev, [symbol]: r }));
    onChange?.(symbol, r);
  }, []);

  const onSortSelect = useCallback((s: SortMode) => {
    if (s === sort) setSortDir(d => (d === "desc" ? "asc" : "desc"));
    else { setSort(s); setSortDir("desc"); }
  }, [sort]);

  const onColumnSort = useCallback((s: SortMode) => {
    if (s === sort) setSortDir(d => (d === "asc" ? "desc" : "asc"));
    else { setSort(s); setSortDir("asc"); }
  }, [sort]);

  const togglePin = useCallback((symbol: string) => {
    setPinnedSymbols(prev => prev.includes(symbol) ? prev.filter(s => s !== symbol) : [...prev, symbol]);
  }, []);

  const createWatchlist = useCallback((name: string) => {
    const id = "wl-" + name.toLowerCase().replace(/\s+/g, "-") + "-" + Date.now();
    setWatchlists(prev => [...prev, { id, name, symbols: [] }]);
  }, []);

  /**
   * Create a list from an imported symbol set and return its id.
   * Symbols are unioned into All Stocks in the same update, which is the
   * invariant toggleWatchlist maintains one symbol at a time.
   */
  const importWatchlist = useCallback((name: string, symbols: string[]) => {
    const id = "wl-import-" + Date.now();
    const unique = [...new Set(symbols)];
    setWatchlists(prev => {
      const withList = [...prev, { id, name, symbols: unique }];
      return withList.map(w => {
        if (w.id !== "portfolio") return w;
        const added = unique.filter(sym => !w.symbols.includes(sym));
        return added.length ? { ...w, symbols: [...w.symbols, ...added] } : w;
      });
    });
    return id;
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
  }, []);

  const ensureInAllStocks = useCallback((symbol: string) => {
    setWatchlists(prev => prev.map(w => {
      if (w.id !== "portfolio" || w.symbols.includes(symbol)) return w;
      return { ...w, symbols: [...w.symbols, symbol] };
    }));
  }, []);

  const apply = useCallback((prefs: UserPrefs, lists: Watchlist[]) => {
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

  const reset = useCallback(() => {
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
  }, []);

  return {
    theme, setTheme, homeRange, setHomeRange, detailRanges,
    filter, setFilter, sort, sortDir, changeDisplay, setChangeDisplay,
    viewMode, setViewMode, watchlists, activeWatchlist, setActiveWatchlist,
    pinnedSymbols, customOrders, activeList,
    setDetailRange, onSortSelect, onColumnSort, togglePin,
    createWatchlist, importWatchlist, deleteWatchlist, renameWatchlist, reorderWatchlists,
    toggleWatchlist, setCustomOrders, ensureInAllStocks,
    apply, reset, setWatchlists,
  };
}
