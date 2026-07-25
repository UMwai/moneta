import { addDaysISO, daysBetween, periodRange } from "@/lib/domain/dates";
import { normalizeMerchantKey } from "@/lib/domain/merchants";
import { formatMoney } from "@/lib/domain/money";
import { inWindow, isSpend } from "./shared";
import type { InsightDraft, InsightRule } from "./types";

export const DUPLICATE_WINDOW_DAYS = 3;

/**
 * Same merchant, same amount, within three days. Almost always a double-tap at
 * the terminal or a retried payment, and almost always refundable — but only if
 * someone notices before the statement scrolls away.
 */
export const duplicateCharge: InsightRule = (ctx) => {
  // Reach back a few days before the period so a pair straddling the 1st of the
  // month is still caught.
  const { from, to } = periodRange(ctx.period);
  const candidates = inWindow(
    ctx,
    addDaysISO(from, -DUPLICATE_WINDOW_DAYS),
    to,
  ).filter((t) => isSpend(ctx, t));

  const groups = new Map<string, typeof candidates>();
  for (const tx of candidates) {
    const key = `${tx.accountId}|${tx.amount}|${normalizeMerchantKey(tx)}`;
    const bucket = groups.get(key) ?? [];
    bucket.push(tx);
    groups.set(key, bucket);
  }

  const drafts: InsightDraft[] = [];
  for (const bucket of groups.values()) {
    if (bucket.length < 2) continue;
    const sorted = [...bucket].sort((a, b) => a.date.localeCompare(b.date));
    for (let i = 1; i < sorted.length; i++) {
      const first = sorted[i - 1]!;
      const second = sorted[i]!;
      if (daysBetween(first.date, second.date) > DUPLICATE_WINDOW_DAYS) continue;
      // Only report the pair if the later charge is inside the analysed period.
      if (second.date < from) continue;
      const magnitude = -second.amount;
      const merchant = second.merchant ?? second.name;
      drafts.push({
        kind: "duplicate_charge",
        severity: "warn",
        title: `Possible duplicate charge at ${merchant}`,
        body: `${formatMoney(
          magnitude,
        )} was charged twice by ${merchant} — on ${first.date} and again on ${
          second.date
        }.`,
        action: `Compare the two charges and, if it's a duplicate, ask ${merchant} to reverse it or file a dispute with your bank.`,
        refs: { transactionId: second.id, accountId: second.accountId },
        period: ctx.period,
        dedupeKey: [first.id, second.id].sort().join("|"),
      });
    }
  }
  return drafts;
};
