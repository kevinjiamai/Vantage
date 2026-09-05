import { Upload } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { DialogShell } from "./common";
import { G, R } from "../lib/format";
import { resolveSymbols } from "../lib/stocks";
import { parseYahooCsv, watchlistNameFromFile } from "../lib/yahooCsv";
import type { StockMeta } from "../lib/stocks";

type Stage = "pick" | "checking" | "review";

const FIELD = {
  background: "var(--v-line-strong)", color: "var(--v-ink)",
  border: "1px solid var(--v-line-strong)", fontFamily: "Geist Mono, monospace",
} as const;

export function ImportWatchlistDialog({
  onClose, onImport,
}: {
  onClose: () => void;
  onImport: (name: string, symbols: string[], stocks: StockMeta[]) => void;
}) {
  const [stage, setStage] = useState<Stage>("pick");
  const [name, setName] = useState("Imported");
  const [text, setText] = useState("");
  const [rejected, setRejected] = useState<string[]>([]);
  const [found, setFound] = useState<string[]>([]);
  const [missing, setMissing] = useState<string[]>([]);
  const [stocks, setStocks] = useState<StockMeta[]>([]);
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const readFile = useCallback(async (file: File) => {
    setError(null);
    setName(watchlistNameFromFile(file.name));
    setText(await file.text());
  }, []);

  const check = useCallback(async () => {
    const parsed = parseYahooCsv(text);
    setRejected(parsed.rejected);
    if (!parsed.symbols.length) {
      setError("No tickers found. Expected a Yahoo CSV export or one ticker per line.");
      return;
    }
    setError(null);
    setStage("checking");
    setProgress({ done: 0, total: parsed.symbols.length });
    try {
      const res = await resolveSymbols(parsed.symbols, (done, total) => setProgress({ done, total }));
      setFound(res.found);
      setMissing(res.missing);
      setStocks(res.stocks);
      setStage("review");
    } catch {
      setError("Couldn't reach the quote service. Check that the API server is running.");
      setStage("pick");
    }
  }, [text]);

  const confirm = useCallback(() => {
    if (found.length) onImport(name.trim() || "Imported", found, stocks);
    onClose();
  }, [found, name, stocks, onImport, onClose]);

  const cancelBtn = (
    <button
      className="px-3.5 py-2 rounded-lg text-xs font-medium transition-colors hover:bg-white/5"
      style={{ color: "var(--v-ink-soft)" }}
      onClick={onClose}
    >
      Cancel
    </button>
  );

  const primary = (label: string, onClick: () => void, disabled = false) => (
    <button
      className="px-4 py-2 rounded-lg text-xs font-semibold transition-opacity hover:opacity-90 disabled:opacity-40"
      style={{ background: G, color: "#0a0a0a" }}
      onClick={onClick}
      disabled={disabled}
    >
      {label}
    </button>
  );

  return (
    <DialogShell
      title="Import watchlist"
      wide
      dismissible={stage !== "checking"}
      onClose={onClose}
      footer={
        stage === "review"
          ? <>{cancelBtn}{primary(`Import ${found.length}`, confirm, !found.length)}</>
          : <>{cancelBtn}{primary("Check symbols", check, stage === "checking" || !text.trim())}</>
      }
    >
      {stage === "checking" ? (
        <div className="py-6 text-center">
          <div className="text-sm mb-2" style={{ color: "var(--v-ink)" }}>
            Checking {progress.total} symbols…
          </div>
          <div className="text-[11px] font-mono" style={{ color: "var(--v-ink-dim)" }}>
            {progress.done} / {progress.total}
          </div>
        </div>
      ) : stage === "review" ? (
        <div className="space-y-3">
          <div className="text-sm" style={{ color: "var(--v-ink)" }}>
            <span className="font-semibold" style={{ color: G }}>{found.length}</span> symbols ready to import.
          </div>
          {missing.length > 0 && (
            <SymbolNote
              label={`${missing.length} not found on Yahoo and will be skipped`}
              symbols={missing}
            />
          )}
          {rejected.length > 0 && (
            <SymbolNote label={`${rejected.length} unreadable rows skipped`} symbols={rejected} />
          )}
          <label className="block">
            <div className="text-[10px] font-mono uppercase tracking-wider mb-1.5" style={{ color: "var(--v-ink-dim)" }}>
              List name
            </div>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-lg text-xs outline-none"
              style={FIELD}
            />
          </label>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs leading-relaxed" style={{ color: "var(--v-ink-soft)" }}>
            In Yahoo Finance open your portfolio, then <span style={{ color: "var(--v-ink)" }}>⋮ → Export</span>.
            Drop the CSV here, or paste tickers one per line.
          </p>

          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv,text/plain"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) void readFile(f); }}
          />
          <button
            className="w-full flex items-center justify-center gap-2 py-6 rounded-xl border border-dashed text-xs transition-colors hover:bg-white/5"
            style={{ borderColor: "var(--v-line-strong)", color: "var(--v-ink-soft)" }}
            onClick={() => fileRef.current?.click()}
            onDragOver={e => e.preventDefault()}
            onDrop={e => {
              e.preventDefault();
              const f = e.dataTransfer.files?.[0];
              if (f) void readFile(f);
            }}
          >
            <Upload size={14} />
            Choose or drop a CSV
          </button>

          <textarea
            value={text}
            onChange={e => { setText(e.target.value); setError(null); }}
            rows={6}
            placeholder={"Symbol,Current Price,…\nAAPL,…\nMSFT,…"}
            className="w-full px-2.5 py-2 rounded-lg text-[11px] outline-none resize-y"
            style={FIELD}
          />

          {error && <div className="text-[11px]" style={{ color: R }}>{error}</div>}
        </div>
      )}
    </DialogShell>
  );
}

function SymbolNote({ label, symbols }: { label: string; symbols: string[] }) {
  return (
    <div className="rounded-lg px-3 py-2" style={{ background: "var(--v-line)" }}>
      <div className="text-[11px] mb-1" style={{ color: "var(--v-ink-soft)" }}>{label}</div>
      <div className="text-[10px] font-mono leading-relaxed max-h-20 overflow-y-auto" style={{ color: "var(--v-ink-dim)" }}>
        {symbols.join(", ")}
      </div>
    </div>
  );
}
