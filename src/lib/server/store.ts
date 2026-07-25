import { randomUUID } from "node:crypto";

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
  RecurringSeries,
  Transaction,
} from "@/lib/types";
import type { CsvTransaction } from "@/lib/server/csv";

export interface StoredUser {
  id: string;
  username: string;
  passwordHash: string;
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
  importCsv(
    rows: CsvTransaction[],
    accountId?: string,
  ): Promise<{ imported: number }>;
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

const SEEDED_CATEGORIES: Category[] = [
  {
    id: "cat-income",
    name: "Income",
    parentId: null,
    icon: "Landmark",
    discretionary: false,
    system: true,
  },
  {
    id: "cat-housing",
    name: "Housing",
    parentId: null,
    icon: "House",
    discretionary: false,
    system: true,
  },
  {
    id: "cat-groceries",
    name: "Groceries",
    parentId: null,
    icon: "ShoppingBasket",
    discretionary: false,
    system: true,
  },
  {
    id: "cat-dining",
    name: "Dining",
    parentId: null,
    icon: "Utensils",
    discretionary: true,
    system: true,
  },
  {
    id: "cat-transport",
    name: "Transportation",
    parentId: null,
    icon: "Car",
    discretionary: false,
    system: true,
  },
  {
    id: "cat-entertainment",
    name: "Entertainment",
    parentId: null,
    icon: "Clapperboard",
    discretionary: true,
    system: true,
  },
];

function clone<T>(value: T): T {
  return structuredClone(value);
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * M3 in-memory adapter. M5 swaps this for the Drizzle-backed store from
 * src/lib/domain; route handlers depend only on the Store interface.
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
    const user = { id: randomUUID(), username, passwordHash };
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

  async importCsv(
    rows: CsvTransaction[],
    accountId?: string,
  ): Promise<{ imported: number }> {
    let targetAccountId = accountId;
    if (targetAccountId) {
      if (!this.accounts.some((account) => account.id === targetAccountId)) {
        throw new Error("Account not found");
      }
    } else {
      let importAccount = this.accounts.find(
        (account) =>
          account.connectionId === null && account.name === "CSV Import",
      );
      if (!importAccount) {
        const timestamp = nowIso();
        importAccount = {
          id: randomUUID(),
          name: "CSV Import",
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
        this.accounts.push(importAccount);
      }
      targetAccountId = importAccount.id;
    }

    const keys = new Set(
      this.transactions.map(
        (transaction) =>
          `${transaction.date}\u0000${transaction.name}\u0000${transaction.amount}`,
      ),
    );
    let imported = 0;
    for (const row of rows) {
      const key = `${row.date}\u0000${row.name}\u0000${row.amount}`;
      if (keys.has(key)) {
        continue;
      }
      keys.add(key);
      const timestamp = nowIso();
      const category = row.category
        ? this.categories.find(
            (item) =>
              item.name.toLocaleLowerCase() ===
              row.category?.toLocaleLowerCase(),
          )
        : undefined;
      this.transactions.push({
        id: randomUUID(),
        accountId: targetAccountId,
        externalId: null,
        amount: row.amount,
        currency: "USD",
        date: row.date,
        name: row.name,
        merchant: null,
        categoryId: category?.id ?? null,
        pending: false,
        notes: null,
        recurringSeriesId: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      });
      imported += 1;
    }
    return { imported };
  }
}

const STORE_SYMBOL = Symbol.for("moneta.store");
type StoreGlobal = typeof globalThis & { [STORE_SYMBOL]?: Store };
const globals = globalThis as StoreGlobal;

export const store: Store = (globals[STORE_SYMBOL] ??= new InMemoryStore());
