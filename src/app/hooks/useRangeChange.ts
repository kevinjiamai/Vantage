import { useEffect, useRef, useState } from "react";
import { type StockMeta, type TimeRange, fetchHistory, getHistory, quoteChangeForRange } from "../lib/stocks";

/** Live $/% change for the selected chart range (1D = day quote). */
export function useRangeChange(symbol: string, range: TimeRange, stock: StockMeta, refreshKey = 0) {
  const [delta, setDelta] = useState(() => quoteChangeForRange(symbol, range, stock));
  const [loading, setLoading] = useState(() => {
    if (range === "1D") return false;
    return getHistory(symbol, range, stock.price).length < 2
      && getHistory(symbol, range, stock.price, { resolution: "spark" }).length < 2;
  });
  const stockRef = useRef(stock);
  stockRef.current = stock;

  useEffect(() => {
    let cancelled = false;
    const s = stockRef.current;

    if (range === "1D") {
      setDelta({ change: s.change, changePercent: s.changePercent });
      setLoading(false);
      return;
    }

    // Hold previous delta + show loading until spark history for this range is ready
    setLoading(true);
    fetchHistory(symbol, range, s.price, { resolution: "spark" })
      .then(() => {
        if (cancelled) return;
        setDelta(quoteChangeForRange(symbol, range, stockRef.current));
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setDelta(quoteChangeForRange(symbol, range, stockRef.current));
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [symbol, range, refreshKey]);

  // Keep 1D day-change in sync when quote updates (without flashing loaders)
  useEffect(() => {
    if (range !== "1D") return;
    setDelta({ change: stock.change, changePercent: stock.changePercent });
  }, [range, stock.change, stock.changePercent]);

  return { change: delta.change, changePercent: delta.changePercent, loading };
}
