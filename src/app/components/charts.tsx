import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartSkeleton } from "./common";

import { G, R, fmt$, fmtPriceTick, fmtTime, fmtVol, priceDomain } from "../lib/format";
import { type TimeRange, downsampleLTTB, fetchHistory, getHistory, sparklineMaxPoints } from "../lib/stocks";

export function MiniSparkline({ symbol, range, isGain, height = 52, lastPrice, refreshKey = 0 }: {
  symbol: string; range: TimeRange; isGain: boolean; height?: number; lastPrice?: number; refreshKey?: number;
}) {
  const [data, setData] = useState(() => getHistory(symbol, range, lastPrice, { resolution: "spark" }));
  const [loading, setLoading] = useState(() => getHistory(symbol, range, lastPrice, { resolution: "spark" }).length < 2);
  const uid = useId();
  const gradId = `spark-${uid}`;
  const chartData = useMemo(
    () => downsampleLTTB(data, sparklineMaxPoints(range)),
    [data, range],
  );
  const seriesGain = chartData.length >= 2 ? chartData[chartData.length - 1].p >= chartData[0].p : isGain;
  const color = seriesGain ? G : R;
  const domain = useMemo(() => priceDomain(chartData), [chartData]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchHistory(symbol, range, lastPrice, { resolution: "spark" }).then(pts => {
      if (cancelled) return;
      setData(pts);
      setLoading(false);
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [symbol, range, lastPrice, refreshKey]);

  if (loading || chartData.length < 2) {
    return <ChartSkeleton height={height} className="rounded-md" />;
  }

  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={chartData} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor={color} stopOpacity={0.18} />
            <stop offset="95%" stopColor={color} stopOpacity={0}    />
          </linearGradient>
        </defs>
        {/* Critical: without a tight domain, Recharts scales from 0 → flat line */}
        <YAxis hide domain={domain} />
        <Area
          type="linear" dataKey="p"
          stroke={color} strokeWidth={1.5}
          fill={`url(#${gradId})`}
          dot={false} isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function DetailChart({ symbol, range, isGain, lastPrice }: { symbol: string; range: TimeRange; isGain: boolean; lastPrice?: number }) {
  const [data, setData] = useState(() => getHistory(symbol, range, lastPrice));
  const [loading, setLoading] = useState(() => getHistory(symbol, range, lastPrice).length < 2);
  const uid = useId();
  const gradId = `dc-${uid}`;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchHistory(symbol, range, lastPrice)
      .then(pts => {
        if (!cancelled) { setData(pts); setLoading(false); }
      })
      .catch(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [symbol, range, lastPrice]);

  // Plot by index (not timestamp) so overnight/weekend gaps don't render as long straight lines
  const indexed = useMemo(
    () => data.map((d, i) => ({ t: d.t, p: d.p, v: typeof d.v === "number" ? d.v : 0, i })),
    [data],
  );
  const seriesGain = data.length >= 2 ? data[data.length - 1].p >= data[0].p : isGain;
  const color = seriesGain ? G : R;
  const domain = useMemo(() => priceDomain(data), [data]);
  const [yMin, yMax] = domain;
  const narrow = width > 0 && width < 360;
  const compact = width > 0 && width < 480;
  const chartH = narrow ? 180 : compact ? 210 : 260;
  const yAxisW = narrow ? 36 : compact ? 44 : 56;
  const chartMargin = narrow
    ? { top: 4, right: 2, bottom: 16, left: 0 }
    : compact
      ? { top: 6, right: 6, bottom: 18, left: 4 }
      : { top: 8, right: 12, bottom: 22, left: 18 };
  const xTicks = useMemo(() => {
    if (data.length < 2) return [];
    const n = data.length;
    const count = Math.min(narrow ? 4 : compact ? 5 : 6, n);
    const out: number[] = [];
    for (let k = 0; k < count; k++) {
      out.push(Math.round((k / (count - 1)) * (n - 1)));
    }
    return [...new Set(out)];
  }, [data, narrow, compact]);
  const yTicks = useMemo(() => {
    const [lo, hi] = domain;
    if (!(hi > lo)) return [lo];
    if (narrow) return [lo, hi];
    return [lo, lo + (hi - lo) / 3, lo + (2 * (hi - lo)) / 3, hi];
  }, [domain, narrow]);

  if (loading) {
    return (
      <div ref={wrapRef}>
        <ChartSkeleton height={chartH || 220} />
      </div>
    );
  }

  if (data.length < 2) {
    return (
      <div ref={wrapRef} className="flex items-center justify-center font-mono text-xs" style={{ height: chartH || 220, color: "var(--v-ink-dim)" }}>
        No chart data
      </div>
    );
  }

  return (
    <div ref={wrapRef}>
      <ResponsiveContainer width="100%" height={chartH}>
        <AreaChart data={indexed} margin={chartMargin}>
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={color} stopOpacity={0.25} />
              <stop offset="95%" stopColor={color} stopOpacity={0}    />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="i"
            type="number"
            domain={[0, indexed.length - 1]}
            ticks={xTicks}
            tickFormatter={i => {
              const pt = indexed[Number(i)];
              return pt ? fmtTime(pt.t, range) : "";
            }}
            tick={{ fontFamily: "Geist Mono, monospace", fontSize: narrow ? 9 : 10, fill: "var(--v-ink-dim)" }}
            axisLine={false}
            tickLine={false}
            tickMargin={narrow ? 8 : 12}
            padding={{ left: narrow ? 2 : 8, right: narrow ? 2 : 8 }}
            interval={0}
          />
          <YAxis
            dataKey="p"
            domain={domain}
            ticks={yTicks}
            tickFormatter={p => fmtPriceTick(Number(p), yMin, yMax)}
            tick={{ fontFamily: "Geist Mono, monospace", fontSize: narrow ? 9 : 10, fill: "var(--v-ink-dim)" }}
            axisLine={false}
            tickLine={false}
            width={yAxisW}
            orientation="right"
          />
          <Tooltip
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null;
              const row = (payload.find(p => p.payload)?.payload ?? payload[0].payload) as {
                t: number; p: number; v?: number;
              };
              const vol = typeof row.v === "number" ? row.v : 0;
              return (
                <div
                  className="px-2.5 py-2 rounded-xl border text-xs font-mono shadow-xl"
                  style={{ background: "var(--v-panel)", borderColor: "var(--v-line-strong)", color: "var(--v-ink)" }}
                >
                  <div className="mb-0.5" style={{ color: "var(--v-ink-dim)" }}>{fmtTime(row.t, range)}</div>
                  <div className="font-semibold">{fmt$(row.p)}</div>
                  <div className="mt-0.5" style={{ color: "var(--v-ink-dim)" }}>
                    Vol {vol > 0 ? fmtVol(vol) : "—"}
                  </div>
                </div>
              );
            }}
          />
          <Area type="linear" dataKey="p" stroke={color} strokeWidth={1.5} fill={`url(#${gradId})`} dot={false} isAnimationActive={false} />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
