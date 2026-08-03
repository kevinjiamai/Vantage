import { TextSkeleton } from "./common";
import { G, R, fmt$, fmtPct } from "../lib/format";
import { type StockMeta } from "../lib/stocks";

export function MarketStrip({ stocks, status }: { stocks: StockMeta[]; status: "loading" | "live" | "stale" | "error" }) {
  const indices = stocks.filter(s => ["SPY", "QQQ", "GLD"].includes(s.symbol));
  const statusLabel =
    status === "loading" ? "loading…"
    : status === "error" ? "yfinance offline"
    : status === "stale" ? "delayed"
    : "yfinance";
  return (
    <div
      className="flex items-center gap-5 px-5 py-1.5 border-b overflow-x-auto no-scrollbar"
      style={{ borderColor: "var(--v-line)", background: "var(--v-panel)" }}
    >
      {status === "loading" && indices.every(s => s.price <= 0) ? (
        <>
          {["SPY", "QQQ", "GLD"].map(sym => (
            <div key={sym} className="flex items-center gap-2 flex-shrink-0">
              <span className="text-[11px] font-mono" style={{ color: "var(--v-ink-soft)" }}>{sym}</span>
              <TextSkeleton width="3.25rem" height="0.65rem" />
              <TextSkeleton width="2.5rem" height="0.65rem" />
            </div>
          ))}
        </>
      ) : (
        indices.map(s => (
          <div key={s.symbol} className="flex items-center gap-2 flex-shrink-0 text-[11px] font-mono">
            <span style={{ color: "var(--v-ink-soft)" }}>{s.symbol}</span>
            {s.price > 0 ? (
              <>
                <span style={{ color: "var(--v-ink)" }}>{fmt$(s.price)}</span>
                <span style={{ color: s.changePercent >= 0 ? G : R }}>{fmtPct(s.changePercent)}</span>
              </>
            ) : (
              <>
                <TextSkeleton width="3.25rem" height="0.65rem" />
                <TextSkeleton width="2.5rem" height="0.65rem" />
              </>
            )}
          </div>
        ))
      )}
      <div className="ml-auto text-[10px] font-mono flex-shrink-0" style={{ color: "var(--v-ink-dim)" }}>
        {new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" })} ET ·{" "}
        {statusLabel}
      </div>
    </div>
  );
}
