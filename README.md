# Moneta

Self-hosted, open-source personal finance for individuals. Pull it down, add **your own**
bank-aggregator key (Plaid, SimpleFIN, or Teller) — or just import CSV/OFX — and get a
full picture of your money plus concrete suggestions to improve it. Your data never
leaves your machine.

## Features

- **Bank sync, bring-your-own-key** — Plaid / SimpleFIN Bridge / Teller adapters behind
  one interface; CSV & OFX import if you'd rather use no aggregator at all
- **Understand** — accounts, transactions, auto-categorization, net worth over time,
  cash flow, recurring-charge detection
- **Improve** — monthly budgets with breach forecasts, subscription/waste finder,
  savings rate & cash runway, an insights feed with suggested actions
- **Own** — single Docker container, SQLite file database, AES-256-GCM-encrypted
  credentials, no telemetry

## Quick start

```bash
git clone https://github.com/UMwai/moneta && cd moneta
cp .env.example .env
# fill APP_ENCRYPTION_KEY and SESSION_SECRET (openssl rand -hex 32)
docker compose up -d
# open http://localhost:3000 and complete first-run setup
```

Or for development:

```bash
pnpm install
pnpm db:migrate
pnpm dev
```

## Try the demo

Start a disposable demo at [http://localhost:3000](http://localhost:3000), then
sign in with `demo` / `demo-moneta`:

```bash
docker run --rm -p 3000:3000 -e DEMO=1 -e COOKIE_SECURE=false -e SESSION_SECRET="$(openssl rand -hex 32)" -e APP_ENCRYPTION_KEY="$(openssl rand -hex 32)" ghcr.io/umwai/moneta:edge
```

`DEMO=1` only seeds an empty database. It never replaces an existing Moneta
household.

## Connecting your bank

Moneta ships with no aggregator account — you supply your own credentials in
**Settings → Connections**:

| Provider | What you need | Cost |
|----------|---------------|------|
| Plaid | client id + secret from dashboard.plaid.com | free sandbox / paid production |
| SimpleFIN Bridge | setup token from bridge.simplefin.org | ~$1.50/mo |
| Teller | app id from teller.io | free tier |
| CSV / OFX | an export from your bank | free |

Credentials are encrypted at rest with your `APP_ENCRYPTION_KEY` and never sent
anywhere except the provider you chose.

## Docs

- [PLAN.md](PLAN.md) — roadmap and architecture
- [decisions/](decisions/) — architecture decision records

## License

MIT
