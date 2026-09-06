import { useState } from "react";
import { DialogShell } from "./common";
import { G, R } from "../lib/format";
import { saveByo, type ByoConfig, type ChatStatus } from "../lib/chat";

const FIELD = {
  background: "var(--v-line-strong)", color: "var(--v-ink)",
  border: "1px solid var(--v-line-strong)", fontFamily: "Geist Mono, monospace",
} as const;

const PRESETS: { label: string; base_url: string; model: string }[] = [
  { label: "Groq",       base_url: "https://api.groq.com/openai/v1",              model: "qwen-3-32b" },
  { label: "Together",   base_url: "https://api.together.xyz/v1",                 model: "Qwen/Qwen3-235B-A22B-Instruct" },
  { label: "DashScope",  base_url: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", model: "qwen-plus" },
  { label: "OpenRouter", base_url: "https://openrouter.ai/api/v1",                model: "qwen/qwen3-32b" },
];

export function ByoModelDialog({
  current, status, onClose, onSaved,
}: {
  current: ByoConfig | null;
  status: ChatStatus | null;
  onClose: () => void;
  onSaved: (cfg: ByoConfig | null) => void;
}) {
  const [baseUrl, setBaseUrl] = useState(current?.base_url ?? "");
  const [apiKey, setApiKey] = useState(current?.api_key ?? "");
  const [model, setModel] = useState(current?.model ?? "");
  const [error, setError] = useState<string | null>(null);

  const allowed = status?.byo_hosts ?? [];

  const save = () => {
    const cfg = { base_url: baseUrl.trim(), api_key: apiKey.trim(), model: model.trim() };
    if (!cfg.base_url || !cfg.api_key || !cfg.model) {
      setError("All three fields are required.");
      return;
    }
    let host: string;
    try {
      const u = new URL(cfg.base_url);
      if (u.protocol !== "https:") { setError("The endpoint must use https."); return; }
      host = u.hostname.toLowerCase();
    } catch {
      setError("That isn't a valid URL.");
      return;
    }
    if (allowed.length && !allowed.includes(host)) {
      setError(`${host} isn't an allowed provider. See the list below.`);
      return;
    }
    saveByo(cfg);
    onSaved(cfg);
    onClose();
  };

  const disconnect = () => {
    saveByo(null);
    onSaved(null);
    onClose();
  };

  return (
    <DialogShell
      title="Connect your own model"
      wide
      onClose={onClose}
      footer={
        <>
          {current && (
            <button
              className="px-3.5 py-2 rounded-lg text-xs font-medium transition-colors hover:bg-white/5 mr-auto"
              style={{ color: R }}
              onClick={disconnect}
            >
              Disconnect
            </button>
          )}
          <button
            className="px-3.5 py-2 rounded-lg text-xs font-medium transition-colors hover:bg-white/5"
            style={{ color: "var(--v-ink-soft)" }}
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            className="px-4 py-2 rounded-lg text-xs font-semibold transition-opacity hover:opacity-90"
            style={{ background: G, color: "#0a0a0a" }}
            onClick={save}
          >
            Connect
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-xs leading-relaxed" style={{ color: "var(--v-ink-soft)" }}>
          Use your own provider instead of the shared one, and the daily limit no longer
          applies — you're paying for it. Any OpenAI-compatible endpoint works.
        </p>
        <p className="text-[11px] leading-relaxed" style={{ color: "var(--v-ink-dim)" }}>
          Your key is stored in this browser and sent with each request. It is never
          saved on the server.
        </p>

        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map(p => (
            <button
              key={p.label}
              className="px-2.5 py-1 rounded-lg text-[11px] transition-colors hover:bg-white/10"
              style={{ background: "var(--v-line)", color: "var(--v-ink-soft)" }}
              onClick={() => { setBaseUrl(p.base_url); setModel(p.model); setError(null); }}
            >
              {p.label}
            </button>
          ))}
        </div>

        {([
          ["Endpoint", baseUrl, setBaseUrl, "https://api.groq.com/openai/v1", false],
          ["Model", model, setModel, "qwen-3-32b", false],
          ["API key", apiKey, setApiKey, "sk-…", true],
        ] as const).map(([label, value, set, placeholder, secret]) => (
          <label key={label} className="block">
            <div className="text-[10px] font-mono uppercase tracking-wider mb-1.5"
                 style={{ color: "var(--v-ink-dim)" }}>
              {label}
            </div>
            <input
              value={value}
              type={secret ? "password" : "text"}
              autoComplete={secret ? "off" : undefined}
              spellCheck={false}
              placeholder={placeholder}
              onChange={e => { set(e.target.value); setError(null); }}
              className="w-full px-2.5 py-1.5 rounded-lg text-xs outline-none"
              style={FIELD}
            />
          </label>
        ))}

        {error && <div className="text-[11px]" style={{ color: R }}>{error}</div>}

        {allowed.length > 0 && (
          <div className="rounded-lg px-3 py-2" style={{ background: "var(--v-line)" }}>
            <div className="text-[11px] mb-1" style={{ color: "var(--v-ink-soft)" }}>
              Allowed providers
            </div>
            <div className="text-[10px] font-mono leading-relaxed" style={{ color: "var(--v-ink-dim)" }}>
              {allowed.join(", ")}
            </div>
          </div>
        )}
      </div>
    </DialogShell>
  );
}
