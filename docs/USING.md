# Using Vantage

For people using a Vantage service. You need an email address and nothing else — no Google account, no API keys, no third-party sign-up.

Running the service yourself? See [OPERATING.md](OPERATING.md) instead.

## Signing in

Vantage accounts belong to the Vantage service you are using. Sign up with an email address, a name and a password of at least 8 characters.

**Without an account** the app still works: browse quotes, charts and news, build watchlists, and try the assistant a few times a day. But nothing is saved — watchlists and settings live in the page and disappear when you reload.

**With an account** your balance, holdings, transaction history, watchlists and preferences are stored by the service and follow you between devices and browsers.

There is currently **no password reset**. If you lose your password, ask whoever runs the service to help — they can see accounts but cannot read passwords, so recovery means setting a new one.

Under **Account → the gear icon** you can change your display name or password, reset your trade history, or delete your account. Changing your password signs out every other session. Deleting the account asks for your password again and removes everything permanently.

## Watchlists

Create lists from the sidebar with **+**, drag to reorder, and use the **⋯** menu on a list to rename or delete it.

Every symbol you add to any list also appears in **All Stocks**, so that view is always the union of everything you follow. Removing a symbol from All Stocks removes it everywhere.

### Importing from Yahoo Finance

The document icon next to **+** imports a watchlist.

1. In Yahoo Finance, open your portfolio and choose **⋮ → Export**. You get a CSV.
2. Click the import icon in Vantage, then drop the CSV in — or paste a list of tickers, one per line.
3. Click **Check symbols**. Every ticker is priced before anything is created; a few hundred symbols takes about half a minute the first time.
4. Review. It tells you how many are ready and lists anything it will skip, then imports on confirmation.

Symbols get skipped when the market data provider has no prices for them — usually delisted companies. Yahoo's own ticker forms are kept as they are, so `BRK-B`, `^VIX`, `ES=F` and `BTC-USD` all import.

Only the ticker column is read. The prices in Yahoo's export are a snapshot from when you exported and would always be staler than Vantage's own data.

## Trading

Deposit play money on the **Bank** page, then buy and sell from any stock's detail view. Holdings track your average cost, so buying the same symbol twice blends the two prices rather than replacing the first.

Selling leaves your average cost unchanged — selling does not alter what the remaining shares cost you. The **Portfolio** page shows unrealised profit and loss per position and across the whole portfolio.

All of it is simulated. No real money is involved at any point.

## The assistant

The button in the bottom-left corner opens Vantage AI. It can see your watchlist, your holdings and a market snapshot, and it can run two tools against your whole list:

- **Screening** — filter and rank by computed indicators: returns over a period, distance from 52-week highs and lows, RSI, position against the 50- and 200-day moving averages, volume against its own average, volatility. Ask things like *which of my stocks are oversold* or *which are near their highs on heavy volume*.
- **Pattern detection** — scan for cup-and-handle and flat-base formations using bar-by-bar price and volume history.

Two things are worth understanding about the answers.

**It reports its coverage.** If it ranked 180 of your 200 symbols because the rest had no data, it says so. A ranking over part of a list presented as though it covered all of it is the failure mode this is built to avoid.

**Pattern matches come with caveats attached.** A detected pattern carries flags naming why it might be unreliable — a leveraged ETF where chart patterns behave differently, a "recovery" that was really one gap day of news, a handle that formed too recently to mean much. When every match is flagged, that is the honest answer, and the assistant will tell you so rather than presenting five clean setups.

It is not financial advice, and pattern geometry describes the past rather than predicting the future.

### Daily limits

The assistant costs the service money per question, so it is metered per day and resets at midnight UTC. The chat header always shows where you stand — for example `free · 18 of 20 left today`.

Signing in raises your limit; the exact numbers are set by whoever runs the service.

A question that uses a tool counts once, even though it takes several model calls behind the scenes. A question that fails before producing an answer is refunded.

### Connecting your own model

The gear icon in the chat header lets you point the assistant at your own model provider. Then you pay for it, and **the daily limit no longer applies**.

You need three things: an endpoint URL, a model name and an API key. Any OpenAI-compatible provider works, and the dialog has presets for several. The allowed list is shown in the dialog — the service restricts it, because a URL it fetches on your behalf could otherwise be aimed anywhere.

**Your key stays in your browser.** It is sent with each request and used for that request only; the service never stores it. It is kept in this browser's local storage, so it does not follow you to another device, and clearing site data removes it.

## Data and privacy

The service stores your email, a bcrypt hash of your password (never the password itself), your display name, and one document holding your balance, holdings, transactions, watchlists and preferences.

Your browser keeps a market-data cache, your session token, and your own model settings if you added them.

Chat messages are sent to whichever model provider the service uses — or yours, if you connected one. Deleting your account removes your account and saved state from the service.
