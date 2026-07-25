import { daysBetween, periodEnd } from "@/lib/domain/dates";
import { formatMoney } from "@/lib/domain/money";
import type { RecurringSeries } from "@/lib/types";
import type { InsightDraft, InsightRule } from "./types";

/** How recently the first charge must have landed to count as "new". */
export const NEW_SUBSCRIPTION_WINDOW_DAYS = 90;

const ANNUALIZE: Record<RecurringSeries["cadence"], number> = {
  weekly: 52,
  biweekly: 26,
  monthly: 12,
  quarterly: 4,
  yearly: 1,
};

/**
 * A recurring charge that started recently. Worth surfacing even when it was
 * intentional: the annualized cost is the number people never do in their head,
 * and a forgotten free trial looks exactly like this.
 */
export const newSubscription: InsightRule = (ctx) => {
  const drafts: InsightDraft[] = [];
  for (const series of ctx.recurring) {
    if (series.amount >= 0) continue;
    if (series.firstDate > periodEnd(ctx.period)) continue;
    const age = daysBetween(series.firstDate, ctx.today);
    if (age < 0 || age > NEW_SUBSCRIPTION_WINDOW_DAYS) continue;

    const perCharge = Math.abs(series.amount);
    const yearly = perCharge * ANNUALIZE[series.cadence];
    drafts.push({
      kind: "new_subscription",
      severity: "info",
      title: `New ${series.cadence} charge: ${series.name}`,
      body: `${series.name} started charging ${formatMoney(perCharge)} ${
        series.cadence
      } on ${series.firstDate} — ${formatMoney(yearly)} a year at that rate.`,
      action: `Confirm you still want ${series.name}. If it was a free trial, cancel before the next charge on ${series.nextExpectedDate}.`,
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
