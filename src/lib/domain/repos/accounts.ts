import { and, asc, eq, isNull } from "drizzle-orm";
import type { Db } from "@/db";
import { id } from "@/db/id";
import { accounts } from "@/db/schema";
import { nowISO } from "@/lib/domain/dates";
import type { Account, AccountType, ProviderAccount } from "@/lib/types";
import { toAccount } from "./mappers";

/** Accounts whose balance reduces net worth rather than adding to it. */
export const LIABILITY_TYPES: readonly AccountType[] = ["credit", "loan"];

/** Accounts that count as spendable cash for runway math. */
export const LIQUID_TYPES: readonly AccountType[] = [
  "checking",
  "savings",
  "cash",
];

export function isLiability(type: AccountType): boolean {
  return LIABILITY_TYPES.includes(type);
}

export interface CreateAccountInput {
  name: string;
  type: AccountType;
  officialName?: string | null;
  currency?: string;
  balance?: number;
  available?: number | null;
  institution?: string | null;
  connectionId?: string | null;
  externalId?: string | null;
  mask?: string | null;
}

export function createAccount(db: Db, input: CreateAccountInput): Account {
  const ts = nowISO();
  const row = {
    id: id("acc"),
    name: input.name,
    officialName: input.officialName ?? null,
    type: input.type,
    currency: input.currency ?? "USD",
    balance: input.balance ?? 0,
    available: input.available ?? null,
    institution: input.institution ?? null,
    connectionId: input.connectionId ?? null,
    externalId: input.externalId ?? null,
    mask: input.mask ?? null,
    archived: false,
    createdAt: ts,
    updatedAt: ts,
  };
  db.insert(accounts).values(row).run();
  return toAccount(row);
}

export function listAccounts(
  db: Db,
  opts: { includeArchived?: boolean; connectionId?: string } = {},
): Account[] {
  const conds = [];
  if (!opts.includeArchived) conds.push(eq(accounts.archived, false));
  if (opts.connectionId) conds.push(eq(accounts.connectionId, opts.connectionId));
  return db
    .select()
    .from(accounts)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(asc(accounts.name))
    .all()
    .map(toAccount);
}

export function getAccount(db: Db, accountId: string): Account | null {
  const row = db
    .select()
    .from(accounts)
    .where(eq(accounts.id, accountId))
    .get();
  return row ? toAccount(row) : null;
}

export function findAccountByExternalId(
  db: Db,
  connectionId: string | null,
  externalId: string,
): Account | null {
  const row = db
    .select()
    .from(accounts)
    .where(
      and(
        connectionId === null
          ? isNull(accounts.connectionId)
          : eq(accounts.connectionId, connectionId),
        eq(accounts.externalId, externalId),
      ),
    )
    .get();
  return row ? toAccount(row) : null;
}

export function updateAccount(
  db: Db,
  accountId: string,
  patch: Partial<
    Pick<
      Account,
      | "name"
      | "officialName"
      | "type"
      | "currency"
      | "balance"
      | "available"
      | "institution"
      | "mask"
      | "archived"
    >
  >,
): Account | null {
  db.update(accounts)
    .set({ ...patch, updatedAt: nowISO() })
    .where(eq(accounts.id, accountId))
    .run();
  return getAccount(db, accountId);
}

/**
 * Idempotent upsert keyed on (connectionId, externalId) — the shape a provider
 * sync needs. Name/type stay under the provider's control; `archived` does not,
 * so a user can hide an account without the next sync resurrecting it.
 */
export function upsertProviderAccount(
  db: Db,
  connectionId: string,
  pa: ProviderAccount,
): Account {
  const existing = findAccountByExternalId(db, connectionId, pa.externalId);
  if (existing) {
    return (
      updateAccount(db, existing.id, {
        name: pa.name,
        officialName: pa.officialName,
        type: pa.type,
        currency: pa.currency,
        balance: pa.balance,
        available: pa.available,
        institution: pa.institution,
        mask: pa.mask,
      }) ?? existing
    );
  }
  return createAccount(db, {
    name: pa.name,
    officialName: pa.officialName,
    type: pa.type,
    currency: pa.currency,
    balance: pa.balance,
    available: pa.available,
    institution: pa.institution,
    mask: pa.mask,
    connectionId,
    externalId: pa.externalId,
  });
}

export function archiveAccount(db: Db, accountId: string): Account | null {
  return updateAccount(db, accountId, { archived: true });
}

export function deleteAccount(db: Db, accountId: string): void {
  db.delete(accounts).where(eq(accounts.id, accountId)).run();
}

/** Spendable cash across checking/savings/cash accounts. */
export function liquidBalance(all: Account[]): number {
  return all
    .filter((a) => !a.archived && LIQUID_TYPES.includes(a.type))
    .reduce((sum, a) => sum + (a.available ?? a.balance), 0);
}
