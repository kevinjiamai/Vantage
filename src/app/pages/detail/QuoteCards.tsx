import { TextSkeleton } from "../../components/common";
import { G, R, fmt$, fmtChangeAmt, fmtPct } from "../../lib/format";
import { positionProfit, positionProfitPct } from "../../lib/trades";
import type { StockMeta } from "../../lib/stocks";
import type { Holding } from "../../types";

const CARD = "rounded-2xl border px-4 py-2.5 grid gap-x-6 w-[15.75rem]";
const CARD_STYLE = { background: "var(--v-panel)", borderColor: "var(--v-line)" };
const LABEL = "text-[9px] font-mono uppercase tracking-widest";
const VALUE = "font-mono text-sm font-semibold mt-0.5 tabular-nums";

/**
 * One price + change pair. Live, pre-market and after-hours are the same card
 * with different labels; only the live one can be waiting on a first quote.
 */
function PriceCard({
  label, price, change, changePercent, pending = false,
}: {
  label: string;
  price: number;
  change: number;
  changePercent: number;
  pending?: boolean;
}) {
  return (
    <div className={`${CARD} grid-cols-2`} style={CARD_STYLE}>
      <div className="min-w-0">
        <div className={LABEL} style={{ color: "var(--v-ink-dim)" }}>{label}</div>
        {pending
          ? <TextSkeleton width="4rem" height="0.9rem" className="mt-1.5" />
          : <div className={VALUE} style={{ color: "var(--v-ink)" }}>{fmt$(price)}</div>}
      </div>
      <div className="min-w-0">
        <div className={LABEL} style={{ color: "var(--v-ink-dim)" }}>Change</div>
        {pending
          ? <TextSkeleton width="5.5rem" height="0.9rem" className="mt-1.5" />
          : (
            <div className={VALUE} style={{ color: changePercent >= 0 ? G : R }}>
              {fmtChangeAmt(change)} ({fmtPct(changePercent)})
            </div>
          )}
      </div>
    </div>
  );
}

function PositionCard({ holding, price }: { holding: Holding; price: number }) {
  const profit = positionProfit(holding, price);
  const profitPct = positionProfitPct(holding, price);
  return (
    <div className={`${CARD} grid-cols-3 gap-x-5 w-[22.5rem]`} style={CARD_STYLE}>
      <div className="min-w-0">
        <div className={LABEL} style={{ color: "var(--v-ink-dim)" }}>Owned</div>
        <div className={VALUE} style={{ color: "var(--v-ink)" }}>
          {holding.shares.toLocaleString("en-US", { maximumFractionDigits: 4 })} shares
        </div>
      </div>
      <div className="min-w-0">
        <div className={LABEL} style={{ color: "var(--v-ink-dim)" }}>Avg cost</div>
        <div className={VALUE} style={{ color: "var(--v-ink)" }}>{fmt$(holding.avgCost)}</div>
      </div>
      <div className="min-w-0">
        <div className={LABEL} style={{ color: "var(--v-ink-dim)" }}>Profit</div>
        <div className={VALUE} style={{ color: profit >= 0 ? G : R }}>
          {profit >= 0 ? "+" : ""}{fmt$(profit)}
          <span className="text-[11px] font-medium opacity-75 ml-1">{fmtPct(profitPct)}</span>
        </div>
      </div>
    </div>
  );
}

/** The row of price / session / position cards above the chart. */
export function QuoteCards({ stock, holding }: { stock: StockMeta; holding?: Holding }) {
  return (
    <div className="flex flex-wrap gap-2.5">
      <PriceCard
        label={stock.marketState === "REGULAR" ? "Live" : "At Close"}
        price={stock.price}
        change={stock.change}
        changePercent={stock.changePercent}
        pending={!(stock.price > 0)}
      />

      {stock.preMarket && stock.preMarket.price > 0 && (
        <PriceCard
          label="Pre-Market"
          price={stock.preMarket.price}
          change={stock.preMarket.change}
          changePercent={stock.preMarket.changePercent}
        />
      )}

      {stock.afterHours && stock.afterHours.price > 0 && (
        <PriceCard
          label="After Hours"
          price={stock.afterHours.price}
          change={stock.afterHours.change}
          changePercent={stock.afterHours.changePercent}
        />
      )}

      {holding && <PositionCard holding={holding} price={stock.price} />}
    </div>
  );
}
