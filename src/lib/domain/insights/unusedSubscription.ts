import { addDaysISO, daysBetween } from "@/lib/domain/dates";
import { normalizeMerchantKey } from "@/lib/domain/merchants";
import { formatMoney } from "@/lib/domain/money";
import { isUnderAny } from "@/lib/domain/repos/categories";
import { CAT } from "@/lib/domain/seed";
import { inWindow } from "./shared";
import type { InsightDraft, InsightRule } from "./types";

export const UNUSED_WINDOW_DAYS = 90;

/** Category roots where "I pay for it but never use it" is a real risk. */
const SUBSCRIPTION_ROOTS: readonly string[] = [
  CAT.SUBSCRIPTIONS,
  "cat_memberships",
  "cat_fitness",
  "cat_games",
];

/**
 * A subscription that keeps charging with no sign of engagement.
 *
 * A bank ledger cannot see usage, so this uses the strongest signal it does
 * have: for 90+ days the only transactions at that merchant have been the fixed
 * recurring charge itself — no upgrades, no add-ons, no à-la-carte purchases,
 * no change in amount. That is the shape of a subscription running on autopilot,
 * and it is exactly the case where asking "do you still use this?" pays for
 * itself. It is intentionally a prompt, not an accusation.
 */
export const unusedSubscription: InsightRule = (ctx) => {
  const windowStart = addDaysISO(ctx.today, -UNUSED_WINDOW_DAYS);
  const recent = inWindow(ctx, windowStart, ctx.today);

  const drafts: InsightDraft[] = [];
  for (const series of ctx.recurring) {
    if (!series.active || series.amount >= 0) continue;
    if (!isUnderAny(ctx.categories, series.categoryId, SUBSCRIPTION_ROOTS))
      continue;
    if (daysBetween(series.firstDate, ctx.today) < UNUSED_WINDOW_DAYS) continue;

    const atMerchant = recent.filter(
      (t) =>
        t.accountId === series.accountId &&
        normalizeMerchantKey(t) === series.normalizedKey,
    );
    const charges = atMerchant.filter(
      (t) => t.recurringSeriesId === series.id,
    ).length;
    const otherActivity = atMerchant.length - charges;
    if (charges === 0 || otherActivity > 0) continue;

    const perCharge = Math.abs(series.amount);
    const paid = perCharge * charges;
    drafts.push({
      kind: "unused_subscription",
      severity: "warn",
      title: `${series.name} may be going unused`,
      body: `You've paid ${series.name} ${formatMoney(
        paid,
      )} across ${charges} charges since ${addDaysISO(
        ctx.today,
        -UNUSED_WINDOW_DAYS,
      )}, with no other activity at that merchant in 90 days.`,
      action: `If you haven't used ${series.name} lately, cancel or downgrade it before the next charge on ${series.nextExpectedDate} and keep ${formatMoney(
        perCharge,
      )}.`,
      refs: {
        recurringSeriesId: series.id,
        accountId: series.accountId,
        ...(series.categoryId ? { categoryId: series.categoryId } : {}),
      },
      period: ctx.period,
      dedupeKey: series.id,
    });
  }
  return drafts;
};
