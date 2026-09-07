# Running Vantage as a service

For service owners: deploying, configuring and operating a Vantage instance.

Using an instance someone else runs? See [USING.md](USING.md). Working on the code? See [DEVELOPING.md](DEVELOPING.md).

## What you need

| | Why |
| --- | --- |
| Somewhere to run Python | the API, accounts and the assistant's tool calls |
| Somewhere to serve static files | the built frontend |
| A **Postgres** database | accounts, saved state and usage counters |
| A model provider *(optional)* | the assistant. Without one, users can still connect their own |

No identity provider, no Firebase project, no service accounts. Vantage owns its own accounts.

## Configuration

Everything is environment variables on the API service. `render.yaml` is a template with each one listed; real values belong in your host's dashboard, never in the repository.

### Required

| Variable | Notes |
| --- | --- |
| `SECRET_KEY` | Signs session tokens. **At least 32 bytes** — the service refuses to start below that, because a short key silently weakens every session. Generate with `openssl rand -base64 48`. Changing it signs everyone out. |
| `DATABASE_URL` | `postgresql://…`. See [Storage](#storage) — this one has a trap. |

### The assistant

| Variable | Notes |
| --- | --- |
| `LLM_BASE_URL` | Any OpenAI-compatible endpoint, e.g. `https://api.groq.com/openai/v1` |
| `LLM_MODEL` | Model name at that endpoint |
| `LLM_API_KEY` | Leave unset to run with no shared model; users can still connect their own |
| `LLM_BYO_EXTRA_HOSTS` | Comma-separated extra hosts users may point at. See [Bring-your-own model](#bring-your-own-model) |

Switching providers is three variables and a restart. No client rebuild, no code change.

### Tiers

| Variable | Default | Questions per UTC day |
| --- | --- | --- |
| `CHAT_LIMIT_ANONYMOUS` | 3 | guests, counted per IP address |
| `CHAT_LIMIT_FREE` | 20 | signed-in accounts |
| `CHAT_LIMIT_PLUS` | 200 | accounts you promote |

New accounts are `free`. Promote one with the [admin CLI](#administration). Users who connect their own model are unmetered.

A question counts once regardless of how many model calls its tool loop takes, and a question that fails before producing output is refunded.

### CORS

| Variable | Notes |
| --- | --- |
| `VANTAGE_CORS_ORIGINS` | Comma-separated browser origins. **Must include your frontend URL.** |
| `VANTAGE_CORS_ORIGIN_REGEX` | For hosts whose preview URLs change per deploy |

**CORS is not access control.** It restricts browsers; `curl` ignores it entirely, and your API is reachable by anyone who knows the URL. What actually defends these endpoints is the session check and the per-tier quota. Treat the origin list as a convenience for your own frontend, not a security boundary.

A frontend that loads but shows no data is almost always a missing origin here.

### Other

| Variable | Default | Notes |
| --- | --- | --- |
| `SESSION_DAYS` | 30 | session token lifetime |
| `ALLOW_EPHEMERAL_SQLITE` | unset | see below |

## Storage

`DATABASE_URL` defaults to a local SQLite file, which is right for development and **wrong for production**: hosted filesystems on Render, Fly, Cloud Run and Heroku are ephemeral, so the file — and every account in it — is destroyed by each redeploy.

Rather than let you discover that weeks later, a hosted process **refuses to start** when `DATABASE_URL` is SQLite. Set it to Postgres, or set `ALLOW_EPHEMERAL_SQLITE=1` if losing all accounts on every deploy is genuinely what you want.

`GET /api/health` reports which backend is live:

```json
{ "ok": true, "storage": "postgres", "chat_model_configured": true }
```

Tables are created automatically at startup. There are no migrations yet, so a schema change to `server/db.py` needs handling by hand.

## Deploying

### API

Any Python host works. On Render, `render.yaml` describes the service:

- root directory `server`, build `pip install -r requirements.txt`
- start `uvicorn main:app --host 0.0.0.0 --port $PORT`
- health check `/api/health`

Set the environment variables above in the dashboard. Note that the free plan sleeps when idle, so the first request after a quiet spell takes several seconds.

### Frontend

Build with `npm run build`, serve `dist/`.

The browser needs to reach the API at `/api/*`. Two ways:

- **Same-origin rewrite** *(preferred)* — proxy `/api/:path*` to the API service. `vercel.json` does this. Leave `VITE_API_BASE_URL` empty and CORS never comes up.
- **Direct** — set `VITE_API_BASE_URL` to the API origin and list the frontend in `VANTAGE_CORS_ORIGINS`.

`VITE_*` variables are inlined at build time, so changing one needs a rebuild, not a restart. They ship inside the bundle and are therefore public by nature: never put a secret in one.

### Checklist

1. `npm run build` and `npm run test:all` pass
2. `DATABASE_URL` points at Postgres
3. `SECRET_KEY` is at least 32 bytes and stored only in the dashboard
4. Frontend URL is in `VANTAGE_CORS_ORIGINS`, unless you use a same-origin rewrite
5. After deploy: `/api/health` reports `"storage": "postgres"`, sign-up works, quotes load
6. Sign in, ask the assistant one question, confirm the header shows a tier and a count

## Administration

There is no admin UI. `server/manage.py` covers what you need:

```bash
cd server
.venv/bin/python manage.py users                        # accounts, tiers, who has saved state
.venv/bin/python manage.py set-tier you@example.com plus
.venv/bin/python manage.py usage                        # today's chat usage per account
```

Run it wherever `DATABASE_URL` points at the database you mean.

## Bring-your-own model

Users can point the assistant at their own provider, which makes them unmetered — they are paying for it.

That means the service fetches a URL the user supplied, which is an SSRF primitive if left open. It is constrained:

- **https only**
- the host must be on an allowlist of known inference providers, extendable with `LLM_BYO_EXTRA_HOSTS`
- the host must resolve to a public address, so loopback, private ranges and cloud metadata endpoints such as `169.254.169.254` are rejected

Only add a host to `LLM_BYO_EXTRA_HOSTS` if you would be comfortable with your API making arbitrary requests to it.

**User keys are never stored.** They arrive with a request, are used for it, and are discarded.

## Security notes

**Passwords** are hashed with bcrypt and capped at 72 bytes, because bcrypt truncates silently past that and a longer password would be weaker than it looks. Wrong-password and unknown-address responses are identical, so the endpoint cannot be used to enumerate accounts. Sign-in failures are throttled per address, eight in fifteen minutes.

**Sessions** are signed tokens carrying an epoch that increments on password change and account deletion, so a token cannot outlive the credential it was issued against.

**Tiers are server-owned.** They live on the user row, which only the service writes. Entitlement in client-writable storage would let users grant it to themselves.

**Account deletion re-checks the password.** A stolen session can already read the data; it should not also be able to destroy it.

## Known gaps

Worth knowing before you put this in front of anyone else.

- **No password reset.** A user who forgets their password needs you to set a new one. This is the largest functional gap.
- **No migrations.** Schema changes need manual handling.
- **The login throttle is in memory.** It resets when the process restarts and is not shared between instances.
- **No billing.** The tier machinery exists; charging for it does not.
- **Chat streams are not resumable.** A dropped connection mid-answer loses the remainder, though the question is still counted if output had started.
