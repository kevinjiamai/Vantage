import { authHeader as sessionHeader } from "./account";
import { apiUrl } from "./stocks";
import type { StockMeta, TimeRange } from "./stocks";

/** A model the user connected themselves. Kept in this browser, never stored server-side. */
export interface ByoConfig {
  base_url: string;
  api_key: string;
  model: string;
}

const BYO_KEY = "vantage-byo-model";

export function loadByo(): ByoConfig | null {
  try {
    const raw = localStorage.getItem(BYO_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<ByoConfig>;
    return p.base_url && p.api_key && p.model
      ? { base_url: p.base_url, api_key: p.api_key, model: p.model }
      : null;
  } catch {
    return null;
  }
}

export function saveByo(cfg: ByoConfig | null) {
  try {
    if (cfg) localStorage.setItem(BYO_KEY, JSON.stringify(cfg));
    else localStorage.removeItem(BYO_KEY);
  } catch {
    /* private mode; the setting just won't persist */
  }
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatContext {
  signedIn: boolean;
  watchlistSymbols: string[];
  holdings: { symbol: string; shares: number; avgCost: number }[];
  stocks: Pick<StockMeta, "symbol" | "name" | "sector" | "price" | "changePercent">[];
  range?: TimeRange;
  performance?: Record<string, number>;
}

export interface ChatQuota {
  tier: string;
  used: number;
  limit: number;
  model?: string;
  byo?: boolean;
}

export interface ChatStatus extends ChatQuota {
  signed_in: boolean;
  service_model_available: boolean;
  byo_hosts: string[];
}

/** Events surfaced to the UI while a reply streams. */
export type ChatEvent =
  | { type: "meta"; quota: ChatQuota }
  | { type: "token"; text: string }
  | { type: "tool"; name: string }
  | { type: "error"; message: string };

function authHeader(): Record<string, string> {
  return sessionHeader();
}

export async function fetchChatStatus(): Promise<ChatStatus | null> {
  try {
    const res = await fetch(apiUrl("/api/chat/status"), { headers: authHeader() });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

function contextBlock(ctx: ChatContext): string {
  const perf = ctx.performance;
  const rangeLabel = ctx.range ?? "1D";
  const lines = [
    `User signed in: ${ctx.signedIn ? "yes" : "no"}`,
    `Watchlist tickers (${ctx.watchlistSymbols.length}): ${ctx.watchlistSymbols.join(", ") || "(none)"}`,
    ctx.holdings.length
      ? "Holdings: " + ctx.holdings.slice(0, 20)
          .map(h => `${h.symbol} ${h.shares}@$${h.avgCost.toFixed(2)}`).join("; ")
      : "Holdings: (none)",
  ];

  if (ctx.stocks.length) {
    const pct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
    const ranked = [...ctx.stocks].sort((a, b) => {
      const pa = perf?.[a.symbol], pb = perf?.[b.symbol];
      if (pa === undefined && pb === undefined) return 0;
      if (pa === undefined) return 1;
      if (pb === undefined) return -1;
      return pb - pa;
    });
    lines.push(
      `Market snapshot (${ranked.length} tickers` +
        (perf ? `, sorted by ${rangeLabel} change` : "") + "):"
    );
    for (const s of ranked) {
      const day = Number.isFinite(s.changePercent) ? pct(s.changePercent) : "—";
      const r = perf?.[s.symbol];
      lines.push(
        `  ${s.symbol} $${s.price.toFixed(2)} 1D ${day}` +
          (r === undefined ? "" : ` ${rangeLabel} ${pct(r)}`) + ` (${s.sector})`
      );
    }
  }
  lines.push(
    "Prefer the tools over this snapshot for any ranking or screen; it may be incomplete."
  );
  return lines.join("\n");
}

/**
 * Stream a reply from this service. The browser never talks to a model provider:
 * whichever model is behind /api/chat is the service's concern, unless the user
 * connected their own.
 */
export async function* streamChatReply(
  history: ChatMessage[],
  ctx: ChatContext,
): AsyncGenerator<ChatEvent> {
  const messages = history.map((m, i) =>
    i === history.length - 1 && m.role === "user"
      ? { ...m, content: `${m.content}\n\n(App context)\n${contextBlock(ctx)}` }
      : m
  );

  const res = await fetch(apiUrl("/api/chat"), {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(authHeader()) },
    body: JSON.stringify({
      messages,
      symbols: ctx.watchlistSymbols,
      range: ctx.range,
      byo: loadByo() ?? undefined,
    }),
  });

  if (!res.ok || !res.body) {
    let message = `Chat failed (${res.status})`;
    try {
      const detail = (await res.json())?.detail;
      message = typeof detail === "string" ? detail : detail?.message ?? message;
    } catch {
      /* keep the status-based message */
    }
    yield { type: "error", message };
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let event = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.startsWith("event: ")) {
        event = line.slice(7).trim();
      } else if (line.startsWith("data: ")) {
        let data: Record<string, unknown>;
        try {
          data = JSON.parse(line.slice(6));
        } catch {
          continue;
        }
        if (event === "token" && typeof data.text === "string") {
          yield { type: "token", text: data.text };
        } else if (event === "meta") {
          yield { type: "meta", quota: data as unknown as ChatQuota };
        } else if (event === "tool" && typeof data.name === "string") {
          yield { type: "tool", name: data.name };
        } else if (event === "error") {
          yield { type: "error", message: String(data.message ?? "chat failed") };
        }
      }
    }
  }
}
