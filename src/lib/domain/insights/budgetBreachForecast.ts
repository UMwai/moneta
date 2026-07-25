import { periodEnd, periodLabel } from "@/lib/domain/dates";
import { formatMoney } from "@/lib/domain/money";
import { computeBudgetStatus } from "@/lib/domain/repos/budgets";
import { descendantIds } from "@/lib/domain/repos/categories";
import { categoryName, inPeriod, isSpend } from "./shared";
import type { InsightDraft, InsightRule } from "./types";

/**
 * Warns before the envelope is empty rather than after. Uses the same run-rate
 * projection the budgets screen shows, so the number in the insight and the
 * number on the page always agree.
 */
export const budgetBreachForecast: InsightRule = (ctx) => {
  const periodTxs = inPeriod(ctx);
  const monthOver = ctx.today > periodEnd(ctx.period);

  const drafts: InsightDraft[] = [];
  for (const budget of ctx.budgets) {
    if (budget.month !== ctx.period) continue;
    const ids = new Set(descendantIds(ctx.categories, budget.categoryId));
    const spent = periodTxs.reduce(
      (sum, t) =>
        t.categoryId && ids.has(t.categoryId) && isSpend(ctx, t)
          ? sum - t.amount
          : sum,
      0,
    );
    const name = categoryName(ctx, budget.categoryId);
    const status = computeBudgetStatus(budget, spent, name, ctx.today);

    if (status.spent > budget.amount) {
      drafts.push({
        kind: "budget_breach_forecast",
        severity: "critical",
        title: `${name} is over budget`,
        body: `You've spent ${formatMoney(status.spent)} of your ${formatMoney(
          budget.amount,
        )} ${name} budget for ${periodLabel(ctx.period)} — ${formatMoney(
          status.spent - budget.amount,
        )} over.`,
        action: monthOver
          ? `Raise next month's ${name} budget to something you can actually hit, or plan where the ${formatMoney(
              status.spent - budget.amount,
            )} comes from.`
          : `Pause ${name} spending for the rest of the month, or move ${formatMoney(
              status.spent - budget.amount,
            )} from another envelope.`,
        refs: { categoryId: budget.categoryId },
        period: ctx.period,
        dedupeKey: budget.categoryId,
      });
      continue;
    }

    if (monthOver || status.projected <= budget.amount) continue;
    const overBy = status.projected - budget.amount;
    drafts.push({
      kind: "budget_breach_forecast",
      severity: "warn",
      title: `On pace to blow the ${name} budget`,
      body: `At the current rate you'll spend about ${formatMoney(
        status.projected,
      )} on ${name} this month — ${formatMoney(
        overBy,
      )} over your ${formatMoney(budget.amount)} budget. ${formatMoney(
        status.remaining,
      )} left.`,
      action: `Hold ${name} to ${formatMoney(
        status.remaining,
      )} for the rest of ${periodLabel(ctx.period)} to finish on budget.`,
      refs: { categoryId: budget.categoryId },
      period: ctx.period,
      dedupeKey: budget.categoryId,
    });
  }
  return drafts;
};
