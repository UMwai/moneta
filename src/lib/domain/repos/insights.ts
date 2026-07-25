import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { id } from "@/db/id";
import { insights } from "@/db/schema";
import { nowISO } from "@/lib/domain/dates";
import type { InsightDraft } from "@/lib/domain/insights/types";
import type { Insight } from "@/lib/types";
import { toInsight } from "./mappers";

export function listInsights(
  db: Db,
  opts: { period?: string; includeDismissed?: boolean } = {},
): Insight[] {
  const conds = [];
  if (opts.period) conds.push(eq(insights.period, opts.period));
  if (!opts.includeDismissed) conds.push(eq(insights.dismissed, false));
  return db
    .select()
    .from(insights)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(insights.createdAt), desc(insights.id))
    .all()
    .map(toInsight);
}

export function getInsight(db: Db, insightId: string): Insight | null {
  const row = db
    .select()
    .from(insights)
    .where(eq(insights.id, insightId))
    .get();
  return row ? toInsight(row) : null;
}

export function dismissInsight(db: Db, insightId: string): boolean {
  const res = db
    .update(insights)
    .set({ dismissed: true, updatedAt: nowISO() })
    .where(eq(insights.id, insightId))
    .run();
  return res.changes > 0;
}

export function undismissInsight(db: Db, insightId: string): boolean {
  const res = db
    .update(insights)
    .set({ dismissed: false, updatedAt: nowISO() })
    .where(eq(insights.id, insightId))
    .run();
  return res.changes > 0;
}

/**
 * Writes a draft, refreshing an existing row with the same
 * (period, kind, dedupeKey). A dismissal survives the refresh — the user said
 * "not interested" about that exact finding, and recomputing it is not new news.
 */
export function upsertInsight(db: Db, draft: InsightDraft): Insight {
  const ts = nowISO();
  const [saved] = db
    .insert(insights)
    .values({
      id: id("ins"),
      kind: draft.kind,
      severity: draft.severity,
      title: draft.title,
      body: draft.body,
      action: draft.action,
      refs: draft.refs,
      period: draft.period,
      dedupeKey: draft.dedupeKey,
      dismissed: false,
      createdAt: ts,
      updatedAt: ts,
    })
    .onConflictDoUpdate({
      target: [insights.period, insights.kind, insights.dedupeKey],
      set: {
        severity: draft.severity,
        title: draft.title,
        body: draft.body,
        action: draft.action,
        refs: draft.refs,
        updatedAt: ts,
      },
    })
    .returning()
    .all();
  return toInsight(saved!);
}

export function upsertInsights(db: Db, drafts: InsightDraft[]): Insight[] {
  // better-sqlite3 is synchronous and single-connection, so statements issued
  // through `db` inside the callback run inside this transaction.
  return db.transaction(() => drafts.map((d) => upsertInsight(db, d)));
}

export function deleteInsight(db: Db, insightId: string): void {
  db.delete(insights).where(eq(insights.id, insightId)).run();
}

export function deleteInsightsForPeriod(db: Db, period: string): number {
  return db.delete(insights).where(eq(insights.period, period)).run().changes;
}
