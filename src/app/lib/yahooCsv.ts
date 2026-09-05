/**
 * Yahoo Finance portfolio/watchlist CSV export.
 *
 * The file Yahoo produces (Portfolio → ⋮ → Export) starts with a header row
 * whose first column is "Symbol"; every later row's first field is a ticker.
 * Only that column is read — the quote columns are a snapshot of Yahoo's
 * prices at export time and are always staler than our own feed.
 */

/** Yahoo tickers in the form our quote backend accepts: BRK-B, ^VIX, ES=F, BTC-USD. */
const SYMBOL_RE = /^[A-Z0-9.^=_-]{1,15}$/;

export interface ParsedYahooCsv {
  /** Valid tickers, uppercased and deduped, in file order. */
  symbols: string[];
  /** Non-empty first fields that were not usable tickers, deduped. */
  rejected: string[];
}

/** Split one CSV line, honouring double-quoted fields (the Comment column may hold commas). */
function splitRow(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') { field += '"'; i++; }
        else quoted = false;
      } else field += c;
    } else if (c === '"') {
      quoted = true;
    } else if (c === ",") {
      out.push(field);
      field = "";
    } else {
      field += c;
    }
  }
  out.push(field);
  return out;
}

/**
 * Pull the ticker column out of a Yahoo CSV export.
 *
 * Also accepts a bare list of tickers (one per line, or comma-separated) so the
 * same path serves pasted text. Never throws: malformed input yields empty
 * `symbols` and the offending fields in `rejected`.
 */
export function parseYahooCsv(text: string): ParsedYahooCsv {
  const rows = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!rows.length) return { symbols: [], rejected: [] };

  const first = splitRow(rows[0])[0]?.trim().toLowerCase();
  const body = first === "symbol" ? rows.slice(1) : rows;

  const seen = new Set<string>();
  const rejectedSeen = new Set<string>();
  const symbols: string[] = [];
  const rejected: string[] = [];

  for (const row of body) {
    const raw = splitRow(row)[0]?.trim();
    if (!raw) continue;
    const sym = raw.toUpperCase();
    if (!SYMBOL_RE.test(sym)) {
      if (!rejectedSeen.has(raw)) { rejectedSeen.add(raw); rejected.push(raw); }
      continue;
    }
    if (seen.has(sym)) continue;
    seen.add(sym);
    symbols.push(sym);
  }

  return { symbols, rejected };
}

/** Default list name for an import, derived from the file name. */
export function watchlistNameFromFile(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
  if (!base) return "Imported";
  return base.charAt(0).toUpperCase() + base.slice(1);
}
