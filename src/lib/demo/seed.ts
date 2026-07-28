import type { Db } from "@/db";
import { hashPasswordSync } from "@/lib/auth/passwords";
import { periodOf } from "@/lib/domain/dates";
import {
  countUsers,
  createAccount,
  createTransactions,
  createUser,
  upsertBudget,
  writeSnapshots,
} from "@/lib/domain/repos";
import { runPostProcessing } from "@/lib/server/pipeline";
import { generateDemoLedger } from "./generate";

export const DEMO_USERNAME = "demo";
export const DEMO_PASSWORD = "demo-moneta";

export interface DemoSeedResult {
  seeded: boolean;
  accounts: number;
  transactions: number;
  snapshots: number;
  insights: number;
}

const NOT_SEEDED: DemoSeedResult = {
  seeded: false,
  accounts: 0,
  transactions: 0,
  snapshots: 0,
  insights: 0,
};

/**
 * Seeds only a brand-new single-household database. The user row and the full
 * derived ledger commit atomically, making that row a safe idempotency sentinel.
 */
export function seedDemo(
  db: Db,
  opts: { now?: Date } = {},
): DemoSeedResult {
  if (process.env.DEMO !== "1" || countUsers(db) > 0) {
    return NOT_SEEDED;
  }

  const now = opts.now ?? new Date();
  const ledger = generateDemoLedger({ now });
  const passwordHash = hashPasswordSync(DEMO_PASSWORD);
  let result = NOT_SEEDED;

  db.transaction(() => {
    if (countUsers(db) > 0) return;

    createUser(db, {
      username: DEMO_USERNAME,
      passwordHash,
    });

    const accountIds = new Map(
      ledger.accounts.map((account) => {
        const created = createAccount(db, {
          name: account.name,
          officialName: account.officialName,
          type: account.type,
          balance: account.balance,
          available: account.available,
          institution: account.institution,
          externalId: `demo-${account.key}`,
          mask: account.mask,
        });
        return [account.key, created.id] as const;
      }),
    );

    const insertedTransactions = createTransactions(
      db,
      ledger.transactions.map((transaction) => ({
        accountId: accountIds.get(transaction.account)!,
        externalId: transaction.externalId,
        amount: transaction.amount,
        date: transaction.date,
        name: transaction.name,
        merchant: transaction.merchant,
        notes: transaction.notes,
      })),
    );

    const period = periodOf(ledger.endDate);
    for (const budget of [
      { categoryId: "cat_groceries", amount: 95_000 },
      { categoryId: "cat_restaurants", amount: 85_000 },
      { categoryId: "cat_subscriptions", amount: 16_000 },
    ]) {
      upsertBudget(db, { ...budget, month: period });
    }

    const snapshotRows = ledger.snapshots.map((snapshot) => {
      const account = ledger.accounts.find(
        (candidate) => candidate.key === snapshot.account,
      )!;
      return {
        date: snapshot.date,
        accountId: accountIds.get(snapshot.account)!,
        accountType: account.type,
        balance: snapshot.balance,
        currency: "USD",
      };
    });
    writeSnapshots(db, snapshotRows);

    const postProcess = runPostProcessing(db, {
      period,
      today: ledger.endDate,
    });
    result = {
      seeded: true,
      accounts: ledger.accounts.length,
      transactions: insertedTransactions.length,
      snapshots: snapshotRows.length,
      insights: postProcess.insights,
    };
  });

  return result;
}
