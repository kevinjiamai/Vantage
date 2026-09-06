import {
  useCallback, useEffect, useRef, useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { MessageCircle, Send, X, Sparkles, Trash2 } from "lucide-react";
import { resetChat, streamChatReply, type ChatContext } from "../lib/gemini";
import { fetchPerformance } from "../lib/stocks";

const G = "#34d399";
const R = "#f87171";

interface Msg {
  id: string;
  role: "user" | "assistant";
  text: string;
}

const WELCOME =
  "Hi — I’m Vantage AI. Ask for stock ideas, pattern reads, or anything about markets and your portfolio.";

const SUGGESTIONS = [
  "Recommend 3 growth stocks for my watchlists",
  "What patterns do you see in my holdings?",
  "Explain today’s market movers simply",
];

const DEFAULT_W = 720;
const DEFAULT_H = 480;
const MIN_W = 420;
const MIN_H = 320;
const Z = 10000;

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

function ThinkingDots() {
  return (
    <span className="inline-flex items-center gap-1 px-0.5 py-0.5" aria-label="Thinking">
      {[0, 1, 2].map(i => (
        <span
          key={i}
          className="w-1.5 h-1.5 rounded-full"
          style={{
            background: "var(--v-ink-dim)",
            animation: "vantage-chat-dot 1.2s ease-in-out infinite",
            animationDelay: `${i * 0.2}s`,
          }}
        />
      ))}
      <style>{`
        @keyframes vantage-chat-dot {
          0%, 80%, 100% { opacity: 0.25; transform: translateY(0); }
          40% { opacity: 1; transform: translateY(-3px); }
        }
      `}</style>
    </span>
  );
}

/** Lightweight markdown → React (bold, italic, code, lists, paragraphs). */
function renderMarkdown(text: string): ReactNode {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let listItems: string[] = [];
  let listKey = 0;

  const flushList = () => {
    if (!listItems.length) return;
    blocks.push(
      <ul key={`ul-${listKey++}`} className="list-disc pl-4 my-1.5 space-y-1">
        {listItems.map((item, i) => (
          <li key={i}>{inlineMd(item)}</li>
        ))}
      </ul>
    );
    listItems = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const heading = line.match(/^\s*#{1,3}\s+(.*)$/);

    if (bullet || numbered) {
      listItems.push((bullet ?? numbered)![1]);
      continue;
    }
    flushList();

    if (!line.trim()) {
      blocks.push(<div key={`sp-${i}`} className="h-2" />);
      continue;
    }
    if (heading) {
      blocks.push(
        <div key={`h-${i}`} className="font-semibold mt-1 mb-0.5">
          {inlineMd(heading[1])}
        </div>
      );
      continue;
    }
    blocks.push(
      <p key={`p-${i}`} className="my-0.5">
        {inlineMd(line)}
      </p>
    );
  }
  flushList();
  return <>{blocks}</>;
}

function inlineMd(text: string): ReactNode {
  const parts: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const token = m[0];
    if (token.startsWith("**")) {
      parts.push(<strong key={k++}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith("`")) {
      parts.push(
        <code
          key={k++}
          className="font-mono text-[0.92em] px-1 py-0.5 rounded"
          style={{ background: "rgba(0,0,0,0.2)" }}
        >
          {token.slice(1, -1)}
        </code>
      );
    } else {
      parts.push(<em key={k++}>{token.slice(1, -1)}</em>);
    }
    last = m.index + token.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length ? parts : text;
}

export function VantageChat({ context }: { context: ChatContext }) {
  const [open, setOpen] = useState(false);
  const [performance, setPerformance] = useState<Record<string, number> | undefined>();
  const [perfLoading, setPerfLoading] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([
    { id: "welcome", role: "assistant", text: WELCOME },
  ]);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const [pos, setPos] = useState({ x: 0, y: 0 });
  const [size, setSize] = useState({ w: DEFAULT_W, h: DEFAULT_H });
  const posRef = useRef(pos);
  const sizeRef = useRef(size);
  posRef.current = pos;
  sizeRef.current = size;

  const dragRef = useRef<{
    mode: "move" | "resize";
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    origW: number;
    origH: number;
  } | null>(null);

  const placeCentered = useCallback(() => {
    const w = clamp(DEFAULT_W, MIN_W, window.innerWidth - 24);
    const h = clamp(DEFAULT_H, MIN_H, window.innerHeight - 24);
    const next = {
      w,
      h,
      x: Math.round((window.innerWidth - w) / 2),
      y: Math.round((window.innerHeight - h) / 2),
    };
    setSize({ w: next.w, h: next.h });
    setPos({ x: next.x, y: next.y });
  }, []);

  useEffect(() => {
    if (!open) return;
    placeCentered();
  }, [open, placeCentered]);

  useEffect(() => {
    if (!open) return;
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, open, busy]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Load range performance once the panel opens. The cold batch takes ~30s for
  // a few hundred symbols, so it must not run on app start; the server caches
  // it per symbol, making every later open fast.
  //
  // Staleness is tracked through loadedKey rather than a cleanup flag: the
  // symbol list is a fresh array on every App render, so a cleanup would
  // cancel the in-flight request on the very next render (setPerfLoading
  // alone causes one) and the dedupe guard would then block the retry.
  const perfKey = `${context.range}:${context.watchlistSymbols.join(",")}`;
  const loadedKey = useRef<string>("");
  useEffect(() => {
    if (!open || !context.range || !context.watchlistSymbols.length) return;
    if (loadedKey.current === perfKey) return;
    loadedKey.current = perfKey;
    const key = perfKey;
    setPerfLoading(true);
    fetchPerformance(context.watchlistSymbols, context.range)
      .then(rows => {
        if (loadedKey.current !== key) return;
        setPerformance(Object.fromEntries(rows.map(r => [r.symbol, r.changePercent])));
      })
      .catch(() => {
        // Leave performance undefined: contextBlock then tells the model it
        // only has 1-day data, which beats ranking on the wrong numbers.
        if (loadedKey.current === key) loadedKey.current = "";
      })
      .finally(() => {
        if (loadedKey.current === key || loadedKey.current === "") setPerfLoading(false);
      });
    // context fields are read through perfKey; adding the array itself would
    // re-run this on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, perfKey]);

  const chatContext: ChatContext = { ...context, performance };

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      e.preventDefault();
      if (d.mode === "move") {
        const { w, h } = sizeRef.current;
        const maxX = window.innerWidth - w;
        const maxY = window.innerHeight - h;
        setPos({
          x: clamp(d.origX + (e.clientX - d.startX), 0, Math.max(0, maxX)),
          y: clamp(d.origY + (e.clientY - d.startY), 0, Math.max(0, maxY)),
        });
      } else {
        const w = clamp(d.origW + (e.clientX - d.startX), MIN_W, window.innerWidth - d.origX - 8);
        const h = clamp(d.origH + (e.clientY - d.startY), MIN_H, window.innerHeight - d.origY - 8);
        setSize({ w, h });
      }
    };
    const onUp = () => { dragRef.current = null; };
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, []);

  const startMove = (e: ReactPointerEvent) => {
    if ((e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current = {
      mode: "move",
      startX: e.clientX,
      startY: e.clientY,
      origX: posRef.current.x,
      origY: posRef.current.y,
      origW: sizeRef.current.w,
      origH: sizeRef.current.h,
    };
  };

  const startResize = (e: ReactPointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current = {
      mode: "resize",
      startX: e.clientX,
      startY: e.clientY,
      origX: posRef.current.x,
      origY: posRef.current.y,
      origW: sizeRef.current.w,
      origH: sizeRef.current.h,
    };
  };

  const send = useCallback(async (raw: string) => {
    const text = raw.trim();
    if (!text || busy) return;
    setInput("");
    setError(null);
    const userId = "u-" + Date.now();
    const botId = "a-" + Date.now();
    setMessages(prev => [
      ...prev,
      { id: userId, role: "user", text },
      { id: botId, role: "assistant", text: "" },
    ]);
    setBusy(true);
    try {
      for await (const partial of streamChatReply(text, chatContext)) {
        setMessages(prev => prev.map(m => (m.id === botId ? { ...m, text: partial } : m)));
      }
    } catch (err) {
      console.error("[VantageChat] reply failed:", err);
      const msg = err instanceof Error ? err.message : "Chat failed";
      // Match the specific failure: a quota error sent people to the Firebase
      // console to enable an API that was already on.
      setError(
        /\b429\b|quota|rate.?limit/i.test(msg)
          ? "Gemini's request quota is used up. Try again shortly, or raise the limit in Google AI Studio."
          : /api-not-enabled|has not been used|is disabled/i.test(msg)
            ? "Gemini isn’t enabled for this Firebase project. Turn on Firebase AI Logic in the console."
            : /permission|PERMISSION|unauthor|API key/i.test(msg)
              ? "Gemini rejected the request as unauthorised. Check the Firebase API key and its restrictions."
              : /parse|stream/i.test(msg)
                ? "The reply was cut off mid-stream. Try asking again."
                : "Something went wrong. Try again in a moment."
      );
      setMessages(prev => prev.map(m => (
        m.id === botId && !m.text
          ? { ...m, text: "I couldn’t complete that reply." }
          : m
      )));
    } finally {
      setBusy(false);
    }
  }, [busy, chatContext]);

  const clear = () => {
    resetChat();
    setError(null);
    setMessages([{ id: "welcome", role: "assistant", text: WELCOME }]);
  };

  const showSuggestions = messages.length <= 1 && messages[0]?.id === "welcome";
  const waitingId = busy
    ? [...messages].reverse().find(m => m.role === "assistant" && !m.text)?.id
    : null;

  const fab = (
    <button
      type="button"
      className="fixed bottom-5 left-5 w-12 h-12 rounded-full flex items-center justify-center shadow-lg transition-transform hover:scale-105"
      style={{ background: G, color: "#0a0a0a", zIndex: Z + 2 }}
      onClick={() => setOpen(v => !v)}
      title={open ? "Close chat" : "Open Vantage AI"}
      aria-label={open ? "Close chat" : "Open Vantage AI"}
    >
      {open ? <X size={20} strokeWidth={2.5} /> : <MessageCircle size={20} strokeWidth={2.5} />}
    </button>
  );

  const overlay = open ? (
    <div style={{ position: "fixed", inset: 0, zIndex: Z }} aria-modal="true" role="dialog">
      <div
        className="absolute inset-0"
        style={{ background: "rgba(0,0,0,0.45)" }}
        onClick={() => setOpen(false)}
      />
      <div
        ref={panelRef}
        className="absolute flex flex-col rounded-2xl border shadow-2xl"
        style={{
          left: pos.x,
          top: pos.y,
          width: size.w,
          height: size.h,
          background: "var(--v-panel)",
          borderColor: "var(--v-line-strong)",
          boxShadow: "0 24px 64px rgba(0,0,0,0.5)",
          zIndex: 1,
          overflow: "hidden",
        }}
        onClick={e => e.stopPropagation()}
      >
        <div
          className="flex items-center gap-2.5 px-4 py-3 border-b flex-shrink-0 cursor-grab active:cursor-grabbing select-none"
          style={{ borderColor: "var(--v-line)" }}
          onPointerDown={startMove}
        >
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center"
            style={{ background: "rgba(52,211,153,0.15)" }}
          >
            <Sparkles size={15} style={{ color: G }} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[13px] font-semibold tracking-wide" style={{ color: "var(--v-ink)" }}>
              Vantage AI
            </div>
            <div className="text-[11px] font-mono" style={{ color: "var(--v-ink-dim)" }}>
              Gemini · not financial advice
            </div>
          </div>
          <button
            type="button"
            className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/10 transition-colors"
            onClick={clear}
            title="Clear chat"
          >
            <Trash2 size={14} style={{ color: "var(--v-ink-dim)" }} />
          </button>
          <button
            type="button"
            className="w-8 h-8 rounded-lg flex items-center justify-center hover:bg-white/10 transition-colors"
            onClick={() => setOpen(false)}
            title="Close"
          >
            <X size={15} style={{ color: "var(--v-ink-dim)" }} />
          </button>
        </div>

        <div
          ref={listRef}
          className="flex-1 overflow-y-auto px-4 py-3.5 flex flex-col gap-3 min-h-0"
          style={{ scrollbarWidth: "thin", scrollbarColor: "var(--v-line-strong) transparent" }}
        >
          {messages.map(m => (
            <div
              key={m.id}
              className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ${
                m.role === "user" ? "self-end whitespace-pre-wrap" : "self-start"
              }`}
              style={
                m.role === "user"
                  ? { background: G, color: "#0a0a0a" }
                  : { background: "var(--v-line)", color: "var(--v-ink)" }
              }
            >
              {m.role === "assistant"
                ? (m.text ? renderMarkdown(m.text) : (m.id === waitingId ? <ThinkingDots /> : ""))
                : m.text}
            </div>
          ))}
          {showSuggestions && (
            <div className="flex flex-wrap gap-2 mt-1">
              {SUGGESTIONS.map(s => (
                <button
                  key={s}
                  type="button"
                  disabled={busy}
                  className="text-left text-[12px] px-3.5 py-2.5 rounded-xl transition-colors hover:bg-white/5 disabled:opacity-50"
                  style={{ color: "var(--v-ink-soft)", border: "1px solid var(--v-line-strong)" }}
                  onClick={() => send(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          )}
          {error && (
            <div className="text-[12px] font-mono px-1" style={{ color: R }}>{error}</div>
          )}
        </div>

        <div className="flex-shrink-0 p-3.5 border-t" style={{ borderColor: "var(--v-line)" }}>
          <div
            className="flex items-end gap-2 rounded-xl px-3 py-2.5"
            style={{ background: "var(--v-line)", border: "1px solid var(--v-line-strong)" }}
          >
            <textarea
              ref={inputRef}
              rows={2}
              value={input}
              disabled={busy}
              placeholder="Ask about stocks, patterns…"
              className="flex-1 resize-none bg-transparent outline-none text-[13px] font-mono max-h-28 py-1"
              style={{ color: "var(--v-ink)" }}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  send(input);
                }
              }}
            />
            <button
              type="button"
              disabled={busy || !input.trim()}
              className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 transition-opacity disabled:opacity-40"
              style={{ background: G, color: "#0a0a0a" }}
              onClick={() => send(input)}
            >
              <Send size={14} strokeWidth={2.5} />
            </button>
          </div>
        </div>

        {/* Resize handle — large hit target, bottom-right */}
        <div
          className="absolute bottom-0 right-0 z-10"
          style={{ width: 28, height: 28, cursor: "nwse-resize", touchAction: "none" }}
          onPointerDown={startResize}
          title="Drag to resize"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 14 14"
            className="absolute bottom-1.5 right-1.5 pointer-events-none"
            style={{ color: "var(--v-ink-dim)" }}
          >
            <path d="M12 2v10H2" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.35" />
            <path d="M12 6v6H6" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.55" />
            <path d="M12 10v2h-2" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.85" />
          </svg>
        </div>
      </div>
    </div>
  ) : null;

  return createPortal(
    <>
      {overlay}
      {fab}
    </>,
    document.body,
  );
}
