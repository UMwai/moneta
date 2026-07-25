/**
 * Post-ingest pipeline.
 *
 * Every path that adds transactions to the ledger — a provider sync or a
 * CSV/OFX import — ends here, so the derived data (categories, recurring series,
 * net-worth history, insight feed) can never drift from the raw ledger depending
 * on how the rows arrived.
 *
 * Order matters: categories feed recurring detection and the budget/insight
 * rules, and recurring series feed the subscription insights.
 */

import type { Db } from "@/db";
import { autoCategorize } from "@/lib/domain/categorize";
import { periodOf, todayISO } from "@/lib/domain/dates";
import { generateInsights } from "@/lib/domain/insights/engine";
import { writeSnapshot } from "@/lib/domain/repos/networth";
import { syncRecurringSeries } from "@/lib/domain/recurring";

export interface PostProcessOptions {
  /** YYYY-MM to compute insights for; defaults to the period containing `today` */
  period?: string;
  today?: string;
}

export interface PostProcessResult {
  categorized: number;
  seriesDetected: number;
  snapshotAccounts: number;
  insights: number;
  period: string;
}

export function runPostProcessing(
  db: Db,
  opts: PostProcessOptions = {},
): PostProcessResult {
  const today = opts.today ?? todayISO();
  const period = opts.period ?? periodOf(today);

  const { categorized } = autoCategorize(db);
  const { detected } = syncRecurringSeries(db, { today });
  const snapshotAccounts = writeSnapshot(db, today);
  const { insights } = generateInsights(db, { period, today });

  return {
    categorized,
    seriesDetected: detected,
    snapshotAccounts,
    insights: insights.length,
    period,
  };
}
