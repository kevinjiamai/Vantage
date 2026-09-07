# Vantage

A stock market simulator that lets you learn how investing works by trading with play money against real market data.

> **Disclaimer:** Vantage is for informational and educational purposes only. It does not provide financial advice. See [Disclaimer](#disclaimer) below.

## What problem does it solve?

Learning to invest has a bad first step: the only realistic way to practice is to risk real money. Paper-trading tools that avoid that risk tend to be either buried inside a brokerage account you must open and fund first, or so simplified that they teach nothing about how a real portfolio behaves.

Vantage removes the risk without removing the realism:

- **Trade with simulated cash against real prices.** Deposit play money into a virtual bank balance, then buy and sell using live quotes and historical charts from real market data.
- **Watch a portfolio behave over time.** Holdings track average cost, unrealised profit and loss, and total value, so you see how positions actually move.
- **Organise what you follow.** Custom watchlists, CSV import, pinning, manual ordering and per-symbol chart ranges.
- **Ask questions in context.** A built-in assistant answers questions grounded in your actual watchlist — screening it by computed indicators rather than guessing.
- **Keep your progress.** Sign in and your balance, holdings, transactions, watchlists and preferences sync across devices.

## Which document do you want?

This project has three audiences. They overlap — if you run Vantage for yourself you are all three — but the setup each one needs is different.

| You are… | You want | Read |
| --- | --- | --- |
| **Using** a Vantage someone else runs | accounts, watchlists, the assistant, daily limits, connecting your own model | **[docs/USING.md](docs/USING.md)** |
| **Running** Vantage as a service | deployment, database, configuration, model provider, tiers, day-to-day operation | **[docs/OPERATING.md](docs/OPERATING.md)** |
| **Working on** the code | local setup, layout, tests, conventions | **[docs/DEVELOPING.md](docs/DEVELOPING.md)** |

Nothing in the app requires an end user to create an account with any third party. Signing in, syncing and the assistant all go through the Vantage service itself.

## Architecture at a glance

```
Browser (React + Vite)
  └── /api/*  ──►  Vantage service (FastAPI)
                     ├── accounts, sessions, saved state  ──►  database
                     ├── quotes, history, screening, patterns  ──►  Yahoo Finance
                     └── assistant  ──►  any OpenAI-compatible model provider
```

The browser talks to one origin. Whichever model provider backs the assistant is the service's concern, not the user's — see [docs/OPERATING.md](docs/OPERATING.md).

| Layer | Technology |
| --- | --- |
| Frontend | React 18, TypeScript, Vite 6, Tailwind CSS 4, Recharts |
| Backend | FastAPI, Uvicorn, SQLAlchemy, yfinance (Python 3.12) |
| Accounts | bcrypt password hashing, signed session tokens |
| Storage | SQLite for development, Postgres in production |
| Assistant | Any OpenAI-compatible provider, with server-side tool calls |
| Hosting | Vercel (frontend), Render (API), managed Postgres |

## Disclaimer

**Vantage is for informational and educational purposes only. It does not provide financial advice.**

- Nothing in this application — including market data, charts, news, portfolio metrics, screening results, detected chart patterns, or output from the assistant — constitutes financial, investment, tax, legal or other professional advice, and none of it is a recommendation, offer or solicitation to buy or sell any security.
- All trading in Vantage is **simulated**. Balances, deposits, holdings and transactions use play money with no real-world value. No real funds are held, transferred or invested, and the app connects to no brokerage or bank.
- Market data is sourced from third-party providers and may be delayed, incomplete or inaccurate. It is not suitable for any real trading decision.
- Screening and pattern detection are mechanical measurements of past price and volume. A detected pattern is a description of what price has already done, not a prediction, and the detectors report their own quality caveats for a reason.
- The assistant is powered by a large language model and can produce content that is incorrect, outdated or misleading. Verify anything it tells you against authoritative sources.
- Simulated results do not predict real outcomes. Investing involves risk, including the possible loss of principal.
- Consult a qualified, licensed financial professional before making any investment decision. You are solely responsible for any decision you make, and the authors and contributors accept no liability for any loss arising from use of this application.

## Licence and attributions

See [ATTRIBUTIONS.md](ATTRIBUTIONS.md).
