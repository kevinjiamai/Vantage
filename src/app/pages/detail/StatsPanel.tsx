import { StatCell } from "../../components/common";
import { G, R, fmt$, fmtCap, fmtVol } from "../../lib/format";
import type { StockMeta } from "../../lib/stocks";

const PANEL = "rounded-2xl border p-4";
const PANEL_STYLE = { background: "var(--v-panel)", borderColor: "var(--v-line)" };
const HEADING = "text-[9px] font-mono uppercase tracking-[0.15em] mb-3";

/** Where the current price sits between the 52-week low and high, as 0–100. */
function rangePosition(stock: StockMeta): number {
  const span = stock.high52w - stock.low52w;
  if (!(span > 0)) return 0;
  return Math.max(0, Math.min(100, ((stock.price - stock.low52w) / span) * 100));
}

/** Today's session numbers, fundamentals, and the 52-week position bar. */
export function StatsPanel({ stock, isGain }: { stock: StockMeta; isGain: boolean }) {
  const pct52 = rangePosition(stock);
  const accent = isGain ? G : R;

  return (
    <div className="w-full @[640px]:w-[19.5rem] flex-shrink-0 flex flex-col gap-3">
      <div className={PANEL} style={PANEL_STYLE}>
        <div className={HEADING} style={{ color: "var(--v-ink-dim)" }}>Today</div>
        <div className="grid grid-cols-3 gap-x-4 gap-y-4">
          <StatCell label="Open"    value={fmt$(stock.open)}        />
          <StatCell label="High"    value={fmt$(stock.dayHigh)}     />
          <StatCell label="Low"     value={fmt$(stock.dayLow)}      />
          <StatCell label="Volume"  value={fmtVol(stock.volume)}    />
          <StatCell label="Avg Vol" value={fmtVol(stock.avgVolume)} />
          <StatCell label="Sector"  value={stock.sector}            />
        </div>
      </div>

      <div className={PANEL} style={PANEL_STYLE}>
        <div className={HEADING} style={{ color: "var(--v-ink-dim)" }}>Fundamentals</div>
        <div className="grid grid-cols-3 gap-x-4 gap-y-4">
          <StatCell label="Market Cap" value={fmtCap(stock.marketCap)} />
          <StatCell label="P/E"        value={stock.pe  != null ? stock.pe.toFixed(1) : "—"} />
          <StatCell label="EPS"        value={stock.eps != null ? fmt$(stock.eps)      : "—"} />
          <StatCell label="52W High"   value={fmt$(stock.high52w)} />
          <StatCell label="52W Low"    value={fmt$(stock.low52w)}  />
          <StatCell label="Div Yield"  value={stock.dividendYield != null ? stock.dividendYield.toFixed(2) + "%" : "—"} />
        </div>

        <div className="mt-5">
          <div className="text-[9px] font-mono uppercase tracking-[0.15em] mb-2.5" style={{ color: "var(--v-ink-dim)" }}>52-Week Range</div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono w-14 text-right flex-shrink-0 tabular-nums" style={{ color: "var(--v-ink-dim)" }}>{fmt$(stock.low52w)}</span>
            <div className="flex-1 relative h-1.5 rounded-full" style={{ background: "var(--v-line-strong)" }}>
              <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: pct52 + "%", background: accent }} />
              <div
                className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 shadow"
                style={{ left: `calc(${pct52}% - 6px)`, borderColor: accent, background: "var(--v-panel)" }}
              />
            </div>
            <span className="text-[10px] font-mono w-14 flex-shrink-0 tabular-nums" style={{ color: "var(--v-ink-dim)" }}>{fmt$(stock.high52w)}</span>
          </div>
          <div className="flex justify-center mt-1.5">
            <span className="text-[10px] font-mono tabular-nums" style={{ color: accent }}>▲ Current: {fmt$(stock.price)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
