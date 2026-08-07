import { G, R } from "../../lib/format";

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
