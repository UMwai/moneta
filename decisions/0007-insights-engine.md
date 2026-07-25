# ADR 0007 — "Help people with their finances": insights engine

**Status:** accepted

## Options

1. **Deterministic rule-based insights engine (v0.1)** — pure functions over the ledger:
   month-over-month category spikes, recurring-charge/subscription detection, unused
   subscriptions, savings rate, cash runway, budget breach forecasts. Transparent,
   testable, offline.
2. LLM-generated advice (BYO Claude/OpenAI key) — compelling, but non-deterministic
   output about money needs guardrails; deferred to v0.2 as an *optional* layer that
   consumes v0.1's structured insights.
3. No insights, data display only — fails the mission ("help people with their
   finances", not just show them).

## Decision

**Option 1 now, option 2 later.** Insights are first-class rows (`insights` table) with
severity, category, and a suggested action, rendered as a feed on the dashboard. The
rules engine lives in `src/lib/domain/insights/` with unit tests per rule.
