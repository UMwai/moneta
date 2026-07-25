import type {
  AccountRow,
  BudgetRow,
  CategoryRow,
  ConnectionRow,
  InsightRow,
  RecurringSeriesRow,
  TransactionRow,
} from "@/db/schema";
import type {
  Account,
  Budget,
  Category,
  Connection,
  Insight,
  RecurringSeries,
  Transaction,
} from "@/lib/types";

/**
 * Row -> contract mappers. Rows carry a few columns that are deliberately absent
 * from src/lib/types.ts (account.externalId, connection.credentialsEnc, insight
 * dedupe keys); mapping here is what keeps those out of anything API-facing.
 */

export function toAccount(r: AccountRow): Account {
  return {
    id: r.id,
    name: r.name,
    officialName: r.officialName,
    type: r.type,
    currency: r.currency,
    balance: r.balance,
    available: r.available,
    institution: r.institution,
    connectionId: r.connectionId,
    mask: r.mask,
    archived: r.archived,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export function toTransaction(r: TransactionRow): Transaction {
  return {
    id: r.id,
    accountId: r.accountId,
    externalId: r.externalId,
    amount: r.amount,
    currency: r.currency,
    date: r.date,
    name: r.name,
    merchant: r.merchant,
    categoryId: r.categoryId,
    pending: r.pending,
    notes: r.notes,
    recurringSeriesId: r.recurringSeriesId,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export function toCategory(r: CategoryRow): Category {
  return {
    id: r.id,
    name: r.name,
    parentId: r.parentId,
    icon: r.icon,
    discretionary: r.discretionary,
    system: r.system,
  };
}

export function toBudget(r: BudgetRow): Budget {
  return {
    id: r.id,
    categoryId: r.categoryId,
    month: r.month,
    amount: r.amount,
    createdAt: r.createdAt,
  };
}

export function toConnection(r: ConnectionRow): Connection {
  return {
    id: r.id,
    provider: r.provider,
    institution: r.institution,
    status: r.status,
    lastSyncAt: r.lastSyncAt,
    createdAt: r.createdAt,
  };
}

export function toInsight(r: InsightRow): Insight {
  return {
    id: r.id,
    kind: r.kind,
    severity: r.severity,
    title: r.title,
    body: r.body,
    action: r.action,
    refs: r.refs ?? {},
    period: r.period,
    dismissed: r.dismissed,
    createdAt: r.createdAt,
  };
}

export function toRecurringSeries(r: RecurringSeriesRow): RecurringSeries {
  return {
    id: r.id,
    name: r.name,
    merchant: r.merchant,
    amount: r.amount,
    cadence: r.cadence,
    lastDate: r.lastDate,
    nextExpectedDate: r.nextExpectedDate,
    accountId: r.accountId,
    active: r.active,
  };
}
