import { ChevronLeft, ChevronRight, Landmark, Plus, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { GuestSaveBanner, SyncErrorBanner } from "../components/auth";
import { DepositDialog } from "../components/trade";
import { G, R, fmt$, fmtWhen } from "../lib/format";
import { type Transaction } from "../types";

export function BankPage({
  balance, transactions, onDeposit, signedIn, onSignIn, syncFailed, onRetrySync,
}: {
  balance: number;
  transactions: Transaction[];
  onDeposit: (amount: number) => void;
  signedIn: boolean;
  onSignIn: () => void;
  syncFailed: boolean;
  onRetrySync: () => void;
}) {
  const [depositOpen, setDepositOpen] = useState(false);
  const TX_PAGE = 6;
  const [txPage, setTxPage] = useState(0);
  const txPages = Math.max(1, Math.ceil(transactions.length / TX_PAGE));

  useEffect(() => {
    setTxPage(p => Math.min(p, Math.max(0, txPages - 1)));
  }, [txPages]);

  const pageTx = transactions.slice(txPage * TX_PAGE, txPage * TX_PAGE + TX_PAGE);

  return (
    <div className="flex-1 overflow-y-auto p-5" style={{ scrollbarWidth: "thin", scrollbarColor: "var(--v-line-strong) transparent" }}>
      <div className="max-w-2xl mx-auto flex flex-col gap-4">
        {syncFailed
          ? <SyncErrorBanner onRetry={onRetrySync} />
          : !signedIn && <GuestSaveBanner onSignIn={onSignIn} />}

        <div className="rounded-2xl border p-6" style={{ background: "var(--v-panel)", borderColor: "var(--v-line)" }}>
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: "var(--v-ink-dim)" }}>
                <Landmark size={12} /> Bank balance
              </div>
              <div className="font-mono text-3xl font-semibold tracking-tight" style={{ color: "var(--v-ink)" }}>
                {fmt$(balance)}
              </div>
            </div>
            <button
              className="px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-1.5 flex-shrink-0"
              style={{ background: G, color: "#0a0a0a" }}
              onClick={() => setDepositOpen(true)}
            >
              <Plus size={12} strokeWidth={2.5} />
              Add money
            </button>
          </div>
        </div>

        <div className="rounded-2xl border overflow-hidden" style={{ background: "var(--v-panel)", borderColor: "var(--v-line)" }}>
          <div className="px-5 py-3.5 border-b flex items-center justify-between gap-3" style={{ borderColor: "var(--v-line)" }}>
            <div className="text-[10px] font-mono uppercase tracking-widest" style={{ color: "var(--v-ink-dim)" }}>
              Transaction history
            </div>
            {transactions.length > 0 && (
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  className="w-7 h-7 rounded-md flex items-center justify-center transition-opacity disabled:opacity-30 hover:bg-white/5"
                  style={{ color: "var(--v-ink-soft)", border: "1px solid var(--v-line-strong)" }}
                  disabled={txPage <= 0}
                  onClick={() => setTxPage(p => Math.max(0, p - 1))}
                  aria-label="Previous transactions"
                >
                  <ChevronLeft size={14} />
                </button>
                <span className="text-[11px] font-mono tabular-nums min-w-[3.5rem] text-center" style={{ color: "var(--v-ink-dim)" }}>
                  {txPage + 1}/{txPages}
                </span>
                <button
                  type="button"
                  className="w-7 h-7 rounded-md flex items-center justify-center transition-opacity disabled:opacity-30 hover:bg-white/5"
                  style={{ color: "var(--v-ink-soft)", border: "1px solid var(--v-line-strong)" }}
                  disabled={txPage >= txPages - 1}
                  onClick={() => setTxPage(p => Math.min(txPages - 1, p + 1))}
                  aria-label="Next transactions"
                >
                  <ChevronRight size={14} />
                </button>
              </div>
            )}
          </div>
          {transactions.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm font-mono" style={{ color: "var(--v-ink-dim)" }}>
              No transactions yet
            </div>
          ) : (
            <div className="divide-y" style={{ borderColor: "var(--v-line)" }}>
              {pageTx.map(tx => {
                const isBuy = tx.type === "buy";
                const inflow = !isBuy; // deposits and sells add money
                const sharesStr = tx.shares?.toLocaleString("en-US", { maximumFractionDigits: 4 });
                return (
                  <div key={tx.id} className="flex items-center gap-3 px-5 py-3.5" style={{ borderColor: "var(--v-line)" }}>
                    <div
                      className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ background: inflow ? "rgba(52,211,153,0.12)" : "rgba(248,113,130,0.12)" }}
                    >
                      {tx.type === "deposit" && <Wallet size={14} style={{ color: G }} />}
                      {tx.type === "buy" && <TrendingUp size={14} style={{ color: R }} />}
                      {tx.type === "sell" && <TrendingDown size={14} style={{ color: G }} />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-medium" style={{ color: "var(--v-ink)" }}>
                        {tx.type === "deposit" && "Deposit"}
                        {tx.type === "buy" && `Bought ${sharesStr} ${tx.symbol}`}
                        {tx.type === "sell" && `Sold ${sharesStr} ${tx.symbol}`}
                      </div>
                      <div className="text-[11px] font-mono mt-0.5" style={{ color: "var(--v-ink-dim)" }}>
                        {fmtWhen(tx.timestamp)}
                        {tx.type !== "deposit" && tx.price != null && ` · ${fmt$(tx.price)}/sh`}
                      </div>
                    </div>
                    <div
                      className="font-mono text-[13px] font-semibold flex-shrink-0"
                      style={{ color: inflow ? G : R }}
                    >
                      {inflow ? "+" : "−"}{fmt$(tx.amount)}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {depositOpen && (
        <DepositDialog onClose={() => setDepositOpen(false)} onDeposit={onDeposit} />
      )}
    </div>
  );
}
