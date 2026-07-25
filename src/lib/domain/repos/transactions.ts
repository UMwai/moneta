import { and, asc, desc, eq, gte, inArray, isNull, lte, sql, type SQL } from "drizzle-orm";
import type { Db } from "@/db";
import { id } from "@/db/id";
import { transactions } from "@/db/schema";
import { nowISO } from "@/lib/domain/dates";
import type {
  Paginated,
  ProviderTransaction,
  Transaction,
} from "@/lib/types";
import { toTransaction } from "./mappers";

export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 500;

export interface TransactionFilters {
  accountId?: string;
  categoryId?: string;
  /** substring match against name and merchant, case-insensitive */
  q?: string;
  /** inclusive ISO dates */
  from?: string;
  to?: string;
  uncategorized?: boolean;
  pending?: boolean;
  limit?: number;
  offset?: number;
}

export interface CreateTransactionInput {
  accountId: string;
  amount: number;
  date: string;
  name: string;
  currency?: string;
  externalId?: string | null;
  merchant?: string | null;
  categoryId?: string | null;
  categorySource?: "auto" | "user" | null;
  pending?: boolean;
  notes?: string | null;
  recurringSeriesId?: string | null;
}

function likeEscape(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

function whereClause(f: TransactionFilters): SQL | undefined {
  const conds: SQL[] = [];
  if (f.accountId) conds.push(eq(transactions.accountId, f.accountId));
  if (f.categoryId) conds.push(eq(transactions.categoryId, f.categoryId));
  if (f.uncategorized) conds.push(isNull(transactions.categoryId));
  if (f.pending !== undefined) conds.push(eq(transactions.pending, f.pending));
  if (f.from) conds.push(gte(transactions.date, f.from));
  if (f.to) conds.push(lte(transactions.date, f.to));
  if (f.q && f.q.trim()) {
    const pattern = `%${likeEscape(f.q.trim().toLowerCase())}%`;
    conds.push(
      sql`(lower(${transactions.name}) like ${pattern} escape '\\' or lower(coalesce(${transactions.merchant}, '')) like ${pattern} escape '\\')`,
    );
  }
  return conds.length ? and(...conds) : undefined;
}

function rowFrom(input: CreateTransactionInput) {
  const ts = nowISO();
  return {
    id: id("txn"),
    accountId: input.accountId,
    externalId: input.externalId ?? null,
    amount: input.amount,
    currency: input.currency ?? "USD",
    date: input.date,
    name: input.name,
    merchant: input.merchant ?? null,
    categoryId: input.categoryId ?? null,
    categorySource: input.categorySource ?? (input.categoryId ? "auto" : null),
    pending: input.pending ?? false,
    notes: input.notes ?? null,
    recurringSeriesId: input.recurringSeriesId ?? null,
    createdAt: ts,
    updatedAt: ts,
  };
}

export function createTransaction(
  db: Db,
  input: CreateTransactionInput,
): Transaction {
  const row = rowFrom(input);
  db.insert(transactions).values(row).run();
  return toTransaction(row);
}

export function createTransactions(
  db: Db,
  inputs: CreateTransactionInput[],
): Transaction[] {
  if (inputs.length === 0) return [];
  const rows = inputs.map(rowFrom);
  db.transaction((tx) => {
    for (const row of rows) tx.insert(transactions).values(row).run();
  });
  return rows.map(toTransaction);
}

export function getTransaction(db: Db, txId: string): Transaction | null {
  const row = db
    .select()
    .from(transactions)
    .where(eq(transactions.id, txId))
    .get();
  return row ? toTransaction(row) : null;
}

export function listTransactions(
  db: Db,
  filters: TransactionFilters = {},
): Paginated<Transaction> {
  const limit = Math.min(Math.max(filters.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
  const offset = Math.max(filters.offset ?? 0, 0);
  const where = whereClause(filters);
  const items = db
    .select()
    .from(transactions)
    .where(where)
    .orderBy(desc(transactions.date), desc(transactions.createdAt), desc(transactions.id))
    .limit(limit)
    .offset(offset)
    .all()
    .map(toTransaction);
  const total =
    db
      .select({ n: sql<number>`count(*)` })
      .from(transactions)
      .where(where)
      .get()?.n ?? 0;
  return { items, total, limit, offset };
}

/** Unpaginated ledger slice, ascending by date — the input shape rules expect. */
export function listTransactionsInRange(
  db: Db,
  range: { from: string; to: string; accountIds?: string[] },
): Transaction[] {
  const conds: SQL[] = [
    gte(transactions.date, range.from),
    lte(transactions.date, range.to),
  ];
  if (range.accountIds) {
    if (range.accountIds.length === 0) return [];
    conds.push(inArray(transactions.accountId, range.accountIds));
  }
  return db
    .select()
    .from(transactions)
    .where(and(...conds))
    .orderBy(asc(transactions.date), asc(transactions.id))
    .all()
    .map(toTransaction);
}

export interface UpdateTransactionPatch {
  categoryId?: string | null;
  notes?: string | null;
  merchant?: string | null;
  name?: string;
  recurringSeriesId?: string | null;
}

/**
 * User-facing edit. Touching `categoryId` here stamps categorySource='user',
 * which permanently exempts the row from the rules engine.
 */
export function updateTransaction(
  db: Db,
  txId: string,
  patch: UpdateTransactionPatch,
  opts: { source?: "auto" | "user" } = {},
): Transaction | null {
  const set: Record<string, unknown> = { updatedAt: nowISO() };
  if ("categoryId" in patch) {
    set.categoryId = patch.categoryId ?? null;
    // Clearing a category is a decision too: stamping the source keeps the
    // rules engine from quietly re-filling a field the user emptied.
    set.categorySource = opts.source ?? "user";
  }
  if ("notes" in patch) set.notes = patch.notes ?? null;
  if ("merchant" in patch) set.merchant = patch.merchant ?? null;
  if ("name" in patch && patch.name !== undefined) set.name = patch.name;
  if ("recurringSeriesId" in patch)
    set.recurringSeriesId = patch.recurringSeriesId ?? null;
  db.update(transactions).set(set).where(eq(transactions.id, txId)).run();
  return getTransaction(db, txId);
}

export function findByExternalId(
  db: Db,
  accountId: string,
  externalId: string,
): Transaction | null {
  const row = db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.accountId, accountId),
        eq(transactions.externalId, externalId),
      ),
    )
    .get();
  return row ? toTransaction(row) : null;
}

/**
 * Provider-sync upsert. An existing row keeps its category when a user set it;
 * everything else follows the provider.
 */
export function upsertProviderTransaction(
  db: Db,
  accountId: string,
  pt: ProviderTransaction,
): { transaction: Transaction; created: boolean } {
  const existing = findByExternalId(db, accountId, pt.externalId);
  if (existing) {
    db.update(transactions)
      .set({
        amount: pt.amount,
        currency: pt.currency,
        date: pt.date,
        name: pt.name,
        merchant: pt.merchant,
        pending: pt.pending,
        updatedAt: nowISO(),
      })
      .where(eq(transactions.id, existing.id))
      .run();
    return {
      transaction: getTransaction(db, existing.id) ?? existing,
      created: false,
    };
  }
  return {
    transaction: createTransaction(db, {
      accountId,
      externalId: pt.externalId,
      amount: pt.amount,
      currency: pt.currency,
      date: pt.date,
      name: pt.name,
      merchant: pt.merchant,
      pending: pt.pending,
    }),
    created: true,
  };
}

export function deleteTransactionsByExternalIds(
  db: Db,
  accountId: string,
  externalIds: string[],
): number {
  if (externalIds.length === 0) return 0;
  const res = db
    .delete(transactions)
    .where(
      and(
        eq(transactions.accountId, accountId),
        inArray(transactions.externalId, externalIds),
      ),
    )
    .run();
  return res.changes;
}

export function deleteTransaction(db: Db, txId: string): void {
  db.delete(transactions).where(eq(transactions.id, txId)).run();
}

export function linkToSeries(
  db: Db,
  txIds: string[],
  seriesId: string | null,
): void {
  if (txIds.length === 0) return;
  db.update(transactions)
    .set({ recurringSeriesId: seriesId, updatedAt: nowISO() })
    .where(inArray(transactions.id, txIds))
    .run();
}

/** Signed sums per category for a date range; used by budgets and insights. */
export function sumByCategory(
  db: Db,
  range: { from: string; to: string },
): Map<string, number> {
  const rows = db
    .select({
      categoryId: transactions.categoryId,
      total: sql<number>`sum(${transactions.amount})`,
    })
    .from(transactions)
    .where(
      and(gte(transactions.date, range.from), lte(transactions.date, range.to)),
    )
    .groupBy(transactions.categoryId)
    .all();
  const out = new Map<string, number>();
  for (const r of rows) {
    if (r.categoryId) out.set(r.categoryId, r.total ?? 0);
  }
  return out;
}

export function countTransactions(db: Db): number {
  return (
    db
      .select({ n: sql<number>`count(*)` })
      .from(transactions)
      .get()?.n ?? 0
  );
}
