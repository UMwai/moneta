import { beforeEach, describe, expect, it } from "vitest";
import { closeDb, createTestDb, type Db } from "@/db";
import {
  advanceByCadence,
  cadenceFromGap,
  detectRecurring,
  isStillActive,
  syncRecurringSeries,
} from "@/lib/domain/recurring";
import { getTransaction, listRecurring } from "@/lib/domain/repos";
import { insertAccount, insertTx, makeTx, monthlyDates } from "./helpers";

function series(
  opts: {
    dates: string[];
    amount: number;
    name: string;
    merchant?: string | null;
    accountId?: string;
    jitter?: number[];
  },
) {
  return opts.dates.map((date, i) =>
    makeTx({
      date,
      name: opts.name,
      merchant: opts.merchant ?? null,
      amount: opts.amount + (opts.jitter?.[i] ?? 0),
      accountId: opts.accountId ?? "acc_main",
    }),
  );
}

describe("cadence inference", () => {
  it.each([
    [7, "weekly"],
    [14, "biweekly"],
    [30, "monthly"],
    [31, "monthly"],
    [91, "quarterly"],
    [365, "yearly"],
  ])("maps a %i day gap to %s", (gap, cadence) => {
    expect(cadenceFromGap(gap)).toBe(cadence);
  });

  it("rejects gaps that match no cadence", () => {
    expect(cadenceFromGap(3)).toBeNull();
    expect(cadenceFromGap(55)).toBeNull();
    expect(cadenceFromGap(200)).toBeNull();
  });

  it("advances by calendar month, not 30 days", () => {
    expect(advanceByCadence("2026-01-31", "monthly")).toBe("2026-02-28");
    expect(advanceByCadence("2026-07-05", "weekly")).toBe("2026-07-12");
    expect(advanceByCadence("2026-07-05", "yearly")).toBe("2027-07-05");
  });

  it("retires a series only after two missed periods", () => {
    // one charge missed (July 5) — still a live subscription
    expect(isStillActive("2026-06-05", "monthly", "2026-07-20")).toBe(true);
    // June and July both missed — treat it as cancelled
    expect(isStillActive("2026-05-05", "monthly", "2026-07-20")).toBe(false);
    expect(isStillActive("2026-04-05", "monthly", "2026-07-20")).toBe(false);
  });
});

describe("detectRecurring", () => {
  it("finds a monthly subscription and predicts the next charge", () => {
    const txs = series({
      dates: monthlyDates("2026-02-05", 6),
      amount: -1_599,
      name: "NETFLIX.COM",
      merchant: "Netflix",
    });
    const [found, ...rest] = detectRecurring(txs, { today: "2026-07-20" });
    expect(rest).toHaveLength(0);
    expect(found).toMatchObject({
      cadence: "monthly",
      amount: -1_599,
      merchant: "Netflix",
      firstDate: "2026-02-05",
      lastDate: "2026-07-05",
      nextExpectedDate: "2026-08-05",
      occurrences: 6,
      active: true,
    });
  });

  it("tolerates small price changes but ignores a one-off spike", () => {
    const txs = series({
      dates: monthlyDates("2026-02-10", 5),
      amount: -1_000,
      name: "GYM MEMBERSHIP",
      // last charge is a one-off annual fee, far outside the ±10% band
      jitter: [0, -50, 40, 0, -20_000],
    });
    const [found] = detectRecurring(txs, { today: "2026-06-20" });
    expect(found!.cadence).toBe("monthly");
    expect(found!.occurrences).toBe(4);
    expect(Math.abs(found!.amount)).toBeLessThan(1_100);
  });

  it("detects biweekly income as a series too", () => {
    const dates = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(2026, 3, 3 + i * 14);
      return d.toISOString().slice(0, 10);
    });
    const [found] = detectRecurring(
      series({ dates, amount: 250_000, name: "ACME PAYROLL" }),
      { today: "2026-06-20" },
    );
    expect(found!.cadence).toBe("biweekly");
    expect(found!.amount).toBeGreaterThan(0);
  });

  it("ignores irregular one-off spending at the same merchant", () => {
    const txs = [
      makeTx({ date: "2026-03-02", name: "CORNER BODEGA", amount: -1_200 }),
      makeTx({ date: "2026-03-19", name: "CORNER BODEGA", amount: -1_180 }),
      makeTx({ date: "2026-05-27", name: "CORNER BODEGA", amount: -1_250 }),
      makeTx({ date: "2026-06-02", name: "CORNER BODEGA", amount: -1_150 }),
    ];
    expect(detectRecurring(txs, { today: "2026-07-01" })).toHaveLength(0);
  });

  it("needs at least three charges before calling it a series", () => {
    const txs = series({
      dates: ["2026-05-05", "2026-06-05"],
      amount: -999,
      name: "SPOTIFY",
    });
    expect(detectRecurring(txs, { today: "2026-07-01" })).toHaveLength(0);
  });

  it("keeps series from different accounts apart", () => {
    const txs = [
      ...series({
        dates: monthlyDates("2026-03-05", 4),
        amount: -1_599,
        name: "NETFLIX",
        accountId: "acc_a",
      }),
      ...series({
        dates: monthlyDates("2026-03-09", 4),
        amount: -1_599,
        name: "NETFLIX",
        accountId: "acc_b",
      }),
    ];
    expect(detectRecurring(txs, { today: "2026-06-20" })).toHaveLength(2);
  });

  it("marks a stopped subscription inactive", () => {
    const txs = series({
      dates: monthlyDates("2026-01-05", 4),
      amount: -1_599,
      name: "NETFLIX",
    });
    const [found] = detectRecurring(txs, { today: "2026-07-20" });
    expect(found!.lastDate).toBe("2026-04-05");
    expect(found!.active).toBe(false);
  });
});

describe("syncRecurringSeries", () => {
  let db: Db;
  beforeEach(() => {
    db = createTestDb();
    return () => closeDb(db);
  });

  it("persists detected series and links their transactions", () => {
    const account = insertAccount(db);
    const ids = monthlyDates("2026-02-05", 6).map(
      (date) =>
        insertTx(db, account.id, {
          date,
          name: "NETFLIX.COM",
          merchant: "Netflix",
          amount: -1_599,
        }).id,
    );

    const result = syncRecurringSeries(db, { today: "2026-07-20" });
    expect(result.detected).toBe(1);
    expect(result.linked).toBe(6);

    const [saved] = listRecurring(db);
    expect(saved!.cadence).toBe("monthly");
    expect(saved!.nextExpectedDate).toBe("2026-08-05");
    for (const txId of ids) {
      expect(getTransaction(db, txId)!.recurringSeriesId).toBe(saved!.id);
    }

    // Re-running must update in place rather than create a second series.
    syncRecurringSeries(db, { today: "2026-07-20" });
    expect(listRecurring(db)).toHaveLength(1);
  });

  it("retires a series once the charges stop", () => {
    const account = insertAccount(db);
    for (const date of monthlyDates("2026-01-05", 4)) {
      insertTx(db, account.id, {
        date,
        name: "NETFLIX.COM",
        merchant: "Netflix",
        amount: -1_599,
      });
    }
    syncRecurringSeries(db, { today: "2026-07-20" });
    expect(listRecurring(db, { activeOnly: true })).toHaveLength(0);
    expect(listRecurring(db)[0]!.active).toBe(false);
  });
});
