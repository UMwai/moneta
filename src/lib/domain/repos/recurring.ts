import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@/db";
import { id } from "@/db/id";
import { recurringSeries } from "@/db/schema";
import { nowISO } from "@/lib/domain/dates";
import type { SeriesContext } from "@/lib/domain/insights/types";
import type { RecurringSeries } from "@/lib/types";
import { toRecurringSeries } from "./mappers";

export interface SeriesInput {
  accountId: string;
  normalizedKey: string;
  name: string;
  merchant: string | null;
  amount: number;
  cadence: RecurringSeries["cadence"];
  firstDate: string;
  lastDate: string;
  nextExpectedDate: string;
  occurrences: number;
  categoryId: string | null;
  active: boolean;
}

export function listRecurring(
  db: Db,
  opts: { activeOnly?: boolean } = {},
): RecurringSeries[] {
  return db
    .select()
    .from(recurringSeries)
    .where(opts.activeOnly ? eq(recurringSeries.active, true) : undefined)
    .orderBy(asc(recurringSeries.nextExpectedDate))
    .all()
    .map(toRecurringSeries);
}

/** Series with detection metadata (firstDate, occurrences) for the rules engine. */
export function listSeriesContext(db: Db): SeriesContext[] {
  return db
    .select()
    .from(recurringSeries)
    .orderBy(asc(recurringSeries.nextExpectedDate))
    .all()
    .map((r) => ({
      ...toRecurringSeries(r),
      firstDate: r.firstDate,
      occurrences: r.occurrences,
      categoryId: r.categoryId,
      normalizedKey: r.normalizedKey,
    }));
}

export function getSeries(db: Db, seriesId: string): RecurringSeries | null {
  const row = db
    .select()
    .from(recurringSeries)
    .where(eq(recurringSeries.id, seriesId))
    .get();
  return row ? toRecurringSeries(row) : null;
}

export function findSeriesByKey(
  db: Db,
  accountId: string,
  normalizedKey: string,
): RecurringSeries | null {
  const row = db
    .select()
    .from(recurringSeries)
    .where(
      and(
        eq(recurringSeries.accountId, accountId),
        eq(recurringSeries.normalizedKey, normalizedKey),
      ),
    )
    .get();
  return row ? toRecurringSeries(row) : null;
}

/** Upsert keyed on (accountId, normalizedKey) so re-detection is stable. */
export function upsertSeries(db: Db, input: SeriesInput): RecurringSeries {
  const ts = nowISO();
  const [saved] = db
    .insert(recurringSeries)
    .values({ id: id("rec"), createdAt: ts, updatedAt: ts, ...input })
    .onConflictDoUpdate({
      target: [recurringSeries.accountId, recurringSeries.normalizedKey],
      set: {
        name: input.name,
        merchant: input.merchant,
        amount: input.amount,
        cadence: input.cadence,
        firstDate: input.firstDate,
        lastDate: input.lastDate,
        nextExpectedDate: input.nextExpectedDate,
        occurrences: input.occurrences,
        categoryId: input.categoryId,
        active: input.active,
        updatedAt: ts,
      },
    })
    .returning()
    .all();
  return toRecurringSeries(saved!);
}

export function setSeriesActive(
  db: Db,
  seriesId: string,
  active: boolean,
): void {
  db.update(recurringSeries)
    .set({ active, updatedAt: nowISO() })
    .where(eq(recurringSeries.id, seriesId))
    .run();
}

export function deleteSeries(db: Db, seriesId: string): void {
  db.delete(recurringSeries).where(eq(recurringSeries.id, seriesId)).run();
}
