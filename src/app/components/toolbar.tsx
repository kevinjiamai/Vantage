import { ArrowUpDown, Check, ChevronDown, Filter, LayoutGrid, List, Search, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { SearchDropdown } from "./SearchDropdown";

import { DropdownMenu } from "./common";
import { G } from "../lib/format";
import { type StockMeta, type TimeRange } from "../lib/stocks";
import { type ChangeDisplay, type FilterMode, type SortDir, type SortMode, type ViewMode, type Watchlist } from "../types";

export const RANGES: TimeRange[] = ["1D", "1W", "1M", "3M", "6M", "YTD", "1Y", "2Y", "5Y", "10Y", "ALL"];

export const DETAIL_RANGES = RANGES;

/** Responsive collapse for narrow windows — 1D/3M/1Y/ALL always remain */
export const RANGE_TIER: Record<TimeRange, string> = {
  "1D":  "",
  "1W":  "hidden xl:block",
  "1M":  "hidden lg:block",
  "3M":  "",
  "6M":  "hidden lg:block",
  "YTD": "hidden xl:block",
  "1Y":  "",
  "2Y":  "hidden xl:block",
  "5Y":  "hidden lg:block",
  "10Y": "hidden 2xl:block",
  "ALL": "",
};

/** Ranges that are hidden at some breakpoints (shown via ▾ overflow menu) */
export const RANGE_OVERFLOW: TimeRange[] = ["1W", "1M", "6M", "YTD", "2Y", "5Y", "10Y"];

export function RangePicker({
  range, setRange, ranges = RANGES,
}: {
  range: TimeRange;
  setRange: (r: TimeRange) => void;
  ranges?: TimeRange[];
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);

  useEffect(() => {
    if (!moreOpen) return;
    const h = (e: MouseEvent) => {
      const t = e.target as Node;
      if (moreRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setMoreOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [moreOpen]);

  useLayoutEffect(() => {
    if (!moreOpen || !moreRef.current) {
      setMenuPos(null);
      return;
    }
    const update = () => {
      const r = moreRef.current!.getBoundingClientRect();
      setMenuPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [moreOpen]);

  const overflowActive = RANGE_OVERFLOW.includes(range);

  return (
    <div className="flex items-center rounded-lg p-0.5 flex-shrink-0" style={{ background: "var(--v-line)" }}>
      {ranges.map(r => (
        <button
          key={r}
          onClick={() => setRange(r)}
          className={`px-3 py-1 rounded-md text-[10px] sm:text-[11px] font-mono font-medium transition-all flex-shrink-0 ${range === r ? "" : RANGE_TIER[r]}`}
          style={{
            background: range === r ? "var(--v-ink)"   : "transparent",
            color:      range === r ? "var(--v-panel)" : "var(--v-ink-soft)",
          }}
        >
          {r}
        </button>
      ))}
      <div ref={moreRef} className="relative flex-shrink-0 self-stretch flex items-center 2xl:hidden">
        <button
          type="button"
          onClick={() => setMoreOpen(v => !v)}
          className="h-full px-1.5 rounded-md flex items-center justify-center transition-all"
          style={{
            background: overflowActive || moreOpen ? "var(--v-ink)" : "transparent",
            color:      overflowActive || moreOpen ? "var(--v-panel)" : "var(--v-ink-soft)",
          }}
          title="More ranges"
          aria-label="More ranges"
          aria-expanded={moreOpen}
        >
          <ChevronDown size={12} />
        </button>
        {moreOpen && menuPos && createPortal(
          <div
            ref={menuRef}
            className="fixed z-[200] min-w-[5.5rem] rounded-xl border py-1.5 shadow-2xl"
            style={{ top: menuPos.top, right: menuPos.right, background: "var(--v-panel)", borderColor: "var(--v-line-strong)" }}
          >
            {RANGE_OVERFLOW.map(r => (
              <button
                key={r}
                className="w-full text-left px-3 py-1.5 text-[11px] font-mono flex items-center gap-2 hover:bg-white/5 transition-colors"
                style={{ color: r === range ? "var(--v-ink)" : "var(--v-ink-soft)" }}
                onClick={() => { setRange(r); setMoreOpen(false); }}
              >
                {r === range ? <Check size={10} color={G} /> : <span className="w-[10px]" />}
                {r}
              </button>
            ))}
          </div>,
          document.body,
        )}
      </div>
    </div>
  );
}

export const FILTER_OPTS: { value: FilterMode; label: string }[] = [
  { value: "all",     label: "All"        },
  { value: "gainers", label: "Gainers"    },
  { value: "losers",  label: "Losers"     },
  { value: "movers",  label: "Top Movers" },
  { value: "owned",   label: "Owned"      },
];

export const SORT_OPTS: { value: SortMode; label: string }[] = [
  { value: "manual",    label: "Manual"     },
  { value: "change",    label: "% Change"   },
  { value: "changeAmt", label: "$ Change"   },
  { value: "price",     label: "Price"      },
  { value: "cap",       label: "Market Cap" },
  { value: "volume",    label: "Volume"     },
  { value: "symbol",    label: "Symbol"     },
  { value: "name",      label: "Name"       },
];

export function Toolbar({
  range, setRange, filter, setFilter, sort, sortDir, onSortSelect,
  changeDisplay, setChangeDisplay,
  search, setSearch, viewMode, setViewMode,
  stocks, watchlists, onSelectSymbol, onToggleWatchlist, onStocksHydrated, refreshKey = 0,
}: {
  range: TimeRange;    setRange:  (r: TimeRange)  => void;
  filter: FilterMode; setFilter: (f: FilterMode) => void;
  sort: SortMode;     sortDir: SortDir;
  onSortSelect: (s: SortMode) => void;
  changeDisplay: ChangeDisplay;
  setChangeDisplay: (c: ChangeDisplay) => void;
  search: string;     setSearch: (s: string)     => void;
  viewMode: ViewMode; setViewMode: (v: ViewMode) => void;
  stocks: StockMeta[];
  watchlists: Watchlist[];
  onSelectSymbol: (symbol: string) => void;
  onToggleWatchlist: (watchlistId: string, symbol: string) => void;
  onStocksHydrated?: (stocks: StockMeta[]) => void;
  refreshKey?: number;
}) {
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);

  const showDropdown = searchOpen && search.trim().length > 0;

  return (
    <div
      className="flex flex-nowrap items-center gap-2.5 px-4 py-2 border-b sticky top-0 z-40 backdrop-blur-md overflow-x-auto no-scrollbar"
      style={{
        background:  "color-mix(in srgb, var(--v-panel) 85%, transparent)",
        borderColor: "var(--v-line)",
      }}
    >
      <div ref={searchRef} className="relative flex-1 min-w-[12rem]">
        <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "var(--v-ink-dim)" }} />
        <input
          value={search}
          onChange={e => { setSearch(e.target.value); setSearchOpen(true); }}
          onFocus={() => { setSearchFocused(true); setSearchOpen(true); }}
          onBlur={() => setSearchFocused(false)}
          placeholder="Search all stocks…"
          className="w-full pl-7 pr-7 py-1.5 rounded-lg text-xs outline-none"
          style={{
            background:   "var(--v-line)",
            color:        "var(--v-ink)",
            fontFamily:   "Geist Mono, monospace",
            borderWidth:  1,
            borderStyle:  "solid",
            borderColor:  searchFocused || showDropdown ? "var(--v-line-strong)" : "transparent",
          }}
        />
        {search && (
          <button className="absolute right-2 top-1/2 -translate-y-1/2" onClick={() => setSearch("")}>
            <X size={11} style={{ color: "var(--v-ink-dim)" }} />
          </button>
        )}

        {showDropdown && (
          <SearchDropdown
            query={search}
            stocks={stocks}
            watchlists={watchlists}
            onSelectSymbol={sym => { onSelectSymbol(sym); setSearchOpen(false); }}
            onToggleWatchlist={onToggleWatchlist}
            onClose={() => setSearchOpen(false)}
            onStocksHydrated={onStocksHydrated}
            refreshKey={refreshKey}
            anchorRef={searchRef}
          />
        )}
      </div>

      <div className="flex items-center gap-2.5 flex-shrink-0">
        <RangePicker range={range} setRange={setRange} />

        <DropdownMenu options={FILTER_OPTS} value={filter} onChange={setFilter} icon={<Filter size={12} />} label="Filter" />
        <DropdownMenu
          options={SORT_OPTS}
          value={sort}
          onChange={onSortSelect}
          icon={<ArrowUpDown size={12} />}
          label="Sort"
          activeSuffix={sort === "manual" ? undefined : sortDir === "desc" ? "↓" : "↑"}
        />

        <button
          onClick={() => setChangeDisplay(changeDisplay === "percent" ? "amount" : "percent")}
          className="flex items-center justify-center w-8 py-1.5 rounded-lg text-xs font-mono font-semibold transition-colors flex-shrink-0"
          style={{ background: "var(--v-line)", color: "var(--v-ink)" }}
          title={changeDisplay === "percent" ? "Showing % change — click for $ change" : "Showing $ change — click for % change"}
        >
          {changeDisplay === "percent" ? "%" : "$"}
        </button>

        <div className="flex rounded-lg p-0.5 flex-shrink-0" style={{ background: "var(--v-line)" }}>
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
      </div>
    </div>
  );
}
