import { beforeEach, describe, expect, it } from "vitest";
import { closeDb, createTestDb, type Db } from "@/db";
import {
  computeBudgetStatus,
  listBudgetStatus,
  listBudgets,
  upsertBudget,
} from "@/lib/domain/repos";
import { insertAccount, insertTx, makeBudget } from "./helpers";

describe("budget status", () => {
  it("projects a full month from the run rate so far", () => {
    // $200 spent by the 10th of a 31-day month -> $620 projected.
    const status = computeBudgetStatus(
      makeBudget({ amount: 50_000 }),
      20_000,
      "Restaurants",
      "2026-07-10",
    );
    expect(status.spent).toBe(20_000);
    expect(status.remaining).toBe(30_000);
    expect(status.projected).toBe(62_000);
    expect(status.categoryName).toBe("Restaurants");
  });

  it("projects exactly what was spent once the month is over", () => {
    const status = computeBudgetStatus(
      makeBudget({ month: "2026-06", amount: 50_000 }),
      31_000,
      "Restaurants",
      "2026-07-20",
    );
    expect(status.projected).toBe(31_000);
    expect(status.remaining).toBe(19_000);
  });

  it("goes negative on remaining when the envelope is blown", () => {
    const status = computeBudgetStatus(
      makeBudget({ amount: 10_000 }),
      15_000,
      "Restaurants",
      "2026-07-31",
    );
    expect(status.remaining).toBe(-5_000);
    expect(status.projected).toBe(15_000);
  });
});

describe("budget repository", () => {
  let db: Db;
  beforeEach(() => {
    db = createTestDb();
    return () => closeDb(db);
  });

  it("upserts by category and month", () => {
    const first = upsertBudget(db, {
      categoryId: "cat_restaurants",
      month: "2026-07",
      amount: 30_000,
    });
    const second = upsertBudget(db, {
      categoryId: "cat_restaurants",
      month: "2026-07",
      amount: 45_000,
    });
    expect(second.id).toBe(first.id);
    expect(second.amount).toBe(45_000);
    expect(listBudgets(db, "2026-07")).toHaveLength(1);
    expect(listBudgets(db, "2026-08")).toHaveLength(0);
  });

  it("counts spend from child categories and nets out refunds", () => {
    const account = insertAccount(db);
    upsertBudget(db, {
      categoryId: "cat_food",
      month: "2026-07",
      amount: 60_000,
    });
    insertTx(db, account.id, {
      amount: -30_000,
      date: "2026-07-03",
      categoryId: "cat_groceries",
      name: "Whole Foods",
    });
    insertTx(db, account.id, {
      amount: -12_000,
      date: "2026-07-05",
      categoryId: "cat_restaurants",
      name: "Dinner",
    });
    insertTx(db, account.id, {
      amount: 2_000,
      date: "2026-07-06",
      categoryId: "cat_restaurants",
      name: "Refund",
    });
    insertTx(db, account.id, {
      amount: -99_000,
      date: "2026-07-07",
      categoryId: "cat_rent",
      name: "Rent",
    });

    const [status] = listBudgetStatus(db, "2026-07", "2026-07-10");
    expect(status!.spent).toBe(40_000);
    expect(status!.remaining).toBe(20_000);
    expect(status!.categoryName).toBe("Food & Dining");
  });
});
