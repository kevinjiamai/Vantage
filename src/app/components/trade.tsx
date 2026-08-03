import { useState } from "react";
import { DialogShell } from "./common";
import { G, R, fmt$ } from "../lib/format";
import { type StockMeta } from "../lib/stocks";

import { type Holding } from "../types";

export const DEPOSIT_MIN = 1;

export const DEPOSIT_MAX = 1_000_000;

export function DepositDialog({ onClose, onDeposit }: { onClose: () => void; onDeposit: (amount: number) => void }) {
  const [raw, setRaw] = useState("");
  const amount = parseFloat(raw);
  const valid = Number.isFinite(amount) && amount >= DEPOSIT_MIN && amount <= DEPOSIT_MAX;
  const outOfRange = raw !== "" && Number.isFinite(amount) && !valid;

  return (
    <DialogShell
      title="Add Money"
      onClose={onClose}
      footer={
        <>
          <button
            className="px-3.5 py-2 rounded-lg text-xs font-medium transition-colors hover:bg-white/5"
            style={{ color: "var(--v-ink-soft)" }}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="px-4 py-2 rounded-lg text-xs font-semibold transition-opacity disabled:opacity-40"
            style={{ background: G, color: "#0a0a0a" }}
            disabled={!valid}
            onClick={() => { if (valid) { onDeposit(amount); onClose(); } }}
          >
            Deposit
          </button>
        </>
      }
    >
      <label className="block text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: "var(--v-ink-dim)" }}>
        Amount (USD)
      </label>
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm" style={{ color: "var(--v-ink-dim)" }}>$</span>
        <input
          autoFocus
          type="number"
          min="0"
          step="0.01"
          value={raw}
          onChange={e => setRaw(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && valid) { onDeposit(amount); onClose(); } }}
          placeholder="0.00"
          className="w-full pl-7 pr-3 py-2.5 rounded-xl text-sm font-mono outline-none"
          style={{ background: "var(--v-line)", color: "var(--v-ink)", border: "1px solid var(--v-line-strong)" }}
        />
      </div>
      <div className="mt-2 text-[11px] font-mono" style={{ color: outOfRange ? R : "var(--v-ink-dim)" }}>
        {outOfRange
          ? `Amount must be between ${fmt$(DEPOSIT_MIN)} and ${fmt$(DEPOSIT_MAX)}`
          : `Enter an amount between ${fmt$(DEPOSIT_MIN)} and ${fmt$(DEPOSIT_MAX)}`}
      </div>
    </DialogShell>
  );
}

export function BuySharesDialog({
  stock, balance, onClose, onBuy,
}: {
  stock: StockMeta;
  balance: number;
  onClose: () => void;
  onBuy: (shares: number) => void;
}) {
  const [raw, setRaw] = useState("1");
  const shares = parseFloat(raw);
  const cost = Number.isFinite(shares) && shares > 0 ? shares * stock.price : 0;
  const valid = Number.isFinite(shares) && shares > 0 && cost <= balance;

  return (
    <DialogShell
      title={`Buy ${stock.symbol}`}
      onClose={onClose}
      footer={
        <>
          <button
            className="px-3.5 py-2 rounded-lg text-xs font-medium transition-colors hover:bg-white/5"
            style={{ color: "var(--v-ink-soft)" }}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="px-4 py-2 rounded-lg text-xs font-semibold transition-opacity disabled:opacity-40"
            style={{ background: G, color: "#0a0a0a" }}
            disabled={!valid}
            onClick={() => { if (valid) { onBuy(shares); onClose(); } }}
          >
            Buy shares
          </button>
        </>
      }
    >
      <div className="flex justify-between text-xs mb-4 font-mono" style={{ color: "var(--v-ink-soft)" }}>
        <span>{fmt$(stock.price)} / share</span>
        <span>Bank {fmt$(balance)}</span>
      </div>
      <label className="block text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: "var(--v-ink-dim)" }}>
        Shares
      </label>
      <input
        autoFocus
        type="number"
        min="0"
        step="any"
        value={raw}
        onChange={e => setRaw(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter" && valid) { onBuy(shares); onClose(); } }}
        className="w-full px-3 py-2.5 rounded-xl text-sm font-mono outline-none"
        style={{ background: "var(--v-line)", color: "var(--v-ink)", border: "1px solid var(--v-line-strong)" }}
      />
      <div className="mt-3 flex justify-between text-xs font-mono">
        <span style={{ color: "var(--v-ink-dim)" }}>Total</span>
        <span style={{ color: cost > balance ? R : "var(--v-ink)" }}>{fmt$(cost)}</span>
      </div>
      {cost > balance && (
        <div className="mt-2 text-[11px] font-mono" style={{ color: R }}>Insufficient bank balance</div>
      )}
    </DialogShell>
  );
}

export function SellSharesDialog({
  stock, holding, onClose, onSell,
}: {
  stock: StockMeta;
  holding: Holding;
  onClose: () => void;
  onSell: (shares: number) => void;
}) {
  const [raw, setRaw] = useState("1");
  const shares = parseFloat(raw);
  const proceeds = Number.isFinite(shares) && shares > 0 ? shares * stock.price : 0;
  const valid = Number.isFinite(shares) && shares > 0 && shares <= holding.shares;

  return (
    <DialogShell
      title={`Sell ${stock.symbol}`}
      onClose={onClose}
      footer={
        <>
          <button
            className="px-3.5 py-2 rounded-lg text-xs font-medium transition-colors hover:bg-white/5"
            style={{ color: "var(--v-ink-soft)" }}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="px-4 py-2 rounded-lg text-xs font-semibold transition-opacity disabled:opacity-40"
            style={{ background: R, color: "#0a0a0a" }}
            disabled={!valid}
            onClick={() => { if (valid) { onSell(shares); onClose(); } }}
          >
            Sell shares
          </button>
        </>
      }
    >
      <div className="flex justify-between text-xs mb-4 font-mono" style={{ color: "var(--v-ink-soft)" }}>
        <span>{fmt$(stock.price)} / share</span>
        <span>
          Owned {holding.shares.toLocaleString("en-US", { maximumFractionDigits: 4 })}
        </span>
      </div>
      <label className="block text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: "var(--v-ink-dim)" }}>
        Shares
      </label>
      <div className="relative">
        <input
          autoFocus
          type="number"
          min="0"
          step="any"
          value={raw}
          onChange={e => setRaw(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && valid) { onSell(shares); onClose(); } }}
          className="w-full px-3 py-2.5 pr-14 rounded-xl text-sm font-mono outline-none"
          style={{ background: "var(--v-line)", color: "var(--v-ink)", border: "1px solid var(--v-line-strong)" }}
        />
        <button
          className="absolute right-2 top-1/2 -translate-y-1/2 px-2 py-1 rounded-md text-[10px] font-mono font-semibold hover:bg-white/10 transition-colors"
          style={{ background: "var(--v-line-strong)", color: "var(--v-ink-soft)" }}
          onClick={() => setRaw(String(holding.shares))}
        >
          MAX
        </button>
      </div>
      <div className="mt-3 flex justify-between text-xs font-mono">
        <span style={{ color: "var(--v-ink-dim)" }}>Proceeds</span>
        <span style={{ color: "var(--v-ink)" }}>{fmt$(proceeds)}</span>
      </div>
      {Number.isFinite(shares) && shares > holding.shares && (
        <div className="mt-2 text-[11px] font-mono" style={{ color: R }}>You only own {holding.shares.toLocaleString("en-US", { maximumFractionDigits: 4 })} shares</div>
      )}
    </DialogShell>
  );
}
