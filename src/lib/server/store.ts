import { randomUUID } from "node:crypto";

import { getDb, migrate, type Db } from "@/db";
import { flattenCategories } from "@/lib/domain/seed";
import {
  bumpSessionVersion,
  createUser,
  countUsers,
  findUserByUsername,
  getSessionVersion,
  type UserRecord,
} from "@/lib/domain/repos/users";
import {
  listAccounts as listAccountsRepo,
} from "@/lib/domain/repos/accounts";
import {
  listTransactions as listTransactionsRepo,
  updateTransaction as updateTransactionRepo,
} from "@/lib/domain/repos/transactions";
import {
  getCategory,
  listCategories as listCategoriesRepo,
} from "@/lib/domain/repos/categories";
import {
  listBudgetStatus,
  upsertBudget as upsertBudgetRepo,
} from "@/lib/domain/repos/budgets";
import { getNetWorthSeries } from "@/lib/domain/repos/networth";
import {
  dismissInsight as dismissInsightRepo,
  listInsights as listInsightsRepo,
} from "@/lib/domain/repos/insights";
import { listRecurring as listRecurringRepo } from "@/lib/domain/repos/recurring";
import {
  createConnection as createConnectionRepo,
  deleteConnection as deleteConnectionRepo,
  getConnection,
  listConnections as listConnectionsRepo,
} from "@/lib/domain/repos/connections";
import { applyImport, type ImportBatch } from "@/lib/server/import";
import { syncConnection, type SyncOutcome } from "@/lib/server/sync";
import type {
  Account,
  Budget,
  BudgetStatus,
  Category,
  Connection,
  Insight,
  NetWorthPoint,
  Paginated,
  ProviderKind,
  ProviderTransaction,
  RecurringSeries,
  Transaction,
} from "@/lib/types";

export interface StoredUser {
  id: string;
  username: string;
  passwordHash: string;
  sessionVersion: number;
}

export interface TransactionFilters {
  accountId?: string;
  categoryId?: string;
  q?: string;
  from?: string;
  to?: string;
  limit: number;
  offset: number;
}

export interface TransactionPatch {
  categoryId?: string | null;
  notes?: string | null;
}

export interface Store {
  hasUser(): Promise<boolean>;
  createUser(username: string, passwordHash: string): Promise<StoredUser>;
  findUserByUsername(username: string): Promise<StoredUser | null>;
  /** Current session version, or null if the user no longer exists. */
  sessionVersion(userId: string): Promise<number | null>;
  /** Revokes every session already issued to this user. */
  revokeSessions(userId: string): Promise<void>;
  listAccounts(): Promise<Account[]>;
  listTransactions(
    filters: TransactionFilters,
  ): Promise<Paginated<Transaction>>;
  updateTransaction(
    id: string,
    patch: TransactionPatch,
  ): Promise<Transaction | null>;
  listCategories(): Promise<Category[]>;
  hasCategory(id: string): Promise<boolean>;
  listBudgetStatuses(month: string): Promise<BudgetStatus[]>;
  upsertBudget(
    categoryId: string,
    month: string,
    amount: number,
  ): Promise<Budget>;
  listNetWorth(from?: string, to?: string): Promise<NetWorthPoint[]>;
  listInsights(period: string): Promise<Insight[]>;
  dismissInsight(id: string): Promise<boolean>;
  listRecurring(): Promise<RecurringSeries[]>;
  listConnections(): Promise<Connection[]>;
  createConnection(
    provider: ProviderKind,
    encryptedCredentials: string,
  ): Promise<Connection>;
  hasConnection(id: string): Promise<boolean>;
  deleteConnection(id: string): Promise<boolean>;
  /** Pulls from the provider and folds the result into the ledger. */
  syncConnection(id: string): Promise<SyncOutcome>;
  /** Lands an already-parsed CSV/OFX batch; returns how many rows were new. */
  importTransactions(batch: ImportBatch): Promise<{ imported: number }>;
}

function toStoredUser(user: UserRecord): StoredUser {
  return {
    id: user.id,
    username: user.username,
    passwordHash: user.passwordHash,
    sessionVersion: user.sessionVersion,
  };
}

/**
 * The production store: every method is a thin async facade over the synchronous
 * Drizzle repositories in src/lib/domain/repos. Migrations and the system
 * category seed are applied on first touch, so `pnpm dev` and the standalone
 * server both come up against an empty data directory without a setup step.
 */
export class DrizzleStore implements Store {
  private prepared: Db | undefined;

  constructor(private readonly source: Db | (() => Db) = getDb) {}

  private db(): Db {
    if (!this.prepared) {
      const raw = typeof this.source === "function" ? this.source() : this.source;
      this.prepared = migrate(raw);
    }
    return this.prepared;
  }

  async hasUser(): Promise<boolean> {
    return countUsers(this.db()) > 0;
  }

  async createUser(
    username: string,
    passwordHash: string,
  ): Promise<StoredUser> {
    const db = this.db();
    // Moneta is single-household by design; the check also closes the race
    // where two setup posts arrive before either has committed.
    if (countUsers(db) > 0) {
      throw new Error("A user already exists");
    }
    const user = createUser(db, { username, passwordHash });
    return toStoredUser(user);
  }

  async findUserByUsername(username: string): Promise<StoredUser | null> {
    const user = findUserByUsername(this.db(), username);
    return user ? toStoredUser(user) : null;
  }

  async sessionVersion(userId: string): Promise<number | null> {
    return getSessionVersion(this.db(), userId);
  }

  async revokeSessions(userId: string): Promise<void> {
    bumpSessionVersion(this.db(), userId);
  }

  async listAccounts(): Promise<Account[]> {
    return listAccountsRepo(this.db());
  }

  async listTransactions(
    filters: TransactionFilters,
  ): Promise<Paginated<Transaction>> {
    return listTransactionsRepo(this.db(), filters);
  }

  async updateTransaction(
    id: string,
    patch: TransactionPatch,
  ): Promise<Transaction | null> {
    // A PATCH from the UI is a human decision, so the repo stamps
    // categorySource='user' and the rules engine leaves the row alone forever.
    return updateTransactionRepo(this.db(), id, patch, { source: "user" });
  }

  async listCategories(): Promise<Category[]> {
    return listCategoriesRepo(this.db());
  }

  async hasCategory(id: string): Promise<boolean> {
    return getCategory(this.db(), id) !== null;
  }

  async listBudgetStatuses(month: string): Promise<BudgetStatus[]> {
    return listBudgetStatus(this.db(), month);
  }

  async upsertBudget(
    categoryId: string,
    month: string,
    amount: number,
  ): Promise<Budget> {
    return upsertBudgetRepo(this.db(), { categoryId, month, amount });
  }

  async listNetWorth(from?: string, to?: string): Promise<NetWorthPoint[]> {
    return getNetWorthSeries(this.db(), { from, to });
  }

  async listInsights(period: string): Promise<Insight[]> {
    return listInsightsRepo(this.db(), { period });
  }

  async dismissInsight(id: string): Promise<boolean> {
    return dismissInsightRepo(this.db(), id);
  }

  async listRecurring(): Promise<RecurringSeries[]> {
    return listRecurringRepo(this.db());
  }

  async listConnections(): Promise<Connection[]> {
    return listConnectionsRepo(this.db());
  }

  async createConnection(
    provider: ProviderKind,
    encryptedCredentials: string,
  ): Promise<Connection> {
    return createConnectionRepo(this.db(), {
      provider,
      credentialsEnc: encryptedCredentials,
    });
  }

  async hasConnection(id: string): Promise<boolean> {
    return getConnection(this.db(), id) !== null;
  }

  async deleteConnection(id: string): Promise<boolean> {
    const db = this.db();
    if (!getConnection(db, id)) return false;
    deleteConnectionRepo(db, id);
    return true;
  }

  async syncConnection(id: string): Promise<SyncOutcome> {
    return syncConnection(this.db(), id);
  }

  async importTransactions(batch: ImportBatch): Promise<{ imported: number }> {
    return applyImport(this.db(), batch);
  }
}

export interface InMemorySeed {
  users?: StoredUser[];
  accounts?: Account[];
  transactions?: Transaction[];
  categories?: Category[];
  budgets?: Budget[];
  netWorth?: NetWorthPoint[];
  insights?: Insight[];
  recurring?: RecurringSeries[];
  connections?: Connection[];
}

/** The system taxonomy, shared with the DB seed so the two can never diverge. */
const SEEDED_CATEGORIES: Category[] = flattenCategories().map((category) => ({
  id: category.id,
  name: category.name,
  parentId: category.parentId,
  icon: category.icon,
  discretionary: category.discretionary,
  system: category.system,
}));

function clone<T>(value: T): T {
  return structuredClone(value);
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * Test-only adapter. It backs unit tests that need a Store without a database;
 * anything that exercises the real ingest pipeline uses DrizzleStore over a
 * temp/in-memory SQLite file instead (see tests/integration).
 */
export class InMemoryStore implements Store {
  private readonly users: StoredUser[];
  private readonly accounts: Account[];
  private readonly transactions: Transaction[];
  private readonly categories: Category[];
  private readonly budgets: Budget[];
  private readonly netWorth: NetWorthPoint[];
  private readonly insights: Insight[];
  private readonly recurring: RecurringSeries[];
  private readonly connections: Connection[];
  private readonly encryptedCredentials = new Map<string, string>();

  constructor(seed: InMemorySeed = {}) {
    this.users = clone(seed.users ?? []);
    this.accounts = clone(seed.accounts ?? []);
    this.transactions = clone(seed.transactions ?? []);
    this.categories = clone(seed.categories ?? SEEDED_CATEGORIES);
    this.budgets = clone(seed.budgets ?? []);
    this.netWorth = clone(seed.netWorth ?? []);
    this.insights = clone(seed.insights ?? []);
    this.recurring = clone(seed.recurring ?? []);
    this.connections = clone(seed.connections ?? []);
  }

  async hasUser(): Promise<boolean> {
    return this.users.length > 0;
  }

  async createUser(
    username: string,
    passwordHash: string,
  ): Promise<StoredUser> {
    if (this.users.length > 0) {
      throw new Error("A user already exists");
    }
    const user = { id: randomUUID(), username, passwordHash, sessionVersion: 1 };
    this.users.push(user);
    return clone(user);
  }

  async findUserByUsername(username: string): Promise<StoredUser | null> {
    const normalized = username.toLocaleLowerCase();
    const user = this.users.find(
      (candidate) => candidate.username.toLocaleLowerCase() === normalized,
    );
    return user ? clone(user) : null;
  }

  async sessionVersion(userId: string): Promise<number | null> {
    return this.users.find((user) => user.id === userId)?.sessionVersion ?? null;
  }

  async revokeSessions(userId: string): Promise<void> {
    const user = this.users.find((candidate) => candidate.id === userId);
    if (user) user.sessionVersion += 1;
  }

  async listAccounts(): Promise<Account[]> {
    return clone(this.accounts);
  }

  async listTransactions(
    filters: TransactionFilters,
  ): Promise<Paginated<Transaction>> {
    const query = filters.q?.toLocaleLowerCase();
    const filtered = this.transactions
      .filter(
        (transaction) =>
          (!filters.accountId ||
            transaction.accountId === filters.accountId) &&
          (!filters.categoryId ||
            transaction.categoryId === filters.categoryId) &&
          (!filters.from || transaction.date >= filters.from) &&
          (!filters.to || transaction.date <= filters.to) &&
          (!query ||
            [transaction.name, transaction.merchant, transaction.notes].some(
              (value) => value?.toLocaleLowerCase().includes(query),
            )),
      )
      .sort(
        (left, right) =>
          right.date.localeCompare(left.date) ||
          right.createdAt.localeCompare(left.createdAt),
      );
    return {
      items: clone(
        filtered.slice(filters.offset, filters.offset + filters.limit),
      ),
      total: filtered.length,
      limit: filters.limit,
      offset: filters.offset,
    };
  }

  async updateTransaction(
    id: string,
    patch: TransactionPatch,
  ): Promise<Transaction | null> {
    const transaction = this.transactions.find((item) => item.id === id);
    if (!transaction) {
      return null;
    }
    if ("categoryId" in patch) {
      transaction.categoryId = patch.categoryId ?? null;
    }
    if ("notes" in patch) {
      transaction.notes = patch.notes ?? null;
    }
    transaction.updatedAt = nowIso();
    return clone(transaction);
  }

  async listCategories(): Promise<Category[]> {
    return clone(this.categories);
  }

  async hasCategory(id: string): Promise<boolean> {
    return this.categories.some((category) => category.id === id);
  }

  async listBudgetStatuses(month: string): Promise<BudgetStatus[]> {
    const [year, monthNumber] = month.split("-").map(Number);
    const current = new Date();
    const isCurrentMonth =
      current.getUTCFullYear() === year &&
      current.getUTCMonth() + 1 === monthNumber;
    const elapsedDays = isCurrentMonth ? current.getUTCDate() : 0;
    const daysInMonth = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();

    return clone(
      this.budgets
        .filter((budget) => budget.month === month)
        .map((budget) => {
          const spent = this.transactions
            .filter(
              (transaction) =>
                transaction.categoryId === budget.categoryId &&
                transaction.date.startsWith(month) &&
                transaction.amount < 0,
            )
            .reduce((total, transaction) => total - transaction.amount, 0);
          const category = this.categories.find(
            (item) => item.id === budget.categoryId,
          );
          return {
            ...budget,
            spent,
            remaining: budget.amount - spent,
            projected:
              isCurrentMonth && elapsedDays > 0
                ? Math.round((spent / elapsedDays) * daysInMonth)
                : spent,
            categoryName: category?.name ?? "Unknown",
          };
        }),
    );
  }

  async upsertBudget(
    categoryId: string,
    month: string,
    amount: number,
  ): Promise<Budget> {
    const existing = this.budgets.find(
      (budget) =>
        budget.categoryId === categoryId && budget.month === month,
    );
    if (existing) {
      existing.amount = amount;
      return clone(existing);
    }
    const budget = {
      id: randomUUID(),
      categoryId,
      month,
      amount,
      createdAt: nowIso(),
    };
    this.budgets.push(budget);
    return clone(budget);
  }

  async listNetWorth(from?: string, to?: string): Promise<NetWorthPoint[]> {
    return clone(
      this.netWorth
        .filter(
          (point) =>
            (!from || point.date >= from) && (!to || point.date <= to),
        )
        .sort((left, right) => left.date.localeCompare(right.date)),
    );
  }

  async listInsights(period: string): Promise<Insight[]> {
    return clone(
      this.insights.filter((insight) => insight.period === period),
    );
  }

  async dismissInsight(id: string): Promise<boolean> {
    const insight = this.insights.find((item) => item.id === id);
    if (!insight) {
      return false;
    }
    insight.dismissed = true;
    return true;
  }

  async listRecurring(): Promise<RecurringSeries[]> {
    return clone(this.recurring);
  }

  async listConnections(): Promise<Connection[]> {
    return clone(this.connections);
  }

  async createConnection(
    provider: ProviderKind,
    encryptedCredentials: string,
  ): Promise<Connection> {
    const connection = {
      id: randomUUID(),
      provider,
      institution: null,
      status: "ok" as const,
      lastSyncAt: null,
      createdAt: nowIso(),
    };
    this.connections.push(connection);
    this.encryptedCredentials.set(connection.id, encryptedCredentials);
    return clone(connection);
  }

  async hasConnection(id: string): Promise<boolean> {
    return this.connections.some((connection) => connection.id === id);
  }

  async deleteConnection(id: string): Promise<boolean> {
    const index = this.connections.findIndex(
      (connection) => connection.id === id,
    );
    if (index < 0) {
      return false;
    }
    this.connections.splice(index, 1);
    this.encryptedCredentials.delete(id);
    return true;
  }

  async syncConnection(): Promise<SyncOutcome> {
    throw new Error(
      "Provider sync needs the ledger; use DrizzleStore over a test database.",
    );
  }

  async importTransactions(
    batch: ImportBatch,
  ): Promise<{ imported: number }> {
    const targetAccountId = batch.accountId
      ? this.requireAccount(batch.accountId)
      : this.fileImportAccount();

    let imported = 0;
    for (const row of batch.transactions) {
      const duplicate = this.transactions.some(
        (transaction) =>
          transaction.accountId === targetAccountId &&
          transaction.externalId === row.externalId,
      );
      if (duplicate) continue;

      const label = batch.categoryByExternalId?.[row.externalId];
      const category = label
        ? this.categories.find(
            (item) =>
              item.name.toLocaleLowerCase() === label.toLocaleLowerCase() ||
              item.id === label,
          )
        : undefined;
      const timestamp = nowIso();
      this.transactions.push({
        id: randomUUID(),
        accountId: targetAccountId,
        externalId: row.externalId,
        amount: row.amount,
        currency: row.currency,
        date: row.date,
        name: row.name,
        merchant: row.merchant,
        categoryId: category?.id ?? null,
        pending: row.pending,
        notes: null,
        recurringSeriesId: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      imported += 1;
    }
    return { imported };
  }

  private requireAccount(accountId: string): string {
    if (!this.accounts.some((account) => account.id === accountId)) {
      throw new Error("Account not found");
    }
    return accountId;
  }

  private fileImportAccount(): string {
    const existing = this.accounts.find(
      (account) =>
        account.connectionId === null && account.name === "File Import",
    );
    if (existing) return existing.id;

    const timestamp = nowIso();
    const created: Account = {
      id: randomUUID(),
      name: "File Import",
      officialName: null,
      type: "checking",
      currency: "USD",
      balance: 0,
      available: null,
      institution: null,
      connectionId: null,
      mask: null,
      archived: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.accounts.push(created);
    return created.id;
  }
}

export type { ImportBatch, ProviderTransaction, SyncOutcome };

const STORE_SYMBOL = Symbol.for("moneta.store");
type StoreGlobal = typeof globalThis & { [STORE_SYMBOL]?: Store };
const globals = globalThis as StoreGlobal;

export const store: Store = (globals[STORE_SYMBOL] ??= new DrizzleStore());
