import { ExternalLink, Newspaper } from "lucide-react";
import { useEffect, useState } from "react";
import { G } from "../../lib/format";
import { fetchStockNews, type StockNewsItem } from "../../lib/stocks";

type NewsStatus = "loading" | "live" | "empty" | "error";

function NewsSkeleton() {
  return (
    <div className="flex flex-col gap-0">
      {[0, 1, 2].map(i => (
        <div key={i} className="flex gap-3 px-3 py-3 border-b last:border-b-0" style={{ borderColor: "var(--v-line)" }}>
          <div className="h-14 w-20 rounded-lg flex-shrink-0" style={{ background: "var(--v-line-strong)" }} />
          <div className="flex-1 flex flex-col gap-2 justify-center">
            <div className="h-3 rounded" style={{ width: "90%", background: "var(--v-line-strong)" }} />
            <div className="h-3 rounded" style={{ width: "60%", background: "var(--v-line-strong)" }} />
          </div>
        </div>
      ))}
    </div>
  );
}

function Thumbnail({ item }: { item: StockNewsItem }) {
  if (!item.image) return <Newspaper size={18} style={{ color: "var(--v-ink-dim)" }} />;
  return (
    <img
      src={item.image}
      alt=""
      className="w-full h-full object-cover"
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={e => {
        // Try the unproxied URL once, then give up rather than loop.
        const el = e.currentTarget;
        if (item.rawImage && el.dataset.fallback !== "1") {
          el.dataset.fallback = "1";
          el.src = item.rawImage;
          return;
        }
        el.style.visibility = "hidden";
      }}
    />
  );
}

/** Headlines for one symbol. Owns its own fetch, refetching when the symbol changes. */
export function NewsFeed({ symbol }: { symbol: string }) {
  const [news, setNews] = useState<StockNewsItem[]>([]);
  const [status, setStatus] = useState<NewsStatus>("loading");

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setNews([]);
    (async () => {
      try {
        const items = await fetchStockNews(symbol);
        if (cancelled) return;
        setNews(items);
        setStatus(items.length ? "live" : "empty");
      } catch {
        if (cancelled) return;
        setNews([]);
        setStatus("error");
      }
    })();
    return () => { cancelled = true; };
  }, [symbol]);

  return (
    <div
      className="rounded-2xl border flex-shrink-0"
      style={{ background: "var(--v-panel)", borderColor: "var(--v-line-strong)" }}
      data-testid="stock-news"
    >
      <div className="px-4 py-3 border-b flex items-center justify-between gap-2" style={{ borderColor: "var(--v-line)" }}>
        <div className="flex items-center gap-2">
          <Newspaper size={14} style={{ color: G }} />
          <div className="text-[11px] font-mono uppercase tracking-[0.12em] font-semibold" style={{ color: "var(--v-ink)" }}>
            Live news
          </div>
        </div>
        <div className="text-[10px] font-mono" style={{ color: "var(--v-ink-dim)" }}>
          {status === "loading" ? "loading…"
            : status === "live" ? `${news.length} headline${news.length === 1 ? "" : "s"}`
            : status === "error" ? "unavailable"
            : "none"}
        </div>
      </div>

      {status === "loading" && <NewsSkeleton />}

      {status === "error" && (
        <div className="px-4 py-6 text-center text-sm font-mono" style={{ color: "var(--v-ink-dim)" }}>
          News unavailable
        </div>
      )}

      {status === "empty" && (
        <div className="px-4 py-6 text-center text-sm font-mono" style={{ color: "var(--v-ink-dim)" }}>
          No recent headlines
        </div>
      )}

      {status === "live" && (
        <div className="flex flex-col">
          {news.map((item, idx) => (
            <a
              key={item.id || `${item.url}-${idx}`}
              href={item.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex gap-3 px-3 py-3 transition-colors hover:bg-white/5 border-b last:border-b-0"
              style={{ borderColor: "var(--v-line)" }}
            >
              <div
                className="h-14 w-20 rounded-lg overflow-hidden flex-shrink-0 border flex items-center justify-center"
                style={{ background: "var(--v-line)", borderColor: "var(--v-line-strong)" }}
              >
                <Thumbnail item={item} />
              </div>
              <div className="min-w-0 flex-1 self-center">
                <div className="text-[12px] font-medium leading-snug" style={{ color: "var(--v-ink)" }}>
                  {item.title}
                </div>
                <div className="mt-1 flex items-center gap-1.5 text-[10px] font-mono" style={{ color: "var(--v-ink-dim)" }}>
                  <span className="truncate">{item.publisher || "Yahoo Finance"}</span>
                  <ExternalLink size={10} className="flex-shrink-0 opacity-70" />
                </div>
              </div>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
