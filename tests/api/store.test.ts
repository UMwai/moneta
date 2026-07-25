import { describe, expect, it } from "vitest";

import { parseImportFile } from "@/lib/server/import";
import { InMemoryStore } from "@/lib/server/store";
import type { Account, Transaction } from "@/lib/types";

const account: Account = {
  id: "account-1",
  name: "Checking",
  officialName: null,
  type: "checking",
  currency: "USD",
  balance: 0,
  available: null,
  institution: null,
  connectionId: null,
  mask: null,
  archived: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

function transaction(
  id: string,
  date: string,
  name: string,
  amount: number,
  categoryId: string | null,
): Transaction {
  return {
    id,
    accountId: account.id,
    externalId: null,
    amount,
    currency: "USD",
    date,
    name,
    merchant: null,
    categoryId,
    pending: false,
    notes: null,
    recurringSeriesId: null,
    createdAt: `${date}T12:00:00.000Z`,
    updatedAt: `${date}T12:00:00.000Z`,
  };
}

const transactions = [
  transaction("tx-1", "2026-07-01", "Corner Market", -2500, "groceries"),
  transaction("tx-2", "2026-07-02", "Cafe", -900, "dining"),
  transaction("tx-3", "2026-07-03", "Salary", 250000, "income"),
  transaction("tx-4", "2026-06-30", "Old Cafe", -700, "dining"),
];

describe("InMemoryStore transaction queries", () => {
  it("filters before calculating total and paginating", async () => {
    const store = new InMemoryStore({
      accounts: [account],
      transactions,
      categories: [
        {
          id: "dining",
          name: "Dining",
          parentId: null,
          icon: null,
          discretionary: true,
          system: true,
        },
      ],
    });

    const firstPage = await store.listTransactions({
      categoryId: "dining",
      from: "2026-06-01",
      to: "2026-07-31",
      limit: 1,
      offset: 0,
    });
    expect(firstPage).toMatchObject({ total: 2, limit: 1, offset: 0 });
    expect(firstPage.items.map((item) => item.id)).toEqual(["tx-2"]);

    const secondPage = await store.listTransactions({
      categoryId: "dining",
      limit: 1,
      offset: 1,
    });
    expect(secondPage.items.map((item) => item.id)).toEqual(["tx-4"]);
  });

  it("matches free text and account filters", async () => {
    const store = new InMemoryStore({
      accounts: [account],
      transactions,
    });

    const result = await store.listTransactions({
      accountId: account.id,
      q: "market",
      limit: 50,
      offset: 0,
    });
    expect(result.total).toBe(1);
    expect(result.items[0].id).toBe("tx-1");
  });

  it("imports each row once and ignores a re-import of the same file", async () => {
    const store = new InMemoryStore({ accounts: [account] });
    const file = [
      "Date,Description,Amount",
      "2026-07-04,Bookshop,-19.99",
      // The same charge twice on one day is a real thing banks do, so both rows
      // must land; only a re-import of the file is a duplicate.
      "2026-07-04,Bookshop,-19.99",
    ].join("\n");
    const batch = () => ({
      ...parseImportFile(file, "statement.csv"),
      accountId: account.id,
    });

    await expect(store.importTransactions(batch())).resolves.toEqual({
      imported: 2,
    });
    await expect(store.importTransactions(batch())).resolves.toEqual({
      imported: 0,
    });
  });
});
