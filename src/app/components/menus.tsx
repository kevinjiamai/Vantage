import { Check, Minus, Plus, Star } from "lucide-react";
import { useEffect, useRef } from "react";

import { G, R } from "../lib/format";
import { type Watchlist } from "../types";

export function CardMenu({
  symbol, watchlists, isPinned, onTogglePin, onToggleWatchlist, onClose,
}: {
  symbol: string;
  watchlists: Watchlist[];
  isPinned: boolean;
  onTogglePin: () => void;
  onToggleWatchlist: (id: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute right-0 top-8 z-50 min-w-[176px] rounded-xl border py-1.5 shadow-2xl"
      style={{ background: "var(--v-panel)", borderColor: "var(--v-line-strong)" }}
      onClick={e => e.stopPropagation()}
    >
      <button
        className="w-full text-left px-3 py-2 text-xs flex items-center gap-2.5 transition-colors hover:bg-white/5"
        style={{ color: "var(--v-ink)" }}
        onClick={() => onTogglePin()}
      >
        <Star size={11} fill={isPinned ? G : "none"} style={{ color: isPinned ? G : "var(--v-ink-dim)", flexShrink: 0 }} />
        {isPinned ? "Unpin from top" : "Pin to top"}
      </button>

      <div className="my-1 mx-3" style={{ borderTop: "1px solid var(--v-line)" }} />

      <div className="px-3 pb-1 text-[10px] font-mono uppercase tracking-widest" style={{ color: "var(--v-ink-dim)" }}>
        Add to watchlist
      </div>
      {watchlists.filter(w => w.id !== "portfolio").length === 0 && (
        <div className="px-3 py-1.5 text-xs" style={{ color: "var(--v-ink-dim)" }}>No lists yet</div>
      )}
      {watchlists.filter(w => w.id !== "portfolio").map(wl => {
        const has = wl.symbols.includes(symbol);
        return (
          <button
            key={wl.id}
            className="w-full text-left px-3 py-1.5 text-xs flex items-center gap-2.5 transition-colors hover:bg-white/5"
            style={{ color: "var(--v-ink)" }}
            onClick={() => onToggleWatchlist(wl.id)}
          >
            {has
              ? <Check size={10} color={G} style={{ flexShrink: 0 }} />
              : <Plus  size={10} style={{ color: "var(--v-ink-dim)", flexShrink: 0 }} />}
            {wl.name}
          </button>
        );
      })}
    </div>
  );
}

// ─── TradeMenu (portfolio card ⋮) ──────────────────────────────────────────────

export function TradeMenu({
  onBuy, onSell, onClose,
}: {
  onBuy: () => void;
  onSell: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute right-0 top-8 z-50 min-w-[148px] rounded-xl border py-1.5 shadow-2xl"
      style={{ background: "var(--v-panel)", borderColor: "var(--v-line-strong)" }}
      onClick={e => e.stopPropagation()}
    >
      <button
        className="w-full text-left px-3 py-2 text-xs flex items-center gap-2.5 transition-colors hover:bg-white/5"
        style={{ color: "var(--v-ink)" }}
        onClick={() => { onBuy(); onClose(); }}
      >
        <Plus size={11} style={{ color: G, flexShrink: 0 }} />
        Buy shares
      </button>
      <button
        className="w-full text-left px-3 py-2 text-xs flex items-center gap-2.5 transition-colors hover:bg-white/5"
        style={{ color: "var(--v-ink)" }}
        onClick={() => { onSell(); onClose(); }}
      >
        <Minus size={11} style={{ color: R, flexShrink: 0 }} />
        Sell shares
      </button>
    </div>
  );
}

// ─── WatchlistAddMenu (for search results) ─────────────────────────────────────

export function WatchlistAddMenu({
  symbol, watchlists, onToggle, onClose,
}: {
  symbol: string;
  watchlists: Watchlist[];
  onToggle: (id: string) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [onClose]);

  const lists = watchlists.filter(w => w.id !== "portfolio");

  return (
    <div
      ref={ref}
      className="absolute left-0 top-7 z-[80] min-w-[164px] rounded-xl border py-1.5 shadow-2xl"
      style={{ background: "var(--v-panel)", borderColor: "var(--v-line-strong)" }}
      onMouseDown={e => e.preventDefault()}
    >
      <div className="px-3 pb-1 text-[10px] font-mono uppercase tracking-widest" style={{ color: "var(--v-ink-dim)" }}>
        Add to watchlist
      </div>
      {lists.length === 0 && (
        <div className="px-3 py-1.5 text-xs" style={{ color: "var(--v-ink-dim)" }}>No lists yet</div>
      )}
      {lists.map(wl => {
        const has = wl.symbols.includes(symbol);
        return (
          <button
            key={wl.id}
            className="w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors hover:bg-white/5"
            style={{ color: "var(--v-ink)" }}
            onClick={() => onToggle(wl.id)}
          >
            {has
              ? <Check size={10} color={G} style={{ flexShrink: 0 }} />
              : <Plus  size={10} style={{ color: "var(--v-ink-dim)", flexShrink: 0 }} />}
            {wl.name}
          </button>
        );
      })}
    </div>
  );
}

export function WatchlistItemMenu({
  onRename, onDelete, onClose,
}: {
  onRename: () => void;
  onDelete: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute right-0 top-7 z-50 min-w-[124px] rounded-xl border py-1.5 shadow-2xl"
      style={{ background: "var(--v-panel)", borderColor: "var(--v-line-strong)" }}
      onClick={e => e.stopPropagation()}
    >
      <button
        className="w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors hover:bg-white/5"
        style={{ color: "var(--v-ink)" }}
        onClick={onRename}
      >
        Rename
      </button>
      <button
        className="w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors hover:bg-white/5"
        style={{ color: R }}
        onClick={onDelete}
      >
        Delete
      </button>
    </div>
  );
}
