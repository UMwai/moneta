import {
  addDaysISO,
  addMonthsISO,
  addPeriods,
  daysBetween,
  parseISODate,
  periodOf,
  toISODate,
} from "@/lib/domain/dates";
import type { AccountType } from "@/lib/types";

export const DEMO_LEDGER_SEED = 0x4d4f4e45;

export type DemoAccountKey =
  | "checking"
  | "savings"
  | "credit"
  | "investment";

export interface DemoAccount {
  key: DemoAccountKey;
  name: string;
  officialName: string;
  type: AccountType;
  balance: number;
  available: number | null;
  institution: string;
  mask: string;
}

export interface DemoTransaction {
  account: DemoAccountKey;
  externalId: string;
  amount: number;
  date: string;
  name: string;
  merchant: string | null;
  notes: string | null;
}

export interface DemoBalanceSnapshot {
  account: DemoAccountKey;
  date: string;
  balance: number;
}

export interface DemoLedger {
  seed: number;
  startDate: string;
  endDate: string;
  accounts: DemoAccount[];
  transactions: DemoTransaction[];
  snapshots: DemoBalanceSnapshot[];
}

export interface GenerateDemoOptions {
  now: Date;
  seed?: number;
}

type PendingTransaction = Omit<DemoTransaction, "externalId">;

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function integer(random: () => number, min: number, max: number): number {
  return Math.floor(random() * (max - min + 1)) + min;
}

function choose<T>(random: () => number, values: readonly T[]): T {
  return values[integer(random, 0, values.length - 1)]!;
}

function dayOfMonth(date: string): number {
  return Number(date.slice(8, 10));
}

function dateInPeriod(period: string, day: number): string {
  return `${period}-${String(day).padStart(2, "0")}`;
}

function monthNumber(period: string): number {
  return Number(period.slice(5, 7));
}

function periodsBetween(startDate: string, endDate: string): string[] {
  const end = periodOf(endDate);
  const periods: string[] = [];
  for (
    let period = periodOf(startDate);
    period <= end;
    period = addPeriods(period, 1)
  ) {
    periods.push(period);
  }
  return periods;
}

function generatedDay(
  random: () => number,
  period: string,
  startDate: string,
  endDate: string,
): number {
  const first =
    period === periodOf(startDate) ? Math.min(dayOfMonth(startDate), 28) : 1;
  const last =
    period === periodOf(endDate) ? Math.min(dayOfMonth(endDate), 28) : 28;
  return integer(random, Math.min(first, last), Math.max(first, last));
}

function isWithin(date: string, startDate: string, endDate: string): boolean {
  return date >= startDate && date <= endDate;
}

function transactionSort(
  left: PendingTransaction,
  right: PendingTransaction,
): number {
  return (
    left.date.localeCompare(right.date) ||
    left.account.localeCompare(right.account) ||
    left.name.localeCompare(right.name) ||
    left.amount - right.amount
  );
}

const ACCOUNTS: DemoAccount[] = [
  {
    key: "checking",
    name: "Everyday Checking",
    officialName: "Chase Total Checking",
    type: "checking",
    balance: 684_219,
    available: 642_870,
    institution: "Chase",
    mask: "1842",
  },
  {
    key: "savings",
    name: "Emergency Savings",
    officialName: "Marcus Online Savings",
    type: "savings",
    balance: 1_284_037,
    available: 1_284_037,
    institution: "Marcus",
    mask: "7091",
  },
  {
    key: "credit",
    name: "Sapphire Preferred",
    officialName: "Chase Sapphire Preferred",
    type: "credit",
    balance: -234_176,
    available: null,
    institution: "Chase",
    mask: "4428",
  },
  {
    key: "investment",
    name: "Vanguard Brokerage",
    officialName: "Individual Brokerage Account",
    type: "investment",
    balance: 3_895_640,
    available: 164_820,
    institution: "Vanguard",
    mask: "9206",
  },
];

const GROCERY_MERCHANTS = [
  { name: "TRADER JOE'S #553", merchant: "Trader Joe's" },
  { name: "WHOLE FOODS MKT 10245", merchant: "Whole Foods Market" },
  { name: "WEGMANS FOOD MARKET #07", merchant: "Wegmans" },
  { name: "ALDI 76012", merchant: "Aldi" },
  { name: "STOP & SHOP 0512", merchant: "Stop & Shop" },
] as const;

const RESTAURANTS = [
  { name: "TST* SWEETGREEN 1157", merchant: "Sweetgreen" },
  { name: "CHIPOTLE 2547", merchant: "Chipotle" },
  { name: "MOMOFUKU NOODLE BAR", merchant: "Momofuku Noodle Bar" },
  { name: "JOE'S PIZZA CARMINE", merchant: "Joe's Pizza" },
  { name: "SHAKE SHACK #118", merchant: "Shake Shack" },
  { name: "SAIGON BISTRO", merchant: "Saigon Bistro" },
  { name: "KATZ'S DELICATESSEN", merchant: "Katz's Restaurant" },
] as const;

const COFFEE_MERCHANTS = [
  { name: "STARBUCKS STORE 13826", merchant: "Starbucks" },
  { name: "BLUE BOTTLE COFFEE", merchant: "Blue Bottle Coffee" },
  { name: "LA COLOMBE CAFE", merchant: "La Colombe Cafe" },
  { name: "DUNKIN #343812", merchant: "Dunkin" },
] as const;

const SUBSCRIPTIONS = [
  {
    name: "NETFLIX.COM",
    merchant: "Netflix",
    amount: -1_599,
    day: 5,
    startsBeforeEnd: 14,
  },
  {
    name: "SPOTIFY USA",
    merchant: "Spotify",
    amount: -1_199,
    day: 7,
    startsBeforeEnd: 14,
  },
  {
    name: "APPLE.COM/BILL ICLOUD",
    merchant: "iCloud",
    amount: -299,
    day: 9,
    startsBeforeEnd: 14,
  },
  {
    name: "EQUINOX MEMBERSHIP",
    merchant: "Equinox Gym",
    amount: -5_499,
    day: 11,
    startsBeforeEnd: 14,
  },
  {
    name: "AMAZON PRIME MEMBERSHIP",
    merchant: "Amazon Prime",
    amount: -1_499,
    day: 13,
    startsBeforeEnd: 14,
  },
  {
    name: "NYTIMES DIGITAL",
    merchant: "NY Times",
    amount: -1_200,
    day: 15,
    startsBeforeEnd: 14,
  },
  {
    name: "1PASSWORD SUBSCRIPTION",
    merchant: "1Password",
    amount: -499,
    day: 17,
    startsBeforeEnd: 14,
  },
  {
    name: "DROPBOX PLUS",
    merchant: "Dropbox",
    amount: -699,
    day: 19,
    startsBeforeEnd: 14,
  },
  {
    name: "DISNEY PLUS",
    merchant: "Disney+",
    amount: -1_599,
    day: 2,
    startsBeforeEnd: 3,
  },
] as const;

function generateSnapshots(
  random: () => number,
  startDate: string,
  endDate: string,
): DemoBalanceSnapshot[] {
  const dates: string[] = [];
  for (
    let cursor = endDate;
    cursor >= startDate;
    cursor = addDaysISO(cursor, -7)
  ) {
    dates.push(cursor);
  }
  dates.reverse();

  const totalDays = Math.max(daysBetween(startDate, endDate), 1);
  const opening: Record<DemoAccountKey, number> = {
    checking: 412_000,
    savings: 742_000,
    credit: -178_000,
    investment: 2_468_000,
  };

  return dates.flatMap((date, index) => {
    const progress = daysBetween(startDate, date) / totalDays;
    return ACCOUNTS.map((account) => {
      if (date === endDate) {
        return { account: account.key, date, balance: account.balance };
      }

      const trend =
        opening[account.key] +
        (account.balance - opening[account.key]) * progress;
      const phase = index / 2.7;
      const variation =
        account.key === "investment"
          ? Math.sin(phase) * 22_000 + integer(random, -7_000, 9_000)
          : account.key === "credit"
            ? Math.sin(phase * 1.6) * 58_000 + integer(random, -18_000, 18_000)
            : account.key === "checking"
              ? Math.sin(phase * 2.1) * 125_000 +
                integer(random, -24_000, 24_000)
              : Math.sin(phase * 0.7) * 18_000 +
                integer(random, -4_000, 5_000);
      const balance = Math.round(
        account.key === "credit"
          ? Math.min(trend + variation, -25_000)
          : trend + variation,
      );
      return { account: account.key, date, balance };
    });
  });
}

/**
 * Produces a repeatable, provider-like household ledger. Time is supplied by the
 * caller so screenshots and tests can pin the calendar without hidden clocks.
 */
export function generateDemoLedger({
  now,
  seed = DEMO_LEDGER_SEED,
}: GenerateDemoOptions): DemoLedger {
  const random = mulberry32(seed);
  const endDate = toISODate(now);
  const startDate = addMonthsISO(endDate, -14);
  const periods = periodsBetween(startDate, endDate);
  const endPeriod = periodOf(endDate);
  const previousPeriod = addPeriods(endPeriod, -1);
  const pending: PendingTransaction[] = [];

  const add = (transaction: PendingTransaction): void => {
    if (
      transaction.amount !== 0 &&
      isWithin(transaction.date, startDate, endDate)
    ) {
      pending.push(transaction);
    }
  };

  const addPair = (
    date: string,
    amount: number,
    outflow: Omit<PendingTransaction, "date" | "amount">,
    inflow: Omit<PendingTransaction, "date" | "amount">,
  ): void => {
    add({ ...outflow, date, amount: -Math.abs(amount) });
    add({ ...inflow, date, amount: Math.abs(amount) });
  };

  const endWeekday = parseISODate(endDate).getDay();
  let payday = addDaysISO(endDate, -((endWeekday - 5 + 7) % 7));
  while (payday >= startDate) {
    add({
      account: "checking",
      date: payday,
      amount: integer(random, 334_000, 348_000),
      name: "ACME SYSTEMS PAYROLL DIRECT DEP",
      merchant: "Acme Systems",
      notes: null,
    });
    payday = addDaysISO(payday, -14);
  }

  for (const period of periods) {
    add({
      account: "checking",
      date: dateInPeriod(period, 1),
      amount: -185_000,
      name: "RIVERSTONE APARTMENTS RENT",
      merchant: "Riverstone Apartments",
      notes: null,
    });

    addPair(
      dateInPeriod(period, 3),
      40_000,
      {
        account: "checking",
        name: "MONTHLY SAVINGS TRANSFER",
        merchant: "Marcus",
        notes: "Automatic emergency-fund contribution",
      },
      {
        account: "savings",
        name: "TRANSFER FROM CHECKING",
        merchant: "Chase",
        notes: "Automatic emergency-fund contribution",
      },
    );

    addPair(
      dateInPeriod(period, 22),
      integer(random, 148_000, 238_000),
      {
        account: "checking",
        name: "CHASE CREDIT CRD AUTOPAY",
        merchant: "Chase",
        notes: null,
      },
      {
        account: "credit",
        name: "PAYMENT THANK YOU",
        merchant: "Chase",
        notes: null,
      },
    );

    if (monthNumber(period) % 3 === 0) {
      addPair(
        dateInPeriod(period, 6),
        25_000,
        {
          account: "checking",
          name: "VANGUARD INVESTMENT",
          merchant: "Vanguard",
          notes: "Quarterly brokerage contribution",
        },
        {
          account: "investment",
          name: "TRANSFER FROM CHECKING",
          merchant: "Chase",
          notes: "Quarterly brokerage contribution",
        },
      );
    }

    add({
      account: "investment",
      date: dateInPeriod(period, 25),
      amount: integer(random, 8_000, 17_000),
      name: "DIVIDEND PAYMENT",
      merchant: "Vanguard Brokerage",
      notes: null,
    });

    for (const subscription of SUBSCRIPTIONS) {
      if (period < addPeriods(endPeriod, -subscription.startsBeforeEnd)) {
        continue;
      }
      add({
        account: "credit",
        date: dateInPeriod(period, subscription.day),
        amount: subscription.amount,
        name: subscription.name,
        merchant: subscription.merchant,
        notes:
          subscription.merchant === "Dropbox"
            ? "Recurring storage plan"
            : null,
      });
    }

    const month = monthNumber(period);
    const seasonal =
      month >= 6 && month <= 9
        ? 5_500
        : month === 12 || month <= 2
          ? 3_800
          : 0;
    add({
      account: "checking",
      date: dateInPeriod(period, 8),
      amount: -integer(random, 8_300 + seasonal, 11_200 + seasonal),
      name: "CON EDISON ELECTRIC BILL",
      merchant: "Con Edison",
      notes: null,
    });
    add({
      account: "credit",
      date: dateInPeriod(period, 14),
      amount: -7_999,
      name: "SPECTRUM INTERNET",
      merchant: "Spectrum",
      notes: null,
    });
    add({
      account: "credit",
      date: dateInPeriod(period, 18),
      amount: -6_850,
      name: "T-MOBILE AUTOPAY",
      merchant: "T-Mobile",
      notes: null,
    });

    const groceries = integer(random, 6, 9);
    for (let index = 0; index < groceries; index++) {
      const merchant = choose(random, GROCERY_MERCHANTS);
      add({
        account: "credit",
        date: dateInPeriod(
          period,
          generatedDay(random, period, startDate, endDate),
        ),
        amount: -integer(random, 2_800, 9_800),
        name: merchant.name,
        merchant: merchant.merchant,
        notes: null,
      });
    }

    const restaurantCount =
      period === endPeriod ? 12 : period === previousPeriod ? 9 : integer(random, 4, 6);
    const restaurantRange =
      period === endPeriod
        ? ([9_500, 12_500] as const)
        : period === previousPeriod
          ? ([6_500, 9_000] as const)
          : ([2_200, 6_500] as const);
    for (let index = 0; index < restaurantCount; index++) {
      const merchant = choose(random, RESTAURANTS);
      add({
        account: "credit",
        date: dateInPeriod(
          period,
          generatedDay(random, period, startDate, endDate),
        ),
        amount: -integer(random, restaurantRange[0], restaurantRange[1]),
        name: merchant.name,
        merchant: merchant.merchant,
        notes: period === previousPeriod ? "Dining-heavy month" : null,
      });
    }

    const coffees =
      period === endPeriod ? integer(random, 10, 13) : integer(random, 5, 9);
    for (let index = 0; index < coffees; index++) {
      const merchant = choose(random, COFFEE_MERCHANTS);
      add({
        account: "credit",
        date: dateInPeriod(
          period,
          generatedDay(random, period, startDate, endDate),
        ),
        amount: -integer(random, 425, 975),
        name: merchant.name,
        merchant: merchant.merchant,
        notes: null,
      });
    }

    for (let index = 0; index < integer(random, 1, 3); index++) {
      add({
        account: "credit",
        date: dateInPeriod(
          period,
          generatedDay(random, period, startDate, endDate),
        ),
        amount: -integer(random, 2_400, 7_800),
        name: index % 2 === 0 ? "DOORDASH*ORDER" : "UBER EATS",
        merchant: index % 2 === 0 ? "DoorDash" : "Uber Eats",
        notes: null,
      });
    }

    for (let index = 0; index < integer(random, 2, 4); index++) {
      add({
        account: "credit",
        date: dateInPeriod(
          period,
          generatedDay(random, period, startDate, endDate),
        ),
        amount: -integer(random, 3_600, 6_900),
        name:
          index % 2 === 0 ? "SHELL OIL 57444229" : "EXXONMOBIL 974126",
        merchant: index % 2 === 0 ? "Shell" : "ExxonMobil",
        notes: null,
      });
    }

    add({
      account: "credit",
      date: dateInPeriod(
        period,
        generatedDay(random, period, startDate, endDate),
      ),
      amount: -integer(random, 2_500, 9_500),
      name: choose(random, [
        "TARGET T-2841",
        "CVS/PHARMACY #10427",
        "UBER *TRIP",
        "AMAZON MKTPLACE PMTS",
      ]),
      merchant: null,
      notes: null,
    });
  }

  const churnPeriod = addPeriods(endPeriod, -4);
  add({
    account: "credit",
    date: dateInPeriod(churnPeriod, 21),
    amount: -2_499,
    name: "DROPBOX STORAGE ADD-ON",
    merchant: "Dropbox",
    notes: "Last add-on before the plan stopped being used",
  });

  add({
    account: "credit",
    date: dateInPeriod(addPeriods(endPeriod, -10), 12),
    amount: -74_218,
    name: "DELTA AIR LINES 006218934",
    merchant: "Delta Air Lines",
    notes: "Holiday flight",
  });
  add({
    account: "checking",
    date: dateInPeriod(addPeriods(endPeriod, -6), 16),
    amount: -54_000,
    name: "GREENWICH VILLAGE DENTAL",
    merchant: "Greenwich Village Dental",
    notes: "Dental work",
  });
  add({
    account: "credit",
    date: dateInPeriod(addPeriods(endPeriod, -2), 10),
    amount: -189_900,
    name: "APPLE STORE SOHO",
    merchant: "Apple Store",
    notes: "Laptop replacement",
  });

  const duplicateFirst = dateInPeriod(endPeriod, Math.min(dayOfMonth(endDate), 8));
  const duplicateSecond = addDaysISO(duplicateFirst, 2);
  for (const date of [duplicateFirst, duplicateSecond]) {
    add({
      account: "credit",
      date,
      amount: -2_875,
      name: "TST* SWEETGREEN 1157",
      merchant: "Sweetgreen",
      notes: "Possible duplicate",
    });
  }

  const transactions = pending
    .sort(transactionSort)
    .map((transaction, index) => ({
      ...transaction,
      externalId: `demo-txn-${String(index + 1).padStart(5, "0")}`,
    }));

  return {
    seed,
    startDate,
    endDate,
    accounts: ACCOUNTS.map((account) => ({ ...account })),
    transactions,
    snapshots: generateSnapshots(random, startDate, endDate),
  };
}
