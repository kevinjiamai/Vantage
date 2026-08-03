import { type User } from "firebase/auth";
import { Settings } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AuthPanel, ManageAccountDialog } from "../components/auth";
import { ProfileAvatar } from "../components/common";
import { G, R, fmt$, fmtPct } from "../lib/format";
import { type Holding, type Profile } from "../types";

export function AccountPage({
  user, profile, setProfile, balance, holdings, totalProfit, portfolioValue, totalCost,
  onResetTradeHistory, onSignOut, onDeleteAccount, onAuthDone,
}: {
  user: User | null;
  profile: Profile;
  setProfile: (p: Profile) => void;
  balance: number;
  holdings: Holding[];
  totalProfit: number;
  portfolioValue: number;
  totalCost: number;
  onResetTradeHistory: () => void;
  onSignOut: () => void;
  onDeleteAccount: () => Promise<void>;
  onAuthDone: (mode: "signin" | "signup", email: string, password: string, name: string) => Promise<void>;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [manageOpen, setManageOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const profitUp = totalProfit >= 0;
  const profitPct = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0;
  const shareCount = holdings.reduce((a, h) => a + h.shares, 0);

  useEffect(() => {
    if (!menuOpen) return;
    const h = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [menuOpen]);

  if (!user) {
    return (
      <div className="flex-1 overflow-y-auto p-5" style={{ scrollbarWidth: "thin", scrollbarColor: "var(--v-line-strong) transparent" }}>
        <div className="max-w-md mx-auto mt-10 rounded-2xl border p-6" style={{ background: "var(--v-panel)", borderColor: "var(--v-line)" }}>
          <AuthPanel onAuth={onAuthDone} />
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-5" style={{ scrollbarWidth: "thin", scrollbarColor: "var(--v-line-strong) transparent" }}>
      <div className="max-w-2xl mx-auto flex flex-col gap-4">
        <div className="relative rounded-2xl border p-6 flex items-center gap-4" style={{ background: "var(--v-panel)", borderColor: "var(--v-line)" }}>
          <div className="absolute top-4 right-4" ref={menuRef}>
            <button
              className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/10 transition-colors"
              onClick={() => setMenuOpen(v => !v)}
              title="Account menu"
            >
              <Settings size={15} style={{ color: "var(--v-ink-soft)" }} />
            </button>
            {menuOpen && (
              <div
                className="absolute right-0 top-9 z-50 min-w-[168px] rounded-xl border py-1.5 shadow-2xl"
                style={{ background: "var(--v-panel)", borderColor: "var(--v-line-strong)" }}
              >
                <button
                  className="w-full text-left px-3 py-2 text-xs transition-colors hover:bg-white/5"
                  style={{ color: "var(--v-ink)" }}
                  onClick={() => { setMenuOpen(false); setManageOpen(true); }}
                >
                  Manage account
                </button>
                <button
                  className="w-full text-left px-3 py-2 text-xs transition-colors hover:bg-white/5"
                  style={{ color: "var(--v-ink-soft)" }}
                  onClick={() => { setMenuOpen(false); onSignOut(); }}
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
          <ProfileAvatar pic={profile.pic} size={64} />
          <div className="min-w-0 flex-1 pr-8">
            <div className="font-mono text-lg font-semibold tracking-tight truncate" style={{ color: "var(--v-ink)" }}>
              {profile.name || "Your account"}
            </div>
            <div className="text-xs mt-0.5 truncate" style={{ color: "var(--v-ink-soft)" }}>
              {profile.email}
            </div>
          </div>
        </div>

        <div className="text-[10px] font-mono uppercase tracking-widest px-1" style={{ color: "var(--v-ink-dim)" }}>
          Analytics
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-2xl border p-4" style={{ background: "var(--v-panel)", borderColor: "var(--v-line)" }}>
            <div className="text-[9px] font-mono uppercase tracking-widest mb-2" style={{ color: "var(--v-ink-dim)" }}>Total profit</div>
            <div className="font-mono text-xl font-semibold" style={{ color: profitUp ? G : R }}>
              {profitUp ? "+" : ""}{fmt$(totalProfit)}
            </div>
            <div className="text-[11px] font-mono mt-1" style={{ color: profitUp ? G : R }}>
              {fmtPct(profitPct)}
            </div>
          </div>
          <div className="rounded-2xl border p-4" style={{ background: "var(--v-panel)", borderColor: "var(--v-line)" }}>
            <div className="text-[9px] font-mono uppercase tracking-widest mb-2" style={{ color: "var(--v-ink-dim)" }}>Portfolio value</div>
            <div className="font-mono text-xl font-semibold" style={{ color: "var(--v-ink)" }}>
              {fmt$(portfolioValue)}
            </div>
            <div className="text-[11px] font-mono mt-1" style={{ color: "var(--v-ink-dim)" }}>
              Cost basis {fmt$(totalCost)}
            </div>
          </div>
          <div className="rounded-2xl border p-4" style={{ background: "var(--v-panel)", borderColor: "var(--v-line)" }}>
            <div className="text-[9px] font-mono uppercase tracking-widest mb-2" style={{ color: "var(--v-ink-dim)" }}>Bank cash</div>
            <div className="font-mono text-xl font-semibold" style={{ color: "var(--v-ink)" }}>
              {fmt$(balance)}
            </div>
          </div>
          <div className="rounded-2xl border p-4" style={{ background: "var(--v-panel)", borderColor: "var(--v-line)" }}>
            <div className="text-[9px] font-mono uppercase tracking-widest mb-2" style={{ color: "var(--v-ink-dim)" }}>Positions</div>
            <div className="font-mono text-xl font-semibold" style={{ color: "var(--v-ink)" }}>
              {holdings.length}
            </div>
            <div className="text-[11px] font-mono mt-1" style={{ color: "var(--v-ink-dim)" }}>
              {shareCount.toLocaleString("en-US", { maximumFractionDigits: 2 })} shares
            </div>
          </div>
        </div>
      </div>

      {manageOpen && (
        <ManageAccountDialog
          profile={profile}
          onClose={() => setManageOpen(false)}
          onSave={setProfile}
          onReset={onResetTradeHistory}
          onDeleteAccount={onDeleteAccount}
        />
      )}
    </div>
  );
}
