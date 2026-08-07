import { describe, expect, it } from "vitest";
import {
  SHARE_EPSILON, applyBuy, applySell, newTransaction,
  positionProfit, positionProfitPct, positionValue,
} from "./trades";
import type { Holding } from "../types";

const AAPL: Holding = { symbol: "AAPL", shares: 10, avgCost: 100 };
const MSFT: Holding = { symbol: "MSFT", shares: 5, avgCost: 400 };

describe("applyBuy", () => {
  it("opens a new position at the fill price", () => {
    expect(applyBuy([], "AAPL", 3, 150)).toEqual([{ symbol: "AAPL", shares: 3, avgCost: 150 }]);
  });

  it("blends average cost on a second fill", () => {
    // 10 @ 100 then 10 @ 200 => 20 shares, avg 150
    const [h] = applyBuy([AAPL], "AAPL", 10, 200);
    expect(h.shares).toBe(20);
    expect(h.avgCost).toBe(150);
  });

  it("weights the average by size, not by fill count", () => {
    // 10 @ 100 then 90 @ 200 => avg 190, not 150
    const [h] = applyBuy([AAPL], "AAPL", 90, 200);
    expect(h.shares).toBe(100);
    expect(h.avgCost).toBeCloseTo(190, 10);
  });

  it("leaves average cost unchanged when buying at the same price", () => {
    const [h] = applyBuy([AAPL], "AAPL", 5, 100);
    expect(h.avgCost).toBe(100);
    expect(h.shares).toBe(15);
  });

  it("handles fractional shares", () => {
    const [h] = applyBuy([{ symbol: "X", shares: 0.5, avgCost: 10 }], "X", 0.25, 20);
    expect(h.shares).toBeCloseTo(0.75, 10);
    expect(h.avgCost).toBeCloseTo((10 * 0.5 + 20 * 0.25) / 0.75, 10);
  });

  it("touches only the target symbol", () => {
    const out = applyBuy([AAPL, MSFT], "AAPL", 10, 200);
    expect(out.find(h => h.symbol === "MSFT")).toEqual(MSFT);
  });

  it("does not mutate the input", () => {
    const input = [{ ...AAPL }];
    applyBuy(input, "AAPL", 10, 200);
    expect(input[0]).toEqual(AAPL);
  });
});

describe("applySell", () => {
  it("reduces share count and preserves average cost", () => {
    const [h] = applySell([AAPL], "AAPL", 4);
    expect(h.shares).toBe(6);
    expect(h.avgCost).toBe(100); // selling never changes what the rest cost
  });

  it("removes the position when sold in full", () => {
    expect(applySell([AAPL], "AAPL", 10)).toEqual([]);
  });

  it("removes the position when float residue is left behind", () => {
    // 0.1 * 3 !== 0.30000000000000004, so this leaves ~-4e-17 shares
    const h: Holding = { symbol: "X", shares: 0.1 + 0.1 + 0.1, avgCost: 1 };
    expect(applySell([h], "X", 0.3)).toEqual([]);
  });

  it("keeps a position that is genuinely above the epsilon", () => {
    const h: Holding = { symbol: "X", shares: 1, avgCost: 1 };
    const out = applySell([h], "X", 1 - SHARE_EPSILON * 10);
    expect(out).toHaveLength(1);
    expect(out[0].shares).toBeGreaterThan(SHARE_EPSILON);
  });

  it("closes a position when oversold rather than going negative", () => {
    expect(applySell([AAPL], "AAPL", 999)).toEqual([]);
  });

  it("touches only the target symbol", () => {
    expect(applySell([AAPL, MSFT], "AAPL", 10)).toEqual([MSFT]);
  });

  it("is a no-op for an unknown symbol", () => {
    expect(applySell([AAPL], "TSLA", 5)).toEqual([AAPL]);
  });

  it("does not mutate the input", () => {
    const input = [{ ...AAPL }];
    applySell(input, "AAPL", 4);
    expect(input[0]).toEqual(AAPL);
  });
});

describe("round trip", () => {
  it("returns to an empty book after buying then selling everything", () => {
    let book: Holding[] = [];
    book = applyBuy(book, "AAPL", 5, 100);
    book = applyBuy(book, "AAPL", 5, 200);
    expect(book[0].avgCost).toBe(150);
    book = applySell(book, "AAPL", 10);
    expect(book).toEqual([]);
  });

  it("survives many fractional sells without leaving a phantom row", () => {
    let book = applyBuy([], "X", 1, 10);
    for (let i = 0; i < 10; i++) book = applySell(book, "X", 0.1);
    expect(book).toEqual([]);
  });
});

describe("position math", () => {
  it("values a position at the live price", () => {
    expect(positionValue(AAPL, 120)).toBe(1200);
  });

  it("computes gain and loss in dollars", () => {
    expect(positionProfit(AAPL, 120)).toBe(200);
    expect(positionProfit(AAPL, 80)).toBe(-200);
  });

  it("computes gain and loss as a percentage of cost", () => {
    expect(positionProfitPct(AAPL, 120)).toBeCloseTo(20, 10);
    expect(positionProfitPct(AAPL, 80)).toBeCloseTo(-20, 10);
  });

  it("returns 0% rather than Infinity when average cost is zero", () => {
    const free: Holding = { symbol: "F", shares: 1, avgCost: 0 };
    expect(positionProfitPct(free, 100)).toBe(0);
    expect(Number.isFinite(positionProfitPct(free, 100))).toBe(true);
  });
});

describe("newTransaction", () => {
  it("stamps type, amount and timestamp", () => {
    const tx = newTransaction("deposit", 500);
    expect(tx.type).toBe("deposit");
    expect(tx.amount).toBe(500);
    expect(typeof tx.timestamp).toBe("number");
  });

  it("carries trade details when given", () => {
    const tx = newTransaction("buy", 1000, { symbol: "AAPL", shares: 5, price: 200 });
    expect(tx).toMatchObject({ type: "buy", symbol: "AAPL", shares: 5, price: 200 });
  });

  it("omits trade details for a plain deposit", () => {
    const tx = newTransaction("deposit", 500);
    expect(tx.symbol).toBeUndefined();
    expect(tx.shares).toBeUndefined();
  });

  it("gives unique ids even within the same millisecond", () => {
    // Date.now() alone collided here, producing duplicate React keys.
    const ids = Array.from({ length: 200 }, () => newTransaction("deposit", 1).id);
    expect(new Set(ids).size).toBe(200);
  });
});
