import type { TimeRange } from "./stocks";

// ─── Palette ───────────────────────────────────────────────────────────────────

/** Gain / positive. */
export const G = "#34d399";
/** Loss / negative. */
export const R = "#f87171";

// ─── Formatters ────────────────────────────────────────────────────────────────

export const fmt$ = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmtPct = (n: number) => (n >= 0 ? "+" : "") + n.toFixed(2) + "%";

export const fmtChangeAmt = (n: number) => (n >= 0 ? "+" : "-") + fmt$(Math.abs(n));

export const fmtVol = (n: number) => {
  if (n >= 1e9) return (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6) return (n / 1e6).toFixed(1) + "M";
  if (n >= 1e3) return (n / 1e3).toFixed(0) + "K";
  return String(n);
};

export const fmtCap = (n: number) => {
  if (n >= 1e12) return "$" + (n / 1e12).toFixed(2) + "T";
  if (n >= 1e9)  return "$" + (n / 1e9).toFixed(1) + "B";
  if (n >= 1e6)  return "$" + (n / 1e6).toFixed(1) + "M";
  return "$" + n.toFixed(0);
};

export const fmtTime = (t: number, range: TimeRange) => {
  const d = new Date(t);
  if (range === "1D") return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  if (range === "1W" || range === "1M" || range === "3M") {
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  if (range === "6M" || range === "YTD") {
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  }
  if (range === "1Y") {
    return d.toLocaleDateString("en-US", { month: "short" });
  }
  if (range === "2Y") {
    return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
  }
  // 5Y / 10Y / ALL
  return d.toLocaleDateString("en-US", { year: "numeric" });
};

export const fmtPriceTick = (p: number, min: number, max: number) => {
  const spread = max - min;
  if (spread < 1) return "$" + p.toFixed(2);
  if (spread < 20) return "$" + p.toFixed(1);
  if (p >= 1000) return "$" + p.toFixed(0);
  return "$" + p.toFixed(0);
};

export const fmtWhen = (t: number) =>
  new Date(t).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

// ─── Chart axis helpers ────────────────────────────────────────────────────────

/** Tight Y domain so sparklines show real movement (not scaled from $0). */
export function priceDomain(points: { p: number }[]): [number, number] {
  const prices = points.map(d => d.p).filter(Number.isFinite);
  if (!prices.length) return [0, 1];
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  if (min === max) {
    const pad = Math.max(Math.abs(min) * 0.01, 0.5);
    return [min - pad, max + pad];
  }
  const pad = (max - min) * 0.12;
  return [min - pad, max + pad];
}

/** Evenly spaced ticks in time (constant visual spacing on a linear X axis). */
export function evenTimeTicks(t0: number, t1: number, count: number): number[] {
  if (!(t1 > t0) || count < 2) return [t0];
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    out.push(t0 + (i / (count - 1)) * (t1 - t0));
  }
  return out;
}
