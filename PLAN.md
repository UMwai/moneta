# Moneta — Build Plan

Open-source, self-hosted personal finance app. Individuals clone it, add their own
bank-aggregator API key (Plaid / SimpleFIN / Teller) or import CSV/OFX, and get a full
picture of their money — plus actionable guidance to improve it.

**Mission:** help people with their finances — not just display data. Every feature ends
in an insight or a suggested action.

## Product pillars

1. **Connect** — BYO-key bank connections (Plaid sandbox/dev, SimpleFIN Bridge, Teller)
   behind one `BankProvider` interface; CSV/OFX import as the zero-cost fallback.
2. **Understand** — accounts, transactions, auto-categorization (rules engine),
   net-worth over time, cash-flow, recurring-charge detection.
3. **Improve** — budgets with envelope tracking, subscription/waste finder, savings-rate
   and runway metrics, rule-based insights feed ("you spent 42% more on dining this
   month", "3 subscriptions unused 90+ days").
4. **Own** — single Docker container, SQLite file DB, secrets encrypted at rest,
   no telemetry, no third-party storage of credentials.

## Architecture

- Next.js 16 (App Router, TS, standalone output) — one process serves UI + API
- SQLite via Drizzle ORM (`data/moneta.db`), migrations via drizzle-kit
- Local auth: username/password (argon2) + signed session cookie (jose); first-run setup
- Provider tokens encrypted AES-256-GCM with `APP_ENCRYPTION_KEY`
- Tailwind v4 UI; charts via Recharts
- CI: GitHub Actions (public repo = free) — lint, typecheck, unit tests, build, Docker build

## Milestones

| # | Milestone | Contents |
|---|-----------|----------|
| M0 | Skeleton (this commit) | scaffold, CI, Docker, plan, ADRs, shared type contracts |
| M1 | Core domain | schema, migrations, repositories, categorization rules, seed data, unit tests |
| M2 | Providers | BankProvider interface, Plaid impl, SimpleFIN impl, CSV/OFX importers, crypto |
| M3 | Auth + API | first-run setup, login, session middleware, REST routes, key-management settings API |
| M4 | UI | dashboard, accounts, transactions, budgets, insights, settings pages |
| M5 | Integration | wire UI→API→domain, sync jobs, e2e smoke, docs, v0.1 release |

## Execution lanes (parallel, one git worktree each)

- **Lane A (Claude Opus):** M1 core domain — `src/db/**`, `src/lib/domain/**`, `tests/domain/**`
- **Lane B (Claude Opus):** M2 providers — `src/lib/providers/**`, `src/lib/crypto.ts`, `tests/providers/**`
- **Lane C (Codex gpt-5.6-sol):** M4 UI — `src/app/(app)/**`, `src/components/**` against contracts in `src/lib/types.ts`
- **Lane D (Codex gpt-5.6-sol):** M3 auth+API — `src/lib/auth/**`, `src/app/api/**`, `src/middleware.ts`

Lanes code against the frozen contracts in `src/lib/types.ts`. Hub (Claude) merges
lanes sequentially, resolves conflicts, runs the full gate (lint, typecheck, test,
build), then pushes. M5 is a final integration pass after all lanes land.

## Non-goals (v0.1)

Multi-currency math beyond display, investment cost-basis/tax lots, bill pay or any
money movement, mobile apps, multi-tenant SaaS hosting.
