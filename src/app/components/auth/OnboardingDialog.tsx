import { Check } from "lucide-react";
import { useMemo, useState } from "react";
import { DialogShell } from "../common";
import { G } from "../../lib/format";
import { ONBOARDING_SECTORS, TECH_STARTER } from "../../lib/onboarding";

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
