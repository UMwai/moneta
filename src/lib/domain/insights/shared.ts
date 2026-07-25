import { periodRange } from "@/lib/domain/dates";
import { isUnderAny } from "@/lib/domain/repos/categories";
import { NON_INCOME_ROOTS, NON_SPEND_ROOTS } from "@/lib/domain/seed";
import type { Transaction } from "@/lib/types";
import type { InsightContext } from "./types";

/**
 * Helpers every rule shares. The important one is `isSpend`: transfers, savings
 * contributions and income are movements, not spending, and counting them would
 * make every metric in the app wrong (a $2,000 card payment is not $2,000 of
 * dining).
 */

export function inPeriod(ctx: InsightContext, period = ctx.period): Transaction[] {
  const { from, to } = periodRange(period);
  return ctx.transactions.filter((t) => t.date >= from && t.date <= to);
}

export function inWindow(
  ctx: InsightContext,
  from: string,
  to: string,
): Transaction[] {
  return ctx.transactions.filter((t) => t.date >= from && t.date <= to);
}

export function isTransferLike(ctx: InsightContext, tx: Transaction): boolean {
  return isUnderAny(ctx.categories, tx.categoryId, NON_SPEND_ROOTS);
}

/** Outflows that represent real spending. */
export function isSpend(ctx: InsightContext, tx: Transaction): boolean {
  return tx.amount < 0 && !isTransferLike(ctx, tx);
}

/**
 * Inflows that represent real income. Only transfers and savings withdrawals are
 * excluded — earnings live under the Income root and must count, or every
 * income-relative metric reads zero.
 */
export function isIncome(ctx: InsightContext, tx: Transaction): boolean {
  return (
    tx.amount > 0 && !isUnderAny(ctx.categories, tx.categoryId, NON_INCOME_ROOTS)
  );
}

export function totalSpend(ctx: InsightContext, txs: Transaction[]): number {
  return txs.reduce((sum, t) => (isSpend(ctx, t) ? sum - t.amount : sum), 0);
}

export function totalIncome(ctx: InsightContext, txs: Transaction[]): number {
  return txs.reduce((sum, t) => (isIncome(ctx, t) ? sum + t.amount : sum), 0);
}

export function categoryName(ctx: InsightContext, categoryId: string): string {
  return ctx.categories.find((c) => c.id === categoryId)?.name ?? "Uncategorized";
}

export function accountName(ctx: InsightContext, accountId: string): string {
  return ctx.accounts.find((a) => a.id === accountId)?.name ?? "your account";
}

export function isDiscretionaryCategory(
  ctx: InsightContext,
  categoryId: string | null,
): boolean {
  if (!categoryId) return false;
  return ctx.categories.find((c) => c.id === categoryId)?.discretionary ?? false;
}
