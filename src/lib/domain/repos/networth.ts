import { asc, lte } from "drizzle-orm";
import type { Db } from "@/db";
import { id } from "@/db/id";
import { networthSnapshots } from "@/db/schema";
import { nowISO, todayISO } from "@/lib/domain/dates";
import type { AccountType, NetWorthPoint } from "@/lib/types";
import { isLiability, listAccounts } from "./accounts";

export interface SnapshotInput {
  date: string;
  accountId: string;
  accountType: AccountType;
  balance: number;
  currency: string;
}

/**
 * Writes explicit historical balances through the same repository boundary as
 * the live snapshot path. Repeated dates replace their prior closing balance.
 */
export function writeSnapshots(db: Db, inputs: SnapshotInput[]): number {
  if (inputs.length === 0) return 0;
  const ts = nowISO();
  db.transaction(() => {
    for (const input of inputs) {
      db.insert(networthSnapshots)
        .values({
          id: id("nws"),
          ...input,
          createdAt: ts,
        })
        .onConflictDoUpdate({
          target: [networthSnapshots.date, networthSnapshots.accountId],
          set: {
            balance: input.balance,
            accountType: input.accountType,
            currency: input.currency,
          },
        })
        .run();
    }
  });
  return inputs.length;
}

/**
 * Writes one balance row per open account for `date`, replacing that day's rows
 * if the snapshot runs twice — a day has exactly one closing balance.
 */
export function writeSnapshot(db: Db, date: string = todayISO()): number {
  const open = listAccounts(db);
  if (open.length === 0) return 0;
  writeSnapshots(
    db,
    open.map((account) => ({
      date,
      accountId: account.id,
      accountType: account.type,
      balance: account.balance,
      currency: account.currency,
    })),
  );
  return open.length;
}

/**
 * Aggregates per-account snapshots into a net-worth series.
 *
 * Balances carry forward: an account that was not snapshotted on a given day
 * keeps its last known balance, so a day where only one account synced does not
 * make the rest of the portfolio vanish. Liability balances are taken as
 * magnitudes, because providers disagree on whether "you owe $500" is +500 or
 * -500 and net worth only cares that it subtracts.
 */
export function aggregateSnapshots(
  rows: SnapshotInput[],
  range: { from?: string; to?: string } = {},
): NetWorthPoint[] {
  const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));
  const latest = new Map<string, { balance: number; type: AccountType }>();
  const points: NetWorthPoint[] = [];
  let cursor = 0;
  const dates = [...new Set(sorted.map((r) => r.date))];
  for (const date of dates) {
    while (cursor < sorted.length && sorted[cursor]!.date === date) {
      const r = sorted[cursor]!;
      latest.set(r.accountId, { balance: r.balance, type: r.accountType });
      cursor++;
    }
    if (range.from && date < range.from) continue;
    if (range.to && date > range.to) continue;
    let assets = 0;
    let liabilities = 0;
    for (const { balance, type } of latest.values()) {
      if (isLiability(type)) liabilities += Math.abs(balance);
      else assets += balance;
    }
    points.push({ date, assets, liabilities, net: assets - liabilities });
  }
  return points;
}

export function getNetWorthSeries(
  db: Db,
  range: { from?: string; to?: string } = {},
): NetWorthPoint[] {
  // Read from the beginning of time up to `to` so balances before `from` can
  // carry forward into the first point of the window.
  const rows = db
    .select()
    .from(networthSnapshots)
    .where(range.to ? lte(networthSnapshots.date, range.to) : undefined)
    .orderBy(asc(networthSnapshots.date))
    .all();
  return aggregateSnapshots(rows, range);
}

/** Current net worth computed from live account balances, not snapshots. */
export function currentNetWorth(db: Db): NetWorthPoint {
  let assets = 0;
  let liabilities = 0;
  for (const a of listAccounts(db)) {
    if (isLiability(a.type)) liabilities += Math.abs(a.balance);
    else assets += a.balance;
  }
  return { date: todayISO(), assets, liabilities, net: assets - liabilities };
}
