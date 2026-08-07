import { ChevronLeft, ExternalLink, Minus, Newspaper, Plus } from "lucide-react";
import { useEffect, useState } from "react";

import { GuestSaveBanner } from "../components/auth";
import { DetailChart } from "../components/charts";
import { StatCell, TextSkeleton } from "../components/common";
import { DETAIL_RANGES, RangePicker } from "../components/toolbar";
import { BuySharesDialog, SellSharesDialog } from "../components/trade";
import { useRangeChange } from "../hooks/useRangeChange";
import { G, R, fmt$, fmtCap, fmtChangeAmt, fmtPct, fmtVol } from "../lib/format";
import { type StockMeta, type StockNewsItem, type TimeRange, fetchStockNews } from "../lib/stocks";
import { type Holding } from "../types";
import { positionProfit, positionProfitPct } from "../lib/trades";

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
  const [news, setNews] = useState<StockNewsItem[]>([]);
  const [newsStatus, setNewsStatus] = useState<"loading" | "live" | "empty" | "error">("loading");
  const owned = !!holding && holding.shares > 0;
  const pct52 = Math.max(0, Math.min(100,
    ((stock.price - stock.low52w) / (stock.high52w - stock.low52w)) * 100
  ));
  const profit = holding ? positionProfit(holding, stock.price) : 0;
  const profitPct = holding ? positionProfitPct(holding, stock.price) : 0;

  useEffect(() => {
    let cancelled = false;
    setNewsStatus("loading");
    setNews([]);
    const load = async () => {
      try {
        const items = await fetchStockNews(stock.symbol);
        if (cancelled) return;
        setNews(items);
        setNewsStatus(items.length ? "live" : "empty");
      } catch {
        if (cancelled) return;
        setNews([]);
        setNewsStatus("error");
      }
    };
    void load();
    return () => { cancelled = true; };
  }, [stock.symbol]);

  return (
    <div
      className="@container flex flex-col h-full min-h-0 overflow-auto"
      style={{ scrollbarWidth: "thin", scrollbarColor: "var(--v-line-strong) transparent" }}
    >
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
            onClick={() => setBuyOpen(true)}
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
            onClick={() => owned && setSellOpen(true)}
          >
            <Minus size={12} strokeWidth={2.5} />
            Sell
          </button>
        </div>
      </div>

      {!signedIn && (
        <GuestSaveBanner onSignIn={onSignIn} className="mx-3 @[420px]:mx-5 mt-3" />
      )}

      <div className="flex flex-col gap-3 px-3 @[420px]:px-5 pt-4 pb-6 w-full min-w-0">
        <div className="flex flex-wrap gap-2.5">
          <div
            className="rounded-2xl border px-4 py-2.5 grid grid-cols-2 gap-x-6 w-[15.75rem]"
            style={{ background: "var(--v-panel)", borderColor: "var(--v-line)" }}
          >
            <div className="min-w-0">
              <div className="text-[9px] font-mono uppercase tracking-widest" style={{ color: "var(--v-ink-dim)" }}>
                {stock.marketState === "REGULAR" ? "Live" : "At Close"}
              </div>
              {stock.price > 0 ? (
                <div className="font-mono text-sm font-semibold mt-0.5 tabular-nums" style={{ color: "var(--v-ink)" }}>
                  {fmt$(stock.price)}
                </div>
              ) : (
                <TextSkeleton width="4rem" height="0.9rem" className="mt-1.5" />
              )}
            </div>
            <div className="min-w-0">
              <div className="text-[9px] font-mono uppercase tracking-widest" style={{ color: "var(--v-ink-dim)" }}>Change</div>
              {stock.price > 0 ? (
                <div
                  className="font-mono text-sm font-semibold mt-0.5 tabular-nums"
                  style={{ color: stock.changePercent >= 0 ? G : R }}
                >
                  {fmtChangeAmt(stock.change)} ({fmtPct(stock.changePercent)})
                </div>
              ) : (
                <TextSkeleton width="5.5rem" height="0.9rem" className="mt-1.5" />
              )}
            </div>
          </div>

          {stock.preMarket && stock.preMarket.price > 0 && (
            <div
              className="rounded-2xl border px-4 py-2.5 grid grid-cols-2 gap-x-6 w-[15.75rem]"
              style={{ background: "var(--v-panel)", borderColor: "var(--v-line)" }}
            >
              <div className="min-w-0">
                <div className="text-[9px] font-mono uppercase tracking-widest" style={{ color: "var(--v-ink-dim)" }}>Pre-Market</div>
                <div className="font-mono text-sm font-semibold mt-0.5 tabular-nums" style={{ color: "var(--v-ink)" }}>
                  {fmt$(stock.preMarket.price)}
                </div>
              </div>
              <div className="min-w-0">
                <div className="text-[9px] font-mono uppercase tracking-widest" style={{ color: "var(--v-ink-dim)" }}>Change</div>
                <div
                  className="font-mono text-sm font-semibold mt-0.5 tabular-nums"
                  style={{ color: stock.preMarket.changePercent >= 0 ? G : R }}
                >
                  {fmtChangeAmt(stock.preMarket.change)} ({fmtPct(stock.preMarket.changePercent)})
                </div>
              </div>
            </div>
          )}

          {stock.afterHours && stock.afterHours.price > 0 && (
            <div
              className="rounded-2xl border px-4 py-2.5 grid grid-cols-2 gap-x-6 w-[15.75rem]"
              style={{ background: "var(--v-panel)", borderColor: "var(--v-line)" }}
            >
              <div className="min-w-0">
                <div className="text-[9px] font-mono uppercase tracking-widest" style={{ color: "var(--v-ink-dim)" }}>After Hours</div>
                <div className="font-mono text-sm font-semibold mt-0.5 tabular-nums" style={{ color: "var(--v-ink)" }}>
                  {fmt$(stock.afterHours.price)}
                </div>
              </div>
              <div className="min-w-0">
                <div className="text-[9px] font-mono uppercase tracking-widest" style={{ color: "var(--v-ink-dim)" }}>Change</div>
                <div
                  className="font-mono text-sm font-semibold mt-0.5 tabular-nums"
                  style={{ color: stock.afterHours.changePercent >= 0 ? G : R }}
                >
                  {fmtChangeAmt(stock.afterHours.change)} ({fmtPct(stock.afterHours.changePercent)})
                </div>
              </div>
            </div>
          )}

          {holding && (
            <div
              className="rounded-2xl border px-4 py-2.5 grid grid-cols-3 gap-x-5 w-[22.5rem]"
              style={{ background: "var(--v-panel)", borderColor: "var(--v-line)" }}
            >
              <div className="min-w-0">
                <div className="text-[9px] font-mono uppercase tracking-widest" style={{ color: "var(--v-ink-dim)" }}>Owned</div>
                <div className="font-mono text-sm font-semibold mt-0.5 tabular-nums" style={{ color: "var(--v-ink)" }}>
                  {holding.shares.toLocaleString("en-US", { maximumFractionDigits: 4 })} shares
                </div>
              </div>
              <div className="min-w-0">
                <div className="text-[9px] font-mono uppercase tracking-widest" style={{ color: "var(--v-ink-dim)" }}>Avg cost</div>
                <div className="font-mono text-sm font-semibold mt-0.5 tabular-nums" style={{ color: "var(--v-ink)" }}>{fmt$(holding.avgCost)}</div>
              </div>
              <div className="min-w-0">
                <div className="text-[9px] font-mono uppercase tracking-widest" style={{ color: "var(--v-ink-dim)" }}>Profit</div>
                <div className="font-mono text-sm font-semibold mt-0.5 tabular-nums" style={{ color: profit >= 0 ? G : R }}>
                  {profit >= 0 ? "+" : ""}{fmt$(profit)}
                  <span className="text-[11px] font-medium opacity-75 ml-1">{fmtPct(profitPct)}</span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Wide: Today/Fundamentals beside chart. Narrow: stacked under chart. */}
        <div className="flex flex-col @[640px]:flex-row @[640px]:items-start gap-3 min-w-0">
          <div className="flex-1 min-w-0">
            <div className="flex justify-end mb-2 overflow-x-auto no-scrollbar">
              <RangePicker range={range} setRange={onRangeChange} ranges={DETAIL_RANGES} />
            </div>
            <DetailChart symbol={stock.symbol} range={range} isGain={isGain} lastPrice={stock.price} />
          </div>

          <div className="w-full @[640px]:w-[19.5rem] flex-shrink-0 flex flex-col gap-3">
            <div className="rounded-2xl border p-4" style={{ background: "var(--v-panel)", borderColor: "var(--v-line)" }}>
              <div className="text-[9px] font-mono uppercase tracking-[0.15em] mb-3" style={{ color: "var(--v-ink-dim)" }}>Today</div>
              <div className="grid grid-cols-3 gap-x-4 gap-y-4">
                <StatCell label="Open"    value={fmt$(stock.open)}        />
                <StatCell label="High"    value={fmt$(stock.dayHigh)}     />
                <StatCell label="Low"     value={fmt$(stock.dayLow)}      />
                <StatCell label="Volume"  value={fmtVol(stock.volume)}    />
                <StatCell label="Avg Vol" value={fmtVol(stock.avgVolume)} />
                <StatCell label="Sector"  value={stock.sector}            />
              </div>
            </div>

            <div className="rounded-2xl border p-4" style={{ background: "var(--v-panel)", borderColor: "var(--v-line)" }}>
              <div className="text-[9px] font-mono uppercase tracking-[0.15em] mb-3" style={{ color: "var(--v-ink-dim)" }}>Fundamentals</div>
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
                    <div className="absolute inset-y-0 left-0 rounded-full" style={{ width: pct52 + "%", background: isGain ? G : R }} />
                    <div
                      className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 shadow"
                      style={{ left: `calc(${pct52}% - 6px)`, borderColor: isGain ? G : R, background: "var(--v-panel)" }}
                    />
                  </div>
                  <span className="text-[10px] font-mono w-14 flex-shrink-0 tabular-nums" style={{ color: "var(--v-ink-dim)" }}>{fmt$(stock.high52w)}</span>
                </div>
                <div className="flex justify-center mt-1.5">
                  <span className="text-[10px] font-mono tabular-nums" style={{ color: isGain ? G : R }}>▲ Current: {fmt$(stock.price)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div
          className="rounded-2xl border flex-shrink-0"
          style={{ background: "var(--v-panel)", borderColor: "var(--v-line-strong)" }}
          data-testid="stock-news"
        >
          <div className="px-4 py-3 border-b flex items-center justify-between gap-2" style={{ borderColor: "var(--v-line)" }}>
            <div className="flex items-center gap-2">
              <Newspaper size={14} style={{ color: G }} />
              <div className="text-[11px] font-mono uppercase tracking-[0.12em] font-semibold" style={{ color: "var(--v-ink)" }}>
                Live news
              </div>
            </div>
            <div className="text-[10px] font-mono" style={{ color: "var(--v-ink-dim)" }}>
              {newsStatus === "loading" ? "loading…"
                : newsStatus === "live" ? `${news.length} headline${news.length === 1 ? "" : "s"}`
                : newsStatus === "error" ? "unavailable"
                : "none"}
            </div>
          </div>
          {newsStatus === "loading" && (
            <div className="flex flex-col gap-0">
              {[0, 1, 2].map(i => (
                <div key={i} className="flex gap-3 px-3 py-3 border-b last:border-b-0" style={{ borderColor: "var(--v-line)" }}>
                  <div
                    className="h-14 w-20 rounded-lg flex-shrink-0"
                    style={{ background: "var(--v-line-strong)" }}
                  />
                  <div className="flex-1 flex flex-col gap-2 justify-center">
                    <div className="h-3 rounded" style={{ width: "90%", background: "var(--v-line-strong)" }} />
                    <div className="h-3 rounded" style={{ width: "60%", background: "var(--v-line-strong)" }} />
                  </div>
                </div>
              ))}
            </div>
          )}
          {newsStatus === "error" && (
            <div className="px-4 py-6 text-center text-sm font-mono" style={{ color: "var(--v-ink-dim)" }}>
              News unavailable
            </div>
          )}
          {newsStatus === "empty" && (
            <div className="px-4 py-6 text-center text-sm font-mono" style={{ color: "var(--v-ink-dim)" }}>
              No recent headlines
            </div>
          )}
          {newsStatus === "live" && (
            <div className="flex flex-col">
              {news.map((item, idx) => (
                <a
                  key={item.id || `${item.url}-${idx}`}
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex gap-3 px-3 py-3 transition-colors hover:bg-white/5 border-b last:border-b-0"
                  style={{ borderColor: "var(--v-line)" }}
                >
                  <div
                    className="h-14 w-20 rounded-lg overflow-hidden flex-shrink-0 border flex items-center justify-center"
                    style={{ background: "var(--v-line)", borderColor: "var(--v-line-strong)" }}
                  >
                    {item.image ? (
                      <img
                        src={item.image}
                        alt=""
                        className="w-full h-full object-cover"
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        onError={e => {
                          const el = e.currentTarget;
                          if (item.rawImage && el.dataset.fallback !== "1") {
                            el.dataset.fallback = "1";
                            el.src = item.rawImage;
                            return;
                          }
                          el.style.visibility = "hidden";
                        }}
                      />
                    ) : (
                      <Newspaper size={18} style={{ color: "var(--v-ink-dim)" }} />
                    )}
                  </div>
                  <div className="min-w-0 flex-1 self-center">
                    <div className="text-[12px] font-medium leading-snug" style={{ color: "var(--v-ink)" }}>
                      {item.title}
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-[10px] font-mono" style={{ color: "var(--v-ink-dim)" }}>
                      <span className="truncate">{item.publisher || "Yahoo Finance"}</span>
                      <ExternalLink size={10} className="flex-shrink-0 opacity-70" />
                    </div>
                  </div>
                </a>
              ))}
            </div>
          )}
        </div>

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
