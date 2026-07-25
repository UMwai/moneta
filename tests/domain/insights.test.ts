import { beforeEach, describe, expect, it } from "vitest";
import { closeDb, createTestDb, type Db } from "@/db";
import {
  budgetBreachForecast,
  cashRunway,
  categorySpike,
  duplicateCharge,
  generateInsights,
  largeTransaction,
  newSubscription,
  runRules,
  savingsRate,
  unusedSubscription,
} from "@/lib/domain/insights";
import { dismissInsight, listInsights } from "@/lib/domain/repos";
import {
  insertAccount,
  insertTx,
  makeAccount,
  makeBudget,
  makeContext,
  makeSeries,
  makeTx,
} from "./helpers";

const TODAY = "2026-07-20";
const PERIOD = "2026-07";

describe("category_spike", () => {
  it("fires when a discretionary category jumps 30% and $50", () => {
    const ctx = makeContext({
      period: PERIOD,
      today: TODAY,
      transactions: [
        makeTx({ date: "2026-06-08", amount: -30_000, categoryId: "cat_restaurants" }),
        makeTx({ date: "2026-07-08", amount: -52_000, categoryId: "cat_restaurants" }),
      ],
    });
    const [insight] = categorySpike(ctx);
    expect(insight!.kind).toBe("category_spike");
    expect(insight!.title).toContain("Restaurants");
    expect(insight!.title).toContain("73%");
    expect(insight!.refs.categoryId).toBe("cat_restaurants");
    expect(insight!.action).toBeTruthy();
  });

  it("stays quiet for essentials and for small absolute jumps", () => {
    const essentials = makeContext({
      period: PERIOD,
      today: TODAY,
      transactions: [
        makeTx({ date: "2026-06-08", amount: -30_000, categoryId: "cat_groceries" }),
        makeTx({ date: "2026-07-08", amount: -52_000, categoryId: "cat_groceries" }),
      ],
    });
    expect(categorySpike(essentials)).toHaveLength(0);

    const small = makeContext({
      period: PERIOD,
      today: TODAY,
      transactions: [
        makeTx({ date: "2026-06-08", amount: -1_000, categoryId: "cat_coffee" }),
        makeTx({ date: "2026-07-08", amount: -4_000, categoryId: "cat_coffee" }),
      ],
    });
    expect(categorySpike(small)).toHaveLength(0);
  });
});

describe("new_subscription", () => {
  it("flags a series whose first charge landed recently", () => {
    const ctx = makeContext({
      period: PERIOD,
      today: TODAY,
      recurring: [makeSeries({ firstDate: "2026-05-05", lastDate: "2026-07-05" })],
    });
    const [insight] = newSubscription(ctx);
    expect(insight!.kind).toBe("new_subscription");
    expect(insight!.body).toContain("$191.88"); // $15.99 x 12
    expect(insight!.action).toContain("2026-08-05");
  });

  it("ignores long-running subscriptions and incoming series", () => {
    expect(
      newSubscription(
        makeContext({
          period: PERIOD,
          today: TODAY,
          recurring: [makeSeries({ firstDate: "2024-01-05" })],
        }),
      ),
    ).toHaveLength(0);
    expect(
      newSubscription(
        makeContext({
          period: PERIOD,
          today: TODAY,
          recurring: [makeSeries({ firstDate: "2026-06-05", amount: 250_000 })],
        }),
      ),
    ).toHaveLength(0);
  });
});

describe("unused_subscription", () => {
  const seriesId = "rec_netflix";
  const charges = ["2026-05-05", "2026-06-05", "2026-07-05"].map((date) =>
    makeTx({
      date,
      amount: -1_599,
      merchant: "Netflix",
      name: "NETFLIX.COM",
      categoryId: "cat_streaming",
      recurringSeriesId: seriesId,
    }),
  );

  it("flags a subscription charging for 90 days with no other activity", () => {
    const ctx = makeContext({
      period: PERIOD,
      today: TODAY,
      transactions: charges,
      recurring: [makeSeries({ id: seriesId, firstDate: "2025-09-05" })],
    });
    const [insight] = unusedSubscription(ctx);
    expect(insight!.kind).toBe("unused_subscription");
    expect(insight!.severity).toBe("warn");
    expect(insight!.refs.recurringSeriesId).toBe(seriesId);
    expect(insight!.action).toContain("cancel");
  });

  it("stays quiet when the merchant shows other activity", () => {
    const ctx = makeContext({
      period: PERIOD,
      today: TODAY,
      transactions: [
        ...charges,
        makeTx({
          date: "2026-07-10",
          amount: -2_499,
          merchant: "Netflix",
          name: "NETFLIX ONE-OFF RENTAL",
          categoryId: "cat_streaming",
        }),
      ],
      recurring: [makeSeries({ id: seriesId, firstDate: "2025-09-05" })],
    });
    expect(unusedSubscription(ctx)).toHaveLength(0);
  });

  it("stays quiet for a subscription younger than the window", () => {
    const ctx = makeContext({
      period: PERIOD,
      today: TODAY,
      transactions: charges,
      recurring: [makeSeries({ id: seriesId, firstDate: "2026-05-05" })],
    });
    expect(unusedSubscription(ctx)).toHaveLength(0);
  });
});

describe("budget_breach_forecast", () => {
  const budget = makeBudget({ categoryId: "cat_restaurants", amount: 40_000 });

  it("warns when the run rate overshoots before month end", () => {
    const ctx = makeContext({
      period: PERIOD,
      today: "2026-07-10",
      budgets: [budget],
      transactions: [
        makeTx({ date: "2026-07-05", amount: -20_000, categoryId: "cat_restaurants" }),
      ],
    });
    const [insight] = budgetBreachForecast(ctx);
    expect(insight!.severity).toBe("warn");
    expect(insight!.body).toContain("$620"); // projected
    expect(insight!.action).toContain("$200"); // what's left
  });

  it("escalates to critical once the envelope is actually empty", () => {
    const ctx = makeContext({
      period: PERIOD,
      today: "2026-07-20",
      budgets: [budget],
      transactions: [
        makeTx({ date: "2026-07-05", amount: -45_000, categoryId: "cat_restaurants" }),
      ],
    });
    const [insight] = budgetBreachForecast(ctx);
    expect(insight!.severity).toBe("critical");
    expect(insight!.title).toContain("over budget");
  });

  it("stays quiet when spending is on pace", () => {
    const ctx = makeContext({
      period: PERIOD,
      today: "2026-07-10",
      budgets: [budget],
      transactions: [
        makeTx({ date: "2026-07-05", amount: -5_000, categoryId: "cat_restaurants" }),
      ],
    });
    expect(budgetBreachForecast(ctx)).toHaveLength(0);
  });
});

describe("savings_rate", () => {
  it("warns when almost nothing is left over", () => {
    const ctx = makeContext({
      period: PERIOD,
      today: TODAY,
      transactions: [
        makeTx({ date: "2026-07-01", amount: 300_000, categoryId: "cat_salary" }),
        makeTx({ date: "2026-07-05", amount: -290_000, categoryId: "cat_rent" }),
      ],
    });
    const [insight] = savingsRate(ctx);
    expect(insight!.severity).toBe("warn");
    expect(insight!.title).toContain("3%");
  });

  it("goes critical when spending exceeds income", () => {
    const ctx = makeContext({
      period: PERIOD,
      today: TODAY,
      transactions: [
        makeTx({ date: "2026-07-01", amount: 300_000, categoryId: "cat_salary" }),
        makeTx({ date: "2026-07-05", amount: -350_000, categoryId: "cat_rent" }),
      ],
    });
    expect(savingsRate(ctx)[0]!.severity).toBe("critical");
  });

  it("does not count a savings transfer as spending", () => {
    const ctx = makeContext({
      period: PERIOD,
      today: TODAY,
      transactions: [
        makeTx({ date: "2026-07-01", amount: 300_000, categoryId: "cat_salary" }),
        makeTx({ date: "2026-07-02", amount: -100_000, categoryId: "cat_savings_contribution" }),
        makeTx({ date: "2026-07-05", amount: -150_000, categoryId: "cat_rent" }),
      ],
    });
    const [insight] = savingsRate(ctx);
    expect(insight!.severity).toBe("info");
    expect(insight!.title).toContain("50%");
  });

  it("says nothing about a month with no income", () => {
    const ctx = makeContext({
      period: PERIOD,
      today: TODAY,
      transactions: [makeTx({ date: "2026-07-05", amount: -1_000 })],
    });
    expect(savingsRate(ctx)).toHaveLength(0);
  });
});

describe("cash_runway", () => {
  const burnTransactions = ["2026-05-10", "2026-06-10", "2026-07-10"].map((date) =>
    makeTx({ date, amount: -100_000, categoryId: "cat_rent" }),
  );

  it("warns when cash covers less than three months of burn", () => {
    const ctx = makeContext({
      period: PERIOD,
      today: TODAY,
      accounts: [makeAccount({ balance: 200_000 })],
      transactions: burnTransactions,
    });
    const [insight] = cashRunway(ctx);
    expect(insight!.severity).toBe("warn");
    expect(insight!.title).toContain("2.0 months");
    expect(insight!.action).toContain("$1,000");
  });

  it("goes critical under a month of cover", () => {
    const ctx = makeContext({
      period: PERIOD,
      today: TODAY,
      accounts: [makeAccount({ balance: 50_000 })],
      transactions: burnTransactions,
    });
    expect(cashRunway(ctx)[0]!.severity).toBe("critical");
  });

  it("says nothing when income covers spending", () => {
    const ctx = makeContext({
      period: PERIOD,
      today: TODAY,
      accounts: [makeAccount({ balance: 200_000 })],
      transactions: [
        ...burnTransactions,
        makeTx({ date: "2026-05-01", amount: 200_000, categoryId: "cat_salary" }),
        makeTx({ date: "2026-06-01", amount: 200_000, categoryId: "cat_salary" }),
        makeTx({ date: "2026-07-01", amount: 200_000, categoryId: "cat_salary" }),
      ],
    });
    expect(cashRunway(ctx)).toHaveLength(0);
  });

  it("says nothing when the cushion is comfortable", () => {
    const ctx = makeContext({
      period: PERIOD,
      today: TODAY,
      accounts: [makeAccount({ balance: 5_000_000 })],
      transactions: burnTransactions,
    });
    expect(cashRunway(ctx)).toHaveLength(0);
  });
});

describe("large_transaction", () => {
  const routine = Array.from({ length: 30 }, (_, i) =>
    makeTx({
      date: `2026-0${i < 15 ? 5 : 6}-${String((i % 15) + 1).padStart(2, "0")}`,
      amount: -2_000,
      categoryId: "cat_groceries",
    }),
  );

  it("flags a charge far above the trailing distribution", () => {
    const ctx = makeContext({
      period: PERIOD,
      today: TODAY,
      transactions: [
        ...routine,
        makeTx({
          id: "txn_big",
          date: "2026-07-10",
          amount: -60_000,
          merchant: "Peloton",
          categoryId: "cat_fitness",
        }),
      ],
    });
    const [insight] = largeTransaction(ctx);
    expect(insight!.refs.transactionId).toBe("txn_big");
    expect(insight!.title).toContain("$600");
  });

  it("flags a big discretionary charge even in a noisy ledger", () => {
    const ctx = makeContext({
      period: PERIOD,
      today: TODAY,
      transactions: [
        makeTx({ date: "2026-05-01", amount: -400_000, categoryId: "cat_rent" }),
        makeTx({ date: "2026-06-01", amount: -400_000, categoryId: "cat_rent" }),
        makeTx({
          id: "txn_watch",
          date: "2026-07-02",
          amount: -55_000,
          categoryId: "cat_electronics",
        }),
      ],
    });
    expect(
      largeTransaction(ctx).map((i) => i.refs.transactionId),
    ).toContain("txn_watch");
  });

  it("stays quiet when every charge looks the same", () => {
    const ctx = makeContext({
      period: PERIOD,
      today: TODAY,
      transactions: [
        ...routine,
        makeTx({ date: "2026-07-10", amount: -2_000, categoryId: "cat_groceries" }),
      ],
    });
    expect(largeTransaction(ctx)).toHaveLength(0);
  });
});

describe("duplicate_charge", () => {
  it("flags the same amount at the same merchant within three days", () => {
    const ctx = makeContext({
      period: PERIOD,
      today: TODAY,
      transactions: [
        makeTx({ date: "2026-07-05", amount: -4_500, merchant: "Blue Bottle", name: "BLUE BOTTLE" }),
        makeTx({
          id: "txn_dupe",
          date: "2026-07-06",
          amount: -4_500,
          merchant: "Blue Bottle",
          name: "BLUE BOTTLE",
        }),
      ],
    });
    const [insight] = duplicateCharge(ctx);
    expect(insight!.refs.transactionId).toBe("txn_dupe");
    expect(insight!.body).toContain("2026-07-05");
    expect(insight!.action).toContain("dispute");
  });

  it("does not flag the same subscription in consecutive months", () => {
    const ctx = makeContext({
      period: PERIOD,
      today: TODAY,
      transactions: [
        makeTx({ date: "2026-06-05", amount: -1_599, merchant: "Netflix" }),
        makeTx({ date: "2026-07-05", amount: -1_599, merchant: "Netflix" }),
      ],
    });
    expect(duplicateCharge(ctx)).toHaveLength(0);
  });

  it("does not flag two different amounts at one merchant", () => {
    const ctx = makeContext({
      period: PERIOD,
      today: TODAY,
      transactions: [
        makeTx({ date: "2026-07-05", amount: -4_500, merchant: "Blue Bottle" }),
        makeTx({ date: "2026-07-06", amount: -3_500, merchant: "Blue Bottle" }),
      ],
    });
    expect(duplicateCharge(ctx)).toHaveLength(0);
  });
});

describe("rules engine", () => {
  it("keeps the most severe of two drafts sharing a dedupe key", () => {
    const ctx = makeContext({
      period: PERIOD,
      today: TODAY,
      budgets: [makeBudget({ categoryId: "cat_restaurants", amount: 40_000 })],
      transactions: [
        makeTx({ date: "2026-07-05", amount: -45_000, categoryId: "cat_restaurants" }),
      ],
    });
    const drafts = runRules(ctx, {
      budget_breach_forecast: budgetBreachForecast,
      category_spike: () => [],
    });
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.severity).toBe("critical");
  });

  it("survives a rule that throws", () => {
    const drafts = runRules(makeContext({ period: PERIOD, today: TODAY }), {
      cash_runway: () => {
        throw new Error("boom");
      },
      savings_rate: () => [],
    });
    expect(drafts).toEqual([]);
  });
});

describe("generateInsights", () => {
  let db: Db;
  beforeEach(() => {
    db = createTestDb();
    return () => closeDb(db);
  });

  function seedLedger(): void {
    const account = insertAccount(db, { balance: 200_000 });
    insertTx(db, account.id, {
      date: "2026-07-01",
      amount: 300_000,
      name: "ACME PAYROLL",
      categoryId: "cat_salary",
    });
    insertTx(db, account.id, {
      date: "2026-07-03",
      amount: -290_000,
      name: "RENT",
      categoryId: "cat_rent",
    });
    for (const date of ["2026-07-05", "2026-07-06"]) {
      insertTx(db, account.id, {
        date,
        amount: -4_500,
        name: "BLUE BOTTLE COFFEE",
        merchant: "Blue Bottle",
        categoryId: "cat_coffee",
      });
    }
  }

  it("persists a feed where every insight carries an action", () => {
    seedLedger();
    const { insights } = generateInsights(db, { period: PERIOD, today: TODAY });
    const kinds = insights.map((i) => i.kind);
    expect(kinds).toContain("duplicate_charge");
    expect(kinds).toContain("savings_rate");
    for (const insight of insights) {
      expect(insight.action).toBeTruthy();
      expect(insight.period).toBe(PERIOD);
      expect(insight.dismissed).toBe(false);
    }
  });

  it("re-runs in place instead of piling up duplicates", () => {
    seedLedger();
    const first = generateInsights(db, { period: PERIOD, today: TODAY }).insights;
    const second = generateInsights(db, { period: PERIOD, today: TODAY }).insights;
    expect(second).toHaveLength(first.length);
    expect(listInsights(db, { period: PERIOD })).toHaveLength(first.length);
    expect(new Set(second.map((i) => i.id))).toEqual(
      new Set(first.map((i) => i.id)),
    );
  });

  it("never resurrects an insight the user dismissed", () => {
    seedLedger();
    const [first] = generateInsights(db, { period: PERIOD, today: TODAY }).insights;
    expect(dismissInsight(db, first!.id)).toBe(true);

    generateInsights(db, { period: PERIOD, today: TODAY });
    expect(listInsights(db, { period: PERIOD }).map((i) => i.id)).not.toContain(
      first!.id,
    );
    expect(
      listInsights(db, { period: PERIOD, includeDismissed: true }).find(
        (i) => i.id === first!.id,
      )!.dismissed,
    ).toBe(true);
  });
});
