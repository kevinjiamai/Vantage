import { Eye, EyeOff } from "lucide-react";
import { useState } from "react";
import { authErrorMessage } from "../../lib/firebase";
import { G, R } from "../../lib/format";

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
