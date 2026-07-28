import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, createTestDb, type Db } from "@/db";
import { verifyPassword } from "@/lib/auth/passwords";
import { periodOf } from "@/lib/domain/dates";
import {
  countTransactions,
  countUsers,
  findUserByUsername,
  getNetWorthSeries,
  listAccounts,
  listBudgets,
  listInsights,
  listRecurring,
} from "@/lib/domain/repos";
import {
  DEMO_PASSWORD,
  DEMO_USERNAME,
  seedDemo,
} from "@/lib/demo/seed";
import { DrizzleStore } from "@/lib/server/store";

const NOW = new Date(2026, 6, 20, 12, 0, 0);
const PERIOD = "2026-07";

function state(db: Db) {
  return {
    users: countUsers(db),
    accounts: listAccounts(db, { includeArchived: true }).length,
    transactions: countTransactions(db),
    budgets: listBudgets(db, PERIOD).length,
    recurring: listRecurring(db).length,
    insights: listInsights(db).length,
    netWorth: getNetWorthSeries(db).length,
  };
}

describe("demo seed", () => {
  let db: Db;

  beforeEach(() => {
    vi.stubEnv("DEMO", "0");
    db = createTestDb();
  });

  afterEach(() => {
    closeDb(db);
    vi.unstubAllEnvs();
  });

  it("does nothing when DEMO is unset", () => {
    vi.stubEnv("DEMO", "");
    const before = state(db);

    expect(seedDemo(db, { now: NOW })).toEqual({
      seeded: false,
      accounts: 0,
      transactions: 0,
      snapshots: 0,
      insights: 0,
    });
    expect(state(db)).toEqual(before);
  });

  it("seeds atomically once and leaves every count stable on a second call", async () => {
    vi.stubEnv("DEMO", "1");

    const first = seedDemo(db, { now: NOW });
    const afterFirst = state(db);
    const second = seedDemo(db, { now: NOW });
    const user = findUserByUsername(db, DEMO_USERNAME);

    expect(first.seeded).toBe(true);
    expect(first.accounts).toBe(4);
    expect(first.transactions).toBeGreaterThan(500);
    expect(second.seeded).toBe(false);
    expect(state(db)).toEqual(afterFirst);
    expect(user?.username).toBe(DEMO_USERNAME);
    await expect(
      verifyPassword(user!.passwordHash, DEMO_PASSWORD),
    ).resolves.toBe(true);
  });

  it("runs the real derivation pipeline and backfills weekly net worth", () => {
    vi.stubEnv("DEMO", "1");
    seedDemo(db, { now: NOW });

    const insights = listInsights(db, { period: periodOf("2026-07-20") });
    const kinds = new Set(insights.map((insight) => insight.kind));
    const netWorth = getNetWorthSeries(db);
    const budgets = listBudgets(db, PERIOD);

    expect(kinds.size).toBeGreaterThanOrEqual(3);
    expect(kinds).toContain("category_spike");
    expect(kinds).toContain("budget_breach_forecast");
    expect(netWorth.length).toBeGreaterThanOrEqual(55);
    expect(budgets).toHaveLength(3);
    expect(listRecurring(db).length).toBeGreaterThanOrEqual(9);
  });

  it("is invoked by the store's migrate-on-first-touch path", async () => {
    vi.stubEnv("DEMO", "1");
    const store = new DrizzleStore(db);

    await expect(store.hasUser()).resolves.toBe(true);
    await expect(store.listAccounts()).resolves.toHaveLength(4);
  });
});
