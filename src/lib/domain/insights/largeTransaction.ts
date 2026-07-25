import { addDaysISO } from "@/lib/domain/dates";
import { formatMoney } from "@/lib/domain/money";
import {
  accountName,
  categoryName,
  inPeriod,
  inWindow,
  isDiscretionaryCategory,
  isSpend,
} from "./shared";
import type { InsightDraft, InsightRule } from "./types";

export const TRAILING_WINDOW_DAYS = 90;
export const SIGMA_THRESHOLD = 2.5;
/** Flat backstop for discretionary spend, in minor units. */
export const DISCRETIONARY_FLOOR = 50_000; // $500.00
export const MAX_DRAFTS = 5;

/**
 * Charges that stand out against the last 90 days — either statistically
 * (>2.5σ above the mean outflow) or as a large discretionary purchase. The
 * statistical test alone misses people whose spending is uniformly large; the
 * flat threshold alone spams people whose normal week includes a $600 charge.
 */
export const largeTransaction: InsightRule = (ctx) => {
  const trailing = inWindow(
    ctx,
    addDaysISO(ctx.today, -TRAILING_WINDOW_DAYS),
    ctx.today,
  ).filter((t) => isSpend(ctx, t));

  const amounts = trailing.map((t) => -t.amount);
  const mean =
    amounts.length > 0
      ? amounts.reduce((a, b) => a + b, 0) / amounts.length
      : 0;
  const variance =
    amounts.length > 1
      ? amounts.reduce((sum, a) => sum + (a - mean) ** 2, 0) /
        (amounts.length - 1)
      : 0;
  const threshold = mean + SIGMA_THRESHOLD * Math.sqrt(variance);

  const candidates = inPeriod(ctx)
    .filter((t) => isSpend(ctx, t))
    .map((t) => ({ tx: t, magnitude: -t.amount }))
    .filter(
      ({ tx, magnitude }) =>
        (amounts.length > 1 && magnitude > threshold) ||
        (magnitude >= DISCRETIONARY_FLOOR &&
          isDiscretionaryCategory(ctx, tx.categoryId)),
    )
    .sort((a, b) => b.magnitude - a.magnitude)
    .slice(0, MAX_DRAFTS);

  const drafts: InsightDraft[] = [];
  for (const { tx, magnitude } of candidates) {
    const where = tx.categoryId ? categoryName(ctx, tx.categoryId) : "an uncategorized charge";
    drafts.push({
      kind: "large_transaction",
      severity: "warn",
      title: `Large charge: ${formatMoney(magnitude)} at ${
        tx.merchant ?? tx.name
      }`,
      body: `${formatMoney(magnitude)} on ${tx.date} from ${accountName(
        ctx,
        tx.accountId,
      )} (${where}) — well above your typical ${formatMoney(
        Math.round(mean),
      )} charge.`,
      action: `Check this charge is right. If it was planned, note why so next month's comparison isn't skewed; if it wasn't, dispute it now.`,
      refs: {
        transactionId: tx.id,
        accountId: tx.accountId,
        ...(tx.categoryId ? { categoryId: tx.categoryId } : {}),
      },
      period: ctx.period,
      dedupeKey: tx.id,
    });
  }
  return drafts;
};
