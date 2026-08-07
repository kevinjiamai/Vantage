import { useState } from "react";

import { GuestSaveBanner } from "../components/auth";
import { DetailChart } from "../components/charts";
import { DETAIL_RANGES, RangePicker } from "../components/toolbar";
import { BuySharesDialog, SellSharesDialog } from "../components/trade";
import { useRangeChange } from "../hooks/useRangeChange";
import { type StockMeta, type TimeRange } from "../lib/stocks";
import { type Holding } from "../types";
import { DetailHeader } from "./detail/DetailHeader";
import { NewsFeed } from "./detail/NewsFeed";
import { QuoteCards } from "./detail/QuoteCards";
import { StatsPanel } from "./detail/StatsPanel";

export function StockDetailView({
  stock, range, holding, balance, onBack, onRangeChange, onBuy, onSell, signedIn, onSignIn,
}: {
  stock: StockMeta;
  range: TimeRange;
  holding?: Holding;
  balance: number;
  onBack: () => void;
  onRangeChange: (r: TimeRange) => void;
  onBuy: (shares: number) => void;
  onSell: (shares: number) => void;
  signedIn: boolean;
  onSignIn: () => void;
}) {
  const delta = useRangeChange(stock.symbol, range, stock);
  const isGain = delta.changePercent >= 0;
  const [buyOpen, setBuyOpen] = useState(false);
  const [sellOpen, setSellOpen] = useState(false);
  const owned = !!holding && holding.shares > 0;

  return (
    <div
      className="@container flex flex-col h-full min-h-0 overflow-auto"
      style={{ scrollbarWidth: "thin", scrollbarColor: "var(--v-line-strong) transparent" }}
    >
      <DetailHeader
        stock={stock}
        owned={owned}
        onBack={onBack}
        onBuy={() => setBuyOpen(true)}
        onSell={() => setSellOpen(true)}
      />

      {!signedIn && (
        <GuestSaveBanner onSignIn={onSignIn} className="mx-3 @[420px]:mx-5 mt-3" />
      )}

      <div className="flex flex-col gap-3 px-3 @[420px]:px-5 pt-4 pb-6 w-full min-w-0">
        <QuoteCards stock={stock} holding={holding} />

        {/* Wide: Today/Fundamentals beside chart. Narrow: stacked under chart. */}
        <div className="flex flex-col @[640px]:flex-row @[640px]:items-start gap-3 min-w-0">
          <div className="flex-1 min-w-0">
            <div className="flex justify-end mb-2 overflow-x-auto no-scrollbar">
              <RangePicker range={range} setRange={onRangeChange} ranges={DETAIL_RANGES} />
            </div>
            <DetailChart symbol={stock.symbol} range={range} isGain={isGain} lastPrice={stock.price} />
          </div>

          <StatsPanel stock={stock} isGain={isGain} />
        </div>

        <NewsFeed symbol={stock.symbol} />

        <div
          className="px-3 py-2.5 rounded-xl text-[11px] font-mono"
          style={{ background: "var(--v-line)", color: "var(--v-ink-dim)" }}
        >
          Live market data via yfinance
        </div>
      </div>

      {buyOpen && (
        <BuySharesDialog
          stock={stock}
          balance={balance}
          onClose={() => setBuyOpen(false)}
          onBuy={onBuy}
        />
      )}
      {sellOpen && holding && (
        <SellSharesDialog
          stock={stock}
          holding={holding}
          onClose={() => setSellOpen(false)}
          onSell={onSell}
        />
      )}
    </div>
  );
}
