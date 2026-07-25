import type { Db } from "@/db";
import {
  addDaysISO,
  periodEnd,
  periodOf,
  periodStart,
  todayISO,
} from "@/lib/domain/dates";
import {
  listAccounts,
  listBudgets,
  listCategories,
  listSeriesContext,
  listTransactionsInRange,
  upsertInsights,
} from "@/lib/domain/repos";
import type { Insight, InsightKind } from "@/lib/types";
import { budgetBreachForecast } from "./budgetBreachForecast";
import { cashRunway } from "./cashRunway";
import { categorySpike } from "./categorySpike";
import { duplicateCharge } from "./duplicateCharge";
import { largeTransaction } from "./largeTransaction";
import { newSubscription } from "./newSubscription";
import { savingsRate } from "./savingsRate";
import { unusedSubscription } from "./unusedSubscription";
import type { InsightContext, InsightDraft, InsightRule } from "./types";

/**
 * The rules engine (ADR 0007). Every rule is a pure function over an
 * InsightContext, so the whole feed is reproducible from the ledger and every
 * finding can be unit-tested in isolation.
 */
export const RULES: Record<InsightKind, InsightRule> = {
  category_spike: categorySpike,
  new_subscription: newSubscription,
  unused_subscription: unusedSubscription,
  budget_breach_forecast: budgetBreachForecast,
  savings_rate: savingsRate,
  cash_runway: cashRunway,
  large_transaction: largeTransaction,
  duplicate_charge: duplicateCharge,
};

/** How much history the rules can see; 13 months covers year-over-year cadence. */
export const CONTEXT_WINDOW_DAYS = 400;

const SEVERITY_RANK: Record<Insight["severity"], number> = {
  critical: 0,
  warn: 1,
  info: 2,
};

/**
 * Runs every rule and drops duplicates within the batch (same kind + dedupeKey),
 * keeping the most severe. A rule that throws is skipped rather than taking the
 * whole feed down with it — a broken insight must never break the dashboard.
 */
export function runRules(
  ctx: InsightContext,
  rules: Partial<Record<InsightKind, InsightRule>> = RULES,
): InsightDraft[] {
  const byKey = new Map<string, InsightDraft>();
  for (const [kind, rule] of Object.entries(rules)) {
    if (!rule) continue;
    let produced: InsightDraft[] = [];
    try {
      produced = rule(ctx);
    } catch {
      produced = [];
    }
    for (const draft of produced) {
      const key = `${kind}|${draft.dedupeKey}`;
      const existing = byKey.get(key);
      if (
        !existing ||
        SEVERITY_RANK[draft.severity] < SEVERITY_RANK[existing.severity]
      ) {
        byKey.set(key, draft);
      }
    }
  }
  return [...byKey.values()].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      a.kind.localeCompare(b.kind) ||
      a.dedupeKey.localeCompare(b.dedupeKey),
  );
}

/** Loads everything the rules may read for one period. */
export function buildContext(
  db: Db,
  opts: { period?: string; today?: string } = {},
): InsightContext {
  const today = opts.today ?? todayISO();
  const period = opts.period ?? periodOf(today);
  const from = addDaysISO(periodStart(period), -CONTEXT_WINDOW_DAYS);
  const to = periodEnd(period) > today ? periodEnd(period) : today;
  return {
    period,
    today,
    transactions: listTransactionsInRange(db, { from, to }),
    accounts: listAccounts(db, { includeArchived: true }),
    categories: listCategories(db),
    budgets: listBudgets(db, period),
    recurring: listSeriesContext(db),
  };
}

export interface GenerateResult {
  period: string;
  drafts: InsightDraft[];
  insights: Insight[];
}

/**
 * Computes and persists the feed for a period. Safe to re-run: insights upsert
 * on (period, kind, dedupeKey) and a dismissal is never resurrected.
 */
export function generateInsights(
  db: Db,
  opts: { period?: string; today?: string } = {},
): GenerateResult {
  const ctx = buildContext(db, opts);
  const drafts = runRules(ctx);
  return { period: ctx.period, drafts, insights: upsertInsights(db, drafts) };
}
