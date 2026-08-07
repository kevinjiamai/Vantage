import { ChevronLeft, Minus, Plus } from "lucide-react";
import { G, R } from "../../lib/format";
import type { StockMeta } from "../../lib/stocks";

/** Sticky bar: back, ticker, and the buy/sell actions. */
export function DetailHeader({
  stock, owned, onBack, onBuy, onSell,
}: {
  stock: StockMeta;
  /** Sell is disabled unless there are shares to sell. */
  owned: boolean;
  onBack: () => void;
  onBuy: () => void;
  onSell: () => void;
}) {
  return (
    <div
      className="sticky top-0 z-20 flex items-center gap-2 px-3 @[420px]:px-5 py-2.5 border-b backdrop-blur-xl"
      style={{ background: "color-mix(in srgb, var(--v-bg) 92%, transparent)", borderColor: "var(--v-line)" }}
    >
      <button
        className="flex items-center gap-0.5 text-xs transition-opacity hover:opacity-60 flex-shrink-0"
        style={{ color: "var(--v-ink-soft)" }}
        onClick={onBack}
      >
        <ChevronLeft size={14} />
        <span className="hidden @[360px]:inline">Back</span>
      </button>
      <div className="w-px h-4 flex-shrink-0" style={{ background: "var(--v-line-strong)" }} />
      <div className="flex items-center gap-2 min-w-0 flex-1">
        <span className="font-mono text-sm @[420px]:text-base font-semibold tracking-wider flex-shrink-0" style={{ color: "var(--v-ink)" }}>{stock.symbol}</span>
        <span className="text-xs truncate min-w-0 hidden @[400px]:inline" style={{ color: "var(--v-ink-soft)" }}>{stock.name}</span>
      </div>
      <div className="flex items-center gap-1.5 @[420px]:gap-2.5 flex-shrink-0">
        <button
          className="px-2.5 @[420px]:px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition-opacity hover:opacity-90"
          style={{ background: G, color: "#0a0a0a" }}
          onClick={onBuy}
        >
          <Plus size={12} strokeWidth={2.5} />
          Buy
        </button>
        <button
          className="px-2.5 @[420px]:px-3.5 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1 transition-opacity hover:opacity-90 disabled:opacity-50"
          style={{
            background: owned ? R : "var(--v-line-strong)",
            color:      owned ? "#0a0a0a" : "var(--v-ink-dim)",
            cursor:     owned ? "pointer" : "not-allowed",
          }}
          disabled={!owned}
          title={owned ? "Sell shares" : "No shares owned"}
          onClick={onSell}
        >
          <Minus size={12} strokeWidth={2.5} />
          Sell
        </button>
      </div>
    </div>
  );
}
