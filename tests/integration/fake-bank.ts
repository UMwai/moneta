import {
  addDaysISO,
  periodOf,
  periodStart,
  todayISO,
} from "@/lib/domain/dates";
import type {
  BankProvider,
  ProviderAccount,
  ProviderTransaction,
  SyncResult,
} from "@/lib/types";

export const GOOD_CREDENTIALS = {
  setupToken: "fake-setup-token",
  accessKey: "correct-horse-battery-staple",
};

export const BAD_CREDENTIALS = {
  setupToken: "fake-setup-token",
  accessKey: "wrong",
};

export const CHECKING_EXTERNAL_ID = "fake:acct:checking";
export const CARD_EXTERNAL_ID = "fake:acct:card";

export const FAKE_ACCOUNTS: ProviderAccount[] = [
  {
    externalId: CHECKING_EXTERNAL_ID,
    name: "Everyday Checking",
    officialName: "Fake Bank Everyday Checking",
    type: "checking",
    currency: "USD",
    balance: 812_345,
    available: 800_000,
    institution: "Fake Bank",
    mask: "4321",
  },
  {
    externalId: CARD_EXTERNAL_ID,
    name: "Rewards Card",
    officialName: null,
    type: "credit",
    currency: "USD",
    balance: -45_600,
    available: null,
    institution: "Fake Bank",
    mask: "9876",
  },
];

/**
 * Dates for the in-period fixtures are pinned relative to today and clamped to
 * the start of the current period, so budgets and insights see them no matter
 * which day of the month the suite happens to run on.
 */
function inPeriod(daysAgo: number): string {
  const today = todayISO();
  const candidate = addDaysISO(today, -daysAgo);
  const start = periodStart(periodOf(today));
  return candidate < start ? start : candidate;
}

function tx(
  over: Partial<ProviderTransaction> &
    Pick<ProviderTransaction, "externalId" | "amount" | "date" | "name">,
): ProviderTransaction {
  return {
    accountExternalId: CHECKING_EXTERNAL_ID,
    currency: "USD",
    merchant: null,
    pending: false,
    ...over,
  };
}

/** One month of activity, deliberately shaped to exercise the whole pipeline. */
export function fakeTransactions(): ProviderTransaction[] {
  const today = todayISO();
  return [
    // Income, so the savings-rate insight has a denominator.
    tx({
      externalId: "fake:txn:payroll",
      amount: 520_000,
      date: inPeriod(12),
      name: "ACME CORP PAYROLL DIRECT DEP",
      merchant: "Acme Corp",
    }),
    // Groceries, so a cat_groceries budget shows real spend.
    tx({
      externalId: "fake:txn:grocery-1",
      amount: -8_500,
      date: inPeriod(9),
      name: "WHOLE FOODS MARKET #221",
      merchant: "Whole Foods",
    }),
    tx({
      externalId: "fake:txn:grocery-2",
      amount: -4_512,
      date: inPeriod(3),
      name: "TRADER JOES 445",
      merchant: "Trader Joes",
    }),
    tx({
      externalId: "fake:txn:restaurant",
      amount: -3_200,
      date: inPeriod(5),
      name: "BLUE BOTTLE COFFEE",
      merchant: "Blue Bottle",
      accountExternalId: CARD_EXTERNAL_ID,
    }),
    // A large discretionary charge, which the large-transaction rule flags.
    tx({
      externalId: "fake:txn:electronics",
      amount: -74_999,
      date: inPeriod(6),
      name: "BEST BUY #1180",
      merchant: "Best Buy",
      accountExternalId: CARD_EXTERNAL_ID,
    }),
    // Four monthly charges at the same amount: enough for recurring detection.
    ...[90, 60, 30, 0].map((daysAgo) =>
      tx({
        externalId: `fake:txn:netflix-${daysAgo}`,
        amount: -1_599,
        date: addDaysISO(today, -daysAgo),
        name: "NETFLIX.COM",
        merchant: "Netflix",
        accountExternalId: CARD_EXTERNAL_ID,
      }),
    ),
  ];
}

export interface FakeBank extends BankProvider {
  /** How many times sync() has been called, to prove the second run ran. */
  readonly calls: { test: number; sync: number };
  /** Cursors handed to sync(), newest last. */
  readonly cursorsSeen: (string | null)[];
  failNextSyncWith(error: Error | null): void;
}

/**
 * A bank that always returns the same window of transactions, whatever cursor it
 * is handed. Re-syncing therefore replays every row, which is exactly the case
 * the `(accountId, externalId)` upsert has to absorb.
 */
export function createFakeBank(
  transactions: ProviderTransaction[] = fakeTransactions(),
): FakeBank {
  const calls = { test: 0, sync: 0 };
  const cursorsSeen: (string | null)[] = [];
  let nextSyncError: Error | null = null;

  return {
    kind: "simplefin",
    calls,
    cursorsSeen,
    failNextSyncWith(error) {
      nextSyncError = error;
    },
    async test(credentials) {
      calls.test += 1;
      const accessKey = (credentials as { accessKey?: unknown } | null)
        ?.accessKey;
      if (accessKey !== GOOD_CREDENTIALS.accessKey) {
        return { ok: false, message: "Access key rejected by Fake Bank." };
      }
      return { ok: true };
    },
    async listAccounts() {
      return FAKE_ACCOUNTS;
    },
    async sync(_credentials, cursor): Promise<SyncResult> {
      calls.sync += 1;
      cursorsSeen.push(cursor);
      if (nextSyncError) {
        const error = nextSyncError;
        nextSyncError = null;
        throw error;
      }
      return {
        accounts: FAKE_ACCOUNTS,
        added: transactions,
        modified: [],
        removedExternalIds: [],
        nextCursor: `cursor-${calls.sync}`,
      };
    },
  };
}
