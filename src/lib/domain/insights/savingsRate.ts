import { periodLabel } from "@/lib/domain/dates";
import { formatMoney, formatPercent } from "@/lib/domain/money";
import { inPeriod, totalIncome, totalSpend } from "./shared";
import type { InsightRule } from "./types";

/** Below this, the month is worth a nudge rather than a pat on the back. */
export const HEALTHY_SAVINGS_RATE = 0.2;
export const LOW_SAVINGS_RATE = 0.1;

/**
 * (income - spending) / income for the month. Transfers and savings
 * contributions are excluded from both sides — moving money to savings is the
 * saving, not an expense, and counting it twice would show a negative rate for
 * someone doing everything right.
 */
export const savingsRate: InsightRule = (ctx) => {
  const txs = inPeriod(ctx);
  const income = totalIncome(ctx, txs);
  if (income <= 0) return [];
  const spend = totalSpend(ctx, txs);
  const saved = income - spend;
  const rate = saved / income;
  const label = periodLabel(ctx.period);

  if (rate < 0) {
    return [
      {
        kind: "savings_rate" as const,
        severity: "critical" as const,
        title: `You spent more than you earned in ${label}`,
        body: `${formatMoney(spend)} spent against ${formatMoney(
          income,
        )} of income — ${formatMoney(-saved)} short.`,
        action: `Find ${formatMoney(
          -saved,
        )} to cut from your largest discretionary categories, and check whether anything unusual landed this month.`,
        refs: {},
        period: ctx.period,
        dedupeKey: "savings_rate",
      },
    ];
  }

  if (rate < LOW_SAVINGS_RATE) {
    const target = Math.round(income * LOW_SAVINGS_RATE) - saved;
    return [
      {
        kind: "savings_rate" as const,
        severity: "warn" as const,
        title: `Savings rate is only ${formatPercent(rate)}`,
        body: `You kept ${formatMoney(saved)} of ${formatMoney(
          income,
        )} in ${label}. Most guidance puts a healthy rate at 20% or more.`,
        action: `Move ${formatMoney(
          target,
        )} more to savings next month — set it as an automatic transfer on payday so it happens before you can spend it.`,
        refs: {},
        period: ctx.period,
        dedupeKey: "savings_rate",
      },
    ];
  }

  return [
    {
      kind: "savings_rate" as const,
      severity: "info" as const,
      title: `You saved ${formatPercent(rate)} in ${label}`,
      body: `${formatMoney(saved)} kept out of ${formatMoney(
        income,
      )} of income.`,
      action:
        rate >= HEALTHY_SAVINGS_RATE
          ? `Put the ${formatMoney(
              saved,
            )} to work — top up your emergency fund first, then investments.`
          : `Push toward a 20% rate by automating a ${formatMoney(
              Math.round(income * HEALTHY_SAVINGS_RATE) - saved,
            )} transfer on payday.`,
      refs: {},
      period: ctx.period,
      dedupeKey: "savings_rate",
    },
  ];
};
