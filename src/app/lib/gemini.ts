import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  type ChatSession,
} from "firebase/ai";
import { app } from "./firebase";
import type { StockMeta, TimeRange } from "./stocks";

const ai = getAI(app, { backend: new GoogleAIBackend() });

const SYSTEM = `You are Vantage AI, a helpful investing assistant inside the Vantage stock app.
You help users with:
- Stock recommendations and ideas (with clear reasoning)
- Pattern / technical / trend analysis based on data they share
- Explaining markets, sectors, ETFs, and portfolio concepts
- Answering questions about tickers they follow

Rules:
- Be concise and practical. Use short paragraphs or bullets when useful.
- Format with simple markdown: **bold**, bullets, and short headings when helpful.
- Always finish complete sentences and complete every bullet — never cut off mid-thought.
- Always remind users this is not financial advice and markets involve risk.
- Prefer tickers and facts grounded in the portfolio/market context provided.
- When ranking or comparing performance, use only the rows in the market snapshot,
  and state the period and how many tickers you ranked. Never present a ranking over
  part of the list as if it covered all of it.
- If data is missing, say so and ask a clarifying question.
- Do not invent precise live prices; use the provided snapshot when available.
- Aim for clear answers; go longer when the user asks for depth.`;

export interface ChatContext {
  signedIn: boolean;
  watchlistSymbols: string[];
  holdings: { symbol: string; shares: number; avgCost: number }[];
  stocks: Pick<StockMeta, "symbol" | "name" | "sector" | "price" | "changePercent">[];
  /** Range the performance figures cover, e.g. "YTD". */
  range?: TimeRange;
  /** Percent change over `range`, by symbol. Absent until loaded. */
  performance?: Record<string, number>;
}

/**
 * Cap on rows in the market snapshot. High enough to carry a whole imported
 * watchlist: ~200 rows is roughly 2.5k tokens against a 1M window, and a
 * truncated list makes the model rank a sample while sounding authoritative.
 */
const MAX_SNAPSHOT_ROWS = 300;

function contextBlock(ctx: ChatContext): string {
  const perf = ctx.performance;
  const rangeLabel = ctx.range ?? "1D";

  const lines: string[] = [
    `User signed in: ${ctx.signedIn ? "yes" : "no"}`,
    `Watchlist tickers (${ctx.watchlistSymbols.length}): ${ctx.watchlistSymbols.join(", ") || "(none)"}`,
  ];

  if (ctx.holdings.length) {
    lines.push(
      "Holdings: " +
        ctx.holdings
          .slice(0, 20)
          .map(h => `${h.symbol} ${h.shares}@$${h.avgCost.toFixed(2)}`)
          .join("; ")
    );
  } else {
    lines.push("Holdings: (none)");
  }

  if (ctx.stocks.length) {
    // Sorted by range performance so that if the cap ever bites it keeps the
    // extremes, which is what ranking questions are about.
    const ranked = [...ctx.stocks].sort((a, b) => {
      const pa = perf?.[a.symbol];
      const pb = perf?.[b.symbol];
      if (pa === undefined && pb === undefined) return 0;
      if (pa === undefined) return 1;
      if (pb === undefined) return -1;
      return pb - pa;
    });
    const shown = ranked.slice(0, MAX_SNAPSHOT_ROWS);

    const pct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
    lines.push(
      `Market snapshot (${shown.length} of ${ctx.stocks.length} tickers` +
        (perf ? `, sorted by ${rangeLabel} change` : "") +
        "):"
    );
    for (const s of shown) {
      const day = Number.isFinite(s.changePercent) ? pct(s.changePercent) : "—";
      const r = perf?.[s.symbol];
      const rangePart = r === undefined ? "" : ` ${rangeLabel} ${pct(r)}`;
      lines.push(`  ${s.symbol} $${s.price.toFixed(2)} 1D ${day}${rangePart} (${s.sector})`);
    }
    if (shown.length < ctx.stocks.length) {
      lines.push(`  (${ctx.stocks.length - shown.length} more not listed)`);
    }
  }

  if (perf) {
    const missing = ctx.stocks.filter(s => perf[s.symbol] === undefined).map(s => s.symbol);
    lines.push(
      `${rangeLabel} performance is available for ${ctx.stocks.length - missing.length} of ` +
        `${ctx.stocks.length} tickers` +
        (missing.length ? `; no data for: ${missing.slice(0, 20).join(", ")}` : "") +
        ". Rank only from the rows above; do not guess for anything absent."
    );
  } else {
    lines.push(
      "No multi-day performance data is loaded, so only 1-day change is known. " +
        "Say so rather than ranking by 1-day change when asked about a longer period."
    );
  }

  return lines.join("\n");
}

let chat: ChatSession | null = null;
let chatContextKey = "";

function ensureChat(ctx: ChatContext): ChatSession {
  const key = JSON.stringify({
    signedIn: ctx.signedIn,
    watchlistSymbols: ctx.watchlistSymbols,
    holdings: ctx.holdings.slice(0, 20),
    range: ctx.range,
    hasPerf: !!ctx.performance,
  });
  if (chat && key === chatContextKey) return chat;

  const model = getGenerativeModel(ai, {
    model: "gemini-flash-latest",
    systemInstruction: SYSTEM,
    generationConfig: {
      temperature: 0.7,
      topP: 0.95,
      topK: 40,
      maxOutputTokens: 4096,
    },
  });

  chat = model.startChat({
    history: [
      {
        role: "user",
        parts: [{ text: `App context for this session:\n${contextBlock(ctx)}` }],
      },
      {
        role: "model",
        parts: [{
          text: "Got it — I’ll use your watchlists, holdings, and market snapshot when helping. What would you like to explore?",
        }],
      },
    ],
  });
  chatContextKey = key;
  return chat;
}

export function resetChat() {
  chat = null;
  chatContextKey = "";
}

/** Stream a reply; yields incremental full text so far. */
export async function* streamChatReply(
  message: string,
  ctx: ChatContext,
): AsyncGenerator<string> {
  const session = ensureChat(ctx);
  const prompt = `${message}\n\n(Latest app context)\n${contextBlock(ctx)}`;
  const result = await session.sendMessageStream(prompt);
  let full = "";
  for await (const chunk of result.stream) {
    const t = chunk.text();
    if (t) {
      full += t;
      yield full;
    }
  }
  try {
    const response = await result.response;
    const final = response.text() || "";
    if (final.length > full.length) {
      full = final;
      yield full;
    } else if (!full && final) {
      full = final;
      yield full;
    }
  } catch {
    /* stream already consumed */
  }
  if (!full) yield "I couldn’t generate a reply. Try again.";
}
