import { addDaysISO } from "@/lib/domain/dates";
import { formatMoney } from "@/lib/domain/money";
import { liquidBalance } from "@/lib/domain/repos/accounts";
import { inWindow, totalIncome, totalSpend } from "./shared";
import type { InsightRule } from "./types";

export const RUNWAY_WINDOW_DAYS = 90;
/** Below three months of cover this is a warning, not a statistic. */
export const RUNWAY_WARN_MONTHS = 3;
export const RUNWAY_CRITICAL_MONTHS = 1;
/** Above this, the number is healthy and does not need to take up feed space. */
export const RUNWAY_QUIET_MONTHS = 6;

/**
 * How long liquid cash covers the current burn rate. Burn is measured net over
 * the trailing 90 days: someone whose income covers their spending is not
 * burning anything, and telling them they have "4 months of runway" would be
 * both wrong and alarming.
 */
export const cashRunway: InsightRule = (ctx) => {
  const from = addDaysISO(ctx.today, -RUNWAY_WINDOW_DAYS);
  const window = inWindow(ctx, from, ctx.today);
  const spend = totalSpend(ctx, window);
  const income = totalIncome(ctx, window);
  const burn = (spend - income) / (RUNWAY_WINDOW_DAYS / 30);
  if (burn <= 0) return [];

  const liquid = liquidBalance(ctx.accounts);
  const months = liquid / burn;
  if (months >= RUNWAY_QUIET_MONTHS) return [];

  const severity =
    months < RUNWAY_CRITICAL_MONTHS
      ? ("critical" as const)
      : months < RUNWAY_WARN_MONTHS
        ? ("warn" as const)
        : ("info" as const);
  const rounded = months.toFixed(1);
  const target = Math.round(burn * RUNWAY_WARN_MONTHS - liquid);

  return [
    {
      kind: "cash_runway" as const,
      severity,
      title: `${rounded} months of cash runway`,
      body: `You hold ${formatMoney(
        liquid,
      )} in cash and are burning about ${formatMoney(
        Math.round(burn),
      )} a month more than you earn.`,
      action:
        target > 0
          ? `Build the cushion to three months by setting aside ${formatMoney(
              target,
            )}, or cut monthly spending until income covers it.`
          : `Keep the cushion where it is and watch next month's burn.`,
      refs: {},
      period: ctx.period,
      dedupeKey: "cash_runway",
    },
  ];
};
