import { describe, expect, it } from "vitest";

import {
  DEMO_LEDGER_SEED,
  generateDemoLedger,
} from "@/lib/demo/generate";

const NOW = new Date(2026, 6, 20, 12, 0, 0);

describe("demo ledger generator", () => {
  it("is deterministic for the same seed and calendar edge", () => {
    const first = generateDemoLedger({ now: NOW, seed: DEMO_LEDGER_SEED });
    const second = generateDemoLedger({ now: NOW, seed: DEMO_LEDGER_SEED });

    expect(second).toEqual(first);
    expect(
      generateDemoLedger({ now: NOW, seed: DEMO_LEDGER_SEED + 1 }),
    ).not.toEqual(first);
  });

  it("produces a realistic bounded household ledger", () => {
    const ledger = generateDemoLedger({ now: NOW });
    const salaries = ledger.transactions.filter((transaction) =>
      transaction.name.includes("PAYROLL"),
    );
    const credit = ledger.accounts.find((account) => account.type === "credit");
    const investmentSnapshots = ledger.snapshots.filter(
      (snapshot) => snapshot.account === "investment",
    );
    const subscriptionMerchants = new Set(
      ledger.transactions
        .filter((transaction) =>
          [
            "Netflix",
            "Spotify",
            "iCloud",
            "Equinox Gym",
            "Amazon Prime",
            "NY Times",
            "1Password",
            "Dropbox",
            "Disney+",
          ].includes(transaction.merchant ?? ""),
        )
        .map((transaction) => transaction.merchant),
    );

    expect(ledger.accounts).toHaveLength(4);
    expect(ledger.transactions.length).toBeGreaterThan(500);
    expect(salaries.length).toBeGreaterThanOrEqual(29);
    expect(salaries.length).toBeLessThanOrEqual(32);
    expect(credit?.balance).toBeLessThan(0);
    expect(subscriptionMerchants.size).toBe(9);
    expect(
      investmentSnapshots.at(-1)!.balance -
        investmentSnapshots[0]!.balance,
    ).toBeGreaterThan(1_000_000);

    expect(
      ledger.transactions.every(
        (transaction) =>
          transaction.amount !== 0 &&
          Number.isInteger(transaction.amount) &&
          transaction.date >= ledger.startDate &&
          transaction.date <= ledger.endDate,
      ),
    ).toBe(true);
    expect(
      ledger.snapshots.every(
        (snapshot) =>
          snapshot.date >= ledger.startDate &&
          snapshot.date <= ledger.endDate,
      ),
    ).toBe(true);
  });
});
