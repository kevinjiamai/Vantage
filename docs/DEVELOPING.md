# Developing Vantage

For people working on the code. Deploying it instead? See [OPERATING.md](OPERATING.md).

## Setup

**Prerequisites:** Node 20 or 22+ (Vite 6 needs `^18 || ^20 || >=22`), and Python 3.12 to match production.

```bash
git clone <repository-url> Vantage
cd Vantage
npm install

# The npm scripts expect the virtualenv at exactly this path
python3.12 -m venv server/.venv
server/.venv/bin/pip install -r server/requirements-dev.txt
```

No `.env` is needed to start. `SECRET_KEY` is generated per process when unset — sessions then do not survive a restart, which is the right failure for a missing secret — and `DATABASE_URL` defaults to `server/vantage.db`, a gitignored SQLite file.

```bash
npm run dev:all      # API on :8000 and Vite on :5173
```

Vite proxies `/api/*` to the API, so the browser only ever sees one origin. Sign up with any email; there is no verification step.

To point the browser at a different API, put `VITE_API_BASE_URL=http://127.0.0.1:8001` in `.env.local` (gitignored) and restart Vite.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Vite with HMR on :5173 |
| `npm run api` | FastAPI with auto-reload on :8000 |
| `npm run dev:all` | both, the usual way to work |
| `npm run build` | production build to `dist/` |
| `npm test` | client tests (vitest) |
| `npm run test:server` | server tests (pytest) |
| `npm run test:all` | both |

## Layout

```
src/app/
  App.tsx                  pages, trading, wiring
  lib/
    account.ts             accounts, sessions, saved-state sync
    chat.ts                assistant client, SSE streaming, own-model settings
    stocks.ts              market data client, quote and history caches
    screener.ts            client-side filter and sort for the visible list
    trades.ts              buy/sell maths (pure, tested)
    yahooCsv.ts            Yahoo CSV parsing (pure, tested)
  hooks/
    useCloudSync.ts        auth state and the sync lifecycle
    usePreferences.ts      watchlists and view preferences
    usePortfolio.ts        balance, holdings, transactions
    useQuotes.ts           quote loading and refresh
  components/, pages/      UI

server/
  main.py                  routes: market data, screening, patterns, chat, auth, state
  db.py                    SQLAlchemy models, state and usage helpers
  accounts.py              password hashing, sessions, tiers, login throttle
  llm.py                   OpenAI-compatible client, own-model validation
  manage.py                admin CLI
  migrate_firestore.py     one-time import from an earlier Firebase version
  tests/                   pytest
```

## How the pieces fit

**The browser talks to one service.** No third-party SDK is loaded in the client. Accounts, saved state, market data and the assistant all arrive through `/api/*`. Keep it that way — putting a provider SDK back in the browser undoes the reason the current shape exists.

**The model routes; code computes.** The assistant never calculates an indicator or judges a chart. It picks a tool and narrates what comes back. Every number in an answer came from `run_screen` or `run_patterns` in `server/main.py`.

This matters more than it sounds. An early cup-and-handle pass with loose criteria returned forty confident candidates, most of them nonsense. Tightening the geometry cut it to five, and three of those five still failed on sight — a leveraged ETN, a "recovery" that was one gap day, a base too V-shaped to qualify. **The criteria are the product.** Detectors return their measurements and a list of quality flags rather than a boolean, and the caller has to surface them.

**Tools report coverage.** Every tool result carries how many symbols matched, how many were screened and which had no data, and the system prompt requires the model to state it. A ranking over part of a list presented as complete is the specific failure this design exists to prevent.

**History-backed endpoints cache per symbol, not per request.** Yahoo returns large batches half-empty when throttled. A whole-response cache pins that partial result for the full TTL; per-symbol entries mean a throttled run only leaves the symbols it missed for the next call to retry. This took coverage of a 200-symbol screen from 61 to 203.

**Quote requests are chunked.** The API rejects more than 40 symbols per request, so `fetchQuotes` and `mergeQuotes` batch. Anything new that fans out over a watchlist needs to as well.

## Conventions

- **Comments explain what the code cannot.** A constraint, a unit, a workaround for someone else's behaviour, an invariant a later edit could break. Not what the line already says.
- **Pure logic gets tests.** `trades.ts`, `yahooCsv.ts` and `screener.ts` are pure and covered. Anything security-relevant on the server is covered in `server/tests`.
- **Defensive parsing at the boundary.** `src/app/types.ts` treats stored and server data as untrusted, because one bad value should not take the app down.
- **Never log a credential.** Passwords pass through `/api/auth/*` and user model keys pass through `/api/chat`. Neither may reach a log, an error message or a response body.

## Testing notes

Server tests rebuild `db` and `accounts` against a temporary SQLite file per test, so import-time configuration (the `SECRET_KEY` length check, the ephemeral-storage refusal) is exercised rather than bypassed.

`tests/test_api.py` checks CORS preflight per method. That is not paranoia: allowing only `GET` and `POST` once broke every `PUT`, `PATCH` and `DELETE` in the browser while passing every `curl` test, because `curl` ignores CORS.

Client tests avoid the network. `screener.test.ts` stubs the history cache so it tests screening rather than the quote pipeline.

## Gotchas

- **Signed out, watchlists do not persist.** They live in memory. Sign in to exercise the sync path.
- **State writes are debounced** 800ms and sent as one full document, coalescing rapid trades into a single write.
- **`server/.yf_cache.json`** holds market data between restarts and is gitignored. Delete it if you suspect stale quotes.
- **Yahoo throttles.** The UI degrades to `stale` and keeps the last good prices rather than showing zeros. Test against that path, not just the happy one.
- **A cold screen or pattern scan is slow** — roughly 30 seconds for 200 symbols — then near-instant from cache. Never put one on a request path a user waits on synchronously.
- **Vite occasionally serves a stale transform** after an edit. If a change seems not to apply, restart with `--force`.
