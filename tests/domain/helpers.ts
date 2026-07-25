import { createTestDb, type Db } from "@/db";
import { flattenCategories } from "@/lib/domain/seed";
import type { InsightContext, SeriesContext } from "@/lib/domain/insights/types";
import type {
  Account,
  AccountType,
  Budget,
  Category,
  Transaction,
} from "@/lib/types";
import { createAccount, createTransaction } from "@/lib/domain/repos";

export function testDb(): Db {
  return createTestDb();
}

let seq = 0;
function next(prefix: string): string {
  seq += 1;
  return `${prefix}_${String(seq).padStart(4, "0")}`;
}

export function makeAccount(over: Partial<Account> = {}): Account {
  return {
    id: over.id ?? next("acc"),
    name: over.name ?? "Everyday Checking",
    officialName: over.officialName ?? null,
    type: over.type ?? "checking",
    currency: over.currency ?? "USD",
    balance: over.balance ?? 500_000,
    available: over.available ?? null,
    institution: over.institution ?? null,
    connectionId: over.connectionId ?? null,
    mask: over.mask ?? null,
    archived: over.archived ?? false,
    createdAt: over.createdAt ?? "2026-01-01T00:00:00.000Z",
    updatedAt: over.updatedAt ?? "2026-01-01T00:00:00.000Z",
  };
}

export function makeTx(over: Partial<Transaction> = {}): Transaction {
  return {
    id: over.id ?? next("txn"),
    accountId: over.accountId ?? "acc_main",
    externalId: over.externalId ?? null,
    amount: over.amount ?? -1_000,
    currency: over.currency ?? "USD",
    date: over.date ?? "2026-07-01",
    name: over.name ?? "Test charge",
    merchant: over.merchant ?? null,
    categoryId: over.categoryId ?? null,
    pending: over.pending ?? false,
    notes: over.notes ?? null,
    recurringSeriesId: over.recurringSeriesId ?? null,
    createdAt: over.createdAt ?? "2026-07-01T00:00:00.000Z",
    updatedAt: over.updatedAt ?? "2026-07-01T00:00:00.000Z",
  };
}

export function makeSeries(over: Partial<SeriesContext> = {}): SeriesContext {
  return {
    id: over.id ?? next("rec"),
    name: over.name ?? "Netflix",
    merchant: over.merchant ?? "Netflix",
    amount: over.amount ?? -1_599,
    cadence: over.cadence ?? "monthly",
    lastDate: over.lastDate ?? "2026-07-05",
    nextExpectedDate: over.nextExpectedDate ?? "2026-08-05",
    accountId: over.accountId ?? "acc_main",
    active: over.active ?? true,
    firstDate: over.firstDate ?? "2026-01-05",
    occurrences: over.occurrences ?? 7,
    categoryId: over.categoryId ?? "cat_streaming",
    normalizedKey: over.normalizedKey ?? "netflix",
  };
}

export function seedCategoriesArray(): Category[] {
  return flattenCategories().map((c) => ({
    id: c.id,
    name: c.name,
    parentId: c.parentId,
    icon: c.icon,
    discretionary: c.discretionary,
    system: c.system,
  }));
}

export function makeContext(over: Partial<InsightContext> = {}): InsightContext {
  return {
    period: over.period ?? "2026-07",
    today: over.today ?? "2026-07-20",
    transactions: over.transactions ?? [],
    accounts: over.accounts ?? [makeAccount({ id: "acc_main" })],
    categories: over.categories ?? seedCategoriesArray(),
    budgets: over.budgets ?? [],
    recurring: over.recurring ?? [],
  };
}

export function makeBudget(over: Partial<Budget> = {}): Budget {
  return {
    id: over.id ?? next("bdg"),
    categoryId: over.categoryId ?? "cat_restaurants",
    month: over.month ?? "2026-07",
    amount: over.amount ?? 40_000,
    createdAt: over.createdAt ?? "2026-07-01T00:00:00.000Z",
  };
}

/** Creates an account in the database and returns it. */
export function insertAccount(
  db: Db,
  over: { name?: string; type?: AccountType; balance?: number } = {},
): Account {
  return createAccount(db, {
    name: over.name ?? "Everyday Checking",
    type: over.type ?? "checking",
    balance: over.balance ?? 500_000,
  });
}

export function insertTx(
  db: Db,
  accountId: string,
  over: Partial<CreateTx> = {},
): Transaction {
  return createTransaction(db, {
    accountId,
    amount: over.amount ?? -1_000,
    date: over.date ?? "2026-07-01",
    name: over.name ?? "Test charge",
    merchant: over.merchant ?? null,
    categoryId: over.categoryId ?? null,
    categorySource: over.categorySource ?? null,
    externalId: over.externalId ?? null,
  });
}

interface CreateTx {
  amount: number;
  date: string;
  name: string;
  merchant: string | null;
  categoryId: string | null;
  categorySource: "auto" | "user" | null;
  externalId: string | null;
}

/** Monthly charges on the same day-of-month, for recurring fixtures. */
export function monthlyDates(
  start: string,
  count: number,
): string[] {
  const [y, m, d] = start.split("-").map(Number) as [number, number, number];
  return Array.from({ length: count }, (_, i) => {
    const date = new Date(y, m - 1 + i, d);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
      date.getDate(),
    ).padStart(2, "0")}`;
  });
}
