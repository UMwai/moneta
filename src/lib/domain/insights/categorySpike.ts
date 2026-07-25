import { periodLabel, previousPeriod } from "@/lib/domain/dates";
import { formatMoney, formatPercent } from "@/lib/domain/money";
import { categoryName, inPeriod, isSpend } from "./shared";
import type { InsightDraft, InsightRule } from "./types";

/** Increase must clear both bars to be worth telling someone about. */
export const SPIKE_MIN_RATIO = 0.3;
export const SPIKE_MIN_DELTA = 5_000; // $50.00

function spendByCategory(
  txs: ReturnType<typeof inPeriod>,
  isSpendFn: (t: (typeof txs)[number]) => boolean,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const t of txs) {
    if (!t.categoryId || !isSpendFn(t)) continue;
    out.set(t.categoryId, (out.get(t.categoryId) ?? 0) - t.amount);
  }
  return out;
}

/**
 * Month-over-month jump in a discretionary category. Requires both a ≥30%
 * increase and a ≥$50 absolute increase, so a coffee habit going from $12 to $20
 * stays quiet while dining going from $300 to $520 does not.
 */
export const categorySpike: InsightRule = (ctx) => {
  const prev = previousPeriod(ctx.period);
  const current = spendByCategory(inPeriod(ctx), (t) => isSpend(ctx, t));
  const previous = spendByCategory(inPeriod(ctx, prev), (t) => isSpend(ctx, t));

  const drafts: InsightDraft[] = [];
  for (const [categoryId, curSpend] of current) {
    const category = ctx.categories.find((c) => c.id === categoryId);
    if (!category?.discretionary) continue;
    const prevSpend = previous.get(categoryId) ?? 0;
    if (prevSpend <= 0) continue;

    const delta = curSpend - prevSpend;
    if (delta < SPIKE_MIN_DELTA) continue;
    const ratio = delta / prevSpend;
    if (ratio < SPIKE_MIN_RATIO) continue;

    const name = categoryName(ctx, categoryId);
    drafts.push({
      kind: "category_spike",
      severity: ratio >= 0.75 ? "warn" : "info",
      title: `${name} spending is up ${formatPercent(ratio)}`,
      body: `You've spent ${formatMoney(curSpend)} on ${name} in ${periodLabel(
        ctx.period,
      )}, ${formatMoney(delta)} more than ${periodLabel(
        prev,
      )}'s ${formatMoney(prevSpend)}.`,
      action: `Review your ${name} transactions this month and set a ${formatMoney(
        prevSpend,
      )} budget to pull it back to where it was.`,
      refs: { categoryId },
      period: ctx.period,
      dedupeKey: categoryId,
    });
  }
  return drafts;
};
