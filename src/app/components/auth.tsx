import { Check, Eye, EyeOff } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { DialogShell, ProfileAvatar } from "./common";
import { authErrorMessage } from "../lib/firebase";
import { G, R } from "../lib/format";
import { ALL_SYMBOLS } from "../lib/stocks";

import { type Profile, type Watchlist } from "../types";

export const TECH_STARTER = ["AAPL", "MSFT", "NVDA", "GOOGL", "META", "NFLX"] as const;

export const ONBOARDING_SECTORS: { sector: string; stocks: { symbol: string; name: string }[] }[] = [
  {
    sector: "Technology",
    stocks: [
      { symbol: "AAPL", name: "Apple" },
      { symbol: "MSFT", name: "Microsoft" },
      { symbol: "NVDA", name: "NVIDIA" },
      { symbol: "GOOGL", name: "Alphabet" },
      { symbol: "META", name: "Meta" },
      { symbol: "NFLX", name: "Netflix" },
      { symbol: "AMD", name: "AMD" },
      { symbol: "ORCL", name: "Oracle" },
    ],
  },
  {
    sector: "Finance",
    stocks: [
      { symbol: "JPM", name: "JPMorgan" },
      { symbol: "V", name: "Visa" },
      { symbol: "BRK.B", name: "Berkshire" },
      { symbol: "MA", name: "Mastercard" },
      { symbol: "BAC", name: "Bank of America" },
      { symbol: "GS", name: "Goldman Sachs" },
    ],
  },
  {
    sector: "Consumer",
    stocks: [
      { symbol: "AMZN", name: "Amazon" },
      { symbol: "COST", name: "Costco" },
      { symbol: "WMT", name: "Walmart" },
      { symbol: "NKE", name: "Nike" },
      { symbol: "SBUX", name: "Starbucks" },
      { symbol: "MCD", name: "McDonald's" },
    ],
  },
  {
    sector: "Healthcare",
    stocks: [
      { symbol: "JNJ", name: "J&J" },
      { symbol: "UNH", name: "UnitedHealth" },
      { symbol: "LLY", name: "Eli Lilly" },
      { symbol: "PFE", name: "Pfizer" },
      { symbol: "ABBV", name: "AbbVie" },
      { symbol: "MRK", name: "Merck" },
    ],
  },
  {
    sector: "Automotive",
    stocks: [
      { symbol: "TSLA", name: "Tesla" },
      { symbol: "F", name: "Ford" },
      { symbol: "GM", name: "GM" },
      { symbol: "RIVN", name: "Rivian" },
    ],
  },
  {
    sector: "ETF",
    stocks: [
      { symbol: "SPY", name: "S&P 500" },
      { symbol: "QQQ", name: "Nasdaq 100" },
      { symbol: "GLD", name: "Gold" },
      { symbol: "IWM", name: "Russell 2000" },
      { symbol: "VTI", name: "Total Market" },
    ],
  },
];

export function buildWatchlistsFromSelection(selected: Set<string>): Watchlist[] {
  const all = [...selected];
  const lists: Watchlist[] = [
    { id: "portfolio", name: "All Stocks", symbols: all.length ? all : [...ALL_SYMBOLS] },
  ];
  for (const group of ONBOARDING_SECTORS) {
    const syms = group.stocks.map(s => s.symbol).filter(s => selected.has(s));
    if (syms.length === 0) continue;
    const id = "wl-" + group.sector.toLowerCase().replace(/\s+/g, "-");
    lists.push({ id, name: group.sector === "Technology" ? "Tech" : group.sector, symbols: syms });
  }
  return lists;
}

// ─── Auth forms ────────────────────────────────────────────────────────────────

export function AuthPanel({
  onAuth,
}: {
  /** Performs the actual sign-in/sign-up. Throws so this panel can show the error. */
  onAuth: (mode: "signin" | "signup", email: string, password: string, name: string) => Promise<void>;
}) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const e = email.trim();
    const n = name.trim();
    if (!e || password.length < 6) {
      setError(password.length > 0 && password.length < 6
        ? "Password must be at least 6 characters."
        : "Enter email and password.");
      return;
    }
    if (mode === "signup" && (n.length < 1 || n.length > 80)) {
      setError("Enter your name (1–80 characters).");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onAuth(mode, e, password, n);
    } catch (err) {
      setError(authErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-sm mx-auto w-full flex flex-col gap-4">
      <div className="text-center mb-1">
        <div className="font-mono text-lg font-semibold tracking-tight" style={{ color: "var(--v-ink)" }}>
          {mode === "signin" ? "Sign in" : "Create account"}
        </div>
        <div className="text-xs mt-1" style={{ color: "var(--v-ink-soft)" }}>
          {mode === "signin"
            ? "Sign in to sync bank & portfolio to your account"
            : "Create an account to sync bank & portfolio across devices"}
        </div>
      </div>

      <div className="flex rounded-lg p-0.5" style={{ background: "var(--v-line)" }}>
        {(["signin", "signup"] as const).map(m => (
          <button
            key={m}
            type="button"
            className="flex-1 py-1.5 rounded-md text-xs font-medium transition-all"
            style={{
              background: mode === m ? "var(--v-ink)" : "transparent",
              color: mode === m ? "var(--v-panel)" : "var(--v-ink-soft)",
            }}
            onClick={() => { setMode(m); setError(null); }}
          >
            {m === "signin" ? "Sign in" : "Sign up"}
          </button>
        ))}
      </div>

      {mode === "signup" && (
        <div>
          <label className="block text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: "var(--v-ink-dim)" }}>
            Name
          </label>
          <input
            type="text"
            autoComplete="name"
            maxLength={80}
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") submit(); }}
            className="w-full px-3 py-2.5 rounded-xl text-sm font-mono outline-none"
            style={{ background: "var(--v-line)", color: "var(--v-ink)", border: "1px solid var(--v-line-strong)" }}
          />
        </div>
      )}

      <div>
        <label className="block text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: "var(--v-ink-dim)" }}>
          Email
        </label>
        <input
          type="email"
          autoComplete="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") submit(); }}
          className="w-full px-3 py-2.5 rounded-xl text-sm font-mono outline-none"
          style={{ background: "var(--v-line)", color: "var(--v-ink)", border: "1px solid var(--v-line-strong)" }}
        />
      </div>
      <div>
        <label className="block text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: "var(--v-ink-dim)" }}>
          Password
        </label>
        <div className="relative">
          <input
            type={showPassword ? "text" : "password"}
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            value={password}
            onChange={e => setPassword(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") submit(); }}
            className="w-full pl-3 pr-10 py-2.5 rounded-xl text-sm font-mono outline-none"
            style={{ background: "var(--v-line)", color: "var(--v-ink)", border: "1px solid var(--v-line-strong)" }}
          />
          <button
            type="button"
            className="absolute right-2.5 top-1/2 -translate-y-1/2 w-6 h-6 flex items-center justify-center rounded-md hover:bg-white/10 transition-colors"
            onClick={() => setShowPassword(v => !v)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            tabIndex={-1}
          >
            {showPassword
              ? <EyeOff size={14} style={{ color: "var(--v-ink-dim)" }} />
              : <Eye size={14} style={{ color: "var(--v-ink-dim)" }} />}
          </button>
        </div>
      </div>

      {error && (
        <div className="text-xs font-mono" style={{ color: R }}>{error}</div>
      )}

      <button
        type="button"
        disabled={busy}
        className="w-full py-2.5 rounded-xl text-xs font-semibold transition-opacity disabled:opacity-50"
        style={{ background: G, color: "#0a0a0a" }}
        onClick={submit}
      >
        {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Create account"}
      </button>
    </div>
  );
}

export function OnboardingDialog({
  email, initialName, onComplete,
}: {
  email: string;
  initialName: string;
  onComplete: (name: string, selected: string[]) => void;
}) {
  // A name given at sign-up is already the user's name — don't ask for it twice.
  const knownName = initialName.trim().slice(0, 80);
  const [step, setStep] = useState<"name" | "stocks">(knownName ? "stocks" : "name");
  const [name, setName] = useState(knownName);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(TECH_STARTER));
  const [sectorTab, setSectorTab] = useState(ONBOARDING_SECTORS[0].sector);
  const trimmed = name.trim();
  const nameValid = trimmed.length >= 1 && trimmed.length <= 80;

  const countsBySector = useMemo(() => {
    const map = new Map<string, number>();
    for (const group of ONBOARDING_SECTORS) {
      map.set(group.sector, group.stocks.filter(s => selected.has(s.symbol)).length);
    }
    return map;
  }, [selected]);

  const maxSectorCount = Math.max(0, ...countsBySector.values());
  const stocksValid = maxSectorCount >= 3;
  const activeGroup = ONBOARDING_SECTORS.find(g => g.sector === sectorTab) ?? ONBOARDING_SECTORS[0];

  const toggle = (symbol: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(symbol)) next.delete(symbol);
      else next.add(symbol);
      return next;
    });
  };

  return (
    <DialogShell
      title={step === "name" ? "Welcome to Vantage" : "Build your watchlists"}
      onClose={() => {}}
      dismissible={false}
      wide={step === "stocks"}
      footer={
        step === "name" ? (
          <button
            className="px-4 py-2 rounded-lg text-xs font-semibold transition-opacity disabled:opacity-40"
            style={{ background: G, color: "#0a0a0a" }}
            disabled={!nameValid}
            onClick={() => { if (nameValid) setStep("stocks"); }}
          >
            Continue
          </button>
        ) : (
          <>
            <button
              className="px-3.5 py-2 rounded-lg text-xs font-medium transition-colors hover:bg-white/5"
              style={{ color: "var(--v-ink-soft)" }}
              onClick={() => setStep("name")}
            >
              Back
            </button>
            <button
              className="px-4 py-2 rounded-lg text-xs font-semibold transition-opacity disabled:opacity-40"
              style={{ background: G, color: "#0a0a0a" }}
              disabled={!stocksValid}
              onClick={() => { if (stocksValid) onComplete(trimmed, [...selected]); }}
            >
              Finish
            </button>
          </>
        )
      }
    >
      {step === "name" ? (
        <>
        
          <label className="block text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: "var(--v-ink-dim)" }}>
            Display name
          </label>
          <input
            autoFocus
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && nameValid) setStep("stocks"); }}
            placeholder="Your name"
            className="w-full px-3 py-2.5 rounded-xl text-sm font-mono outline-none"
            style={{ background: "var(--v-line)", color: "var(--v-ink)", border: "1px solid var(--v-line-strong)" }}
          />
          <div className="mt-2 text-[11px] font-mono truncate" style={{ color: "var(--v-ink-dim)" }}>
            Signed in as {email}
          </div>
        </>
      ) : (
        <>
          <div className="text-xs mb-3" style={{ color: "var(--v-ink-soft)" }}>
            Select at least 3 stocksfrom one sector to get started.
          </div>
          <div className="flex gap-1.5 overflow-x-auto pb-2 mb-3" style={{ scrollbarWidth: "thin" }}>
            {ONBOARDING_SECTORS.map(g => {
              const n = countsBySector.get(g.sector) ?? 0;
              const active = sectorTab === g.sector;
              return (
                <button
                  key={g.sector}
                  type="button"
                  className="flex-shrink-0 px-2.5 py-1.5 rounded-lg text-[11px] font-mono font-medium"
                  style={{
                    background: active ? "var(--v-ink)" : "var(--v-line)",
                    color: active ? "var(--v-panel)" : "var(--v-ink-soft)",
                  }}
                  onClick={() => setSectorTab(g.sector)}
                >
                  {g.sector === "Technology" ? "Tech" : g.sector}
                  <span className="ml-1 opacity-70">{n}</span>
                </button>
              );
            })}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {activeGroup.stocks.map(s => {
              const on = selected.has(s.symbol);
              return (
                <button
                  key={s.symbol}
                  type="button"
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-colors"
                  style={{
                    background: on ? "rgba(52,211,153,0.12)" : "var(--v-line)",
                    border: `1px solid ${on ? "rgba(52,211,153,0.45)" : "var(--v-line-strong)"}`,
                  }}
                  onClick={() => toggle(s.symbol)}
                >
                  <span
                    className="w-4 h-4 rounded flex items-center justify-center flex-shrink-0"
                    style={{
                      background: on ? G : "transparent",
                      border: on ? "none" : "1px solid var(--v-ink-dim)",
                    }}
                  >
                    {on && <Check size={10} color="#0a0a0a" strokeWidth={3} />}
                  </span>
                  <span className="min-w-0">
                    <span className="block font-mono text-[12px] font-semibold" style={{ color: "var(--v-ink)" }}>
                      {s.symbol}
                    </span>
                    <span className="block text-[10px] truncate" style={{ color: "var(--v-ink-dim)" }}>
                      {s.name}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="mt-3 text-[11px] font-mono" style={{ color: stocksValid ? G : "var(--v-ink-dim)" }}>
            {stocksValid
              ? `${selected.size} selected · ready`
              : `Select at least 3 in one sector (${maxSectorCount}/3)`}
          </div>
        </>
      )}
    </DialogShell>
  );
}

export function GuestSaveBanner({
  onSignIn, className = "",
}: {
  onSignIn: () => void;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-wrap items-center gap-3 px-4 py-3 rounded-xl text-[12px] ${className}`}
      style={{ background: "rgba(52,211,153,0.08)", border: "1px solid rgba(52,211,153,0.25)", color: "var(--v-ink-soft)" }}
    >
      <div className="flex-1 min-w-[12rem] leading-relaxed">
        You’re not signed in — bank & portfolio changes won’t be saved.
      </div>
      <button
        type="button"
        className="px-3 py-1.5 rounded-lg text-[11px] font-semibold flex-shrink-0"
        style={{ background: G, color: "#0a0a0a" }}
        onClick={onSignIn}
      >
        Sign in to save
      </button>
    </div>
  );
}

export function SyncErrorBanner({
  onRetry, className = "",
}: {
  onRetry: () => void;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-wrap items-center gap-3 px-4 py-3 rounded-xl text-[12px] ${className}`}
      style={{ background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.3)", color: "var(--v-ink-soft)" }}
    >
      <div className="flex-1 min-w-[12rem] leading-relaxed">
        You’re signed in, but we couldn’t reach your saved data. Changes aren’t syncing right now.
      </div>
      <button
        type="button"
        className="px-3 py-1.5 rounded-lg text-[11px] font-semibold flex-shrink-0"
        style={{ background: R, color: "#0a0a0a" }}
        onClick={onRetry}
      >
        Retry
      </button>
    </div>
  );
}

export function ManageAccountDialog({
  profile, onClose, onSave, onReset, onDeleteAccount,
}: {
  profile: Profile;
  onClose: () => void;
  onSave: (p: Profile) => void;
  onReset: () => void;
  onDeleteAccount: () => Promise<void>;
}) {
  const [name, setName] = useState(profile.name);
  const [pic, setPic] = useState(profile.pic);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const onPickFile = (file: File | null) => {
    if (!file || !file.type.startsWith("image/")) return;
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") setPic(reader.result);
    };
    reader.readAsDataURL(file);
  };

  const handleDelete = async () => {
    setDeleteBusy(true);
    setDeleteError(null);
    try {
      await onDeleteAccount();
    } catch (err) {
      setDeleteError(authErrorMessage(err));
      setDeleteBusy(false);
    }
  };

  return (
    <DialogShell
      title="Manage account"
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
            className="px-4 py-2 rounded-lg text-xs font-semibold"
            style={{ background: G, color: "#0a0a0a" }}
            onClick={() => {
              onSave({
                ...profile,
                name: name.trim() || profile.name,
                pic,
              });
              onClose();
            }}
          >
            Save
          </button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-4">
          <ProfileAvatar pic={pic} size={56} />
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: "var(--v-ink-dim)" }}>
              Profile photo
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={e => onPickFile(e.target.files?.[0] ?? null)}
            />
            <div className="flex gap-2">
              <button
                className="px-3 py-1.5 rounded-lg text-xs font-medium"
                style={{ background: "var(--v-line)", color: "var(--v-ink)" }}
                onClick={() => fileRef.current?.click()}
              >
                Upload photo
              </button>
              {pic && (
                <button
                  className="px-3 py-1.5 rounded-lg text-xs font-medium"
                  style={{ color: "var(--v-ink-soft)" }}
                  onClick={() => setPic("")}
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        </div>
        <div>
          <label className="block text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: "var(--v-ink-dim)" }}>
            Name
          </label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            className="w-full px-3 py-2.5 rounded-xl text-sm font-mono outline-none"
            style={{ background: "var(--v-line)", color: "var(--v-ink)", border: "1px solid var(--v-line-strong)" }}
          />
        </div>
        <div>
          <label className="block text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: "var(--v-ink-dim)" }}>
            Email
          </label>
          <input
            type="email"
            value={profile.email}
            readOnly
            className="w-full px-3 py-2.5 rounded-xl text-sm font-mono outline-none opacity-70"
            style={{ background: "var(--v-line)", color: "var(--v-ink)", border: "1px solid var(--v-line-strong)" }}
          />
        </div>

        <div className="pt-2" style={{ borderTop: "1px solid var(--v-line)" }}>
          <div className="text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: "var(--v-ink-dim)" }}>
            Danger zone
          </div>
          {!confirmReset ? (
            <button
              className="w-full px-3 py-2.5 rounded-xl text-xs font-medium text-left transition-colors hover:bg-white/5"
              style={{ color: R, border: "1px solid rgba(248,113,130,0.35)" }}
              onClick={() => { setConfirmReset(true); setConfirmDelete(false); }}
            >
              Reset trade history
            </button>
          ) : (
            <div className="rounded-xl p-3" style={{ border: "1px solid rgba(248,113,130,0.35)", background: "rgba(248,113,130,0.08)" }}>
              <div className="text-xs mb-3" style={{ color: "var(--v-ink-soft)" }}>
                Sets bank to $0 and clears portfolio + transactions. This can’t be undone.
              </div>
              <div className="flex gap-2">
                <button
                  className="flex-1 px-3 py-2 rounded-lg text-xs font-medium"
                  style={{ color: "var(--v-ink-soft)", background: "var(--v-line)" }}
                  onClick={() => setConfirmReset(false)}
                >
                  Cancel
                </button>
                <button
                  className="flex-1 px-3 py-2 rounded-lg text-xs font-semibold"
                  style={{ background: R, color: "#0a0a0a" }}
                  onClick={() => { onReset(); onClose(); }}
                >
                  Reset
                </button>
              </div>
            </div>
          )}

          {!confirmDelete ? (
            <button
              className="w-full mt-2 px-3 py-2.5 rounded-xl text-xs font-medium text-left transition-colors hover:bg-white/5"
              style={{ color: R, border: "1px solid rgba(248,113,130,0.35)" }}
              onClick={() => { setConfirmDelete(true); setConfirmReset(false); setDeleteError(null); }}
            >
              Delete account
            </button>
          ) : (
            <div className="mt-2 rounded-xl p-3" style={{ border: "1px solid rgba(248,113,130,0.35)", background: "rgba(248,113,130,0.08)" }}>
              <div className="text-xs mb-3" style={{ color: "var(--v-ink-soft)" }}>
                Permanently deletes your account and all synced data. This can’t be undone.
              </div>
              {deleteError && (
                <div className="text-[11px] font-mono mb-2" style={{ color: R }}>{deleteError}</div>
              )}
              <div className="flex gap-2">
                <button
                  className="flex-1 px-3 py-2 rounded-lg text-xs font-medium"
                  style={{ color: "var(--v-ink-soft)", background: "var(--v-line)" }}
                  disabled={deleteBusy}
                  onClick={() => setConfirmDelete(false)}
                >
                  Cancel
                </button>
                <button
                  className="flex-1 px-3 py-2 rounded-lg text-xs font-semibold disabled:opacity-50"
                  style={{ background: R, color: "#0a0a0a" }}
                  disabled={deleteBusy}
                  onClick={handleDelete}
                >
                  {deleteBusy ? "Deleting…" : "Delete"}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </DialogShell>
  );
}
