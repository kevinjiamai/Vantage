import {
  getAI,
  getGenerativeModel,
  GoogleAIBackend,
  Schema,
  type ChatSession,
  type FunctionCall,
} from "firebase/ai";
import { app } from "./firebase";
import { fetchScreen } from "./stocks";
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
- For any question about which stocks meet a condition, or which lead or lag on a
  measure, call screen_watchlist. Never estimate an indicator, and never rank from the
  snapshot when the tool can answer it — the snapshot may be partial.
- Report the coverage the tool gives back (how many matched, how many were screened),
  and never present a ranking over part of the list as if it covered all of it.
- Chart patterns (cup and handle, double bottom, breakouts) need bar-by-bar history the
  tool does not expose yet. Say so plainly instead of guessing from indicators.
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

// ─── Tools ─────────────────────────────────────────────────────────────────────
// The model chooses a filter; the backend computes every number. It is never
// asked to derive an indicator itself, which is where confident nonsense
// comes from.

const SCREEN_METRICS = [
  "price", "changePercent", "ret_1m", "ret_3m", "ret_6m", "ret_ytd", "ret_1y",
  "pct_off_52w_high", "pct_off_52w_low", "rsi14", "pct_vs_ma50", "pct_vs_ma200",
  "vol_vs_50d", "atr_pct", "volume",
].join(", ");

const SCREEN_TOOL = {
  functionDeclarations: [{
    name: "screen_watchlist",
    description:
      "Filter and rank the user's whole watchlist by computed technical indicators. " +
      "Use this for any question about which stocks meet a condition or lead/lag on a " +
      "measure — best/worst over a period, near highs or lows, oversold, above a moving " +
      "average, unusual volume. Never estimate these numbers yourself. " +
      `Available metrics: ${SCREEN_METRICS}. ` +
      "Percent metrics are already percentages (5.2 means +5.2%); pct_off_52w_high is " +
      "negative below the high. vol_vs_50d is a multiple (1.5 = 50% above average).",
    parameters: Schema.object({
      properties: {
        where: Schema.string({
          description:
            "Comma-separated filter clauses, each metric<op>number with op one of " +
            "< <= > >= = != . Example: 'rsi14<30,vol_vs_50d>=1.5'. Omit for no filter.",
          nullable: true,
        }),
        sort: Schema.string({
          description: "Metric to sort by; prefix with '-' for descending, e.g. '-ret_ytd'.",
          nullable: true,
        }),
        limit: Schema.number({
          description: "Maximum rows to return (1-200). Default 25.",
          nullable: true,
        }),
      },
      optionalProperties: ["where", "sort", "limit"],
    }),
  }],
};

async function runScreen(args: Record<string, unknown>, symbols: string[]) {
  try {
    const res = await fetchScreen(symbols, {
      where: typeof args.where === "string" ? args.where : undefined,
      sort: typeof args.sort === "string" ? args.sort : undefined,
      limit: typeof args.limit === "number" ? args.limit : undefined,
    });
    return {
      ...res,
      note:
        `Ranked ${res.matched} matches out of ${res.screened} tickers screened ` +
        `(${res.requested} requested${res.no_data.length ? `, no data for ${res.no_data.join(", ")}` : ""}). ` +
        "State this coverage when reporting a ranking.",
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "screen failed" };
  }
}

async function dispatch(call: FunctionCall, symbols: string[]) {
  const args = (call.args ?? {}) as Record<string, unknown>;
  if (call.name === "screen_watchlist") return runScreen(args, symbols);
  return { error: `unknown tool ${call.name}` };
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
    tools: [SCREEN_TOOL],
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

/** Cap on tool round-trips per message, so a confused model cannot loop forever. */
const MAX_TOOL_ROUNDS = 3;

/** Stream a reply; yields incremental full text so far. */
export async function* streamChatReply(
  message: string,
  ctx: ChatContext,
): AsyncGenerator<string> {
  const session = ensureChat(ctx);
  let next: string =
    `${message}\n\n(Latest app context)\n${contextBlock(ctx)}`;
  let full = "";

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    let result;
    try {
      result = await session.sendMessageStream(next);
    } catch (err) {
      // A later round can fail after we already have a usable answer.
      if (!full) throw err;
      break;
    }
    let streamBroke = false;
    try {
      for await (const chunk of result.stream) {
        const t = chunk.text();
        if (t) {
          full += t;
          yield full;
        }
      }
    } catch (err) {
      // The SSE stream occasionally dies mid-reply (AI/parse-failed). Keeping the
      // partial answer beats throwing away a reply that was nearly complete.
      if (!full) throw err;
      streamBroke = true;
    }

    let response;
    try {
      response = streamBroke ? null : await result.response;
    } catch {
      response = null; // stream already consumed
    }
    if (!response) break;

    const calls = response.functionCalls?.() ?? [];
    if (!calls.length) {
      const final = response.text() || "";
      if (final.length > full.length) {
        full = final;
        yield full;
      }
      break;
    }

    if (round === MAX_TOOL_ROUNDS) {
      full += "\n\nI couldn't finish looking that up. Try narrowing the question.";
      yield full;
      break;
    }

    const placeholder = "Screening your watchlist…";
    if (!full) {
      full = placeholder;
      yield full;
    }
    const results = await Promise.all(
      calls.map(async call => ({
        tool: call.name,
        args: call.args ?? {},
        result: await dispatch(call, ctx.watchlistSymbols),
      })),
    );
    // Results go back as a user turn, not a functionResponse part: this backend
    // rejects the SDK's "function" role ("Please use a valid role: ... USER, MODEL").
    if (full === placeholder) full = "";
    next =
      "Tool results as JSON. These numbers are authoritative — quote them exactly, " +
      "do not recompute or round away detail, and report the coverage in `note`.\n" +
      JSON.stringify(results);
  }

  if (!full) yield "I couldn't generate a reply. Try again.";
}
