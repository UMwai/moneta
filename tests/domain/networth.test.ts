import { beforeEach, describe, expect, it } from "vitest";
import { closeDb, createTestDb, type Db } from "@/db";
import {
  aggregateSnapshots,
  currentNetWorth,
  getNetWorthSeries,
  updateAccount,
  writeSnapshot,
  type SnapshotInput,
} from "@/lib/domain/repos";
import { insertAccount } from "./helpers";

const snap = (
  date: string,
  accountId: string,
  accountType: SnapshotInput["accountType"],
  balance: number,
): SnapshotInput => ({ date, accountId, accountType, balance, currency: "USD" });

describe("net worth aggregation", () => {
  it("splits assets from liabilities by account type", () => {
    const [point] = aggregateSnapshots([
      snap("2026-07-01", "a", "checking", 500_000),
      snap("2026-07-01", "b", "investment", 1_200_000),
      snap("2026-07-01", "c", "credit", 80_000),
      snap("2026-07-01", "d", "loan", 2_000_000),
    ]);
    expect(point).toEqual({
      date: "2026-07-01",
      assets: 1_700_000,
      liabilities: 2_080_000,
      net: -380_000,
    });
  });

  it("treats a liability the same whichever sign the provider used", () => {
    const [positive] = aggregateSnapshots([snap("2026-07-01", "c", "credit", 80_000)]);
    const [negative] = aggregateSnapshots([snap("2026-07-01", "c", "credit", -80_000)]);
    expect(positive!.liabilities).toBe(80_000);
    expect(negative!.liabilities).toBe(80_000);
  });

  it("carries a balance forward on days an account did not report", () => {
    const points = aggregateSnapshots([
      snap("2026-07-01", "a", "checking", 500_000),
      snap("2026-07-01", "b", "credit", 100_000),
      snap("2026-07-02", "a", "checking", 450_000),
    ]);
    expect(points).toHaveLength(2);
    expect(points[1]).toEqual({
      date: "2026-07-02",
      assets: 450_000,
      liabilities: 100_000,
      net: 350_000,
    });
  });

  it("carries balances from before the window into the first point", () => {
    const points = aggregateSnapshots(
      [
        snap("2026-06-30", "a", "checking", 500_000),
        snap("2026-07-02", "b", "savings", 200_000),
      ],
      { from: "2026-07-01" },
    );
    expect(points).toHaveLength(1);
    expect(points[0]).toEqual({
      date: "2026-07-02",
      assets: 700_000,
      liabilities: 0,
      net: 700_000,
    });
  });
});

describe("snapshot repository", () => {
  let db: Db;
  beforeEach(() => {
    db = createTestDb();
    return () => closeDb(db);
  });

  it("writes one row per open account per day and overwrites a re-run", () => {
    const checking = insertAccount(db, { name: "Checking", balance: 500_000 });
    const card = insertAccount(db, {
      name: "Card",
      type: "credit",
      balance: 120_000,
    });

    expect(writeSnapshot(db, "2026-07-01")).toBe(2);
    updateAccount(db, checking.id, { balance: 400_000 });
    writeSnapshot(db, "2026-07-01");

    const series = getNetWorthSeries(db);
    expect(series).toHaveLength(1);
    expect(series[0]).toEqual({
      date: "2026-07-01",
      assets: 400_000,
      liabilities: 120_000,
      net: 280_000,
    });
    expect(card.type).toBe("credit");
  });

  it("skips archived accounts and honours the date window", () => {
    const checking = insertAccount(db, { balance: 500_000 });
    writeSnapshot(db, "2026-06-30");
    updateAccount(db, checking.id, { balance: 600_000 });
    writeSnapshot(db, "2026-07-05");
    updateAccount(db, checking.id, { archived: true });
    expect(writeSnapshot(db, "2026-07-06")).toBe(0);

    const series = getNetWorthSeries(db, { from: "2026-07-01", to: "2026-07-31" });
    expect(series.map((p) => p.date)).toEqual(["2026-07-05"]);
    expect(series[0]!.net).toBe(600_000);
  });

  it("computes current net worth from live balances", () => {
    insertAccount(db, { balance: 500_000 });
    insertAccount(db, { type: "loan", balance: 1_500_000 });
    const now = currentNetWorth(db);
    expect(now.assets).toBe(500_000);
    expect(now.liabilities).toBe(1_500_000);
    expect(now.net).toBe(-1_000_000);
  });
});
